// Comptes : invitations, connexion, isolation des données, clé Raccourcis, sauvegarde chiffrée, administration.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'shred-auth-'));
await build({
  entryPoints: ['worker/index.ts', 'worker/users.ts', 'src/lib/crypto.ts'],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outdir: dir,
  logLevel: 'error',
  external: ['cloudflare:*'],
});
const worker = (await import(pathToFileURL(join(dir, 'worker/index.js')).href)).default;
const users = await import(pathToFileURL(join(dir, 'worker/users.js')).href);
const kdf = await import(pathToFileURL(join(dir, 'src/lib/crypto.js')).href);

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

/* KV en mémoire, avec métadonnées, listes et expiration. */
const kv = new Map();
const KV = {
  async get(k) {
    const e = kv.get(k);
    return e ? e.value : null;
  },
  async getWithMetadata(k) {
    const e = kv.get(k);
    return { value: e?.value ?? null, metadata: e?.metadata ?? null };
  },
  async put(k, value, opts = {}) {
    kv.set(k, {
      value,
      metadata: opts.metadata ?? null,
      expiration: opts.expirationTtl ? Math.floor(Date.now() / 1000) + opts.expirationTtl : undefined,
    });
  },
  async delete(k) {
    kv.delete(k);
  },
  async list({ prefix = '' } = {}) {
    const keys = [...kv.entries()].filter(([k]) => k.startsWith(prefix)).map(([name, e]) => ({ name, metadata: e.metadata, expiration: e.expiration }));
    return { keys, list_complete: true };
  },
};

const env = {
  ADMIN_CODE: 'code-admin-local-123',
  GUEST_AI_LIMIT: '0',
  MOCK_AI: '1',
  KV,
  ASSETS: { fetch: async () => new Response('app') },
};

let ipCounter = 1;
async function call(path, { token, body, method, ip, auth } = {}) {
  const res = await worker.fetch(
    new Request(`https://shred.test${path}`, {
      method: method ?? (body ? 'POST' : 'GET'),
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': ip ?? `10.0.0.${ipCounter}`,
        ...(auth !== undefined ? { authorization: auth } : token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
  );
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const t0 = Date.now();
const selimKeys = await kdf.deriveKeys('Selim@Exemple.com ', 'mot-de-passe-solide');
check('clés dérivées sur le téléphone (32 octets, deux clés différentes)', selimKeys.auth.length === 43 && selimKeys.auth !== selimKeys.data, `${Date.now() - t0} ms`);
const again = await kdf.deriveKeys('selim@exemple.com', 'mot-de-passe-solide');
check('même email (casse ignorée) et même mot de passe → même clé', again.auth === selimKeys.auth);

let r = await call('/api/auth/register', { body: { email: 'selim@exemple.com', name: 'Selim', invite: 'FAUX0-CODE0', key: selimKeys.auth } });
check('inscription sans invitation valable refusée', r.status === 403, r.data.error);

r = await call('/api/auth/register', { body: { email: 'selim@exemple.com', name: 'Selim', invite: env.ADMIN_CODE, key: selimKeys.auth } });
check('le code admin crée un compte administrateur', r.status === 200 && r.data.user.role === 'admin', JSON.stringify(r.data.user));
let selim = r.data.token;

const stored = JSON.parse(kv.get(`acct:${r.data.user.id}`).value);
check('le serveur ne garde ni mot de passe ni clé, seulement une empreinte', !JSON.stringify(stored).includes('mot-de-passe') && stored.hash !== selimKeys.auth);

r = await call('/api/health', { token: selim });
check('session reconnue', r.status === 200 && r.data.user.name === 'Selim');

r = await call('/api/admin/invites', { token: selim, body: { note: 'Mehdi' } });
check('invitation créée', r.status === 200 && /^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(r.data.code), r.data.code);
const invite = r.data.code;

const mehdiKeys = await kdf.deriveKeys('mehdi@exemple.com', 'autre-mot-de-passe');
r = await call('/api/auth/register', {
  body: { email: 'mehdi@exemple.com', name: 'Mehdi', invite: invite.toLowerCase().replace('-', ' '), key: mehdiKeys.auth },
});
check('inscription avec l’invitation (tapée en minuscules)', r.status === 200 && r.data.user.role === 'member');
let mehdi = r.data.token;
const mehdiId = r.data.user.id;

r = await call('/api/auth/register', { body: { email: 'autre@exemple.com', name: 'Autre', invite, key: mehdiKeys.auth } });
check('une invitation ne sert qu’une fois', r.status === 403);

const inv2 = (await call('/api/admin/invites', { token: selim, body: {} })).data.code;
r = await call('/api/auth/register', { body: { email: 'MEHDI@exemple.com', name: 'Mehdi bis', invite: inv2, key: mehdiKeys.auth } });
check('un email ne peut avoir qu’un compte', r.status === 409);

r = await call('/api/auth/login', { body: { email: 'mehdi@exemple.com', key: selimKeys.auth } });
check('mauvais mot de passe refusé', r.status === 401);
r = await call('/api/auth/login', { body: { email: 'Mehdi@exemple.com', key: mehdiKeys.auth } });
check('connexion', r.status === 200 && r.data.user.name === 'Mehdi');

ipCounter = 50;
let last;
for (let i = 0; i < 11; i++) last = await call('/api/auth/login', { body: { email: 'personne@exemple.com', key: mehdiKeys.auth } });
check('trop d’essais : bloqué un quart d’heure', last.status === 429, last.data.error);
ipCounter = 2;

await call('/api/health/ingest', { token: selim, body: { steps: 9000 } });
await call('/api/health/ingest', { token: mehdi, body: { steps: 1200 } });
const a = (await call('/api/health/recent?days=1', { token: selim })).data;
const b = (await call('/api/health/recent?days=1', { token: mehdi })).data;
check(
  'données séparées par personne',
  Object.values(a.days)[0]?.health?.steps === 9000 && Object.values(b.days)[0]?.health?.steps === 1200,
);

r = await call('/api/admin/overview', { token: mehdi });
check('un invité n’a pas accès à l’administration', r.status === 403);

r = await call('/api/account/device-key', { token: mehdi, body: {} });
const shortcutKey = r.data.key;
check('clé Raccourcis créée', r.status === 200 && shortcutKey.startsWith('shk_'));
r = await call('/api/health/ingest', { token: shortcutKey, body: { steps: 4321 } });
check('la clé Raccourcis envoie Santé', r.status === 200);
for (const auth of [`bearer ${shortcutKey}`, `Bearer:${shortcutKey}`, `Bearer${shortcutKey}`, shortcutKey, ` Bearer  ${shortcutKey} `]) {
  r = await call('/api/health/ingest', { auth, body: { steps: 4322 } });
  check(`en-tête tapé à la main accepté : « ${auth.replace(shortcutKey, 'clé')} »`, r.status === 200, JSON.stringify(r.data));
}
r = await call('/api/health/ingest', { body: { steps: 4323 } });
check('sans en-tête : message qui dit quoi ajouter', r.status === 401 && /en-tête Authorization/.test(r.data.error), r.data.error);
r = await call('/api/health/ingest', { auth: 'Bearer ', body: { steps: 4323 } });
check('« Bearer » sans clé (variable vide) : même message', r.status === 401 && /en-tête Authorization/.test(r.data.error), r.data.error);
r = await call('/api/health/ingest', { auth: 'Bearer shk_mauvaise', body: { steps: 4323 } });
check('clé fausse : refusée', r.status === 401);
r = await call('/api/gym/checkin', { token: shortcutKey, body: {} });
check('la clé Raccourcis signale la salle', r.status === 200);
r = await call('/api/backup', { token: shortcutKey });
check('la clé Raccourcis ne lit rien d’autre', r.status === 403);

const state = { version: 1, days: { '2026-10-12': { mainDone: true } }, settings: { name: 'Mehdi' } };
const box = await kdf.seal(mehdiKeys.data, JSON.stringify(state));
r = await call('/api/backup', { token: mehdi, method: 'PUT', body: box });
check('sauvegarde envoyée', r.status === 200 && r.data.savedAt > 0);
const raw = kv.get(`u:${mehdiId}:backup`).value;
check('le serveur ne voit qu’un bloc chiffré', !raw.includes('Mehdi') && !raw.includes('mainDone'));
r = await call('/api/backup?meta=1', { token: mehdi });
check('date de sauvegarde sans le contenu', r.data.savedAt > 0 && !r.data.data);
r = await call('/api/backup', { token: mehdi });
const back = JSON.parse(await kdf.unseal(mehdiKeys.data, r.data));
check('sauvegarde récupérée et déchiffrée', back.days['2026-10-12'].mainDone === true);
let wrongKey = false;
try {
  await kdf.unseal(selimKeys.data, r.data);
} catch {
  wrongKey = true;
}
check('illisible avec la clé de quelqu’un d’autre', wrongKey);
r = await call('/api/backup?meta=1', { token: selim });
check('chacun sa sauvegarde', r.data.savedAt === null);

const newKeys = await kdf.deriveKeys('mehdi@exemple.com', 'nouveau-mot-de-passe');
r = await call('/api/account/password', { token: mehdi, body: { current: mehdiKeys.auth, next: newKeys.auth } });
check('changement de mot de passe', r.status === 200 && r.data.token);
const oldToken = mehdi;
mehdi = r.data.token;
r = await call('/api/health', { token: oldToken });
check('les anciennes sessions tombent', r.status === 401);
r = await call('/api/health', { token: mehdi });
check('la nouvelle session marche', r.status === 200);

r = await call('/api/admin/users/' + mehdiId + '/reset', { token: selim, body: {} });
const resetCode = r.data.code;
check('code de réinitialisation créé par l’admin', r.status === 200 && resetCode);
const resetKeys = await kdf.deriveKeys('mehdi@exemple.com', 'mot-de-passe-oublie');
r = await call('/api/auth/reset', { body: { email: 'mehdi@exemple.com', code: 'XXXXX-XXXXX', key: resetKeys.auth } });
check('mauvais code refusé', r.status === 403);
r = await call('/api/auth/reset', { body: { email: 'mehdi@exemple.com', code: resetCode, key: resetKeys.auth } });
check('mot de passe réinitialisé avec le code', r.status === 200 && r.data.backupCleared === true);
check('l’ancienne sauvegarde, illisible, est effacée', !kv.has(`u:${mehdiId}:backup`));
r = await call('/api/auth/reset', { body: { email: 'mehdi@exemple.com', code: resetCode, key: resetKeys.auth } });
check('un code ne sert qu’une fois', r.status === 403);
mehdi = (await call('/api/auth/login', { body: { email: 'mehdi@exemple.com', key: resetKeys.auth } })).data.token;

r = await call('/api/coach', { token: mehdi, body: { messages: [{ role: 'user', content: 'Salut' }] } });
check('IA intégrée fermée aux invités si GUEST_AI_LIMIT=0', r.status === 403);
r = await call('/api/coach', { token: selim, body: { messages: [{ role: 'user', content: 'Salut' }], memory: '2026-10-12 Push : développé 70 kg × 8' } });
check('IA de l’admin, avec extraits d’historique', r.status === 200);

r = await call('/api/profile', { token: mehdi, method: 'PUT', body: { visible: true, data: { streak: 12, best: 20, flames: 2, tier: 2, level: 7, email: 'fuite@exemple.com', poids: 80, radar: [{ id: 'chest', name: 'Pecs', short: 'Pecs', grade: 'B', score: 3.4 }, { id: 'x<script>', name: 'Bras', short: 'Bras', grade: 'Z', score: 99 }] } } });
check('profil public publié', r.status === 200);
r = await call('/api/profile', { token: selim, method: 'PUT', body: { visible: false, data: { streak: 99 } } });
r = await call('/api/profiles', { token: selim });
const others = r.data.profiles ?? [];
const pm = others.find((p) => p.name === 'Mehdi');
check('les profils visibles apparaissent', pm?.streak === 12 && pm?.best === 20 && pm?.radar?.[0]?.grade === 'B');
check('un profil privé n’apparaît pas', !others.some((p) => p.name === 'Selim'));
check('seuls les champs prévus sont publiés', pm && !('email' in pm) && !('poids' in pm) && pm.radar[1].grade === null && pm.radar[1].score === null && pm.radar[1].id === 'xscript', JSON.stringify(pm?.radar?.[1]));
r = await call('/api/profiles', { token: shortcutKey });
check('la clé Raccourcis ne lit pas les profils', r.status === 403);
r = await call('/api/profile', { token: mehdi, method: 'PUT', body: { visible: false } });
r = await call('/api/profiles', { token: selim });
check('repasser en privé retire le profil', !(r.data.profiles ?? []).some((p) => p.name === 'Mehdi'));

r = await call('/api/admin/shortcuts', { token: selim, method: 'PUT', body: { health: 'https://exemple.com/piege' } });
check('lien de raccourci hors iCloud refusé', r.status === 400);
r = await call('/api/admin/shortcuts', { token: mehdi, method: 'PUT', body: { health: 'https://www.icloud.com/shortcuts/abc123' } });
check('seul l’admin règle les liens des raccourcis', r.status === 403);
r = await call('/api/admin/shortcuts', { token: selim, method: 'PUT', body: { health: 'https://www.icloud.com/shortcuts/abc123', gymIn: '', gymOut: 'https://www.icloud.com/shortcuts/def456' } });
r = await call('/api/health', { token: mehdi });
check('chaque testeur reçoit les liens à installer', r.data.shortcuts?.health === 'https://www.icloud.com/shortcuts/abc123' && !r.data.shortcuts?.gymIn, JSON.stringify(r.data.shortcuts));

r = await call('/api/admin/overview', { token: selim });
check('l’admin voit les comptes et les invitations', r.data.users.length === 2 && r.data.invites.length === 1, `${r.data.users.length} comptes, ${r.data.invites.length} invitation(s)`);
check('les emails n’apparaissent pas dans les clés', [...kv.keys()].every((k) => !k.includes('@')));

const cron = await users.allUsers(env);
check('le cron voit les deux comptes', cron.length === 2);

r = await call(`/api/admin/users/${mehdiId}`, { token: selim, method: 'DELETE' });
check('l’admin retire un compte', r.status === 200);
check('toutes ses données sont effacées', ![...kv.keys()].some((k) => k.includes(mehdiId)));
r = await call('/api/auth/login', { body: { email: 'mehdi@exemple.com', key: resetKeys.auth } });
check('il ne peut plus se connecter', r.status === 401);
r = await call('/api/health/ingest', { token: shortcutKey, body: { steps: 1 } });
check('sa clé Raccourcis ne marche plus', r.status === 401);

r = await call('/api/auth/logout', { token: selim, body: {} });
r = await call('/api/health', { token: selim });
check('déconnexion : la session est fermée', r.status === 401);

console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent.');
process.exit(failures ? 1 : 0);
