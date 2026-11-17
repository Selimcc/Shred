// Données Apple Santé (envoyées par un Raccourci iPhone) et passages à la salle.
import { type Env, HttpError, localTime } from './env';
import { DEFAULT_CFG, type DayState, type UserCfg, vapidFromEnv } from './reminders';
import { loadJson, type Store } from './users';
import { type PushSubscriptionData, sendPush } from './webpush';
import { type Lang, tx } from './i18n';
import { isLang } from '../shared/i18n';

export interface HealthDay {
  steps?: number;
  activeKcal?: number;
  restingKcal?: number;
  /** Sommeil de la nuit précédente, en minutes. */
  sleepMin?: number;
  /** Fréquence cardiaque au repos (bpm) et variabilité (VFC, ms). */
  restingHr?: number;
  hrv?: number;
  /** Minutes d'exercice (anneau vert d'Apple) et distance marche + course en km. */
  exerciseMin?: number;
  distanceKm?: number;
  at: string;
}

/** Valeurs qui s'accumulent dans la journée (on garde la plus grande) et valeurs ponctuelles (la dernière compte). */
const CUMULATIVE = ['steps', 'activeKcal', 'restingKcal', 'exerciseMin', 'distanceKm'] as const;
const LATEST = ['sleepMin', 'restingHr', 'hrv'] as const;

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

/** Décimal à la française ou non (« 7,5 »), arrondi à `digits` chiffres. */
export function toDecimal(v: unknown, max: number, digits = 1): number | undefined {
  let n: number | undefined;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    const m = v.replace(/[\s  ]/g, '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
    n = m ? Number(m[0]) : undefined;
  }
  if (n === undefined || !Number.isFinite(n) || n < 0 || n > max) return undefined;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Les totaux du jour ne font que monter : on garde le plus grand pour ne pas écraser une bonne valeur par un envoi vide. */
export function mergeHealth(prev: HealthDay | null, next: Omit<HealthDay, 'at'>, at: string): HealthDay {
  const max = (a?: number, b?: number) => (a === undefined ? b : b === undefined ? a : Math.max(a, b));
  const out: HealthDay = { at };
  for (const k of CUMULATIVE) {
    const v = max(prev?.[k], next[k]);
    if (v !== undefined) out[k] = v;
  }
  for (const k of LATEST) {
    const v = next[k] ?? prev?.[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Sommeil envoyé en minutes (sleep_min) ou en heures (sleep_h, « 7,5 » ou « 7 h 30 »). Raccourcis donne
 * souvent une durée en secondes (27 120) ou sous la forme « 7:32:00 » : les deux sont reconnues.
 */
export function sleepMinutes(body: Record<string, unknown>): number | undefined {
  const rawMin = body.sleep_min ?? body.sleepMin;
  if (typeof rawMin === 'string') {
    const hms = rawMin.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (hms) return Number(hms[1]) * 60 + Number(hms[2]) + Math.round(Number(hms[3] ?? 0) / 60);
  }
  const min = toNumber(rawMin, 24 * 60);
  if (min !== undefined) return min;
  const sec = toNumber(rawMin, 24 * 3600);
  if (sec !== undefined) return Math.round(sec / 60);
  const raw = body.sleep_h ?? body.sleep;
  if (typeof raw === 'string') {
    const hm = raw.match(/(\d+)\s*h\s*(\d+)?/i);
    if (hm) return Number(hm[1]) * 60 + Number(hm[2] ?? 0);
  }
  const h = toDecimal(raw, 24, 2);
  return h === undefined ? undefined : Math.round(h * 60);
}

/**
 * Raccourcis envoie parfois une liste (plusieurs échantillons), un objet, ou des clés avec un espace en
 * trop : on ramène chaque valeur à un nombre ou un texte simple, et chaque clé à sa forme propre.
 */
function flatValue(v: unknown, depth = 0): unknown {
  if (depth > 4) return undefined;
  if (Array.isArray(v)) return v.length ? flatValue(v[0], depth + 1) : undefined;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return flatValue(o.value ?? o.quantity ?? o.Valeur ?? Object.values(o)[0], depth + 1);
  }
  return typeof v === 'string' ? v.slice(0, 200) : v;
}

/** Totaux du jour : plusieurs échantillons s'additionnent (raccourci sans « regrouper par jour »). */
const SUMMED = new Set(['steps', 'active_kcal', 'activekcal', 'resting_kcal', 'restingkcal', 'exercise_min', 'exercisemin', 'distance_km', 'distancekm', 'sleep_min', 'sleepmin', 'sleep_h', 'sleep']);
/** Mesures ponctuelles : plusieurs échantillons donnent la moyenne. */
const AVERAGED = new Set(['resting_hr', 'restinghr', 'hrv']);
const HMS = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** Plusieurs échantillons : une liste, ou un texte d'une valeur par ligne (une liste que Raccourcis a changée en texte). */
function samples(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v.length > 1 ? v.slice(0, 2000) : null;
  if (typeof v !== 'string' || !v.trim().includes('\n')) return null;
  const lines = v.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length > 1 ? lines.slice(0, 2000) : null;
}

/** Valeur d'un échantillon : 8432, « 8 432 pas », « 412,6 kcal », ou une durée « 7:32:00 » (en secondes). */
function sampleNumber(v: unknown): number | undefined {
  const x = flatValue(v);
  if (typeof x === 'number') return Number.isFinite(x) && x >= 0 ? x : undefined;
  if (typeof x !== 'string') return undefined;
  const hms = x.trim().match(HMS);
  if (hms) return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3] ?? 0);
  const m = x.replace(/[\s  ]/g, '').replace(',', '.').match(/^\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : undefined;
}

/** Une liste d'échantillons devient une seule valeur : la somme pour un total, la moyenne pour le cœur. */
function combine(norm: string, v: unknown): unknown {
  const list = samples(v);
  if (!list) return flatValue(v);
  if (!SUMMED.has(norm) && !AVERAGED.has(norm)) return flatValue(list[0]);
  const nums = list.map(sampleNumber).filter((n): n is number => n !== undefined);
  if (!nums.length) return undefined;
  const total = nums.reduce((a, b) => a + b, 0);
  if (AVERAGED.has(norm)) return Math.round((total / nums.length) * 10) / 10;
  // Des durées « h:mm:ss » restent une durée : le sommeil sait la lire, sans confondre minutes et secondes.
  if (list.some((x) => typeof flatValue(x) === 'string' && HMS.test(String(flatValue(x)).trim()))) {
    const s = Math.round(total);
    return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  return Math.round(total * 1000) / 1000;
}

/** Clés qui modifieraient le prototype d'un objet JavaScript. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const FIELDS = new Set(['steps', 'active_kcal', 'resting_kcal', 'sleep_min', 'sleep_h', 'resting_hr', 'hrv', 'exercise_min', 'distance_km', 'date']);

export function cleanBody(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let [k, v] of Object.entries(raw ?? {}).slice(0, 60)) {
    // Nom et valeur inversés dans le dictionnaire (« 3588 » = « steps ») : on remet dans le bon sens.
    if (typeof v === 'string' && FIELDS.has(v.trim().toLowerCase()) && !FIELDS.has(k.trim().toLowerCase())) [k, v] = [v, k];
    const norm = k.trim().toLowerCase().replace(/[\s-]+/g, '_');
    const value = combine(norm, v);
    if (k.length > 60 || UNSAFE_KEYS.has(k) || UNSAFE_KEYS.has(norm)) continue;
    out[k] = value;
    out[norm] = value;
  }
  return out;
}

function received(body: Record<string, unknown>, lang: Lang): string {
  const parts = Object.entries(body).filter(([k]) => k === k.toLowerCase()).map(([k, v]) => `${k} = ${v === undefined || v === '' ? tx(lang, 'vide') : JSON.stringify(v).slice(0, 30)}`);
  return parts.length ? tx(lang, ' Reçu : {list}.', { list: parts.join(', ') }) : tx(lang, ' Le corps de la requête est vide : vérifie « Corps de la requête : JSON ».');
}

/** Écart minimal entre deux enregistrements de petits changements, selon le mode du serveur (minutes). */
export const HEALTH_GAP: Record<'normal' | 'economy' | 'critical', number> = { normal: 15, economy: 60, critical: 180 };

export async function ingestHealth(store: Store, rawBody: Record<string, unknown>, now = new Date(), mode: 'normal' | 'economy' | 'critical' = 'normal', lang: Lang = 'fr') {
  const body = cleanBody(rawBody);
  const cfg = await userCfg(store);
  const today = localTime(now, cfg.timezone).date;
  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : today;
  if (date > today || date < addDays(today, -7)) throw new HttpError(400, 'Date hors de la fenêtre des 7 derniers jours');

  const incoming: Omit<HealthDay, 'at'> = {
    steps: toNumber(body.steps, 200_000),
    activeKcal: toNumber(body.active_kcal ?? body.activeKcal, 20_000),
    restingKcal: toNumber(body.resting_kcal ?? body.restingKcal, 20_000),
    sleepMin: sleepMinutes(body),
    restingHr: toNumber(body.resting_hr ?? body.restingHr, 250),
    hrv: toNumber(body.hrv, 400),
    exerciseMin: toNumber(body.exercise_min ?? body.exerciseMin, 1440),
    distanceKm: toDecimal(body.distance_km ?? body.distanceKm, 300),
  };
  if (Object.values(incoming).every((v) => v === undefined)) {
    throw new HttpError(400, 'Aucune valeur lisible : envoie steps, active_kcal, resting_kcal, sleep_min, resting_hr, hrv, exercise_min ou distance_km.{received}', {
      received: received(body, lang),
    });
  }
  const key = `health:${date}`;
  const prev = await loadJson<HealthDay>(store, key);
  const merged = mergeHealth(prev, incoming, now.toISOString());
  if (prev && !worthSaving(prev, merged, now, HEALTH_GAP[mode])) return { date, ...prev, skipped: true };
  await store.put(key, JSON.stringify(merged), { expirationTtl: TTL });
  return { date, ...merged };
}

/**
 * Le raccourci peut tourner souvent (à chaque ouverture de WhatsApp, par exemple).
 * On n'écrit que si quelque chose a vraiment bougé, et pas plus d'une fois par quart d'heure pour de petits écarts :
 * la base gratuite limite les écritures à 1 000 par jour pour tout le monde.
 */
export function worthSaving(prev: HealthDay, next: HealthDay, now: Date, gapMin = 15): boolean {
  const gain = (a?: number, b?: number) => (b ?? 0) - (a ?? 0);
  const age = now.getTime() - new Date(prev.at).getTime();
  // Sommeil, cœur : une nouvelle valeur s'enregistre tout de suite (en mode critique, au rythme réduit).
  if (LATEST.some((k) => next[k] !== undefined && next[k] !== prev[k])) return gapMin <= 60 || age >= gapMin * 60_000;
  const steps = gain(prev.steps, next.steps);
  const kcal = gain(prev.activeKcal, next.activeKcal) + gain(prev.restingKcal, next.restingKcal) + gain(prev.exerciseMin, next.exerciseMin) * 5;
  if (steps <= 0 && kcal <= 0) return false;
  if (age >= gapMin * 60_000) return true;
  // Gros écart : enregistré sans attendre, sauf en mode critique.
  return gapMin <= 60 && (steps >= 1000 || kcal >= 100);
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
      // Le raccourci de l'iPhone n'a pas de langue : on prend celle de l'app.
      const lang = isLang(cfg.lang) ? cfg.lang : 'fr';
      const label = (state?.date === date && state.label) || cfg.plan[weekday] || tx(lang, 'Ta séance');
      try {
        const res = await sendPush(
          sub,
          { title: tx(lang, 'Te voilà à la salle'), body: tx(lang, '{label} t’attend. Touche pour ouvrir ta séance.', { label }), tag: 'gym', url: '/?tab=workout' },
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
