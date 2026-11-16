// Surveillance du plan gratuit Cloudflare : comptage des opérations KV, modes économie et critique,
// compteurs déplacés hors KV (IA, essais, rappels), rapport pour l'administrateur.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'shred-usage-'));
await build({
  entryPoints: ['worker/index.ts', 'worker/health.ts', 'src/lib/crypto.ts'],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outdir: dir,
  logLevel: 'error',
  external: ['cloudflare:*'],
});
const mod = await import(pathToFileURL(join(dir, 'worker/index.js')).href);
const worker = mod.default;
const health = await import(pathToFileURL(join(dir, 'worker/health.js')).href);
const kdf = await import(pathToFileURL(join(dir, 'src/lib/crypto.js')).href);

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

const kv = new Map();
const KV = {
  async get(k) {
    return kv.get(k)?.value ?? null;
  },
  async getWithMetadata(k) {
    const e = kv.get(k);
    return { value: e?.value ?? null, metadata: e?.metadata ?? null };
  },
  async put(k, value, opts = {}) {
    kv.set(k, { value, metadata: opts.metadata ?? null });
  },
  async delete(k) {
    kv.delete(k);
  },
  async list({ prefix = '' } = {}) {
    return { keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
  },
};
const mem = new Map();
const storage = {
  async get(k) {
    return structuredClone(mem.get(k));
  },
  async put(k, v) {
    mem.set(k, structuredClone(v));
  },
  async delete(k) {
    for (const key of Array.isArray(k) ? k : [k]) mem.delete(key);
  },
  async list({ prefix = '', reverse = false, limit = Infinity, end } = {}) {
    let keys = [...mem.keys()].filter((k) => k.startsWith(prefix)).sort();
    if (end) keys = keys.filter((k) => k < end);
    if (reverse) keys.reverse();
    return new Map(keys.slice(0, limit).map((k) => [k, structuredClone(mem.get(k))]));
  },
};
const usage = new mod.Usage({ storage }, {});
let doCalls = 0;
const env = {
  ADMIN_CODE: 'code-admin-local-123',
  MOCK_AI: '1',
  KV,
  ASSETS: { fetch: async (r) => (new URL(r.url).pathname === '/manifest.webmanifest' ? Response.json({ name: 'Shred', start_url: '/' }) : new Response('app')) },
  USAGE: { idFromName: () => 'usage', get: () => ({ fetch: (url, init) => (doCalls++, usage.fetch(new Request(url, init))) }) },
};
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
let ip = 1;
async function call(path, { token, body, method } = {}) {
  const res = await worker.fetch(
    new Request(`https://shred.test${path}`, {
      method: method ?? (body ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.2.0.${ip++}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
    ctx,
  );
  await Promise.all(waits.splice(0));
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const keys = await kdf.deriveKeys('selim@exemple.com', 'mot-de-passe-solide');
const reg = await call('/api/auth/register', { body: { email: 'selim@exemple.com', name: 'Selim', invite: env.ADMIN_CODE, key: keys.auth } });
const token = reg.data.token;
check('compte créé', Boolean(token));

/* ---------- Comptage ---------- */

let r = await call('/api/admin/usage', { token });
const today = r.data.days[0];
check('rapport du jour pour l’administrateur', r.status === 200 && r.data.tracked && today.day === new Date().toISOString().slice(0, 10));
check('les requêtes de l’API sont comptées', today.requests.used >= 2, String(today.requests.used));
check('les écritures KV sont comptées (inscription : compte, email, index, session)', today.kvWrite.used >= 4, String(today.kvWrite.used));
check('écritures rangées par usage', today.writes.some((w) => w.name === 'comptes') && today.writes.some((w) => w.name === 'connexions'), JSON.stringify(today.writes));
check('limites du plan gratuit jointes', r.data.limits.kvWrite === 1000 && r.data.limits.kvRead === 100000 && today.kvWrite.limit === 1000);
check('projection sur la journée au rythme actuel', today.kvWrite.projected >= today.kvWrite.used);
check('mode normal au départ', r.data.mode === 'normal');

const member = await call('/api/admin/usage', { token: 'x'.repeat(40) });
check('rapport refusé sans être connecté', member.status === 401);

/* ---------- Compteurs hors KV ---------- */

const before = [...kv.keys()].length;
for (let i = 0; i < 3; i++) await call('/api/coach', { token, body: { messages: [{ role: 'user', content: 'Salut' }] } });
check('les requêtes IA du jour ne s’écrivent plus dans KV', ![...kv.keys()].some((k) => k.includes(':usage:')), [...kv.keys()].filter((k) => k.includes('usage')).join());
check('elles sont comptées dans le compteur', [...mem.keys()].some((k) => k.startsWith('c:ai:')));
for (let i = 0; i < 10; i++) await call('/api/auth/login', { body: { email: 'selim@exemple.com', key: keys.auth.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) } });
r = await call('/api/auth/login', { body: { email: 'selim@exemple.com', key: keys.auth.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) } });
check('essais de connexion limités sans écrire dans KV', r.status === 429 && ![...kv.keys()].some((k) => k.startsWith('rl:')));
check('pas d’autre clé KV créée par ces appels', [...kv.keys()].length === before, `${before} → ${kv.size}`);

/* ---------- Modes ---------- */

const day = new Date().toISOString().slice(0, 10);
const forceWrites = (n) => mem.set(`d:${day}`, { ...mem.get(`d:${day}`), kvWrite: n });
forceWrites(650);
// Le mode est gardé une minute en mémoire : on attend un nouvel envoi.
r = await call('/api/admin/usage', { token });
check('au-delà de 60 % des écritures : mode économie', r.data.days[0].mode === 'economy', r.data.days[0].mode);
check('règle des modes', health && JSON.stringify(['normal', 'economy', 'critical']) === JSON.stringify([0.5, 0.65, 0.95].map((x) => (x >= 0.9 ? 'critical' : x >= 0.6 ? 'economy' : 'normal'))));

const prev = { at: new Date(Date.now() - 20 * 60_000).toISOString(), steps: 4000, activeKcal: 200 };
const next = { ...prev, steps: 4300, activeKcal: 220, at: new Date().toISOString() };
check('santé, mode normal : petit changement enregistré après 15 min', health.worthSaving(prev, next, new Date(), health.HEALTH_GAP.normal));
check('santé, mode économie : il attend 1 h', !health.worthSaving(prev, next, new Date(), health.HEALTH_GAP.economy));
check('santé, mode économie : un gros écart passe quand même', health.worthSaving(prev, { ...next, steps: 5200 }, new Date(), health.HEALTH_GAP.economy));
check('santé, mode critique : même un gros écart attend 3 h', !health.worthSaving(prev, { ...next, steps: 9000 }, new Date(), health.HEALTH_GAP.critical));
check('santé, mode critique : le sommeil aussi attend', !health.worthSaving(prev, { ...next, sleepMin: 420 }, new Date(), health.HEALTH_GAP.critical));
check('santé, mode normal : le sommeil passe tout de suite', health.worthSaving({ ...prev, at: new Date().toISOString() }, { ...next, sleepMin: 420 }, new Date(), health.HEALTH_GAP.normal));

/* ---------- Sauvegarde en mode économie ---------- */

const box = { iv: 'a'.repeat(16), data: 'b'.repeat(100) };
const waitMode = () => new Promise((res) => setTimeout(res, 0));
await waitMode();
// Le mode en mémoire suit le dernier envoi des compteurs, qui vient d'annoncer « économie ».
r = await call('/api/backup', { token, method: 'PUT', body: box });
check('mode économie : la première sauvegarde passe', r.status === 200, JSON.stringify(r.data));
r = await call('/api/backup', { token, method: 'PUT', body: box });
check('mode économie : une seconde dans la demi-heure attend', r.status === 429 && /économie/.test(r.data.error), r.data.error);

/* ---------- Installation depuis un lien d'invitation ---------- */

const man = await worker.fetch(new Request('https://shred.test/manifest.webmanifest?invite=K7QX2-M9PLD'), env, ctx);
const manifest = await man.json();
check('lien d’invitation : l’app installée s’ouvre avec le code', manifest.start_url === '/?invite=K7QX2-M9PLD' && manifest.name === 'Shred');
const bad = await worker.fetch(new Request('https://shred.test/manifest.webmanifest?invite=%3Cscript%3E'), env, ctx);
check('code d’invitation bizarre : manifeste normal', (await bad.json()).start_url === '/');

console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
