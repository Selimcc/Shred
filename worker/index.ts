import { analyzeMeal, type CoachRequest, coachReply, type MealRequest, normalizeMessages, validateMeal } from './claude';
import { type Env, HttpError, json, localTime, readJson } from './env';
import { gymEvent, ingestHealth, recentHealth } from './health';
import { DEFAULT_CFG, type DayState, type ReminderType, runReminders, runRemindersFor, type UserCfg, vapidFromEnv } from './reminders';
import { accountRoutes, adminRoutes, authRoutes } from './auth';
import { getBackup, putBackup } from './backup';
import { profileRoutes } from './profiles';
import { emailReady, sendReport } from './report';
import { authenticate, ensureIndexed, listAccounts, loadJson, type User, userStore } from './users';
import { restRoute } from './timers';
import { clubRoutes } from './club';
import { stravaCallback, stravaRoutes } from './strava';
import { type PushSubscriptionData, sendPush } from './webpush';
import { counters, currentMode, FREE, flushUsage, lastKnownMode, metered, summary, sweepUsage, usageReport, utcDay } from './usage';

export { RestTimer } from './timers';
export { Club } from './club';
export { Usage } from './usage';
import { placeRoutes } from './places';

const VERSION = '0.17.0';

function cors(res: Response): Response {
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Headers', 'authorization, content-type');
  h.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  return new Response(res.body, { status: res.status, headers: h });
}

/** Requêtes IA autorisées par jour : l'administrateur paie la clé, il fixe la part des invités. */
function aiLimit(env: Env, user: User): number {
  const raw = user.role === 'admin' ? env.DAILY_AI_LIMIT : env.GUEST_AI_LIMIT;
  const n = Number(raw ?? (user.role === 'admin' ? 60 : 10));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Limite quotidienne d'appels IA pour garder les coûts sous contrôle. */
async function consumeAiQuota(env: Env, user: User) {
  const limit = aiLimit(env, user);
  if (limit === 0) throw new HttpError(403, 'L’IA intégrée n’est pas ouverte aux invités : choisis « App Claude » dans Réglages, IA.');
  const day = new Date().toISOString().slice(0, 10);
  const key = `ai:${user.id}:${day}`;
  const used = await counters.get(env, key);
  if (used >= limit) throw new HttpError(429, `Limite de ${limit} requêtes IA atteinte aujourd’hui`);
  return { used: await counters.incr(env, key, 2 * 86400), limit };
}

/** Routes que les Raccourcis iPhone appellent avec leur clé dédiée. */
const DEVICE_ROUTES = new Set(['/api/health/ingest', '/api/gym/checkin', '/api/gym/checkout']);

function isTime(v: unknown): v is string {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

function sanitizeCfg(input: Partial<UserCfg> | undefined, current: UserCfg): UserCfg {
  const cfg: UserCfg = structuredClone(current);
  if (!input) return cfg;
  if (typeof input.timezone === 'string') {
    try {
      new Intl.DateTimeFormat('fr-FR', { timeZone: input.timezone });
      cfg.timezone = input.timezone;
    } catch {
      throw new HttpError(400, 'Fuseau horaire inconnu');
    }
  }
  if (input.reminders) {
    for (const type of Object.keys(DEFAULT_CFG.reminders) as ReminderType[]) {
      const r = input.reminders[type];
      if (!r) continue;
      cfg.reminders[type] = { on: Boolean(r.on), time: isTime(r.time) ? r.time : cfg.reminders[type].time };
    }
  }
  if (Array.isArray(input.plan) && input.plan.length === 7) cfg.plan = input.plan.map((p) => String(p).slice(0, 30));
  if (Array.isArray(input.lifting) && input.lifting.length === 7) cfg.lifting = input.lifting.map(Boolean);
  if (input.meals !== undefined) cfg.meals = Math.max(0, Math.min(4, Math.round(Number(input.meals) || 0)));
  return cfg;
}

function isSubscription(v: unknown): v is PushSubscriptionData {
  const s = v as PushSubscriptionData;
  return (
    !!s &&
    typeof s.endpoint === 'string' &&
    s.endpoint.startsWith('https://') &&
    typeof s.keys?.p256dh === 'string' &&
    typeof s.keys?.auth === 'string'
  );
}

async function route(req: Request, env: Env, url: URL, ctx?: ExecutionContext): Promise<Response> {
  const { pathname } = url;
  const method = req.method;

  // Public : version déployée (vérifiée par la CI après chaque déploiement).
  if (pathname === '/api/version' && method === 'GET') return json({ version: VERSION });

  const open = (await authRoutes(req, env, pathname)) ?? (method === 'GET' ? await stravaCallback(env, url) : null);
  if (open) return open;

  const user: User = await authenticate(req, env, { deviceKey: DEVICE_ROUTES.has(pathname) });
  const store = user.store;

  if (pathname === '/api/admin/usage' && method === 'GET') {
    if (user.role !== 'admin') throw new HttpError(403, 'Réservé à l’administrateur');
    const days = await usageReport(env, 14);
    return json({ limits: FREE, mode: await currentMode(env), days: days.map((d) => summary(d)), tracked: Boolean(env.USAGE) });
  }

  const place = await placeRoutes(req, env, pathname);
  if (place) return place;

  const acct =
    (await accountRoutes(req, env, user, pathname)) ??
    (await adminRoutes(req, env, user, url)) ??
    (await profileRoutes(req, env, user, pathname)) ??
    (await clubRoutes(req, env, user, url, ctx)) ??
    (await stravaRoutes(req, env, user, url));
  if (acct) return acct;

  if (pathname === '/api/health' && method === 'GET') {
    return json({
      ok: true,
      version: VERSION,
      ai: env.MOCK_AI === '1' ? 'mock' : env.ANTHROPIC_API_KEY ? 'live' : 'missing',
      aiLimit: aiLimit(env, user),
      push: Boolean(vapidFromEnv(env)),
      email: emailReady(env),
      subscribed: Boolean(await store.get('sub')),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      shortcuts: (await loadJson<Record<string, string>>(env.KV, 'cfg:shortcuts')) ?? {},
    });
  }

  if (pathname === '/api/report/email' && method === 'POST') return sendReport(req, env, user);
  if (pathname === '/api/backup' && method === 'PUT') return putBackup(req, env, user);
  if (pathname === '/api/backup' && method === 'GET') return getBackup(env, user, url.searchParams.get('meta') === '1');

  if (pathname === '/api/push/key' && method === 'GET') {
    const vapid = vapidFromEnv(env);
    if (!vapid) throw new HttpError(503, 'Clés VAPID non configurées sur le serveur');
    return json({ publicKey: vapid.publicKey });
  }

  if (pathname === '/api/push/subscribe' && method === 'POST') {
    const body = await readJson<{ subscription: unknown; config?: Partial<UserCfg> }>(req, 20_000);
    if (!isSubscription(body.subscription)) throw new HttpError(400, 'Abonnement push invalide');
    const current = (await loadJson<UserCfg>(store, 'cfg')) ?? DEFAULT_CFG;
    const cfg = sanitizeCfg(body.config, current);
    await Promise.all([
      store.put('sub', JSON.stringify(body.subscription)),
      store.put('cfg', JSON.stringify(cfg)),
      ensureIndexed(env, user.id),
    ]);
    return json({ ok: true, config: cfg });
  }

  if (pathname === '/api/push/rest' && (method === 'POST' || method === 'DELETE')) return restRoute(req, env, user);

  if (pathname === '/api/push/unsubscribe' && method === 'POST') {
    await store.delete('sub');
    return json({ ok: true });
  }

  if (pathname === '/api/push/test' && method === 'POST') {
    const vapid = vapidFromEnv(env);
    if (!vapid) throw new HttpError(503, 'Clés VAPID non configurées sur le serveur');
    const sub = await loadJson<PushSubscriptionData>(store, 'sub');
    if (!sub) throw new HttpError(404, 'Aucun appareil abonné aux notifications');
    const res = await sendPush(
      sub,
      { title: 'Notifications activées', body: 'Tu recevras tes rappels ici. Pas d’excuse.', tag: 'test', url: '/' },
      vapid,
      { urgency: 'high' },
    );
    if (res.gone) await store.delete('sub');
    if (!res.ok) throw new HttpError(502, `Le service push a refusé l’envoi (${res.status})`);
    return json({ ok: true });
  }

  if (pathname === '/api/config' && method === 'PUT') {
    const body = await readJson<{ config?: Partial<UserCfg> }>(req, 20_000);
    const current = (await loadJson<UserCfg>(store, 'cfg')) ?? DEFAULT_CFG;
    const cfg = sanitizeCfg(body.config, current);
    await store.put('cfg', JSON.stringify(cfg));
    return json({ ok: true, config: cfg });
  }

  if (pathname === '/api/state' && method === 'POST') {
    const b = await readJson<Partial<DayState>>(req, 5_000);
    if (typeof b.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) throw new HttpError(400, 'Date invalide');
    const state: DayState = {
      date: b.date,
      label: String(b.label ?? '').slice(0, 30),
      mainDone: Boolean(b.mainDone),
      meals: Math.max(0, Math.min(10, Number(b.meals) || 0)),
      validated: Boolean(b.validated),
      streak: Math.max(0, Number(b.streak) || 0),
      banked: Math.max(0, Number(b.banked) || 0),
      lifting: typeof b.lifting === 'boolean' ? b.lifting : undefined,
    };
    await store.put('state', JSON.stringify(state));
    return json({ ok: true });
  }

  if (pathname === '/api/health/ingest' && method === 'POST') {
    // Appelé par le Raccourci iPhone « Shred Santé ».
    const body = await readJson<Record<string, unknown>>(req, 5_000);
    return json({ ok: true, saved: await ingestHealth(store, body, new Date(), await currentMode(env)) });
  }

  if (pathname === '/api/health/recent' && method === 'GET') {
    return json(await recentHealth(store, Number(url.searchParams.get('days') ?? 14)));
  }

  if ((pathname === '/api/gym/checkin' || pathname === '/api/gym/checkout') && method === 'POST') {
    // Appelé par les automatisations d'arrivée et de départ de la salle.
    return json({ ok: true, ...(await gymEvent(env, store, pathname.endsWith('checkin') ? 'in' : 'out')) });
  }

  if (pathname === '/api/meal/analyze' && method === 'POST') {
    const body = await readJson<MealRequest>(req);
    validateMeal(body);
    const quota = await consumeAiQuota(env, user);
    const analysis = await analyzeMeal(env, body);
    return json({ ...analysis, quota });
  }

  if (pathname === '/api/coach' && method === 'POST') {
    const body = await readJson<CoachRequest>(req, 200_000);
    normalizeMessages(Array.isArray(body.messages) ? body.messages : []);
    const quota = await consumeAiQuota(env, user);
    const reply = await coachReply(env, body);
    return json({ reply, quota });
  }

  if (pathname === '/api/debug/reminders' && method === 'POST') {
    // Force l'évaluation des rappels à une heure donnée (tests).
    const body = await readJson<{ at?: string }>(req, 1_000);
    const at = body.at ? new Date(body.at) : new Date();
    const cfg = (await loadJson<UserCfg>(store, 'cfg')) ?? DEFAULT_CFG;
    const sent = await runRemindersFor(env, store, at);
    return json({ ok: true, local: localTime(at, cfg.timezone), sent });
  }

  throw new HttpError(404, 'Route inconnue');
}

export default {
  async fetch(req, rawEnv, ctx): Promise<Response> {
    const url = new URL(req.url);
    // Les fichiers de l'app ne touchent ni KV ni les objets : seules les requêtes de l'API sont comptées.
    const env = url.pathname.startsWith('/api/') ? metered(rawEnv) : rawEnv;
    if (env !== rawEnv) ctx?.waitUntil(flushUsage(env).then(() => alertIfNeeded(env)));
    // Lien d'invitation : l'app installée depuis ce lien s'ouvre avec le code déjà rempli.
    const invite = url.searchParams.get('invite');
    if (url.pathname === '/manifest.webmanifest' && invite && /^[A-Za-z0-9-]{4,40}$/.test(invite)) {
      const res = await rawEnv.ASSETS.fetch(new Request(new URL('/manifest.webmanifest', url), req));
      const manifest = (await res.json()) as Record<string, unknown>;
      return new Response(JSON.stringify({ ...manifest, start_url: `/?invite=${encodeURIComponent(invite)}` }), {
        headers: { 'content-type': 'application/manifest+json', 'cache-control': 'no-store' },
      });
    }
    if (!url.pathname.startsWith('/api/')) {
      // App privée : on demande aux moteurs de recherche de ne pas l'indexer.
      const res = await env.ASSETS.fetch(req);
      const h = new Headers(res.headers);
      h.set('X-Robots-Tag', 'noindex, nofollow');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    }
    if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    try {
      const res = await route(req, env, url, ctx);
      return cors(res);
    } catch (e) {
      if (e instanceof HttpError) return cors(json({ error: e.message }, e.status));
      console.error(e);
      return cors(json({ error: 'Erreur serveur' }, 500));
    }
  },

  async scheduled(event, rawEnv, ctx): Promise<void> {
    const env = metered(rawEnv);
    const at = new Date(event.scheduledTime);
    ctx.waitUntil(
      runReminders(env, at)
        .then((sent) => {
          for (const [who, types] of Object.entries(sent)) if (types.length) console.log(`Rappels envoyés à ${who} :`, types.join(', '));
        })
        // Une fois par jour, vers 3 h UTC, on range les compteurs expirés.
        .then(() => (at.getUTCHours() === 3 && at.getUTCMinutes() < 15 ? sweepUsage(env) : undefined))
        .then(() => flushUsage(env, true))
        .then(() => alertIfNeeded(env)),
    );
  },
} satisfies ExportedHandler<Env>;

/** Le plan gratuit approche de sa limite : l'administrateur reçoit une notification, une fois par jour et par palier. */
async function alertIfNeeded(env: Env) {
  const mode = lastKnownMode();
  if (mode === 'normal') return;
  const vapid = vapidFromEnv(env);
  if (!vapid || !(await counters.once(env, `alert:${mode}:${utcDay()}`, 86400))) return;
  const admins = (await listAccounts(env)).filter((a) => a.role === 'admin');
  await Promise.all(
    admins.map(async (a) => {
      const store = userStore(env.KV, a.id);
      const sub = await loadJson<PushSubscriptionData>(store, 'sub');
      if (!sub) return;
      await sendPush(
        sub,
        {
          title: mode === 'critical' ? 'Cloudflare : plan gratuit presque épuisé' : 'Cloudflare : mode économie',
          body:
            mode === 'critical'
              ? 'Plus de 90 % des écritures du jour. La santé et les sauvegardes ralentissent jusqu’à 1 h du matin.'
              : 'Plus de 60 % des écritures du jour. Shred enregistre moins souvent pour tenir jusqu’à minuit UTC.',
          tag: 'usage',
          url: '/?settings=usage',
        },
        vapid,
      ).catch(() => undefined);
    }),
  );
}
