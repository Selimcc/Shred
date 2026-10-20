// Données Apple Santé (envoyées par un Raccourci iPhone) et passages à la salle.
import { type Env, HttpError, localTime } from './env';
import { DEFAULT_CFG, type DayState, type UserCfg, vapidFromEnv } from './reminders';
import { loadJson, type Store } from './users';
import { type PushSubscriptionData, sendPush } from './webpush';

export interface HealthDay {
  steps?: number;
  activeKcal?: number;
  restingKcal?: number;
  at: string;
}

export interface GymDay {
  in?: string;
  out?: string;
  visits: number;
}

const TTL = 120 * 86400;

/**
 * Les Raccourcis peuvent envoyer des nombres ou du texte formaté à la française
 * (« 8 432 », « 412,5 kcal »). On accepte les deux.
 */
export function toNumber(v: unknown, max: number): number | undefined {
  let n: number | undefined;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    const cleaned = v.replace(/[\s  ]/g, '').replace(',', '.');
    const m = cleaned.match(/-?\d+(?:\.\d+)?/);
    n = m ? Number(m[0]) : undefined;
  }
  if (n === undefined || !Number.isFinite(n) || n < 0 || n > max) return undefined;
  return Math.round(n);
}

async function userCfg(store: Store): Promise<UserCfg> {
  return { ...DEFAULT_CFG, ...(await loadJson<UserCfg>(store, 'cfg')) };
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Les totaux du jour ne font que monter : on garde le plus grand pour ne pas écraser une bonne valeur par un envoi vide. */
export function mergeHealth(prev: HealthDay | null, next: Omit<HealthDay, 'at'>, at: string): HealthDay {
  const max = (a?: number, b?: number) => (a === undefined ? b : b === undefined ? a : Math.max(a, b));
  return {
    steps: max(prev?.steps, next.steps),
    activeKcal: max(prev?.activeKcal, next.activeKcal),
    restingKcal: max(prev?.restingKcal, next.restingKcal),
    at,
  };
}

export async function ingestHealth(store: Store, body: Record<string, unknown>, now = new Date()) {
  const cfg = await userCfg(store);
  const today = localTime(now, cfg.timezone).date;
  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : today;
  if (date > today || date < addDays(today, -7)) throw new HttpError(400, 'Date hors de la fenêtre des 7 derniers jours');

  const incoming = {
    steps: toNumber(body.steps, 200_000),
    activeKcal: toNumber(body.active_kcal ?? body.activeKcal, 20_000),
    restingKcal: toNumber(body.resting_kcal ?? body.restingKcal, 20_000),
  };
  if (incoming.steps === undefined && incoming.activeKcal === undefined && incoming.restingKcal === undefined) {
    throw new HttpError(400, 'Aucune valeur lisible : envoie steps, active_kcal ou resting_kcal');
  }
  const key = `health:${date}`;
  const prev = await loadJson<HealthDay>(store, key);
  const merged = mergeHealth(prev, incoming, now.toISOString());
  if (prev && !worthSaving(prev, merged, now)) return { date, ...prev, skipped: true };
  await store.put(key, JSON.stringify(merged), { expirationTtl: TTL });
  return { date, ...merged };
}

/**
 * Le raccourci peut tourner souvent (à chaque ouverture de WhatsApp, par exemple).
 * On n'écrit que si quelque chose a vraiment bougé, et pas plus d'une fois par quart d'heure pour de petits écarts :
 * la base gratuite limite les écritures à 1 000 par jour pour tout le monde.
 */
export function worthSaving(prev: HealthDay, next: HealthDay, now: Date): boolean {
  const gain = (a?: number, b?: number) => (b ?? 0) - (a ?? 0);
  const steps = gain(prev.steps, next.steps);
  const kcal = gain(prev.activeKcal, next.activeKcal) + gain(prev.restingKcal, next.restingKcal);
  if (steps <= 0 && kcal <= 0) return false;
  const age = now.getTime() - new Date(prev.at).getTime();
  return age >= 15 * 60_000 || steps >= 1000 || kcal >= 100;
}

export async function recentHealth(store: Store, days: number, now = new Date()) {
  const cfg = await userCfg(store);
  const today = localTime(now, cfg.timezone).date;
  const n = Math.max(1, Math.min(31, Math.floor(days) || 14));
  const dates = Array.from({ length: n }, (_, i) => addDays(today, -i));
  const rows = await Promise.all(
    dates.map(async (date) => {
      const [health, gym] = await Promise.all([
        loadJson<HealthDay>(store, `health:${date}`),
        loadJson<GymDay>(store, `gym:${date}`),
      ]);
      return [date, { health, gym }] as const;
    }),
  );
  return { today, days: Object.fromEntries(rows.filter(([, v]) => v.health || v.gym)) };
}

export async function gymEvent(env: Env, store: Store, kind: 'in' | 'out', now = new Date()) {
  const cfg = await userCfg(store);
  const { date, weekday } = localTime(now, cfg.timezone);
  const key = `gym:${date}`;
  const gym: GymDay = (await loadJson<GymDay>(store, key)) ?? { visits: 0 };
  const at = now.toISOString();
  let notified = false;

  if (kind === 'in') {
    gym.in = at;
    gym.out = undefined;
    gym.visits += 1;
    const [state, sub] = await Promise.all([
      loadJson<DayState>(store, 'state'),
      loadJson<PushSubscriptionData>(store, 'sub'),
    ]);
    const done = state?.date === date && state.mainDone;
    const vapid = vapidFromEnv(env);
    if (!done && sub && vapid) {
      const label = (state?.date === date && state.label) || cfg.plan[weekday] || 'Ta séance';
      try {
        const res = await sendPush(
          sub,
          { title: 'Te voilà à la salle', body: `${label} t’attend. Touche pour ouvrir ta séance.`, tag: 'gym', url: '/?tab=workout' },
          vapid,
          { urgency: 'high' },
        );
        notified = res.ok;
        if (res.gone) await store.delete('sub');
      } catch (e) {
        console.error('Notification d’arrivée impossible', e);
      }
    }
  } else {
    gym.out = at;
  }
  await store.put(key, JSON.stringify(gym), { expirationTtl: TTL });
  return { date, gym, notified };
}
