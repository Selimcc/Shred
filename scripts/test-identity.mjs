// Identité : @pseudo unique (vérification en direct, sosies, noms réservés, limite de changements, ancien pseudo
// réservé), surnom et bio, changement d'email de connexion, suggestions de faute de frappe.
import { build } from 'esbuild';
import { workerShims } from './worker-shims.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'shred-identity-'));
await build({
  entryPoints: ['worker/index.ts', 'worker/users.ts', 'src/lib/crypto.ts', 'shared/handle.ts', 'shared/email-typo.ts'],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outdir: dir,
  logLevel: 'error',
  external: ['cloudflare:*'],
  ...workerShims,
});
const worker = (await import(pathToFileURL(join(dir, 'worker/index.js')).href)).default;
const users = await import(pathToFileURL(join(dir, 'worker/users.js')).href);
const kdf = await import(pathToFileURL(join(dir, 'src/lib/crypto.js')).href);
const hd = await import(pathToFileURL(join(dir, 'shared/handle.js')).href);
const typo = await import(pathToFileURL(join(dir, 'shared/email-typo.js')).href);

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
      expiration: opts.expiration ?? (opts.expirationTtl ? Math.floor(Date.now() / 1000) + opts.expirationTtl : undefined),
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
  DATA_KEY: 'racine-de-test-pour-le-chiffrement-au-repos',
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


/* ---------- Règles, sans serveur ---------- */
check('pseudo valable', hd.handleProblem('selim.fit') === null);
check('trop court refusé', hd.handleProblem('se') !== null);
check('accents et espaces refusés', hd.handleProblem('élodie') !== null || hd.normHandle('Élodie') === 'elodie');
check('@ et majuscules normalisés', hd.normHandle('@Selim_JB') === 'selim_jb');
check('commence par un chiffre : refusé', hd.handleProblem('1selim') !== null);
check('point final ou doublé refusé', hd.handleProblem('selim.') !== null && hd.handleProblem('se..lim') !== null);
check('nom réservé refusé (admin, sosie adm1n, shred.officiel)', hd.handleProblem('admin') !== null && hd.handleProblem('adm1n') !== null && hd.handleProblem('shred.team') !== null);
check('prénom courant accepté (claude, mehdi)', hd.handleProblem('claude') === null && hd.handleProblem('mehdi') === null);
check('sosies : se1im = selim = s.e.l.i.m', hd.skeleton('se1im') === hd.skeleton('selim') && hd.skeleton('s.e.l.i.m') === hd.skeleton('selim'));

check('gmial.com → gmail.com', typo.emailSuggestion('selim@gmial.com') === 'selim@gmail.com');
check('hotmial.fr → hotmail.fr', typo.emailSuggestion('a@hotmial.fr') === 'a@hotmail.fr');
check('gmail.con → gmail.com', typo.emailSuggestion('a@gmail.con') === 'a@gmail.com');
check('adresse correcte : pas de suggestion', typo.emailSuggestion('a@gmail.com') === null && typo.emailSuggestion('a@cesi.fr') === null);

/* ---------- Serveur ---------- */
const sk = await kdf.deriveKeys('selim@exemple.com', 'mot-de-passe-solide');
let r = await call('/api/auth/register', { body: { email: 'selim@exemple.com', name: 'Selim', invite: env.ADMIN_CODE, key: sk.auth } });
const selim = r.data.token;
r = await call('/api/account/identity', { token: selim });
check('pseudo donné à l’inscription, tiré du prénom', r.status === 200 && r.data.handle === 'selim', JSON.stringify(r.data));
check('2 changements possibles au départ', r.data.handleChangesLeft === 2);

const inv = (await call('/api/admin/invites', { token: selim, body: { uses: 5, days: 7 } })).data.code;
const mk = await kdf.deriveKeys('mehdi@exemple.com', 'autre-mot-de-passe');
r = await call('/api/auth/register', { body: { email: 'mehdi@exemple.com', name: 'Selim', invite: inv, key: mk.auth } });
let mehdi = r.data.token;
r = await call('/api/account/identity', { token: mehdi });
check('même prénom : un autre pseudo libre est donné', r.data.handle && r.data.handle !== 'selim' && !r.data.handle.startsWith('se1'), r.data.handle);

r = await call('/api/account/handle?h=selim', { token: mehdi });
check('pseudo pris : refusé avec 3 propositions libres', r.data.ok === false && r.data.suggestions?.length === 3 && !r.data.suggestions.includes('selim'), JSON.stringify(r.data));
r = await call('/api/account/handle?h=SE1IM', { token: mehdi });
check('sosie d’un pseudo existant refusé', r.data.ok === false && /proche/.test(r.data.reason), r.data.reason);
r = await call('/api/account/handle?h=mehdi.fit', { token: mehdi });
check('pseudo libre accepté', r.data.ok === true);
r = await call('/api/account/handle?h=selim', { token: selim });
check('son propre pseudo : « c’est le tien »', r.data.ok === true && r.data.mine === true);

r = await call('/api/account/identity', { token: mehdi, method: 'PUT', body: { handle: 'selim' } });
check('prendre le pseudo d’un autre : 409', r.status === 409);
r = await call('/api/account/identity', { token: mehdi, method: 'PUT', body: { handle: 'mehdi.fit', name: 'Mehdi', nick: '  Le grand frère ', bio: 'Ingé logiciel.\n\n\n\nSquat le lundi.‮abc' } });
check('pseudo, prénom, surnom et bio enregistrés', r.status === 200 && r.data.handle === 'mehdi.fit' && r.data.name === 'Mehdi' && r.data.nick === 'Le grand frère', JSON.stringify(r.data));
check('bio nettoyée (lignes vides et caractères invisibles retirés)', r.data.bio === 'Ingé logiciel.\n\nSquat le lundi.abc', JSON.stringify(r.data.bio));
check('premier vrai changement compté', r.data.handleChangesLeft === 1);
const oldMehdi = (await call('/api/account/identity', { token: mehdi })).data;

r = await call('/api/account/identity', { token: mehdi, method: 'PUT', body: { bio: 'x'.repeat(500) } });
check('bio limitée à 160 caractères', r.data.bio.length === 160);

r = await call('/api/account/identity', { token: mehdi, method: 'PUT', body: { handle: 'mehdi.jb' } });
check('deuxième changement accepté', r.status === 200 && r.data.handleChangesLeft === 0);
r = await call('/api/account/identity', { token: mehdi, method: 'PUT', body: { handle: 'mehdi.three' } });
check('troisième changement en 14 jours refusé, avec la date', r.status === 429 && /Prochain changement/.test(r.data.error), r.data.error);

r = await call('/api/account/handle?h=mehdi.fit', { token: selim });
check('ancien pseudo réservé à son ancien propriétaire (14 jours)', r.data.ok === false, JSON.stringify(r.data));
check('l’index et la recherche par pseudo suivent', kv.get('handle:mehdi.jb')?.value && !kv.get('handle:mehdi.fit'));

r = await call('/api/account/identity', { token: selim, method: 'PUT', body: { handle: 'admin' } });
check('pseudo réservé refusé par le serveur', r.status === 400);
r = await call('/api/account/identity', { token: selim, method: 'PUT', body: { name: '   ' } });
check('prénom vide refusé', r.status === 400);
r = await call('/api/account/identity', { token: selim, method: 'PUT', body: { name: 'Selim', handle: 'selim' } });
check('garder son pseudo ne compte pas comme un changement', r.status === 200 && r.data.handleChangesLeft === 2);

/* ---------- Changer l'email de connexion ---------- */
const nk = await kdf.deriveKeys('mehdi.jabnoun@exemple.com', 'autre-mot-de-passe');
r = await call('/api/account/email', { token: mehdi, body: { email: 'selim@exemple.com', current: mk.auth, next: (await kdf.deriveKeys('selim@exemple.com', 'autre-mot-de-passe')).auth } });
check('email déjà utilisé par un autre compte : refusé', r.status === 409, r.data.error);
r = await call('/api/account/email', { token: mehdi, body: { email: 'mehdi.jabnoun@exemple.com', current: sk.auth, next: nk.auth } });
check('mauvais mot de passe : refusé', r.status === 403);
r = await call('/api/account/email', { token: mehdi, body: { email: 'mehdi.jabnoun@exemple.com', current: mk.auth, next: nk.auth } });
check('email changé', r.status === 200 && r.data.user.email === 'mehdi.jabnoun@exemple.com');
const fresh = r.data.token;
r = await call('/api/health', { token: mehdi });
check('les autres sessions sont fermées', r.status === 401);
r = await call('/api/health', { token: fresh });
check('la nouvelle session marche', r.status === 200);
r = await call('/api/auth/login', { body: { email: 'mehdi.jabnoun@exemple.com', key: nk.auth } });
check('connexion avec le nouvel email', r.status === 200);
r = await call('/api/auth/login', { body: { email: 'mehdi@exemple.com', key: mk.auth } });
check('l’ancien email ne marche plus', r.status === 401);
const clear = [...kv.entries()].filter(([, e]) => String(e.value).includes('mehdi.jabnoun@exemple.com')).map(([k]) => k);
check('l’email reste chiffré au repos', !clear.length, clear.join(', '));
mehdi = fresh;

/* ---------- Suppression : le pseudo est libéré ---------- */
r = await call('/api/account', { token: fresh, method: 'DELETE', body: { key: nk.auth } });
check('compte supprimé', r.status === 200);
check('pseudo libéré', !kv.get('handle:mehdi.jb'));
r = await call('/api/account/handle?h=mehdi.jb', { token: selim });
check('le pseudo d’un compte supprimé redevient libre', r.data.ok === true);

console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
