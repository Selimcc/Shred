// Surveillance du plan gratuit de Cloudflare.
//
// Chaque requête compte ses opérations KV (lectures, écritures, suppressions, listes) et ses appels aux
// Durable Objects ; les totaux du jour (UTC, comme Cloudflare) sont rangés dans le Durable Object USAGE.
// Le même objet tient aussi les petits compteurs qui écrivaient beaucoup dans KV (IA par jour, essais de
// connexion, rappels déjà envoyés) : une ligne SQLite coûte cent fois moins cher qu'une écriture KV
// (100 000 lignes par jour contre 1 000 écritures).
//
// Quand les écritures KV du jour approchent de la limite, l'app passe en mode économie : la santé et la
// sauvegarde s'enregistrent moins souvent, et l'administrateur est prévenu une fois.
import { type Env, HttpError } from './env';

/** Plan Workers gratuit (developers.cloudflare.com, novembre 2026). Remise à zéro à 00:00 UTC. */
export const FREE = {
  requests: 100_000,
  kvRead: 100_000,
  kvWrite: 1_000,
  kvDelete: 1_000,
  kvList: 1_000,
  doRequests: 100_000,
  doRowsWritten: 100_000,
} as const;

export type Mode = 'normal' | 'economy' | 'critical';

export interface DayUsage {
  day: string;
  requests: number;
  kvRead: number;
  kvWrite: number;
  kvDelete: number;
  kvList: number;
  doRequests: number;
  /** Écritures KV par usage (« santé », « sauvegarde »…). */
  writes: Record<string, number>;
}

type Delta = Omit<DayUsage, 'day' | 'writes'> & { writes: Record<string, number> };

const empty = (): Delta => ({ requests: 0, kvRead: 0, kvWrite: 0, kvDelete: 0, kvList: 0, doRequests: 0, writes: {} });

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

/** Le mode suit les écritures KV, la ressource la plus rare du plan gratuit. */
export function modeFor(u: Pick<DayUsage, 'kvWrite' | 'requests'>): Mode {
  const r = Math.max(u.kvWrite / FREE.kvWrite, u.requests / FREE.requests);
  return r >= 0.9 ? 'critical' : r >= 0.6 ? 'economy' : 'normal';
}

/** Regroupe les clés KV par usage, pour savoir qui écrit le plus. */
export function category(key: string): string {
  const parts = key.split(':');
  const head = parts[0] === 'u' ? (parts[2] ?? '') : parts[0];
  const map: Record<string, string> = {
    health: 'santé',
    gym: 'salle',
    backup: 'sauvegarde',
    state: 'état du jour',
    sub: 'notifications',
    cfg: 'réglages',
    profile: 'profil public',
    strava: 'Strava',
    avatar: 'photo de profil',
    club: 'photos du club',
    sess: 'connexions',
    acct: 'comptes',
    email: 'comptes',
    idx: 'comptes',
    dkey: 'clés Raccourcis',
    inv: 'invitations',
    rst: 'mots de passe',
    'strava-state': 'Strava',
    client: 'connecteur Claude',
    grant: 'connecteur Claude',
    token: 'connecteur Claude',
    mcpc: 'connecteur Claude',
    mail: 'bilan par mail',
    usage: 'IA',
    sent: 'rappels',
    rl: 'essais de connexion',
  };
  return map[head] ?? head ?? 'autre';
}

/* ---------- Durable Object ---------- */

export class Usage {
  constructor(
    private state: DurableObjectState,
    _env: Env,
  ) {}

  private get db() {
    return this.state.storage;
  }

  async fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    const b = (await req.json()) as Record<string, unknown>;
    switch (pathname) {
      case '/add': {
        const day = String(b.day);
        const d = b.delta as Delta;
        const cur = (await this.db.get<DayUsage>(`d:${day}`)) ?? { day, ...empty() };
        for (const k of ['requests', 'kvRead', 'kvWrite', 'kvDelete', 'kvList', 'doRequests'] as const) cur[k] += d[k] ?? 0;
        for (const [c, n] of Object.entries(d.writes ?? {})) cur.writes[c] = (cur.writes[c] ?? 0) + n;
        await this.db.put(`d:${day}`, cur);
        // On garde 35 jours d'historique.
        if (Math.random() < 0.02) {
          const old = await this.db.list({ prefix: 'd:', end: `d:${utcDay(new Date(Date.now() - 35 * 86400_000))}` });
          if (old.size) await this.db.delete([...old.keys()]);
        }
        return Response.json({ usage: cur, mode: modeFor(cur) });
      }
      case '/report': {
        const days = Math.max(1, Math.min(35, Number(b.days) || 14));
        const list = await this.db.list<DayUsage>({ prefix: 'd:', reverse: true, limit: days });
        return Response.json({ days: [...list.values()] });
      }
      case '/today': {
        const cur = (await this.db.get<DayUsage>(`d:${utcDay()}`)) ?? { day: utcDay(), ...empty() };
        return Response.json({ usage: cur, mode: modeFor(cur) });
      }
      case '/incr': {
        // Compteur qui expire (IA du jour, essais de connexion) : renvoie la valeur après ajout.
        const key = `c:${String(b.key)}`;
        const now = Date.now();
        const cur = await this.db.get<{ n: number; exp: number }>(key);
        const live = cur && cur.exp > now ? cur : { n: 0, exp: now + Number(b.ttl) * 1000 };
        live.n += Number(b.by ?? 1);
        await this.db.put(key, live);
        return Response.json({ n: live.n });
      }
      case '/get': {
        const cur = await this.db.get<{ n: number; exp: number }>(`c:${String(b.key)}`);
        return Response.json({ n: cur && cur.exp > Date.now() ? cur.n : 0 });
      }
      case '/once': {
        // Vrai la première fois seulement (rappel déjà envoyé, alerte déjà donnée).
        const key = `o:${String(b.key)}`;
        const cur = await this.db.get<number>(key);
        if (cur && cur > Date.now()) return Response.json({ first: false });
        await this.db.put(key, Date.now() + Number(b.ttl) * 1000);
        return Response.json({ first: true });
      }
      case '/seen': {
        // Dernière visite d'un membre (panneau admin) : quand, quelle version, quel appareil.
        await this.db.put(`s:${String(b.id)}`, { at: Number(b.at), ver: String(b.ver ?? ''), plat: String(b.plat ?? '') });
        return Response.json({ ok: true });
      }
      case '/unseen': {
        await this.db.delete(`s:${String(b.id)}`);
        return Response.json({ ok: true });
      }
      case '/seen-all': {
        const list = await this.db.list<Seen>({ prefix: 's:' });
        return Response.json({ seen: Object.fromEntries([...list].map(([k, v]) => [k.slice(2), v])) });
      }
      case '/sweep': {
        const now = Date.now();
        const c = await this.db.list<{ exp: number }>({ prefix: 'c:' });
        const o = await this.db.list<number>({ prefix: 'o:' });
        const gone = [...[...c].filter(([, v]) => v.exp <= now).map(([k]) => k), ...[...o].filter(([, v]) => v <= now).map(([k]) => k)];
        for (let i = 0; i < gone.length; i += 128) await this.db.delete(gone.slice(i, i + 128));
        return Response.json({ removed: gone.length });
      }
    }
    return Response.json({ error: 'route inconnue' }, { status: 404 });
  }
}

/* ---------- Côté Worker ---------- */

const stub = (env: Env) => env.USAGE!.get(env.USAGE!.idFromName('usage'));

async function call<T>(env: Env, path: string, body: Record<string, unknown>): Promise<T> {
  pending.doRequests += 1;
  const res = await stub(env).fetch(`https://usage${path}`, { method: 'POST', body: JSON.stringify(body) });
  return (await res.json()) as T;
}

/** Compteurs et drapeaux : dans le Durable Object quand il existe, sinon dans KV (tests, ancienne config). */
export const counters = {
  async get(env: Env, key: string): Promise<number> {
    if (env.USAGE) return (await call<{ n: number }>(env, '/get', { key })).n;
    return Number((await env.KV.get(`cnt:${key}`)) ?? 0);
  },
  async incr(env: Env, key: string, ttlSec: number): Promise<number> {
    if (env.USAGE) return (await call<{ n: number }>(env, '/incr', { key, ttl: ttlSec })).n;
    const n = Number((await env.KV.get(`cnt:${key}`)) ?? 0) + 1;
    await env.KV.put(`cnt:${key}`, String(n), { expirationTtl: Math.max(60, ttlSec) });
    return n;
  },
  async once(env: Env, key: string, ttlSec: number): Promise<boolean> {
    if (env.USAGE) return (await call<{ first: boolean }>(env, '/once', { key, ttl: ttlSec })).first;
    if (await env.KV.get(`once:${key}`)) return false;
    await env.KV.put(`once:${key}`, '1', { expirationTtl: Math.max(60, ttlSec) });
    return true;
  },
};

export interface Seen {
  at: number;
  ver: string;
  plat: string;
}

/** Présence des membres, pour le panneau admin. Une écriture au plus toutes les 2 minutes par membre et par isolat. */
const lastMark = new Map<string, number>();
export const presence = {
  async mark(env: Env, id: string, client: string | null, ua: string | null): Promise<void> {
    const now = Date.now();
    // Un changement de version ou d'appareil passe tout de suite.
    const k = `${id}|${client ?? ''}|${(ua ?? '').slice(0, 60)}`;
    if (now - (lastMark.get(k) ?? 0) < 120_000) return;
    lastMark.set(k, now);
    if (lastMark.size > 5000) lastMark.clear();
    // En-tête X-Shred-Client : « version;mode » (pwa, web ou ios), sinon on devine l'appareil.
    const [ver = '', mode = ''] = (client ?? '').slice(0, 40).split(';');
    const device = /iphone|ipad/i.test(ua ?? '') ? 'iPhone' : /android/i.test(ua ?? '') ? 'Android' : /mac|windows|linux/i.test(ua ?? '') ? 'Ordinateur' : '';
    const plat = [device, { pwa: 'app installée', web: 'navigateur', ios: 'app iPhone' }[mode] ?? ''].filter(Boolean).join(', ');
    const seen: Seen = { at: now, ver: ver.replace(/[^0-9a-z.+-]/gi, ''), plat };
    if (env.USAGE) await call(env, '/seen', { id, ...seen });
    else await env.KV.put(`seen:${id}`, JSON.stringify(seen));
  },
  /** Compte supprimé : sa trace de présence part aussi. */
  async forget(env: Env, id: string): Promise<void> {
    for (const k of lastMark.keys()) if (k.startsWith(`${id}|`)) lastMark.delete(k);
    if (env.USAGE) await call(env, '/unseen', { id });
    else await env.KV.delete(`seen:${id}`);
  },
  async all(env: Env, ids: string[]): Promise<Record<string, Seen>> {
    if (env.USAGE) return (await call<{ seen: Record<string, Seen> }>(env, '/seen-all', {})).seen;
    const out: Record<string, Seen> = {};
    for (const id of ids) {
      const v = await env.KV.get(`seen:${id}`);
      if (v) out[id] = JSON.parse(v) as Seen;
    }
    return out;
  },
};

/* Totaux en attente dans cet isolat : envoyés au plus toutes les 30 s, ou tout de suite s'il y a eu des écritures. */
let pending = empty();
let lastFlush = 0;
let cachedMode: { mode: Mode; usage?: DayUsage; at: number } = { mode: 'normal', at: 0 };

function hasWork(d: Delta) {
  return d.requests + d.kvRead + d.kvWrite + d.kvDelete + d.kvList + d.doRequests > 0;
}

/** Envoie les totaux en attente. Appelé en fin de requête, sans la ralentir (waitUntil). */
export async function flushUsage(env: Env, force = false): Promise<void> {
  if (!env.USAGE || !hasWork(pending)) return;
  const now = Date.now();
  if (!force && pending.kvWrite + pending.kvDelete === 0 && now - lastFlush < 30_000) return;
  const delta = pending;
  pending = empty();
  lastFlush = now;
  try {
    const r = await call<{ usage: DayUsage; mode: Mode }>(env, '/add', { day: utcDay(), delta });
    cachedMode = { mode: r.mode, usage: r.usage, at: now };
  } catch {
    // Compteur indisponible : on remet les chiffres de côté pour le prochain envoi.
    for (const k of ['requests', 'kvRead', 'kvWrite', 'kvDelete', 'kvList', 'doRequests'] as const) pending[k] += delta[k];
    for (const [c, n] of Object.entries(delta.writes)) pending.writes[c] = (pending.writes[c] ?? 0) + n;
  }
}

/** Mode du moment (gardé une minute en mémoire pour ne pas interroger l'objet à chaque requête). */
export async function currentMode(env: Env): Promise<Mode> {
  if (!env.USAGE) return 'normal';
  if (Date.now() - cachedMode.at < 60_000) return cachedMode.mode;
  try {
    const r = await call<{ usage: DayUsage; mode: Mode }>(env, '/today', {});
    cachedMode = { mode: r.mode, usage: r.usage, at: Date.now() };
  } catch {
    cachedMode = { ...cachedMode, at: Date.now() };
  }
  return cachedMode.mode;
}

export const lastKnownMode = (): Mode => cachedMode.mode;

export async function usageReport(env: Env, days = 14): Promise<DayUsage[]> {
  if (!env.USAGE) return [];
  await flushUsage(env, true);
  return (await call<{ days: DayUsage[] }>(env, '/report', { days })).days;
}

export async function sweepUsage(env: Env): Promise<void> {
  if (env.USAGE) await call(env, '/sweep', {});
}

/** Pour les tests : remet les compteurs de l'isolat à zéro. */
export function resetUsageMemory() {
  pending = empty();
  lastFlush = 0;
  cachedMode = { mode: 'normal', at: 0 };
}

/**
 * Enveloppe le KV de l'environnement : chaque opération est comptée, puis on passe la main au vrai KV.
 * Les Durable Objects aussi : chaque appel compte une requête.
 */
export function metered(env: Env): Env {
  if ((env as Env & { __metered?: boolean }).__metered) return env;
  pending.requests += 1;
  const kv = env.KV;
  const wrapped = {
    get: (key: string, opts?: unknown) => {
      pending.kvRead += 1;
      return (kv.get as (k: string, o?: unknown) => Promise<unknown>)(key, opts);
    },
    getWithMetadata: (key: string, opts?: unknown) => {
      pending.kvRead += 1;
      return (kv.getWithMetadata as (k: string, o?: unknown) => Promise<unknown>)(key, opts);
    },
    put: (key: string, value: unknown, opts?: KVNamespacePutOptions) => {
      pending.kvWrite += 1;
      const c = category(key);
      pending.writes[c] = (pending.writes[c] ?? 0) + 1;
      return kv.put(key, value as string, opts);
    },
    delete: (key: string) => {
      pending.kvDelete += 1;
      return kv.delete(key);
    },
    list: (opts?: KVNamespaceListOptions) => {
      pending.kvList += 1;
      return kv.list(opts);
    },
  } as unknown as KVNamespace;
  const wrapDo = (ns?: DurableObjectNamespace): DurableObjectNamespace | undefined =>
    ns &&
    ({
      idFromName: (n: string) => ns.idFromName(n),
      get: (id: DurableObjectId) => {
        const s = ns.get(id);
        return {
          fetch: (...args: Parameters<typeof s.fetch>) => {
            pending.doRequests += 1;
            return s.fetch(...args);
          },
        };
      },
    } as unknown as DurableObjectNamespace);
  return { ...env, KV: wrapped, CLUB: wrapDo(env.CLUB), TIMERS: wrapDo(env.TIMERS), __metered: true } as Env;
}

/** La part de chaque limite déjà consommée aujourd'hui, et ce que ça donnerait à ce rythme en fin de journée. */
export function summary(u: DayUsage, now = new Date()) {
  const start = Date.parse(`${u.day}T00:00:00Z`);
  const elapsed = Math.min(1, Math.max(1 / 96, (now.getTime() - start) / 86400_000));
  const isToday = u.day === utcDay(now);
  const row = (used: number, limit: number) => ({ used, limit, pct: used / limit, projected: isToday ? Math.round(used / elapsed) : used });
  return {
    day: u.day,
    mode: modeFor(u),
    requests: row(u.requests, FREE.requests),
    kvRead: row(u.kvRead, FREE.kvRead),
    kvWrite: row(u.kvWrite, FREE.kvWrite),
    kvDelete: row(u.kvDelete, FREE.kvDelete),
    kvList: row(u.kvList, FREE.kvList),
    doRequests: row(u.doRequests, FREE.doRequests),
    writes: Object.entries(u.writes)
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => ({ name, n })),
  };
}

/**
 * Plafond par membre et par jour pour ce qui écrit ou coûte (publications, commentaires, photos, recherches) :
 * un compte abusif ne peut pas épuiser le plan gratuit pour tout le monde.
 */
export const DAILY_CAPS = {
  post: 30,
  comment: 150,
  spark: 300,
  avatar: 15,
  challenge: 20,
  follow: 200,
  places: 120,
  music: 400,
  handle: 400,
  search: 400,
  video: 8,
  board: 300,
  email: 10,
  // Minuteur de repos : une série validée, un ajustement de +30 s… largement de quoi faire deux séances.
  rest: 800,
  // Modifier le texte d'une publication.
  edit: 60,
  // Connecteur Claude : appels d'outils (chacun déchiffre la sauvegarde) et autorisations données.
  mcp: 800,
  connect: 30,
} as const;

export async function capDaily(env: Env, userId: string, kind: keyof typeof DAILY_CAPS): Promise<void> {
  const n = await counters.incr(env, `q:${kind}:${userId}:${utcDay()}`, 2 * 86400);
  if (n > DAILY_CAPS[kind]) {
    throw new HttpError(429, 'Limite du jour atteinte pour cette action, réessaie demain');
  }
}
