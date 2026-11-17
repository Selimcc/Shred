// Club (fil, photos, étincelles, commentaires, mentions, abonnements, notifications) et connexion Strava, de bout en bout.
import { build } from 'esbuild';
import { workerShims } from './worker-shims.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'shred-club-'));
await build({
  entryPoints: ['worker/index.ts', 'worker/club.ts', 'worker/strava.ts', 'src/lib/crypto.ts'],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outdir: dir,
  logLevel: 'error',
  external: ['cloudflare:*'],
  ...workerShims,
});
const worker = (await import(pathToFileURL(join(dir, 'worker/index.js')).href)).default;
const club = await import(pathToFileURL(join(dir, 'worker/club.js')).href);
const strava = await import(pathToFileURL(join(dir, 'worker/strava.js')).href);
const kdf = await import(pathToFileURL(join(dir, 'src/lib/crypto.js')).href);

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

/* KV en mémoire (valeurs texte ou binaires, métadonnées). */
const kv = new Map();
const KV = {
  async get(k, type) {
    const e = kv.get(k);
    if (!e) return null;
    return type === 'arrayBuffer' ? e.value : e.value;
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

/* Stockage de Durable Object en mémoire, trié comme le vrai (list avec prefix, reverse, limit, end). */
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
  async list({ prefix = '', reverse = false, limit = Infinity, end, start } = {}) {
    let keys = [...mem.keys()].filter((k) => k.startsWith(prefix)).sort();
    if (start) keys = keys.filter((k) => k >= start);
    if (end) keys = keys.filter((k) => k < end);
    if (reverse) keys.reverse();
    return new Map(keys.slice(0, limit).map((k) => [k, structuredClone(mem.get(k))]));
  },
};
const room = new club.Club({ storage }, {});
const env = {
  ADMIN_CODE: 'code-admin-local-123',
  MOCK_AI: '1',
  KV,
  ASSETS: { fetch: async () => new Response('app') },
  CLUB: { idFromName: () => 'club', get: () => ({ fetch: (url, init) => room.fetch(new Request(url, init)) }) },
};

let ip = 1;
async function call(path, { token, body, method } = {}) {
  const res = await worker.fetch(
    new Request(`https://shred.test${path}`, {
      method: method ?? (body ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.1.0.${ip++}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
  );
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json().catch(() => ({})) : type.startsWith('image/') || type.startsWith('video/') ? new Uint8Array(await res.arrayBuffer()) : await res.text();
  return { status: res.status, data, type };
}

async function register(email, name, invite) {
  const keys = await kdf.deriveKeys(email, 'mot-de-passe-solide');
  const r = await call('/api/auth/register', { body: { email, name, invite, key: keys.auth } });
  return { token: r.data.token, id: r.data.user.id };
}

const selim = await register('selim@exemple.com', 'Selim', env.ADMIN_CODE);
const inv = async () => (await call('/api/admin/invites', { token: selim.token, body: {} })).data.code;
const ines = await register('ines@exemple.com', 'Inès', await inv());
const yanis = await register('yanis@exemple.com', 'Yanis', await inv());

/* ---------- Publication, photo, mention ---------- */

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let r = await call('/api/club/posts', {
  token: selim.token,
  body: {
    text: 'Grosse séance jambes avec @Inès',
    mentions: [{ id: ines.id }, { id: 'inconnu-123456' }],
    photos: [png],
    session: { title: 'Bas du corps', kind: 'lifting', stats: [{ label: 'Séries', value: '18' }, { label: 'Volume', value: '6,2 t' }], date: '2026-11-16', evil: '<script>' },
  },
});
check('publication créée', r.status === 200 && r.data.post.photos.length === 1, r.data.error);
check('mentions vérifiées contre les membres', r.data.post.mentions.length === 1 && r.data.post.mentions[0].name === 'Inès');
check('résumé de séance nettoyé', !JSON.stringify(r.data.post.session).includes('script') && r.data.post.session.stats.length === 2);
const post1 = r.data.post;

r = await call(`/api/club/photo/${post1.photos[0]}`, { token: ines.token });
check('photo servie aux membres', r.status === 200 && r.type === 'image/png' && r.data.length > 20);
r = await call(`/api/club/photo/${post1.photos[0]}`);
check('photo refusée sans compte', r.status === 401);

r = await call('/api/club/posts', { token: selim.token, body: { photos: ['data:text/html;base64,PGgxPg=='] } });
check('fichier qui n’est pas une image refusé', r.status === 400);
r = await call('/api/club/posts', { token: selim.token, body: { text: '   ' } });
check('publication vide refusée', r.status === 400);

r = await call('/api/club/notifications', { token: ines.token });
check('la personne identifiée est prévenue', r.data.unread === 1 && r.data.notices[0].type === 'mention' && r.data.notices[0].actorName === 'Selim');

/* ---------- Visibilité ---------- */

await call('/api/club/posts', { token: yanis.token, body: { text: 'Footing tranquille', visibility: 'followers' } });
await call('/api/club/posts', { token: yanis.token, body: { text: 'Note pour moi', visibility: 'private' } });
r = await call('/api/club/feed', { token: selim.token });
check('« abonnés » et « moi seul » cachés aux autres', r.data.posts.length === 1 && r.data.posts[0].id === post1.id, r.data.posts.map((p) => p.text).join(' | '));
r = await call(`/api/club/follow/${yanis.id}`, { token: selim.token, body: {} });
check('abonnement', r.data.following === true);
r = await call('/api/club/feed', { token: selim.token });
check('abonné : la sortie réservée aux abonnés apparaît, pas la note privée', r.data.posts.length === 2 && !r.data.posts.some((p) => p.text === 'Note pour moi'));
r = await call('/api/club/feed', { token: yanis.token });
check('l’auteur voit tout ce qu’il publie', r.data.posts.filter((p) => p.mine).length === 2);
r = await call('/api/club/feed?filter=following', { token: ines.token });
check('fil « abonnements » vide sans abonnement', r.data.posts.length === 0);
r = await call(`/api/club/feed?filter=user:${selim.id}`, { token: ines.token });
check('fil d’un membre', r.data.posts.length === 1 && r.data.posts[0].author === selim.id);
r = await call('/api/club/notifications', { token: yanis.token });
check('nouvel abonné notifié', r.data.notices.some((n) => n.type === 'follow' && n.actorName === 'Selim'));

/* ---------- Étincelles et commentaires ---------- */

r = await call(`/api/club/posts/${post1.id}/spark`, { token: ines.token, body: {} });
check('étincelle envoyée', r.data.post.sparks === 1 && r.data.post.sparked);
r = await call(`/api/club/posts/${post1.id}/spark`, { token: ines.token, body: {} });
check('étincelle reprise au second appui', r.data.post.sparks === 0 && !r.data.post.sparked);
r = await call(`/api/club/posts/${post1.id}/spark`, { token: selim.token, body: {} });
check('pas d’étincelle pour sa propre séance', r.status === 400);
await call(`/api/club/posts/${post1.id}/spark`, { token: yanis.token, body: {} });
await call(`/api/club/posts/${post1.id}/spark`, { token: ines.token, body: {} });
r = await call(`/api/club/posts/${post1.id}/comments`, { token: yanis.token, body: { text: 'Propre ! @Inès tu viens la prochaine fois ?', mentions: [{ id: ines.id }] } });
check('commentaire', r.status === 200 && r.data.post.comments === 1);
const c1 = r.data.comment;
r = await call('/api/club/notifications', { token: selim.token });
check('l’auteur est prévenu du commentaire et des étincelles', r.data.notices.some((n) => n.type === 'comment') && r.data.notices.some((n) => n.type === 'spark'));
r = await call('/api/club/notifications', { token: ines.token });
check('mention dans un commentaire notifiée', r.data.notices.filter((n) => n.type === 'mention').length === 2);
await call('/api/club/notifications/read', { token: ines.token, body: {} });
r = await call('/api/club/notifications', { token: ines.token });
check('notifications lues', r.data.unread === 0);
r = await call(`/api/club/posts/${post1.id}`, { token: ines.token });
check('détail avec les commentaires', r.data.comments.length === 1 && r.data.comments[0].authorName === 'Yanis');
r = await call(`/api/club/posts/${post1.id}/comments/${c1.id}`, { token: ines.token, method: 'DELETE' });
check('on ne supprime pas le commentaire d’un autre', r.status === 403);
r = await call(`/api/club/posts/${post1.id}/comments/${c1.id}`, { token: selim.token, method: 'DELETE' });
check('l’auteur de la publication peut retirer un commentaire', r.status === 200 && r.data.post.comments === 0);

/* ---------- Modifier une publication ---------- */

r = await call(`/api/club/posts/${post1.id}`, { token: ines.token, method: 'PUT', body: { text: 'Piraté' } });
check('modification : refusée à qui n’est pas l’auteur', r.status === 403);
r = await call('/api/club/notifications', { token: yanis.token });
const yanisMentions = r.data.notices.filter((n) => n.type === 'mention').length;
r = await call(`/api/club/posts/${post1.id}`, { token: selim.token, method: 'PUT', body: { text: 'Grosse séance jambes avec @Inès et @Yanis', mentions: [{ id: ines.id }, { id: yanis.id }, { id: 'inconnu-123456' }] } });
check('modification : texte réécrit et marqué modifié', r.status === 200 && r.data.post.text.endsWith('@Yanis') && typeof r.data.post.editedAt === 'number', r.data.error);
check('modification : mentions revérifiées contre les membres', r.data.post.mentions.length === 2);
check('modification : photos, séance et étincelles gardées', r.data.post.photos.length === 1 && r.data.post.session?.title === 'Bas du corps' && r.data.post.sparks === 2);
const editedAt = r.data.post.editedAt;
r = await call('/api/club/notifications', { token: yanis.token });
check('modification : la personne ajoutée est prévenue', r.data.notices.filter((n) => n.type === 'mention').length === yanisMentions + 1);
r = await call('/api/club/notifications', { token: ines.token });
check('modification : la personne déjà identifiée ne l’est pas une deuxième fois', r.data.unread === 0);
r = await call(`/api/club/posts/${post1.id}`, { token: selim.token, method: 'PUT', body: { text: 'Grosse séance jambes avec @Inès et @Yanis', mentions: [{ id: ines.id }, { id: yanis.id }] } });
check('modification : même texte, rien ne change', r.data.post.editedAt === editedAt);
r = await call('/api/club/feed', { token: ines.token });
check('modification : visible dans le fil', r.data.posts.find((p) => p.id === post1.id)?.editedAt === editedAt);
r = await call('/api/club/posts', { token: ines.token, body: { text: 'Juste du texte' } });
const textOnly = r.data.post;
r = await call(`/api/club/posts/${textOnly.id}`, { token: ines.token, method: 'PUT', body: { text: '   ' } });
check('modification : texte vidé refusé sans photo ni séance', r.status === 400);
r = await call(`/api/club/posts/${textOnly.id}`, { token: selim.token, method: 'PUT', body: { text: 'L’admin réécrit' } });
check('modification : même un admin ne réécrit pas le texte d’un autre', r.status === 403);
r = await call(`/api/club/posts/${textOnly.id}`, { token: ines.token, method: 'PUT', body: { text: 'x'.repeat(5000) } });
check('modification : texte borné à 1000 caractères', r.status === 200 && r.data.post.text.length === 1000);
await call(`/api/club/posts/${textOnly.id}`, { token: ines.token, method: 'DELETE' });

/* ---------- Membres, photo de profil, suppression ---------- */

r = await call('/api/club/avatar', { token: ines.token, method: 'PUT', body: { photo: png } });
check('photo de profil', r.status === 200 && r.data.avatar);
r = await call('/api/club/members', { token: selim.token });
const me = r.data.members.find((m) => m.me);
check('membres : seulement mes relations (moi et Yanis que je suis), pas Inès', r.data.members.length === 2 && r.data.members.find((m) => m.id === yanis.id)?.following && !r.data.members.some((m) => m.id === ines.id));
r = await call('/api/club/search?q=@ine', { token: selim.token });
const ines2 = r.data.members.find((m) => m.id === ines.id);
check('recherche par pseudo : Inès trouvée, avec sa photo', me.posts === 1 && ines2?.avatar && ines2.handle === 'ines', JSON.stringify(r.data.members.map((m) => m.handle)));
r = await call('/api/club/search?q=i', { token: selim.token });
check('recherche : 2 caractères minimum', r.data.members.length === 0);
r = await call('/api/club/search?q=nes', { token: selim.token });
check('recherche dans le pseudo, pas par prénom seul', r.data.members.some((m) => m.id === ines.id));
check('étincelles reçues comptées pour l’auteur (elles deviennent de l’XP)', me.sparks === 2, String(me.sparks));
r = await call(`/api/club/posts/${post1.id}`, { token: ines.token, method: 'DELETE' });
check('on ne supprime pas la publication d’un autre', r.status === 403);
r = await call(`/api/club/posts/${post1.id}`, { token: selim.token, method: 'DELETE' });
check('suppression : la photo part avec', r.status === 200 && !kv.has(`club:photo:${post1.photos[0]}`));
r = await call('/api/club/members', { token: selim.token });
check('publication supprimée : ses étincelles ne comptent plus', r.data.members.find((m) => m.me).sparks === 0);

// Pagination : 25 publications, deux pages.
for (let i = 0; i < 25; i++) {
  await call('/api/club/posts', { token: ines.token, body: { text: `Séance ${i}` } });
  await new Promise((r) => setTimeout(r, 2)); // deux publications dans la même milliseconde n'ont pas d'ordre garanti
}
r = await call('/api/club/feed', { token: selim.token });
const page2 = await call(`/api/club/feed?before=${encodeURIComponent(r.data.next)}`, { token: selim.token });
check('fil paginé, sans doublon', r.data.posts.length === 20 && r.data.next && page2.data.posts.length === 6 && !page2.data.posts.some((p) => r.data.posts.some((q) => q.id === p.id)), `${r.data.posts.length} + ${page2.data.posts.length}`);
check('le plus récent en premier', r.data.posts[0].text === 'Séance 24');

/* ---------- Photos : seulement pour qui voit la publication ---------- */

{
  const img = `data:image/png;base64,${Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64').toString('base64')}`;
  let res = await call('/api/club/posts', { token: selim.token, body: { text: 'Pour moi seul', photos: [img], visibility: 'private' } });
  const ph = res.data.post.photos[0];
  const get = async (tk) => worker.fetch(new Request(`https://shred.test/api/club/photo/${ph}`, { headers: { authorization: `Bearer ${tk}`, 'cf-connecting-ip': '10.3.0.1' } }), env);
  check('photo d’une publication privée : visible par son auteur', (await get(selim.token)).status === 200);
  check('photo d’une publication privée : cachée aux autres, même avec son adresse', (await get(ines.token)).status === 404);
  res = await call('/api/club/posts', { token: selim.token, body: { text: 'Pour tous', photos: [img] } });
  const ph2 = res.data.post.photos[0];
  const pub = await worker.fetch(new Request(`https://shred.test/api/club/photo/${ph2}`, { headers: { authorization: `Bearer ${ines.token}` } }), env);
  check('photo d’une publication publique : visible par les membres', pub.status === 200);
}

/* ---------- Musique ---------- */

const track = { id: '123', title: 'Titre', artist: 'Artiste', artwork: 'https://is1-ssl.mzstatic.com/a/300x300bb.jpg', preview: 'https://audio-ssl.itunes.apple.com/p.m4a', link: 'https://music.apple.com/fr/album/x?i=123' };
r = await call('/api/club/posts', { token: selim.token, body: { text: 'Avec du son', music: track } });
check('publication avec musique', r.status === 200 && r.data.post.music?.title === 'Titre' && r.data.post.music.preview === track.preview);
r = await call('/api/club/posts', { token: selim.token, body: { music: track } });
check('une musique seule suffit pour publier', r.status === 200);
r = await call('/api/club/posts', { token: selim.token, body: { text: 'Lien piégé', music: { ...track, link: 'https://evil.example/x' } } });
check('musique hors Apple ignorée', r.status === 200 && !r.data.post.music);

/* ---------- Défis ---------- */

r = await call('/api/club/challenges', { token: selim.token });
check('porte-monnaie de départ : 5 disques', r.data.wallet?.plates === 5 && r.data.wallet.cap === 30 && r.data.nulos === 0, JSON.stringify(r.data.wallet));
r = await call('/api/club/challenges', { token: selim.token, body: { to: ines.id, hours: 48, text: 'Jambes avant jeudi ?' } });
const ch = r.data.challenge;
check('défi lancé : une mise d’un disque', r.status === 200 && ch.to === ines.id && ch.status === 'open' && ch.stake === 1 && r.data.wallet.plates === 4 && Math.abs(ch.due - ch.at - 48 * 3600_000) < 1000);
r = await call('/api/club/notifications', { token: ines.token });
check('la personne défiée est prévenue', r.data.notices.some((n) => n.type === 'challenge' && n.actorName === 'Selim' && n.text === 'Jambes avant jeudi ?'));
r = await call('/api/club/challenges', { token: selim.token, body: { to: selim.id } });
check('pas de défi à soi-même', r.status === 400);
r = await call('/api/club/challenges', { token: selim.token, body: { to: 'inconnu-1234' } });
check('membre inconnu : refusé', r.status === 404);
r = await call('/api/club/challenges', { token: selim.token, body: { to: ines.id, hours: 24 } });
check('un seul défi à la fois par personne', r.status === 409);
r = await call('/api/club/challenges', { token: selim.token, body: { to: yanis.id, hours: 24, gage: '  Payer le café  ' } });
const withGage = r.data.challenge;
check('défi avec gage : mise de 3 disques', r.status === 200 && withGage.stake === 3 && withGage.gage === 'Payer le café' && r.data.wallet.plates === 1, JSON.stringify(r.data));
r = await call('/api/club/notifications', { token: yanis.token });
check('le gage est annoncé', r.data.notices.some((n) => n.type === 'challenge' && /Gage : Payer le café/.test(n.text ?? '')));
const camille = await register('camille@exemple.com', 'Camille', await inv());
const nora = await register('nora@exemple.com', 'Nora', await inv());
r = await call('/api/club/challenges', { token: selim.token, body: { to: camille.id, gage: 'Payer le café' } });
check('pas assez de disques pour un gage : refusé', r.status === 402);
r = await call('/api/club/challenges', { token: selim.token, body: { to: camille.id } });
const toCamille = r.data.challenge;
check('dernier disque misé', r.status === 200 && r.data.wallet.plates === 0);
r = await call('/api/club/challenges', { token: selim.token, body: { to: nora.id } });
check('trois défis lancés en même temps, pas plus', r.status === 429);
r = await call('/api/club/challenges', { token: ines.token });
check('chacun voit ses défis', r.data.challenges.length === 1 && r.data.challenges[0].to === ines.id);
r = await call(`/api/club/challenges/${ch.id}/done`, { token: yanis.token, body: {} });
check('seule la personne défiée peut le relever', r.status === 404);
r = await call(`/api/club/challenges/${ch.id}/done`, { token: ines.token, body: {} });
check('défi relevé : la mise est pour elle', r.status === 200 && r.data.challenge.status === 'done' && !r.data.already && r.data.wallet.plates === 6);
r = await call(`/api/club/challenges/${ch.id}/done`, { token: ines.token, body: {} });
check('relevé une seule fois (pas d’XP ni de disque en double)', r.data.already === true);
r = await call('/api/club/notifications', { token: selim.token });
check('celui qui a lancé le défi est prévenu', r.data.notices.some((n) => n.type === 'challengeDone' && n.actorName === 'Inès'));
r = await call(`/api/club/member/${ines.id}`, { token: selim.token });
check('fiche : défis relevés', r.data.member.record?.won === 1 && !r.data.member.nulos, JSON.stringify(r.data.member.record));
r = await call('/api/club/challenges', { token: ines.token, body: { to: yanis.id, hours: 999 } });
check('délai inconnu : 48 h par défaut', Math.abs(r.data.challenge.due - r.data.challenge.at - 48 * 3600_000) < 1000);
r = await call('/api/club/challenges', { token: ines.token, body: { to: selim.id, rematch: ch.id } });
check('pas de revanche sur un défi relevé', r.status === 410);

/* ---------- Disques ---------- */

const todayKey = new Date(Date.now()).toISOString().slice(0, 10);
r = await call('/api/club/wallet', { token: nora.token, body: { day: todayKey, streak: 1 } });
check('journée validée : un disque de plus', r.status === 200 && r.data.gained === 1 && r.data.wallet.plates === 6, JSON.stringify(r.data));
r = await call('/api/club/wallet', { token: nora.token, body: { day: todayKey, streak: 1 } });
check('une seule fois par jour', r.data.gained === 0 && r.data.wallet.plates === 6);
r = await call('/api/club/wallet', { token: nora.token, body: { day: '2020-01-01', streak: 5 } });
check('journée trop ancienne refusée', r.status === 400);
r = await call('/api/club/wallet', { token: nora.token, body: { day: todayKey, streak: -3 } });
check('série invalide refusée', r.status === 400);

/* ---------- Strava ---------- */

r = await call('/api/strava/status', { token: selim.token });
check('Strava non configuré : statut clair', r.data.configured === false && r.data.connected === false);
r = await call('/api/strava/connect', { token: selim.token, body: {} });
check('Strava non configuré : connexion refusée proprement', r.status === 503);

env.STRAVA_CLIENT_ID = '12345';
env.STRAVA_CLIENT_SECRET = 'secret';
const realFetch = globalThis.fetch;
let tokenCalls = 0;
let activityAuth = '';
let revoke = false;
globalThis.fetch = async (input, init) => {
  const u = String(input instanceof Request ? input.url : input);
  if (u === 'https://www.strava.com/oauth/token') {
    tokenCalls++;
    const p = new URLSearchParams(String(init.body));
    if (p.get('grant_type') === 'authorization_code')
      return Response.json({ access_token: 'acc-1', refresh_token: 'ref-1', expires_at: Math.floor(Date.now() / 1000) - 10, athlete: { id: 7, firstname: 'Selim', lastname: 'Jabnoun' } });
    return Response.json({ access_token: 'acc-2', refresh_token: 'ref-2', expires_at: Math.floor(Date.now() / 1000) + 21600 });
  }
  if (u.startsWith('https://www.strava.com/api/v3/athlete/activities')) {
    activityAuth = init.headers.authorization;
    if (revoke) return new Response('{}', { status: 401 });
    return Response.json([
      { id: 99, name: 'Sortie du soir', sport_type: 'Run', start_date_local: '2026-11-15T18:02:00Z', moving_time: 2730, distance: 8420, total_elevation_gain: 41, average_heartrate: 151.2 },
      { id: 100, name: 'Home trainer', sport_type: 'VirtualRide', start_date_local: '2026-11-14T07:00:00Z', moving_time: 3600, distance: 30100, kilojoules: 640 },
      { id: 101, name: 'Sans durée', sport_type: 'Run', start_date_local: '2026-11-13T07:00:00Z', moving_time: 0 },
    ]);
  }
  if (u === 'https://www.strava.com/oauth/deauthorize') return new Response('{}');
  return realFetch(input, init);
};

r = await call('/api/strava/connect', { token: selim.token, body: {} });
const auth = new URL(r.data.url);
const state = auth.searchParams.get('state');
check('lien d’autorisation Strava', auth.hostname === 'www.strava.com' && auth.searchParams.get('redirect_uri') === 'https://shred.test/api/strava/callback' && auth.searchParams.get('scope').includes('activity:read_all'));
r = await call(`/api/strava/callback?state=${state}&code=abc&scope=read,activity:read_all`);
check('retour de Strava : compte relié', r.status === 200 && r.data.includes('Strava est relié') && kv.has(`u:${selim.id}:strava`));
r = await call(`/api/strava/callback?state=${state}&code=abc&scope=read,activity:read_all`);
check('un lien de connexion ne sert qu’une fois', r.data.includes('expiré'));
r = await call('/api/strava/status', { token: selim.token });
check('statut : relié, prénom et initiale', r.data.connected && r.data.athlete === 'Selim J');
check('les jetons ne sortent jamais du serveur', !JSON.stringify(r.data).includes('acc-') && !JSON.stringify(r.data).includes('ref-'));
r = await call('/api/strava/sync', { token: selim.token, body: {} });
check('jeton expiré : rafraîchi avant la synchro', tokenCalls === 2 && activityAuth === 'Bearer acc-2');
check('sorties importées et résumées', r.data.activities.length === 2 && r.data.activities[0].id === 'strava:99' && r.data.activities[0].sport === 'run' && r.data.activities[0].km === 8.42 && r.data.activities[0].min === 45.5);
check('vélo virtuel : sport et calories', r.data.activities[1].sport === 'bike' && r.data.activities[1].kcal === 640);
check('heure locale gardée telle quelle', r.data.activities[0].start === '2026-11-15T18:02:00');
await call('/api/strava/sync', { token: selim.token, body: {} });
check('jeton encore valable : pas de nouveau rafraîchissement', tokenCalls === 2);
r = await call('/api/strava/callback?error=access_denied&state=x');
check('autorisation refusée : page claire', r.data.includes('annulée'));
revoke = true;
r = await call('/api/strava/sync', { token: selim.token, body: {} });
check('accès retiré côté Strava : déconnecté proprement', r.status === 409 && !kv.has(`u:${selim.id}:strava`));
check('mapActivity ignore les entrées incomplètes', strava.mapActivity({ id: 1, sport_type: 'Run' }) === null);
globalThis.fetch = realFetch;

/* ---------- Compte privé, demandes d'abonnement ---------- */

const leo = await register('leo@exemple.com', 'Léo', await inv());
r = await call('/api/club/privacy', { token: leo.token, method: 'PUT', body: { private: true } });
check('compte passé en privé', r.status === 200 && r.data.private === true);
await call('/api/club/posts', { token: leo.token, body: { text: 'Séance privée de Léo', visibility: 'all' } });
r = await call('/api/club/feed', { token: selim.token });
check('compte privé : ses publications « tout le club » cachées aux non-abonnés', !r.data.posts.some((p) => p.text === 'Séance privée de Léo'));
r = await call(`/api/club/member/leo`, { token: selim.token });
check('fiche d’un compte privé : nom et pseudo visibles, marqué privé', r.status === 200 && r.data.member.private === true && r.data.member.handle === 'leo');
r = await call(`/api/club/follow/${leo.id}`, { token: selim.token, body: {} });
check('suivre un compte privé = demande', r.data.following === false && r.data.requested === true);
r = await call('/api/club/notifications', { token: leo.token });
check('demande notifiée', r.data.notices.some((n) => n.type === 'request' && n.actor === selim.id));
r = await call('/api/club/requests', { token: leo.token });
check('liste des demandes reçues', r.data.members.length === 1 && r.data.members[0].id === selim.id);
r = await call(`/api/club/follow/${leo.id}`, { token: selim.token, body: {} });
check('second appui : demande annulée', r.data.requested === false);
r = await call('/api/club/notifications', { token: leo.token });
check('demande annulée : sa notification disparaît', !r.data.notices.some((n) => n.type === 'request'));
await call(`/api/club/follow/${leo.id}`, { token: selim.token, body: {} });
await call(`/api/club/follow/${leo.id}`, { token: yanis.token, body: {} });
r = await call('/api/club/challenges', { token: selim.token, body: { to: leo.id, hours: 24 } });
check('pas de défi à un compte privé qu’on ne suit pas', r.status === 403);
r = await call(`/api/club/requests/${selim.id}`, { token: leo.token, body: { accept: true } });
check('demande acceptée', r.status === 200 && r.data.accepted === true);
r = await call(`/api/club/requests/${yanis.id}`, { token: leo.token, body: { accept: false } });
check('demande refusée', r.status === 200 && r.data.accepted === false);
r = await call(`/api/club/requests/${yanis.id}`, { token: leo.token, body: { accept: true } });
check('demande déjà traitée : 404', r.status === 404);
r = await call('/api/club/notifications', { token: selim.token });
check('acceptation notifiée au demandeur', r.data.notices.some((n) => n.type === 'accepted' && n.actor === leo.id));
r = await call('/api/club/feed', { token: selim.token });
check('abonné accepté : il voit les séances du compte privé', r.data.posts.some((p) => p.text === 'Séance privée de Léo'));
r = await call('/api/club/feed', { token: yanis.token });
check('refusé : il ne les voit toujours pas', !r.data.posts.some((p) => p.text === 'Séance privée de Léo'));
r = await call('/api/club/members', { token: leo.token });
check('mes relations : l’abonné accepté y est, marqué « te suit »', r.data.members.some((m) => m.id === selim.id && m.followsMe));
r = await call(`/api/club/followers/${selim.id}`, { token: leo.token, method: 'DELETE' });
r = await call('/api/club/feed', { token: selim.token });
check('abonné retiré : il ne voit plus rien', r.status === 200 && !r.data.posts.some((p) => p.text === 'Séance privée de Léo'));
await call(`/api/club/follow/${leo.id}`, { token: yanis.token, body: {} });
r = await call('/api/club/privacy', { token: leo.token, method: 'PUT', body: { private: false } });
r = await call('/api/club/members', { token: yanis.token });
check('repassé en public : les demandes en attente sont acceptées', r.data.members.some((m) => m.id === leo.id && m.following));
r = await call(`/api/club/followers/${'0'.repeat(16)}`, { token: leo.token, method: 'POST' });
check('route inconnue pour une mauvaise méthode', r.status === 404);

/* ---------- Courtes vidéos ---------- */

const raw = async (path, token, type, bytes) => {
  const res = await worker.fetch(new Request(`https://shred.test${path}`, { method: 'POST', headers: { 'content-type': type, authorization: `Bearer ${token}`, 'cf-connecting-ip': `10.1.0.${ip++}` }, body: bytes }), env);
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
// Un faux MP4 : la boîte « ftyp » au bon endroit, puis du remplissage.
const mp4 = new Uint8Array(4096);
mp4.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
r = await raw('/api/club/videos', selim.token, 'video/mp4', mp4);
check('vidéo envoyée', r.status === 200 && /^[a-f0-9]{24}$/.test(r.data.id), JSON.stringify(r.data));
const vid = r.data.id;
r = await raw('/api/club/videos', selim.token, 'video/mp4', new TextEncoder().encode('<html><script>alert(1)</script></html>'.padEnd(64, ' ')));
check('faux fichier refusé', r.status === 415);
r = await raw('/api/club/videos', selim.token, 'text/html', mp4);
check('type non vidéo refusé', r.status === 415);
r = await raw('/api/club/videos', selim.token, 'video/mp4', new Uint8Array(6_000_001));
check('vidéo de plus de 6 Mo refusée', r.status === 413);
r = await call('/api/club/posts', { token: yanis.token, body: { text: 'Vol de vidéo', video: { id: vid, poster: png, w: 720, h: 1280, dur: 9, sound: true } } });
check('on ne publie pas la vidéo d’un autre', r.status === 400);
r = await call('/api/club/posts', { token: selim.token, body: { text: 'Dernière série', visibility: 'followers', video: { id: vid, poster: png, w: 720, h: 1280, dur: 99, sound: false } } });
check('publication avec vidéo', r.status === 200 && r.data.post.video?.id === vid && r.data.post.video.sound === false, JSON.stringify(r.data.post?.video ?? r.data));
check('durée bornée à 16 s', r.data.post.video.dur === 16);
const vpost = r.data.post;
check('vidéo gardée pour de bon une fois publiée', kv.has(`club:video:${vid}`) && !kv.get(`club:video:${vid}`).metadata?.pending);
r = await call(`/api/club/video/${vid}`, { token: selim.token });
check('vidéo servie à son auteur', r.status === 200 && r.type === 'video/mp4');
r = await call(`/api/club/video/${vid}`, { token: ines.token });
check('vidéo « abonnés » refusée à qui ne suit pas', r.status === 404);
r = await call(`/api/club/photo/${vpost.video.poster}`, { token: ines.token });
check('aperçu protégé de la même façon', r.status === 404);
r = await call(`/api/club/posts/${vpost.id}`, { token: selim.token, method: 'DELETE' });
check('suppression : la vidéo et son aperçu partent avec', r.status === 200 && !kv.has(`club:video:${vid}`) && !kv.has(`club:photo:${vpost.video.poster}`));

/* ---------- Classement de la semaine ---------- */

const wk = '2026-11-16';
// Lundi, mardi, mercredi et vendredi : 0b0010111.
r = await call('/api/profile', { token: yanis.token, method: 'PUT', body: { visible: false, board: { weekOf: wk, week: 5, volume: 31000, streak: 12, days: 0b0010111 } } });
check('chiffres de la semaine publiés même profil masqué', r.status === 200 && r.data.profile.board?.week === 5 && r.data.profile.board.days === 0b0010111);
r = await call('/api/profile', { token: ines.token, method: 'PUT', body: { visible: true, data: {}, board: { weekOf: wk, week: 99, volume: -4, streak: 3, days: 999, extra: '<script>' } } });
check(
  'données du classement bornées',
  r.data.profile.board.week === 0 && r.data.profile.board.volume === 0 && !('extra' in r.data.profile.board) && !('days' in r.data.profile.board),
  JSON.stringify(r.data.profile.board),
);
r = await call(`/api/club/leaderboard?week=${wk}`, { token: selim.token });
check('classement : moi et les personnes que je suis', r.status === 200 && r.data.rows.some((x) => x.me) && r.data.rows.some((x) => x.id === yanis.id), JSON.stringify(r.data.rows?.map((x) => x.name)));
check('classement : pas les inconnus', !r.data.rows.some((x) => x.id === ines.id));
check('classement : trié par séances', r.data.rows[0].week >= r.data.rows.at(-1).week);
check('classement : les jours de séance de la semaine', r.data.rows.find((x) => x.id === yanis.id)?.days === 0b0010111);
r = await call('/api/club/leaderboard?week=2026-11-09', { token: selim.token });
check('classement : semaine passée = zéro, aucun jour', r.data.rows.every((x) => x.week === 0 && x.days === 0));
// Une app d'avant la 0.28 ne publie pas les jours : on ne les invente pas.
await call('/api/profile', { token: yanis.token, method: 'PUT', body: { visible: false, board: { weekOf: wk, week: 5, volume: 31000, streak: 12 } } });
r = await call(`/api/club/leaderboard?week=${wk}`, { token: selim.token });
check('classement : jours inconnus pour une ancienne app', !('days' in r.data.rows.find((x) => x.id === yanis.id)));
r = await call('/api/club/leaderboard?week=x', { token: selim.token });
check('semaine invalide refusée', r.status === 400);
r = await call('/api/profiles', { token: ines.token });
check('liste de tous les profils fermée aux membres', r.status === 403);

/* ---------- Panneau admin ---------- */

r = await call('/api/admin/testers', { token: ines.token });
check('panneau admin refusé aux membres', r.status === 403);
const tagged = await worker.fetch(new Request('https://shred.test/api/club/members', { headers: { authorization: `Bearer ${yanis.token}`, 'x-shred-client': '0.20.0;pwa', 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)', 'cf-connecting-ip': `10.1.0.${ip++}` } }), env);
check('requête marquée', tagged.status === 200);
await new Promise((res) => setTimeout(res, 20));
r = await call('/api/admin/testers', { token: selim.token });
const ty = r.data.testers?.find((t) => t.id === yanis.id);
check('panneau admin : tous les testeurs', r.status === 200 && r.data.testers.length >= 4 && r.data.version, JSON.stringify(r.data).slice(0, 200));
check('présence : dernière visite, version et appareil', ty?.lastSeen > 0 && ty.version === '0.20.0' && ty.platform === 'iPhone, app installée', JSON.stringify(ty));
check('compteurs du club par testeur', typeof ty?.posts === 'number' && typeof ty?.followers === 'number');

/* ---------- Défis ratés : bonnet de Nulos, mise rendue, gage, revanche (on avance l'horloge) ---------- */

const realNow = Date.now;
let shift = 0;
Date.now = () => realNow() + shift;
const H = 3600_000;
// Inès défie Selim 24 h ; il valide hors ligne avant l'échéance et se synchronise 10 min après.
r = await call('/api/club/challenges', { token: ines.token, body: { to: selim.id, hours: 24 } });
const late = r.data.challenge;
shift = 24 * H + 10 * 60_000;
r = await call(`/api/club/challenges/${late.id}/done`, { token: selim.token, body: { at: late.at + 23 * H } });
check('validé hors ligne avant l’échéance : compte encore pendant la demi-heure de grâce', r.status === 200 && r.data.challenge.status === 'done', JSON.stringify(r.data));
r = await call(`/api/club/challenges/${toCamille.id}/done`, { token: camille.token, body: { at: realNow() - H } });
check('séance validée avant le défi : ne compte pas', r.status === 410, String(r.status));

// 25 h : le défi avec gage de Yanis est échu.
shift = 25 * H;
r = await call(`/api/club/challenges/${withGage.id}/done`, { token: yanis.token, body: {} });
check('trop tard : défi expiré', r.status === 410);
r = await call('/api/club/challenges', { token: yanis.token });
const failed = r.data.challenges.find((c) => c.id === withGage.id);
check('défi raté dès qu’on regarde la liste', failed?.status === 'failed' && failed.failedAt === withGage.due, JSON.stringify(failed));
check('bonnet de Nulos pour 24 h', r.data.nulos > Date.now() && Math.abs(r.data.nulos - (withGage.due + 24 * H)) < 1000 && r.data.record.lost === 1);
r = await call('/api/club/notifications', { token: yanis.token });
check('Yanis est prévenu, avec son gage', r.data.notices.some((n) => n.type === 'challengeFailed' && n.text === 'Payer le café'));
r = await call('/api/club/challenges', { token: selim.token });
check('la mise revient à Selim', r.data.wallet.plates === 4, JSON.stringify(r.data.wallet));
r = await call('/api/club/notifications', { token: selim.token });
check('Selim est prévenu', r.data.notices.some((n) => n.type === 'challengeExpired' && n.actorName === 'Yanis'));
r = await call(`/api/club/member/${yanis.id}`, { token: selim.token });
check('fiche : bonnet de Nulos et défi raté', r.data.member.nulos > Date.now() && r.data.member.record?.lost === 1);
r = await call('/api/club/feed', { token: selim.token });
const yanisPost = r.data.posts.find((p) => p.author === yanis.id);
check('fil : le bonnet suit ses publications', !yanisPost || yanisPost.authorNulos > Date.now());
r = await call(`/api/club/challenges/${withGage.id}/gage`, { token: selim.token, body: {} });
check('seul le perdant déclare son gage', r.status === 404);
r = await call('/api/club/challenges', { token: yanis.token, body: { to: selim.id, rematch: withGage.id, gage: 'Payer le café', hours: 24 } });
const revenge = r.data.challenge;
check('revanche : gratuite et sans gage', r.status === 200 && revenge.stake === 0 && !revenge.gage && revenge.rematch === withGage.id && r.data.wallet.plates === 5, JSON.stringify(r.data));
r = await call('/api/club/notifications', { token: selim.token });
check('Selim est prévenu de la revanche', r.data.notices.some((n) => n.type === 'rematch' && n.actorName === 'Yanis'));
r = await call('/api/club/challenges', { token: yanis.token });
check('une seule revanche', r.data.challenges.find((c) => c.id === withGage.id)?.revenge === revenge.id);
r = await call(`/api/club/challenges/${withGage.id}/gage`, { token: yanis.token, body: {} });
check('gage fait : le bonnet tombe', r.status === 200 && r.data.nulos === 0 && r.data.challenge.gageDone > 0);
r = await call('/api/club/notifications', { token: selim.token });
check('Selim apprend que le gage est fait', r.data.notices.some((n) => n.type === 'gageDone' && n.text === 'Payer le café'));

// Le cron règle les autres défis échus, sans qu'on ait besoin d'ouvrir l'app.
r = await club.sweepChallenges(env);
check('cron : rien d’autre d’échu à 25 h', r === 0, String(r));
shift = 49 * H;
r = await club.sweepChallenges(env);
check('cron : le défi de Camille est raté à 49 h', r >= 1, String(r));
r = await call('/api/club/challenges', { token: camille.token });
check('Camille porte le bonnet, sans gage à faire', r.data.nulos > Date.now() && r.data.challenges.find((c) => c.id === toCamille.id)?.status === 'failed');
r = await call(`/api/club/challenges/${toCamille.id}/gage`, { token: camille.token, body: {} });
check('pas de gage à déclarer quand il n’y en avait pas', r.status === 404);
shift = 74 * H;
r = await call('/api/club/challenges', { token: camille.token });
check('24 h plus tard, le bonnet est tombé', r.data.nulos === 0);
r = await call('/api/club/challenges', { token: camille.token, body: { to: selim.id, rematch: toCamille.id } });
check('revanche fermée une fois le bonnet tombé', r.status === 410);
Date.now = realNow;

console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
