import { counters } from './usage';
import { type Env, localTime } from './env';
import { allUsers, loadJson, type Store } from './users';
import type { GymDay, HealthDay } from './health';
import { type PushSubscriptionData, sendPush, type VapidKeys } from './webpush';
import { type Lang, say, tx, txn } from './i18n';
import { isLang, LANGS } from '../shared/i18n';

export type ReminderType = 'morning' | 'breakfast' | 'lunch' | 'training' | 'dinner' | 'evening';

/** Rappels de repas : un par repas principal, seulement s'il n'est pas noté. */
export type MealReminder = 'breakfast' | 'lunch' | 'dinner';

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
  /** Jours de repos du planning (index 0 = dimanche). Absent pour une app d'avant la 0.31. */
  rest?: boolean[];
  /** Langue de l'app, pour écrire les rappels dans la même. */
  lang?: Lang;
  /** Module nutrition activé (rappels de repas). Absent avant la 0.32 : on regarde `meals`. */
  nutrition?: boolean;
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
  /** La séance du jour est un repos (actif). */
  rest?: boolean;
  /** Repas déjà notés aujourd'hui (petit-déjeuner, déjeuner, collation, dîner…). Absent avant la 0.32. */
  slots?: string[];
}

export const DEFAULT_CFG: UserCfg = {
  timezone: 'Europe/Paris',
  reminders: {
    morning: { on: true, time: '08:00' },
    breakfast: { on: true, time: '10:00' },
    lunch: { on: true, time: '13:30' },
    training: { on: true, time: '18:00' },
    dinner: { on: true, time: '21:00' },
    evening: { on: true, time: '21:30' },
  },
  plan: ['Conditionnement', 'Push', 'Pull', 'Legs', 'Repos actif', 'Upper', 'Lower'],
  lifting: [false, true, true, true, false, true, true],
  meals: 3,
};

export const ORDER: ReminderType[] = ['morning', 'breakfast', 'lunch', 'training', 'dinner', 'evening'];

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

/** Sans la liste des repas (app d'avant la 0.32), le nombre de repas notés fait foi. */
const MEALS_BEFORE: Record<MealReminder, number> = { breakfast: 1, lunch: 2, dinner: 3 };

/**
 * Rappel d'un repas pas encore noté, même si la journée est déjà validée : noter ce qu'on mange compte pour les
 * calories, pas seulement pour la flamme. Le lien ouvre la feuille d'ajout de ce repas (photo, code-barres, recherche).
 */
function mealReminder(type: MealReminder, cfg: UserCfg, s: DayState | null, T: (fr: string) => string): Notification | null {
  if (!(cfg.nutrition ?? cfg.meals > 0)) return null;
  const logged = s?.slots ? s.slots.includes(type) : (s?.meals ?? 0) >= MEALS_BEFORE[type];
  if (logged) return null;
  const quick = say('Photo, code-barres ou recherche : 10 secondes et c’est noté.');
  const text = {
    breakfast: { title: say('Ton petit-déjeuner est noté ?'), bodies: [quick, say('Note-le maintenant, ce soir tu ne t’en souviendras plus.')] },
    lunch: { title: say('Ton déjeuner est noté ?'), bodies: [quick, say('Une photo suffit, le calcul des calories est automatique.'), say('Coche ta box ou prends ton plat en photo, 10 secondes.')] },
    dinner: { title: say('Ton dîner est noté ?'), bodies: [quick, say('Dernier repas de la journée : note-le avant d’oublier.')] },
  }[type];
  return { title: T(text.title), body: T(pick(text.bodies)), tag: type, url: `/?tab=food&add=${type}` };
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
  const lang: Lang = isLang(cfg.lang) ? cfg.lang : 'fr';
  const locale = LANGS.find((l) => l.id === lang)!.locale;
  const T = (fr: string, vars?: Record<string, string | number>) => tx(lang, fr, vars);
  const s = state?.date === today ? state : null;
  const steps = extra.health?.steps;
  const stepsLeft = steps !== undefined && steps < 8000 ? 8000 - steps : 0;
  const fmt = (n: number) => n.toLocaleString(locale).replace(/\u202f|\u00a0/g, ' ');
  const atGym = !!extra.gym?.in && !extra.gym?.out;
  const label = s?.label || cfg.plan[weekday] || T('Séance');
  const lifting = s?.lifting ?? cfg.lifting[weekday] ?? true;
  // Repos actif : dit par l'app ; les apps d'avant la 0.31 n'envoient que le nom.
  const rest = s?.rest ?? cfg.rest?.[weekday] ?? label === 'Repos actif';
  const risk = streakAtRisk(state, today);
  const jours = (n: number) => txn(lang, n, '{n} jour', '{n} jours');

  if (type === 'breakfast' || type === 'lunch' || type === 'dinner') return mealReminder(type, cfg, s, (fr) => T(fr));
  if (s?.validated) return null;

  switch (type) {
    case 'morning': {
      const body = lifting
        ? T(pick([say('Prépare ton sac maintenant, tu te remercieras ce soir.'), say('Une séance de plus vers les épaules que tu veux.'), say('Le programme est prêt. Il ne manque que toi.')]))
        : rest
          ? T('8 000 pas et tes repas. Récupérer fait partie du plan.')
          : T('Corde, shadow ou intervalles : 35 minutes et c’est réglé.');
      return {
        title: T('Aujourd’hui : {label}', { label }),
        body: risk > 0 ? T('Série en cours : {days}. {body}', { days: jours(risk), body }) : body,
        tag: 'morning',
        url: '/?tab=today',
      };
    }
    case 'training': {
      if (s?.mainDone || atGym) return null;
      if (!lifting && rest && stepsLeft > 0) {
        return {
          title: T('Repos actif : encore un effort'),
          body: T('Il te manque {steps} pas pour tes 8 000. Une marche de 20 minutes suffit.', { steps: fmt(stepsLeft) }),
          tag: 'training',
          url: '/?tab=today',
        };
      }
      return {
        title: lifting ? T('{label} t’attend', { label }) : T('{label} : pas encore fait', { label }),
        body: lifting
          ? pick([
              T('La salle ne va pas venir à toi.'),
              risk > 0 ? T('{days} de série. Ce n’est pas ce soir que ça s’arrête.', { days: jours(risk) }) : T('Une séance aujourd’hui, une série qui démarre.'),
              T('Le fer ne se soulève pas tout seul.'),
              T('Même une séance moyenne bat une séance sautée.'),
            ])
          : T('Valide ton activité du jour pour garder ta série.'),
        tag: 'training',
        url: '/?tab=workout',
      };
    }
    case 'evening': {
      const hoursLeft = Math.max(1, Math.round((24 * 60 - minutes) / 60));
      const todo: string[] = [];
      if (!s?.mainDone) todo.push(lifting ? T('ta séance {label}', { label }) : lang === 'fr' ? label.toLowerCase() : label);
      if (cfg.meals > 0 && (s?.meals ?? 0) < cfg.meals) todo.push(T('tes repas'));
      const what = todo.length ? new Intl.ListFormat(locale, { type: 'conjunction' }).format(todo) : T('ta journée');
      return {
        title: risk > 0 ? T('Ta série de {days} est en danger', { days: jours(risk) }) : T('Lance ta série ce soir'),
        body: T('Il te reste {hours} h pour valider {what}.', { hours: hoursLeft, what }) + (stepsLeft > 0 ? T(' Et {steps} pas pour tes 8 000.', { steps: fmt(stepsLeft) }) : ''),
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

    // Un rappel ne part qu'une fois : le drapeau vit dans le compteur (USAGE), pas dans KV.
    if (store.scope && env.USAGE) {
      if (!(await counters.once(env, `sent:${store.scope}:${date}:${type}`, 2 * 86400))) continue;
    } else {
      const sentKey = `sent:${date}:${type}`;
      if (await store.get(sentKey)) continue;
      await store.put(sentKey, '1', { expirationTtl: 2 * 86400 });
    }

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
