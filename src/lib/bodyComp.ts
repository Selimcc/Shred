// Ton corps estimé : masse grasse et développement des muscles, à partir de ce que l'app sait déjà (poids, taille,
// tour de taille, sexe, âge, charges). Rien n'est mesuré directement : c'est une estimation, affichée comme telle.
// - Masse grasse : avec un tour de taille, la formule RFM (Woolcott et Bergman, 2018) : 64 − 20 × taille / tour de
//   taille pour un homme, 76 − 20 × taille / tour de taille pour une femme, environ 4 à 5 points d'écart avec un
//   scanner DXA. Sinon la valeur de ton profil, sinon l'IMC (formule de Deurenberg, 1991), corrigé par tes
//   charges : à IMC égal, un pratiquant fort porte plus de muscle et moins de gras.
// - Muscles : la note de force de chaque groupe (E à A) ramenée de 0 à 1 ; sans charge notée, ton expérience.
import type { Experience, Sex } from '../../shared/athlete';
import { addDays } from './date';
import type { AppState } from './state';
import { strengthProfile } from './strength';
import { type BodyShape, CHANNELS, type Channel } from './body3d/shape';

export type FatMethod = 'waist' | 'declared' | 'bmi';

export interface BodyEstimate {
  date: string;
  weight: number;
  /** Taille en cm (supposée si elle n'est pas renseignée). */
  height: number;
  heightKnown: boolean;
  sex: Sex;
  /** Masse grasse en %. */
  fat: number;
  method: FatMethod;
  fatKg: number;
  leanKg: number;
  /** 0 (peu développé) à 1 (très développé), par zone. */
  muscle: Record<Channel, number>;
  /** Groupes notés avec tes charges (sur 6). */
  rated: number;
}

/** Moyenne des pesées de la semaine qui finit ce jour-là, sinon la dernière des 6 semaines d'avant. */
export function weightNear(s: AppState, date: string): number | null {
  const week: number[] = [];
  for (let i = 0; i < 7; i++) {
    const v = s.body.weight[addDays(date, -i)];
    if (v) week.push(v);
  }
  if (week.length) return week.reduce((a, b) => a + b, 0) / week.length;
  const from = addDays(date, -42);
  const last = Object.entries(s.body.weight)
    .filter(([d]) => d >= from && d <= date)
    .sort(([a], [b]) => b.localeCompare(a))[0];
  return last ? last[1] : null;
}

/** Le dernier tour de taille des 6 semaines qui finissent ce jour-là. */
export function waistNear(s: AppState, date: string): number | null {
  const from = addDays(date, -42);
  const last = Object.entries(s.body.waist)
    .filter(([d]) => d >= from && d <= date)
    .sort(([a], [b]) => b.localeCompare(a))[0];
  return last ? last[1] : null;
}

/** RFM : masse grasse d'après la taille et le tour de taille (en cm). */
export function rfm(heightCm: number, waistCm: number, sex: Sex): number {
  return (sex === 'female' ? 76 : 64) - (20 * heightCm) / waistCm;
}

/** Deurenberg : masse grasse d'après l'IMC, l'âge et le sexe. */
export function deurenberg(bmi: number, age: number, sex: Sex): number {
  return 1.2 * bmi + 0.23 * age - 10.8 * (sex === 'female' ? 0 : 1) - 5.4;
}

const EXPERIENCE_SCORE: Record<Experience, number> = { beginner: 1.2, intermediate: 2.4, advanced: 3.4 };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const toLevel = (score: number) => clamp((score - 0.5) / 4.5, 0, 1);

/** Développement de chaque zone d'après la fiche de force à cette date. */
export function muscleAt(s: AppState, date: string): { muscle: Record<Channel, number>; rated: number } {
  const p = strengthProfile(s, date);
  const score = (id: string) => p.groups.find((g) => g.id === id)?.score ?? null;
  const known = p.groups.filter((g) => g.score !== null).map((g) => g.score!);
  const fallback = known.length ? known.reduce((a, b) => a + b, 0) / known.length : (EXPERIENCE_SCORE[s.settings.athlete.experience] ?? 1.2);
  const lvl = (id: string) => toLevel(score(id) ?? fallback);
  const legs = (lvl('quads') + lvl('hamstrings')) / 2;
  const muscle: Record<Channel, number> = {
    chest: lvl('chest'),
    delts: lvl('shoulders'),
    arms: lvl('arms'),
    back: lvl('back'),
    traps: lvl('back'),
    quads: lvl('quads'),
    posterior: lvl('hamstrings'),
    calves: legs * 0.85,
  };
  return { muscle, rated: known.length };
}

/** Développement moyen des muscles, de 0 à 1. */
const average = (m: Record<Channel, number>) => CHANNELS.reduce((n, c) => n + m[c], 0) / CHANNELS.length;

/** L'estimation à une date, à partir de ce qu'on sait ce jour-là. */
export function estimateBody(s: AppState, date: string): BodyEstimate | null {
  const weight = weightNear(s, date);
  if (!weight) return null;
  const a = s.settings.athlete;
  const sex: Sex = a.sex === 'female' ? 'female' : 'male';
  const heightKnown = Boolean(s.settings.height && s.settings.height > 120 && s.settings.height < 230);
  const height = heightKnown ? s.settings.height! : sex === 'female' ? 164 : 177;
  const age = clamp(s.settings.age ?? 30, 16, 80);
  const { muscle, rated } = muscleAt(s, date);
  const avg = average(muscle);

  let fat: number;
  let method: FatMethod;
  const waist = waistNear(s, date);
  if (waist && heightKnown) {
    // La formule ne connaît pas les muscles : une taille épaissie par les abdos et les obliques passe pour du gras.
    fat = rfm(height, waist, sex) - (rated ? Math.max(0, avg - 0.4) * 6 : 0);
    method = 'waist';
  } else if (a.bodyFat) {
    fat = a.bodyFat;
    method = 'declared';
  } else {
    const bmi = weight / (height / 100) ** 2;
    // À IMC égal, plus de muscle veut dire moins de gras (seulement si les charges le disent).
    fat = deurenberg(bmi, age, sex) - (rated ? (avg - 0.3) * (sex === 'female' ? 10 : 12) : 0);
    method = 'bmi';
  }
  fat = clamp(fat, sex === 'female' ? 10 : 4, 55);
  const fatKg = (weight * fat) / 100;
  return { date, weight, height, heightKnown, sex, fat, method, fatKg, leanKg: weight - fatKg, muscle, rated };
}

/**
 * Ton corps à une date passée, déduit d'aujourd'hui : les formules donnent un niveau, mais suivent mal les
 * changements (un tour de taille qui baisse de 5 cm ne déplace la formule RFM que de 2 à 3 points). On part donc
 * de l'estimation du jour et on remonte avec le poids : la masse maigre suit tes charges quand on les connaît aux
 * deux dates, sinon on suppose qu'une perte de poids est surtout du gras (80 %) et une prise moitié-moitié.
 */
export function estimateBefore(s: AppState, now: BodyEstimate, date: string): BodyEstimate | null {
  const weight = weightNear(s, date);
  if (!weight) return null;
  const was = muscleAt(s, date);
  const both = was.rated >= 2 && now.rated >= 2;
  const muscle = was.rated ? was.muscle : now.muscle;
  const dw = now.weight - weight;
  const weeks = Math.max(1, (Date.parse(now.date) - Date.parse(date)) / (7 * 864e5));
  const dLean = both ? clamp((average(now.muscle) - average(was.muscle)) * 12, -0.25 * weeks, 0.25 * weeks) : dw * (dw < 0 ? 0.2 : 0.5);
  const leanKg = clamp(now.leanKg - dLean, weight * 0.45, weight * 0.96);
  const fatKg = weight - leanKg;
  return { ...now, date, weight, fat: (fatKg / weight) * 100, fatKg, leanKg, muscle, rated: was.rated };
}

/** Aujourd'hui, et il y a 12 semaines (sinon 8 ou 4) si tu t'étais pesé à ce moment-là. */
export function bodyTimeline(s: AppState, today: string): { now: BodyEstimate; then: BodyEstimate | null; weeks: number } | null {
  const now = estimateBody(s, today);
  if (!now) return null;
  for (const weeks of [12, 8, 4]) {
    const then = estimateBefore(s, now, addDays(today, -7 * weeks));
    if (then) return { now, then, weeks };
  }
  return { now, then: null, weeks: 0 };
}

/** Amplitude de chaque zone (m) entre un muscle peu et très développé. */
const AMP: Record<Channel, number> = { chest: 0.03, delts: 0.028, arms: 0.026, back: 0.026, traps: 0.024, quads: 0.03, posterior: 0.028, calves: 0.02 };

/** La forme du corps 3D pour une estimation : muscles autour d'un niveau moyen, gras autour d'un taux courant. */
export function shapeOf(e: BodyEstimate): BodyShape {
  const female = e.sex === 'female';
  const muscle = CHANNELS.map((c) => (e.muscle[c] - 0.4) * AMP[c] * (female && c !== 'quads' && c !== 'posterior' && c !== 'calves' ? 0.6 : 1));
  const ref = female ? 23 : 14;
  return { muscle, fat: clamp((e.fat - ref) * 0.0023, -0.012, 0.065), female: female ? 1 : 0 };
}

/** Netteté des séparations entre muscles : nettes quand on est sec, presque effacées avec plus de gras. */
export function definitionOf(e: BodyEstimate): number {
  const lean = e.sex === 'female' ? 17 : 10;
  return clamp(0.75 - (e.fat - lean) * 0.035, 0.1, 0.75);
}
