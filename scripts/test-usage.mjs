// Surveillance du plan gratuit Cloudflare : comptage des opérations KV, modes économie et critique,
// compteurs déplacés hors KV (IA, essais, rappels), rapport pour l'administrateur.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'shred-usage-'));
await build({
  entryPoints: ['worker/index.ts', 'worker/health.ts', 'worker/places.ts', 'src/lib/crypto.ts'],
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
const places = await import(pathToFileURL(join(dir, 'worker/places.js')).href);
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
  DATA_KEY: 'cle-de-chiffrement-de-test-0123456789',
  MOCK_AI: '1',
  KV,
  ASSETS: { fetch: async (r) => (new URL(r.url).pathname === '/manifest.webmanifest' ? Response.json({ name: 'Shred', start_url: '/' }) : new Response('app')) },
  FETCH: async (url, init) => {
    fetched.push(String(url));
    if (String(url).includes('overpass')) {
      const q = decodeURIComponent(String(init.body).slice(5));
      fetchedBodies.push(q);
      return Response.json({
        elements: [
          { type: 'node', id: 1, lat: 36.8065, lon: 10.1815, tags: { leisure: 'fitness_centre', name: 'California Gym', 'addr:street': 'Avenue Habib Bourguiba', 'addr:city': 'Tunis' } },
          { type: 'way', id: 2, center: { lat: 36.8066, lon: 10.1816 }, tags: { leisure: 'fitness_centre', name: 'California Gym' } },
          { type: 'node', id: 3, lat: 36.82, lon: 10.17, tags: { leisure: 'fitness_centre', name: 'Salle du quartier' } },
          { type: 'node', id: 4, lat: 36.81, lon: 10.18, tags: { leisure: 'fitness_centre' } },
        ],
      });
    }
    if (String(url).includes('nominatim')) return Response.json([{ lat: '36.8065', lon: '10.1815', display_name: 'Tunis, Gouvernorat de Tunis, Tunisie' }]);
    if (String(url).includes('api.deezer.com/search')) {
      return Response.json({
        data: [
          { id: 777, title: 'Titre', title_short: 'Titre', link: 'https://www.deezer.com/track/777', preview: 'https://cdnt-preview.dzcdn.net/a.mp3?hdnea=x', artist: { name: 'Artiste' }, album: { cover_medium: 'https://e-cdns-images.dzcdn.net/c.jpg' } },
          { id: 778, title: 'Autre titre', link: 'https://www.deezer.com/track/778', preview: 'https://cdnt-preview.dzcdn.net/b.mp3', artist: { name: 'Adrian Mills' }, album: { cover_medium: 'https://e-cdns-images.dzcdn.net/d.jpg' } },
        ],
      });
    }
    if (String(url).includes('api.deezer.com/track/778')) return Response.json({ preview: 'https://cdnt-preview.dzcdn.net/frais.mp3' });
    if (String(url).includes('soundcloud.com/oembed')) {
      return Response.json({ title: 'Mon son by DJ Test', author_name: 'DJ Test', thumbnail_url: 'https://i1.sndcdn.com/artworks-x.jpg' });
    }
    if (String(url).includes('itunes')) {
      if (appleDown) return new Response('forbidden', { status: 403 });
      return Response.json({
        results: [
          { kind: 'song', trackId: 123, trackName: 'Titre', artistName: 'Artiste', artworkUrl100: 'https://is1-ssl.mzstatic.com/a/100x100bb.jpg', previewUrl: 'https://audio-ssl.itunes.apple.com/p.m4a', trackViewUrl: 'https://music.apple.com/fr/album/x?i=123' },
          { kind: 'music-video', trackId: 9, trackViewUrl: 'https://music.apple.com/x' },
        ],
      });
    }
    return new Response('nope', { status: 404 });
  },
  USAGE: { idFromName: () => 'usage', get: () => ({ fetch: (url, init) => (doCalls++, usage.fetch(new Request(url, init))) }) },
};
const waits = [];
const fetched = [];
const fetchedBodies = [];
let appleDown = false;
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

/* ---------- Salles autour de soi, partout dans le monde ---------- */

r = await call('/api/places/gyms?lat=36.80652&lon=10.18151', { token });
check('salles autour d’un point à Tunis', r.status === 200 && r.data.places[0].name === 'California Gym' && r.data.places[0].address === 'Avenue Habib Bourguiba, Tunis', JSON.stringify(r.data.places?.[0]));
check('une même salle en point et en bâtiment : un seul résultat', r.data.places.filter((p) => p.name === 'California Gym').length === 1);
check('lieu sans nom ignoré, triées par distance', r.data.places.length === 2 && r.data.places[0].distance <= r.data.places[1].distance);
check('position arrondie à ~100 m avant d’être envoyée', fetchedBodies[0].includes('36.807,10.182'), fetchedBodies[0]);
r = await call('/api/places/gyms?lat=36.8&lon=10.18&q=califor"nia', { token });
check('recherche par nom, caractères spéciaux retirés', fetchedBodies[1].includes('"name"~"california",i') && fetchedBodies[1].includes('around:25000'), fetchedBodies[1]);
r = await call('/api/places/gyms?lat=200&lon=10', { token });
check('position impossible : refusée', r.status === 400);
r = await call('/api/places/gyms?lat=36.8&lon=10.18');
check('réservé aux membres connectés', r.status === 401);
r = await call('/api/places/geocode?q=Tunis', { token });
check('ville en position (sans localisation)', r.status === 200 && Math.abs(r.data.lat - 36.8065) < 0.001 && r.data.label.startsWith('Tunis'));

/* ---------- Musique des publications ---------- */

r = await call('/api/music/search?q=titre', { token });
check('recherche de musique : Apple puis Deezer, sans doublon', r.status === 200 && r.data.tracks.length === 2 && r.data.tracks[0].source === 'apple' && r.data.tracks[0].artwork.includes('300x300bb') && r.data.tracks[1].source === 'deezer' && r.data.tracks[1].artist === 'Adrian Mills', JSON.stringify(r.data.tracks?.map((x) => [x.source, x.title])));
const t = r.data.tracks[0];
appleDown = true;
r = await call('/api/music/search?q=adrian', { token });
check('Apple indisponible : Deezer prend le relais', r.status === 200 && r.data.tracks.every((x) => x.source === 'deezer') && r.data.tracks.length === 2);
r = await call('/api/music/deezer/778', { token });
check('extrait Deezer redemandé frais au moment d’écouter', r.data.preview === 'https://cdnt-preview.dzcdn.net/frais.mp3');
r = await call('/api/music/soundcloud?url=' + encodeURIComponent('https://soundcloud.com/dj-test/mon-son?si=abc'), { token });
check('lien SoundCloud : titre sans « by artiste », lien nettoyé', r.status === 200 && r.data.track.title === 'Mon son' && r.data.track.artist === 'DJ Test' && r.data.track.link === 'https://soundcloud.com/dj-test/mon-son', JSON.stringify(r.data));
r = await call('/api/music/soundcloud?url=' + encodeURIComponent('https://evil.example/x'), { token });
check('lien hors SoundCloud refusé', r.status === 400);
check('Deezer accepté dans une publication, sans extrait stocké', places.sanitizeTrack({ source: 'deezer', id: '778', title: 'a', artist: 'b', artwork: 'https://e-cdns-images.dzcdn.net/d.jpg', link: 'https://www.deezer.com/track/778', preview: 'https://x' })?.preview === undefined);
check('SoundCloud accepté dans une publication', places.sanitizeTrack({ source: 'soundcloud', title: 'a', artist: 'b', link: 'https://soundcloud.com/a/b' })?.id === 'https://soundcloud.com/a/b');
check('faux lien Deezer refusé', places.sanitizeTrack({ source: 'deezer', id: '1', link: 'https://deezer.com.evil.example/1' }) === undefined);
check('musique valide acceptée dans une publication', places.sanitizeTrack(t)?.id === '123');
check('lien hors Apple refusé', places.sanitizeTrack({ ...t, link: 'https://evil.example/x' }) === undefined);
check('extrait audio hors Apple retiré', places.sanitizeTrack({ ...t, preview: 'https://evil.example/a.mp3' })?.preview === undefined);
check('pochette hors Apple refusée', places.sanitizeTrack({ ...t, artwork: 'http://is1-ssl.mzstatic.com/a.jpg' }) === undefined);

/* ---------- Sécurité ---------- */

const keys2 = await kdf.deriveKeys('pirate@exemple.com', 'mot-de-passe-solide');
r = await call('/api/auth/register', { body: { email: 'pirate@exemple.com', name: 'Pirate', invite: env.ADMIN_CODE, key: keys2.auth } });
check('code administrateur : inutilisable une fois le premier admin créé', r.status === 403 && /déjà utilisé/.test(r.data.error), r.data.error);
check('services de notification connus seulement', mod.pushHostOk('https://web.push.apple.com/abc') && mod.pushHostOk('https://fcm.googleapis.com/fcm/send/x') && !mod.pushHostOk('https://evil.example/x') && !mod.pushHostOk('https://fcm.googleapis.com.evil.example/x') && !mod.pushHostOk('http://fcm.googleapis.com/x'));
const html = mod.secureAsset(new Response('<html></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }));
check('page de l’app : scripts de Shred seulement, pas dans un cadre', /script-src 'self'(;|$)/.test(html.headers.get('content-security-policy') ?? '') && html.headers.get('x-frame-options') === 'DENY' && html.headers.get('x-content-type-options') === 'nosniff');
const img = mod.secureAsset(new Response('x', { headers: { 'content-type': 'image/png' } }));
check('fichiers : nosniff, sans CSP inutile', img.headers.get('x-content-type-options') === 'nosniff' && !img.headers.get('content-security-policy'));
const foreign = await worker.fetch(new Request('https://shred.test/api/version', { headers: { origin: 'https://evil.example' } }), env, ctx);
check('autre site : pas d’accès CORS à l’API', !foreign.headers.get('access-control-allow-origin'));
const native = await worker.fetch(new Request('https://shred.test/api/version', { headers: { origin: 'capacitor://localhost' } }), env, ctx);
check('app iPhone : accès CORS autorisé', native.headers.get('access-control-allow-origin') === 'capacitor://localhost');
let last;
for (let i = 0; i < 16; i++) last = await call('/api/club/avatar', { token, method: 'PUT', body: { photo: null } });
check('plafond du jour par membre (photo de profil : 15)', last.status === 429 && /Limite du jour/.test(last.data.error), String(last.status));

/* ---------- Chiffrement au repos ---------- */

const rawAcct = [...kv.entries()].find(([k]) => k.startsWith('acct:'))[1].value;
check('email chiffré dans la base', rawAcct.includes('sealed:v1:') && !rawAcct.includes('selim@exemple.com'));
check('index des comptes chiffré aussi', kv.get('idx:users').value.includes('sealed:v1:') && !kv.get('idx:users').value.includes('@'));
r = await call('/api/health', { token });
check('mais l’app reçoit l’email en clair', r.data.user?.email === 'selim@exemple.com', JSON.stringify(r.data.user));
// Les essais ratés plus haut ont bloqué la connexion pour un quart d'heure : on remet le compteur à zéro.
for (const k of [...mem.keys()]) if (k.startsWith('c:rl:')) mem.delete(k);
r = await call('/api/auth/login', { body: { email: 'selim@exemple.com', key: keys.auth } });
check('connexion toujours possible (recherche par empreinte)', r.status === 200);

const sealMod = await import(pathToFileURL(join(dir, 'worker/index.js')).href);
check('ajout d’une nouvelle clé : les anciennes valeurs restent lisibles', await (async () => {
  const old = { VAPID_PRIVATE_KEY: 'ancienne-cle-vapid' };
  const v = await sealMod.sealForTest(old, 'a@b.c');
  return v.startsWith('sealed:v1:') && (await sealMod.unsealForTest({ ...old, DATA_KEY: 'nouvelle' }, v)) === 'a@b.c' && (await sealMod.unsealForTest({ DATA_KEY: 'autre' }, v)) === '';
})());

/* ---------- Session en cookie HttpOnly ---------- */

const login = await worker.fetch(
  new Request('https://shred.test/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.9.9.9' }, body: JSON.stringify({ email: 'selim@exemple.com', key: keys.auth }) }),
  env,
  ctx,
);
const setCookie = login.headers.get('set-cookie') ?? '';
const tok = (await login.json()).token;
check('connexion : cookie HttpOnly, Secure, SameSite=Strict, limité à /api', /shred_session=/.test(setCookie) && /HttpOnly/.test(setCookie) && /Secure/.test(setCookie) && /SameSite=Strict/.test(setCookie) && /Path=\/api/.test(setCookie), setCookie);
const cookie = `shred_session=${tok}`;
const viaCookie = async (path, init = {}) => {
  const res = await worker.fetch(new Request(`https://shred.test${path}`, { ...init, headers: { 'content-type': 'application/json', cookie, ...(init.headers ?? {}) } }), env, ctx);
  return { status: res.status, data: await res.json().catch(() => ({})), headers: res.headers };
};
r = await viaCookie('/api/health');
check('le cookie seul suffit pour lire', r.status === 200);
r = await viaCookie('/api/profile', { method: 'PUT', body: JSON.stringify({}) });
check('écriture avec le cookie sans X-Shred : refusée (autre site)', r.status === 403, String(r.status));
r = await viaCookie('/api/auth/cookie', { method: 'POST', body: '{}', headers: { 'x-shred': '1' } });
check('écriture avec le cookie et X-Shred : acceptée', r.status !== 403 && r.status !== 401, String(r.status));
r = await call('/api/auth/cookie', { token: tok, body: {} });
check('passage au cookie pour un téléphone déjà connecté', r.status === 200);
r = await viaCookie('/api/auth/logout', { method: 'POST', body: '{}', headers: { 'x-shred': '1' } });
check('déconnexion : cookie effacé', /Max-Age=0/.test(r.headers.get('set-cookie') ?? ''));
r = await viaCookie('/api/health');
check('après déconnexion, le cookie ne vaut plus rien', r.status === 401);

/* ---------- Installation depuis un lien d'invitation ---------- */

const man = await worker.fetch(new Request('https://shred.test/manifest.webmanifest?invite=K7QX2-M9PLD'), env, ctx);
const manifest = await man.json();
check('lien d’invitation : l’app installée s’ouvre avec le code', manifest.start_url === '/?invite=K7QX2-M9PLD' && manifest.name === 'Shred');
const bad = await worker.fetch(new Request('https://shred.test/manifest.webmanifest?invite=%3Cscript%3E'), env, ctx);
check('code d’invitation bizarre : manifeste normal', (await bad.json()).start_url === '/');

console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
