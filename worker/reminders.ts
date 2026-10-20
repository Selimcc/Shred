import { type Env, localTime } from './env';
import { allUsers, loadJson, type Store } from './users';
import type { GymDay, HealthDay } from './health';
import { type PushSubscriptionData, sendPush, type VapidKeys } from './webpush';

export type ReminderType = 'morning' | 'lunch' | 'training' | 'evening';

export interface ReminderCfg {
  on: boolean;
  time: string; // "HH:MM"
}

export interface UserCfg {
  timezone: string;
  reminders: Record<ReminderType, ReminderCfg>;
  /** Libellé de la séance par jour de semaine (index 0 = dimanche). */
  plan: string[];
  /** true si la séance du jour est de la muscu. */
  lifting: boolean[];
  /** Repas à noter pour valider la journée (0 = module nutrition coupé). */
  meals: number;
}

/** Résumé envoyé par l'app à chaque changement. */
export interface DayState {
  date: string;
  label: string;
  mainDone: boolean;
  meals: number;
  validated: boolean;
  /** Série affichée (inclut aujourd'hui si validé). */
  streak: number;
  /** Série acquise jusqu'à hier, celle qui est en jeu aujourd'hui. */
  banked: number;
  /** La séance du jour est de la muscu (peut différer du planning si elle a été changée). */
  lifting?: boolean;
}

export const DEFAULT_CFG: UserCfg = {
  timezone: 'Europe/Paris',
  reminders: {
    morning: { on: true, time: '08:00' },
    lunch: { on: true, time: '13:30' },
    training: { on: true, time: '18:00' },
    evening: { on: true, time: '21:30' },
  },
  plan: ['Conditionnement', 'Push', 'Pull', 'Legs', 'Repos actif', 'Upper', 'Lower'],
  lifting: [false, true, true, true, false, true, true],
  meals: 3,
};

export const ORDER: ReminderType[] = ['morning', 'lunch', 'training', 'evening'];

/** Fenêtre de déclenchement : le cron tourne toutes les 15 min. */
const WINDOW_MIN = 15;

export interface Notification {
  title: string;
  body: string;
  tag: string;
  url: string;
}

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function streakAtRisk(state: DayState | null, today: string): number {
  if (!state) return 0;
  if (state.date === today) return state.banked;
  if (state.date === addDays(today, -1)) return state.validated ? state.streak : state.banked;
  return 0;
}

export function buildReminder(
  type: ReminderType,
  cfg: UserCfg,
  state: DayState | null,
  today: string,
  weekday: number,
  minutes: number,
  extra: { health?: HealthDay | null; gym?: GymDay | null } = {},
): Notification | null {
  const s = state?.date === today ? state : null;
  const steps = extra.health?.steps;
  const stepsLeft = steps !== undefined && steps < 8000 ? 8000 - steps : 0;
  const fmt = (n: number) => n.toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ');
  const atGym = !!extra.gym?.in && !extra.gym?.out;
  const label = s?.label || cfg.plan[weekday] || 'Séance';
  const lifting = s?.lifting ?? cfg.lifting[weekday] ?? true;
  const risk = streakAtRisk(state, today);
  const jours = (n: number) => `${n} jour${n > 1 ? 's' : ''}`;

  if (s?.validated) return null;

  switch (type) {
    case 'morning': {
      const body = lifting
        ? pick([
            'Prépare ton sac maintenant, tu te remercieras ce soir.',
            'Une séance de plus vers les épaules que tu veux.',
            'Le programme est prêt. Il ne manque que toi.',
          ])
        : label === 'Repos actif'
          ? '8 000 pas et tes repas. Récupérer fait partie du plan.'
          : 'Corde, shadow ou intervalles : 35 minutes et c’est réglé.';
      return {
        title: `Aujourd’hui : ${label}`,
        body: risk > 0 ? `Série en cours : ${jours(risk)}. ${body}` : body,
        tag: 'morning',
        url: '/?tab=today',
      };
    }
    case 'lunch': {
      if (cfg.meals === 0 || (s?.meals ?? 0) >= 2) return null;
      return {
        title: 'Ton déjeuner est noté ?',
        body: pick([
          'Une photo suffit, le calcul des calories est automatique.',
          'Coche ta box ou prends ton plat en photo, 10 secondes.',
        ]),
        tag: 'lunch',
        url: '/?tab=food',
      };
    }
    case 'training': {
      if (s?.mainDone || atGym) return null;
      if (!lifting && label === 'Repos actif' && stepsLeft > 0) {
        return {
          title: 'Repos actif : encore un effort',
          body: `Il te manque ${fmt(stepsLeft)} pas pour tes 8 000. Une marche de 20 minutes suffit.`,
          tag: 'training',
          url: '/?tab=today',
        };
      }
      return {
        title: lifting ? `${label} t’attend` : `${label} : pas encore fait`,
        body: lifting
          ? pick([
              'La salle ne va pas venir à toi.',
              risk > 0 ? `${jours(risk)} de série. Ce n’est pas ce soir que ça s’arrête.` : 'Une séance aujourd’hui, une série qui démarre.',
              'Le fer ne se soulève pas tout seul.',
              'Même une séance moyenne bat une séance sautée.',
            ])
          : 'Valide ton activité du jour pour garder ta série.',
        tag: 'training',
        url: '/?tab=workout',
      };
    }
    case 'evening': {
      const hoursLeft = Math.max(1, Math.round((24 * 60 - minutes) / 60));
      const todo: string[] = [];
      if (!s?.mainDone) todo.push(lifting ? `ta séance ${label}` : label.toLowerCase());
      if (cfg.meals > 0 && (s?.meals ?? 0) < cfg.meals) todo.push('tes repas');
      return {
        title: risk > 0 ? `Ta série de ${jours(risk)} est en danger` : 'Lance ta série ce soir',
        body: `Il te reste ${hoursLeft} h pour valider ${todo.length ? todo.join(' et ') : 'ta journée'}.${stepsLeft > 0 ? ` Et ${fmt(stepsLeft)} pas pour tes 8 000.` : ''}`,
        tag: 'evening',
        url: '/?tab=today',
      };
    }
  }
}

export function vapidFromEnv(env: Env): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT || 'mailto:admin@example.com',
  };
}

/** Appelé par le cron : passe sur chaque compte inscrit. */
export async function runReminders(env: Env, now = new Date()): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const user of await allUsers(env)) {
    try {
      out[user.name ?? user.id] = await runRemindersFor(env, user.store, now);
    } catch (e) {
      console.error('Rappels impossibles pour', user.name ?? user.id, e);
    }
  }
  return out;
}

/** Envoie à une personne les rappels dont l'heure tombe dans la fenêtre courante. */
export async function runRemindersFor(env: Env, store: Store, now = new Date()): Promise<string[]> {
  const vapid = vapidFromEnv(env);
  if (!vapid) return [];
  const [sub, cfgStored, state] = await Promise.all([
    loadJson<PushSubscriptionData>(store, 'sub'),
    loadJson<UserCfg>(store, 'cfg'),
    loadJson<DayState>(store, 'state'),
  ]);
  if (!sub) return [];
  const cfg: UserCfg = { ...DEFAULT_CFG, ...cfgStored, reminders: { ...DEFAULT_CFG.reminders, ...cfgStored?.reminders } };
  const { date, minutes, weekday } = localTime(now, cfg.timezone);
  const sent: string[] = [];
  let extra: { health?: HealthDay | null; gym?: GymDay | null } | undefined;

  for (const type of ORDER) {
    const r = cfg.reminders[type];
    if (!r?.on) continue;
    const [h, m] = r.time.split(':').map(Number);
    const t = h * 60 + m;
    if (minutes < t || minutes >= t + WINDOW_MIN) continue;

    const sentKey = `sent:${date}:${type}`;
    if (await store.get(sentKey)) continue;
    await store.put(sentKey, '1', { expirationTtl: 2 * 86400 });

    extra ??= {
      health: await loadJson<HealthDay>(store, `health:${date}`),
      gym: await loadJson<GymDay>(store, `gym:${date}`),
    };
    const notif = buildReminder(type, cfg, state, date, weekday, minutes, extra);
    if (!notif) continue;
    try {
      const res = await sendPush(sub, notif, vapid, { urgency: type === 'evening' ? 'high' : 'normal', topic: type });
      if (res.gone) {
        await store.delete('sub');
        console.log('Abonnement push expiré, supprimé');
        break;
      }
      if (!res.ok) console.error('Push refusé', res.status, res.detail);
      else sent.push(type);
    } catch (e) {
      console.error('Envoi push impossible', e);
    }
  }
  return sent;
}
