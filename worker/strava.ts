// Strava : connexion OAuth, puis import des sorties (course, vélo, natation…) sans raccourci.
// Les jetons restent sur le serveur (ils doivent être rafraîchis toutes les 6 heures) ; l'app ne reçoit que
// des sorties résumées. Règle de Strava : ces données ne s'affichent qu'à la personne qui les a enregistrées.
import { type Env, HttpError, json, readJson } from './env';
import { loadJson, type Store, type User } from './users';

const AUTHORIZE = 'https://www.strava.com/oauth/authorize';
const TOKEN = 'https://www.strava.com/oauth/token';
const DEAUTHORIZE = 'https://www.strava.com/oauth/deauthorize';
const API = 'https://www.strava.com/api/v3';
const SCOPE = 'read,activity:read_all';
const STATE_TTL = 600;

interface Tokens {
  access: string;
  refresh: string;
  /** Expiration du jeton d'accès, en secondes Unix. */
  expiresAt: number;
  athleteId: number;
  athlete: string;
  scope: string;
  connectedAt: string;
}

export type Sport = 'run' | 'bike' | 'swim' | 'walk' | 'row' | 'combat' | 'lift' | 'other';

export interface ImportedActivity {
  id: string;
  source: 'strava';
  sport: Sport;
  name: string;
  start: string;
  min: number;
  km?: number;
  elev?: number;
  hr?: number;
  kcal?: number;
}

const SPORTS: Record<string, Sport> = {
  Run: 'run', TrailRun: 'run', VirtualRun: 'run',
  Ride: 'bike', VirtualRide: 'bike', GravelRide: 'bike', MountainBikeRide: 'bike', EBikeRide: 'bike', EMountainBikeRide: 'bike', Velomobile: 'bike', Handcycle: 'bike',
  Swim: 'swim',
  Walk: 'walk', Hike: 'walk',
  Rowing: 'row', VirtualRow: 'row',
  WeightTraining: 'lift', Crossfit: 'lift',
  Boxing: 'combat', Kickboxing: 'combat', MartialArts: 'combat',
};

export const stravaReady = (env: Env) => Boolean(env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET);

/** Une sortie Strava, réduite à ce dont l'app a besoin. */
export function mapActivity(a: Record<string, unknown>): ImportedActivity | null {
  const id = a.id;
  if (typeof id !== 'number' && typeof id !== 'string') return null;
  const type = String(a.sport_type ?? a.type ?? '');
  const moving = Number(a.moving_time ?? a.elapsed_time ?? 0);
  const start = typeof a.start_date_local === 'string' ? a.start_date_local.replace(/Z$/, '') : null;
  if (!start || !(moving > 0)) return null;
  const km = Number(a.distance ?? 0) / 1000;
  const hr = Number(a.average_heartrate ?? 0);
  const kj = Number(a.kilojoules ?? 0);
  const kcal = Number(a.calories ?? 0) || (kj > 0 ? kj : 0);
  return {
    id: `strava:${id}`,
    source: 'strava',
    sport: SPORTS[type] ?? 'other',
    name: String(a.name ?? type).slice(0, 80),
    start,
    min: Math.round((moving / 60) * 10) / 10,
    ...(km > 0.05 ? { km: Math.round(km * 100) / 100 } : {}),
    ...(Number(a.total_elevation_gain) > 0 ? { elev: Math.round(Number(a.total_elevation_gain)) } : {}),
    ...(hr > 0 ? { hr: Math.round(hr) } : {}),
    ...(kcal > 0 ? { kcal: Math.round(kcal) } : {}),
  };
}

async function tokenRequest(env: Env, params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.STRAVA_CLIENT_ID!, client_secret: env.STRAVA_CLIENT_SECRET!, ...params }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof data.access_token !== 'string') throw new HttpError(502, 'Strava a refusé la connexion. Réessaie depuis Réglages, Strava.');
  return data;
}

/** Un jeton d'accès valable, rafraîchi s'il expire dans moins de deux minutes. */
async function accessToken(env: Env, store: Store): Promise<Tokens> {
  const t = await loadJson<Tokens>(store, 'strava');
  if (!t) throw new HttpError(409, 'Strava n’est pas relié');
  if (t.expiresAt - 120 > Date.now() / 1000) return t;
  const data = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: t.refresh });
  const next: Tokens = { ...t, access: String(data.access_token), refresh: String(data.refresh_token ?? t.refresh), expiresAt: Number(data.expires_at) };
  await store.put('strava', JSON.stringify(next));
  return next;
}

const page = (title: string, text: string) =>
  new Response(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#15171b;color:#f2f3f5;font:16px/1.5 system-ui,-apple-system,sans-serif;padding:24px}
main{max-width:360px;text-align:center}h1{font-size:1.4rem;margin:0 0 8px}p{color:#a0a5ad;margin:0 0 20px}a{display:inline-block;background:#f2f3f5;color:#15171b;border-radius:14px;padding:12px 20px;font-weight:700;text-decoration:none}</style></head>
<body><main><h1>${title}</h1><p>${text}</p><a href="/">Revenir dans Shred</a></main></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );

/** Retour de Strava après l'autorisation : sans session (c'est le navigateur qui arrive ici). */
export async function stravaCallback(env: Env, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/strava/callback') return null;
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code');
  const userId = /^[a-f0-9]{32}$/.test(state) ? await env.KV.get(`strava-state:${state}`) : null;
  if (userId) await env.KV.delete(`strava-state:${state}`);
  if (url.searchParams.get('error') || !code) return page('Connexion annulée', 'Strava n’a pas été relié. Tu peux réessayer depuis Réglages, Strava.');
  if (!userId) return page('Lien expiré', 'Ce lien de connexion a expiré. Relance la connexion depuis Réglages, Strava.');
  const scope = url.searchParams.get('scope') ?? '';
  if (!scope.includes('activity:read')) return page('Accès aux sorties refusé', 'Shred a besoin de lire tes activités pour les importer. Relance la connexion et coche l’accès aux activités.');
  const data = await tokenRequest(env, { code, grant_type: 'authorization_code' });
  const athlete = (data.athlete ?? {}) as { id?: number; firstname?: string; lastname?: string };
  const tokens: Tokens = {
    access: String(data.access_token),
    refresh: String(data.refresh_token),
    expiresAt: Number(data.expires_at),
    athleteId: Number(athlete.id ?? 0),
    athlete: [athlete.firstname, athlete.lastname?.slice(0, 1)].filter(Boolean).join(' ') || 'ton compte',
    scope,
    connectedAt: new Date().toISOString(),
  };
  await env.KV.put(`u:${userId}:strava`, JSON.stringify(tokens));
  return page('Strava est relié', 'Tes sorties vont arriver dans Shred. Tu peux fermer cette page et revenir dans l’app.');
}

export async function disconnectStrava(env: Env, store: Store) {
  const t = await loadJson<Tokens>(store, 'strava');
  if (!t) return;
  await fetch(DEAUTHORIZE, { method: 'POST', headers: { authorization: `Bearer ${t.access}` } }).catch(() => undefined);
  await store.delete('strava');
}

export async function stravaRoutes(req: Request, env: Env, user: User, url: URL): Promise<Response | null> {
  const { pathname } = url;
  if (!pathname.startsWith('/api/strava')) return null;
  const store = user.store;

  if (pathname === '/api/strava/status' && req.method === 'GET') {
    const t = await loadJson<Tokens>(store, 'strava');
    return json({ configured: stravaReady(env), connected: Boolean(t), athlete: t?.athlete ?? null, connectedAt: t?.connectedAt ?? null });
  }

  if (!stravaReady(env)) throw new HttpError(503, 'Strava n’est pas encore configuré sur ce serveur (voir docs/STRAVA.md).');

  if (pathname === '/api/strava/connect' && req.method === 'POST') {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    const state = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    await env.KV.put(`strava-state:${state}`, user.id, { expirationTtl: STATE_TTL });
    const params = new URLSearchParams({
      client_id: env.STRAVA_CLIENT_ID!,
      response_type: 'code',
      redirect_uri: `${url.origin}/api/strava/callback`,
      approval_prompt: 'auto',
      scope: SCOPE,
      state,
    });
    return json({ url: `${AUTHORIZE}?${params}` });
  }

  if (pathname === '/api/strava/sync' && req.method === 'POST') {
    const b = await readJson<{ after?: number }>(req, 1_000);
    const now = Math.floor(Date.now() / 1000);
    const after = Number.isFinite(b.after) && b.after! > now - 90 * 86400 ? Math.floor(b.after!) : now - 14 * 86400;
    const t = await accessToken(env, store);
    const res = await fetch(`${API}/athlete/activities?after=${after}&per_page=60`, { headers: { authorization: `Bearer ${t.access}` } });
    if (res.status === 401) {
      // Accès retiré depuis Strava : on oublie les jetons, l'app proposera de relier à nouveau.
      await store.delete('strava');
      throw new HttpError(409, 'Strava a été déconnecté. Relie-le à nouveau dans Réglages, Strava.');
    }
    if (res.status === 429) throw new HttpError(429, 'Strava limite les requêtes : réessaie dans un quart d’heure.');
    if (!res.ok) throw new HttpError(502, `Strava ne répond pas (${res.status})`);
    const list = (await res.json()) as Record<string, unknown>[];
    const activities = list.map(mapActivity).filter((a): a is ImportedActivity => Boolean(a));
    return json({ activities, athlete: t.athlete });
  }

  if (pathname === '/api/strava/disconnect' && req.method === 'POST') {
    await disconnectStrava(env, store);
    return json({ ok: true });
  }

  throw new HttpError(404, 'Route inconnue');
}
