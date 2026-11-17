// Connecteur Claude (MCP + OAuth 2.1), de bout en bout : découverte, inscription du client, PKCE, demande d'accès
// liée au navigateur, clé de la sauvegarde confiée et jamais lisible au repos, outils sur les données déchiffrées,
// cartes MCP Apps, renouvellement, retrait depuis les réglages et après un changement de mot de passe.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { workerShims } from './worker-shims.mjs';

const dir = mkdtempSync(join(tmpdir(), 'shred-connector-'));
await build({
  entryPoints: { index: 'worker/index.ts', crypto: 'src/lib/crypto.ts', state: 'src/lib/state.ts', logic: 'src/lib/logic.ts' },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outdir: dir,
  logLevel: 'error',
  external: ['cloudflare:*'],
  ...workerShims,
});
const load = (n) => import(pathToFileURL(join(dir, `${n}.js`)).href);
const [{ default: worker }, kdf, st, logic] = await Promise.all(['index', 'crypto', 'state', 'logic'].map(load));

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

/* KV en mémoire, avec ce que le fournisseur OAuth utilise : lecture JSON, métadonnées, liste par préfixe, expiration. */
const kv = new Map();
const alive = (e) => e && (!e.exp || e.exp > Date.now());
const read = (e, opt) => {
  const type = typeof opt === 'string' ? opt : opt?.type;
  return type === 'json' ? JSON.parse(e.value) : e.value;
};
const KV = {
  async get(k, opt) {
    const e = kv.get(k);
    return alive(e) ? read(e, opt) : null;
  },
  async getWithMetadata(k, opt) {
    const e = kv.get(k);
    return alive(e) ? { value: read(e, opt), metadata: e.metadata ?? null } : { value: null, metadata: null };
  },
  async put(k, value, opts = {}) {
    const exp = opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : opts.expiration ? opts.expiration * 1000 : null;
    kv.set(k, { value: typeof value === 'string' ? value : String(value), metadata: opts.metadata ?? null, exp });
  },
  async delete(k) {
    kv.delete(k);
  },
  async list({ prefix = '', limit = 1000, cursor } = {}) {
    const names = [...kv.keys()].filter((k) => k.startsWith(prefix) && alive(kv.get(k))).sort();
    const start = cursor ? Number(cursor) : 0;
    const page = names.slice(start, start + limit);
    const done = start + limit >= names.length;
    return { keys: page.map((name) => ({ name, metadata: kv.get(name).metadata ?? undefined })), list_complete: done, ...(done ? {} : { cursor: String(start + limit) }) };
  },
};
const env = { ADMIN_CODE: 'code-admin-local-123', MOCK_AI: '1', KV, ASSETS: { fetch: async () => new Response('app') } };
const ctx = { waitUntil() {}, passThroughOnException() {} };
const ORIGIN = 'https://shred.test';
const MCP = `${ORIGIN}/api/mcp`;
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

let ip = 1;
async function raw(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('cf-connecting-ip', `10.2.0.${ip++}`);
  return worker.fetch(new Request(path.startsWith('http') ? path : `${ORIGIN}${path}`, { ...init, headers, redirect: 'manual' }), env, ctx);
}
async function call(path, { token, body, method, cookie } = {}) {
  const res = await raw(path, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, data: type.includes('json') ? await res.json().catch(() => ({})) : await res.text(), headers: res.headers };
}
let rpcId = 0;
async function rpc(token, method, params, { notify = false } = {}) {
  const res = await raw('/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, data, headers: res.headers };
}
const tool = async (token, name, args = {}) => (await rpc(token, 'tools/call', { name, arguments: args })).data?.result;
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* ---------- Un compte avec une sauvegarde ---------- */

const email = 'selim@exemple.com';
const keys = await kdf.deriveKeys(email, 'mot-de-passe-solide');
const reg = await call('/api/auth/register', { body: { email, name: 'Selim', invite: env.ADMIN_CODE, key: keys.auth } });
let session = reg.data.token;
const uid = reg.data.user.id;
check('compte créé', Boolean(session && uid), JSON.stringify(reg.data).slice(0, 120));

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (k, n) => {
  const [y, m, d] = k.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
};
const s = st.initial();
s.settings.onboarded = true;
s.settings.name = 'Selim';
const lift = (sets) => ({ sets, meals: [], habits: {}, mainDone: true, mainDoneAt: Date.now() });
s.days[addDays(today, -14)] = lift({ bench: [80, 80, 80].map((w) => ({ w, r: 8, done: true })) });
s.days[addDays(today, -7)] = lift({ bench: [82.5, 82.5, 82.5].map((w) => ({ w, r: 8, done: true })) });
// Aujourd'hui : deux séries du premier exercice de la séance prévue.
const planned = logic.sessionFor(s, today);
const first = planned.exercises[0];
s.days[today] = { sets: first ? { [first.key]: [{ w: 60, r: 10, done: true }, { w: 60, r: 9, done: true }] } : {}, meals: [], habits: {}, mainDone: false };
s.body.weight = { [addDays(today, -10)]: 80.4, [addDays(today, -1)]: 79.6 };
const box = await kdf.seal(keys.data, JSON.stringify(s));
let r = await call('/api/backup', { token: session, method: 'PUT', body: box });
check('sauvegarde chiffrée envoyée', r.status === 200, JSON.stringify(r.data));

/* ---------- Découverte ---------- */

r = await rpc(null, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude', version: '1' } });
const challenge = r.headers.get('www-authenticate') ?? '';
check('MCP sans jeton : 401 avec l’adresse des métadonnées', r.status === 401 && challenge.includes('resource_metadata="https://shred.test/.well-known/oauth-protected-resource/api/mcp"'), challenge);
r = await call('/.well-known/oauth-protected-resource/api/mcp');
check(
  'métadonnées de la ressource',
  r.status === 200 && r.data.resource === MCP && r.data.authorization_servers?.[0] === ORIGIN && r.data.scopes_supported?.includes('shred:read'),
  JSON.stringify(r.data),
);
r = await call('/.well-known/oauth-authorization-server');
const meta = r.data;
check(
  'métadonnées du serveur d’autorisation',
  r.status === 200 &&
    meta.authorization_endpoint === `${ORIGIN}/api/oauth/authorize` &&
    meta.token_endpoint === `${ORIGIN}/api/oauth/token` &&
    meta.registration_endpoint === `${ORIGIN}/api/oauth/register` &&
    meta.code_challenge_methods_supported?.includes('S256'),
  JSON.stringify(meta).slice(0, 300),
);
check('documents d’identité des clients (CIMD) acceptés', meta.client_id_metadata_document_supported === true);

/* ---------- Inscription du client et demande d'accès ---------- */

r = await call('/api/oauth/register', {
  body: { client_name: 'Claude', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] },
});
const clientId = r.data.client_id;
check('inscription dynamique du client', r.status === 201 && Boolean(clientId), JSON.stringify(r.data).slice(0, 200));

async function authorize(state = 'etat-123') {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challengeCode = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: CALLBACK,
    code_challenge: challengeCode,
    code_challenge_method: 'S256',
    state,
    scope: 'shred:read',
    resource: MCP,
  });
  const res = await raw(`/api/oauth/authorize?${q}`);
  const location = res.headers.get('location') ?? '';
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const handle = new URL(location, ORIGIN).searchParams.get('connect');
  return { res, location, cookie, handle, verifier };
}

const a = await authorize();
check('demande d’accès : renvoi vers l’app avec la demande', a.res.status === 302 && a.location.startsWith(`${ORIGIN}/?connect=`) && Boolean(a.handle), a.location);
check('demande liée au navigateur par un cookie __Host-', a.cookie.startsWith('__Host-oauth-consent'), a.cookie);
check('page de demande non affichable dans un cadre', (a.res.headers.get('x-frame-options') ?? '').toUpperCase() === 'DENY');
r = await call(`/api/oauth/consent?h=${encodeURIComponent(a.handle)}`);
check('l’app sait qui demande et où partent les jetons', r.status === 200 && r.data.name === 'Claude' && r.data.host === 'claude.ai' && !r.data.loopback, JSON.stringify(r.data));

r = await call('/api/oauth/authorize', { token: session, body: { handle: a.handle, approve: true, key: keys.data } });
check('accord refusé sans le cookie du navigateur qui a ouvert la demande', r.status === 400, JSON.stringify(r.data));
const other = await kdf.deriveKeys(email, 'autre-mot-de-passe');
r = await call('/api/oauth/authorize', { token: session, cookie: a.cookie, body: { handle: a.handle, approve: true, key: other.data } });
check('une clé qui n’ouvre pas la sauvegarde est refusée', r.status === 403, JSON.stringify(r.data));
r = await call('/api/oauth/authorize', { cookie: a.cookie, body: { handle: a.handle, approve: true, key: keys.data } });
check('accord impossible sans être connecté', r.status === 401);
r = await call('/api/oauth/authorize', { token: session, cookie: a.cookie, body: { handle: a.handle, approve: true, key: keys.data } });
const redirect = new URL(r.data.redirectTo ?? 'about:blank');
check(
  'accord : retour vers Claude avec le code, l’état et l’émetteur',
  r.status === 200 && redirect.origin + redirect.pathname === CALLBACK && redirect.searchParams.get('state') === 'etat-123' && Boolean(redirect.searchParams.get('code')) && redirect.searchParams.get('iss') === ORIGIN,
  r.data.redirectTo,
);
r = await call('/api/oauth/authorize', { token: session, cookie: a.cookie, body: { handle: a.handle, approve: true, key: keys.data } });
check('une demande ne sert qu’une fois', r.status === 410 || r.status === 400, String(r.status));

async function exchange(code, verifier) {
  const res = await raw('/api/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: clientId, code_verifier: verifier, resource: MCP }),
  });
  return { status: res.status, data: await res.json() };
}
r = await exchange(redirect.searchParams.get('code'), 'mauvais-verifieur-mauvais-verifieur-mauvais');
check('PKCE : un mauvais vérifieur ne donne pas de jeton', r.status === 400, JSON.stringify(r.data));
const a2 = await authorize('etat-2');
const ok2 = await call('/api/oauth/authorize', { token: session, cookie: a2.cookie, body: { handle: a2.handle, approve: true, key: keys.data } });
const tokens = await exchange(new URL(ok2.data.redirectTo).searchParams.get('code'), a2.verifier);
const access = tokens.data.access_token;
check('jetons émis pour la seule ressource MCP', tokens.status === 200 && Boolean(access) && Boolean(tokens.data.refresh_token) && tokens.data.scope === 'shred:read', JSON.stringify(tokens.data).slice(0, 200));

/* ---------- Rien de lisible au repos ---------- */

const stored = [...kv.values()].map((e) => e.value).join('\n');
check('la clé de la sauvegarde n’est jamais stockée en clair', !stored.includes(keys.data));
check('les jetons ne sont stockés qu’en empreinte', !stored.includes(access) && !stored.includes(tokens.data.refresh_token));

/* ---------- Le serveur MCP ---------- */

r = await rpc(access, 'initialize', { protocolVersion: '2025-06-18', capabilities: { extensions: { 'io.modelcontextprotocol/ui': {} } }, clientInfo: { name: 'claude', version: '1' } });
check(
  'initialize : version négociée, outils et ressources',
  r.status === 200 && r.data.result?.protocolVersion === '2025-06-18' && r.data.result.capabilities.tools && r.data.result.serverInfo.name === 'shred',
  JSON.stringify(r.data).slice(0, 200),
);
r = await rpc(access, 'initialize', { protocolVersion: '2099-01-01', capabilities: {}, clientInfo: { name: 'x', version: '1' } });
check('version inconnue : le serveur propose la sienne', r.data.result?.protocolVersion === '2025-11-25');
r = await rpc(access, 'notifications/initialized', {}, { notify: true });
check('notification : 202 sans corps', r.status === 202);
r = await rpc(access, 'tools/list', {});
const tools = r.data.result?.tools ?? [];
check('six outils, tous en lecture seule', tools.length === 6 && tools.every((t) => t.annotations?.readOnlyHint === true && t.inputSchema?.type === 'object'), tools.map((t) => t.name).join(', '));
check(
  'séance du jour et récap ont une carte (MCP Apps)',
  tools.find((t) => t.name === 'get_today')?._meta?.ui?.resourceUri === 'ui://shred/today' && tools.find((t) => t.name === 'get_month_recap')?._meta?.ui?.resourceUri === 'ui://shred/recap',
);
r = await rpc(access, 'resources/read', { uri: 'ui://shred/recap' });
const res0 = r.data.result?.contents?.[0];
check('la carte : du HTML MCP Apps, sans adresse extérieure', res0?.mimeType === 'text/html;profile=mcp-app' && res0.text.includes('data-card="recap"') && !/src="https?:/.test(res0.text), res0?.mimeType);
r = await rpc(access, 'resources/read', { uri: 'ui://shred/autre' });
check('ressource inconnue : erreur', r.data.error?.code === -32002);

let out = await tool(access, 'get_today');
check(
  'séance du jour : la séance prévue et les séries déjà faites',
  out?.structuredContent?.kind === 'today' &&
    out.structuredContent.session.name === planned.name &&
    (!first || out.structuredContent.exercises[0].done.join(' ') === '60×10 60×9') &&
    out.content[0].text.includes('synchronisées'),
  JSON.stringify(out?.structuredContent?.exercises?.[0] ?? out).slice(0, 200),
);
out = await tool(access, 'get_month_recap', { month: today.slice(0, 7) });
check('récap : le mois en cours avec son profil', out?.structuredContent?.kind === 'recap' && out.structuredContent.partial === true && Boolean(out.structuredContent.profile.title), JSON.stringify(out?.structuredContent ?? out).slice(0, 160));
out = await tool(access, 'get_month_recap', { month: '2026-13' });
check('mois invalide : résultat en erreur, pas une panne', out?.isError === true);
out = await tool(access, 'search_history', { query: 'développé couché' });
check('recherche dans l’historique (RAG)', out?.isError === false && out.content[0].text.includes('Développé couché'), out?.content?.[0]?.text?.slice(0, 120));
out = await tool(access, 'get_exercise_history', { exercise: 'developpe couche' });
check(
  'historique d’un exercice retrouvé sans accents, avec le record',
  out?.isError === false && out.content[0].text.startsWith('Développé couché barre') && out.content[0].text.includes('82,5 kg × 8'),
  out?.content?.[0]?.text?.slice(0, 160),
);
out = await tool(access, 'get_exercise_history', { exercise: 'zzqx' });
check('exercice introuvable : message clair', out?.isError === true && out.content[0].text.includes('zzqx'));
out = await tool(access, 'get_days', { from: addDays(today, -7), to: today });
check('journal de 8 jours', out?.isError === false && out.content[0].text.split('\n\n').length === 9, String(out?.content?.[0]?.text?.split('\n\n').length));
out = await tool(access, 'get_days', { from: addDays(today, -40), to: today });
check('journal : 31 jours au plus', out?.isError === true);
out = await tool(access, 'get_profile');
check('profil, programme et force', out?.isError === false && out.content[0].text.includes('Programme') && out.content[0].text.includes('Selim'));
r = await rpc(access, 'tools/call', { name: 'delete_everything', arguments: {} });
check('outil inconnu : erreur de protocole', r.data.error?.code === -32602);
r = await rpc(access, 'nimporte/quoi', {});
check('méthode inconnue', r.data.error?.code === -32601);
r = await raw('/api/mcp', { method: 'GET', headers: { authorization: `Bearer ${access}` } });
check('pas de flux SSE : GET refusé', r.status === 405);

/* ---------- Réglages : applications connectées ---------- */

r = await call('/api/connector', { token: session });
check('Réglages : Claude apparaît, avec l’adresse du connecteur', r.status === 200 && r.data.url === MCP && r.data.clients.length === 1 && r.data.clients[0].name === 'Claude', JSON.stringify(r.data));
const grantId = r.data.clients[0]?.id;

/* ---------- Renouvellement ---------- */

let res = await raw('/api/oauth/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.data.refresh_token, client_id: clientId }),
});
const refreshed = await res.json();
out = await tool(refreshed.access_token, 'get_today');
check('jeton renouvelé : la clé suit', res.status === 200 && out?.structuredContent?.kind === 'today', JSON.stringify(refreshed).slice(0, 120));

/* ---------- Retrait depuis Shred ---------- */

r = await call(`/api/connector/${grantId}`, { token: session, method: 'DELETE' });
r = await rpc(refreshed.access_token, 'tools/list', {});
check('déconnecté dans Réglages : le jeton ne sert plus', r.status === 401, String(r.status));

/* ---------- Mot de passe changé : l'autorisation tombe ---------- */

const a3 = await authorize('etat-3');
const ok3 = await call('/api/oauth/authorize', { token: session, cookie: a3.cookie, body: { handle: a3.handle, approve: true, key: keys.data } });
const t3 = await exchange(new URL(ok3.data.redirectTo).searchParams.get('code'), a3.verifier);
out = await tool(t3.data.access_token, 'get_profile');
check('nouvelle connexion', out?.isError === false);
const next = await kdf.deriveKeys(email, 'nouveau-mot-de-passe');
r = await call('/api/account/password', { token: session, body: { current: keys.auth, next: next.auth } });
session = r.data.token;
r = await rpc(t3.data.access_token, 'tools/call', { name: 'get_profile', arguments: {} });
check('mot de passe changé : 401, Claude doit reconnecter', r.status === 401 && (r.headers.get('www-authenticate') ?? '').includes('invalid_token'), String(r.status));
r = await call('/api/connector', { token: session });
check('…et l’autorisation est retirée', r.status === 200 && r.data.clients.length === 0, JSON.stringify(r.data));

/* ---------- Refus ---------- */

const a4 = await authorize('etat-4');
r = await call('/api/oauth/authorize', { token: session, cookie: a4.cookie, body: { handle: a4.handle, approve: false } });
const denied = new URL(r.data.redirectTo ?? 'about:blank');
check('refus : retour vers Claude avec access_denied', r.status === 200 && denied.searchParams.get('error') === 'access_denied' && denied.searchParams.get('state') === 'etat-4', r.data.redirectTo);
r = await call(`/api/oauth/consent?h=${encodeURIComponent(a4.handle)}`);
check('la demande refusée est effacée', r.status === 410);

/* ---------- Client identifié par son document publié (CIMD) : son domaine est vérifié ---------- */

const CIMD = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const u = typeof input === 'string' ? input : input.url;
  if (u === CIMD) {
    return new Response(JSON.stringify({ client_id: CIMD, client_name: 'Claude', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' },
    });
  }
  return realFetch(input, init);
};
{
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const code_challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const q = new URLSearchParams({ response_type: 'code', client_id: CIMD, redirect_uri: CALLBACK, code_challenge, code_challenge_method: 'S256', state: 'c', scope: 'shred:read', resource: MCP });
  const res2 = await raw(`/api/oauth/authorize?${q}`);
  const handle = new URL(res2.headers.get('location') ?? '/', ORIGIN).searchParams.get('connect');
  r = await call(`/api/oauth/consent?h=${encodeURIComponent(handle ?? '')}`);
  check('client CIMD : domaine vérifié affiché', res2.status === 302 && r.data.domain === 'claude.ai' && r.data.name === 'Claude', JSON.stringify(r.data));
}
globalThis.fetch = realFetch;

const bad = await raw(`/api/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: 'inconnu', redirect_uri: 'https://evil.example/cb', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' })}`);
check('client inconnu : page d’erreur, jamais de redirection', bad.status === 400 && !bad.headers.get('location'));

console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
