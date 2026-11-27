// Fiche de force : note de A à E par groupe musculaire, calculée à partir des charges notées.
// Principe : 1RM estimé (formule d'Epley) rapporté au poids de corps, comparé à des repères par exercice
// (débutant → avancé). C'est un ordre de grandeur, pas une mesure.
// Les repères suivent ce que soulèvent vraiment les pratiquants (données de Strength Level, des millions de séries
// déclarées) : une élévation latérale se fait léger pour tout le monde, un soulevé de terre lourd. Pour une femme,
// les ratios sont ramenés à son échelle (à poids égal, environ 65 % des charges masculines en haut du corps, 80 %
// en bas, 90 % sur les fessiers), sinon les notes seraient faussées.
import { catalogEntry, exerciseName } from '../../shared/catalog';
import { regionOf } from '../../shared/generator';
import type { Experience, Sex } from '../../shared/athlete';
import { addDays } from './date';
import type { AppState } from './state';
import { tr } from '../../shared/i18n';

export type Grade = 'A' | 'B' | 'C' | 'D' | 'E';
export const GRADES: Grade[] = ['E', 'D', 'C', 'B', 'A'];

interface Standard {
  /** Ratio 1RM / poids de corps pour atteindre E, D, C, B, A. */
  t: [number, number, number, number, number];
  /** Le poids saisi est un lest qui s'ajoute au poids de corps (tractions, dips). */
  bodyweight?: boolean;
}

// Repères (homme) : 1RM / poids de corps pour E, D, C, B et A. Haltères : le poids d'un haltère.

const STANDARDS: Record<string, Standard> = {
  bench: { t: [0.5, 0.75, 1.0, 1.25, 1.5] },
  'incline-db-press': { t: [0.15, 0.25, 0.35, 0.45, 0.55] },
  dips: { t: [1.0, 1.15, 1.35, 1.6, 1.85], bodyweight: true },
  pullup: { t: [1.0, 1.1, 1.25, 1.45, 1.7], bodyweight: true },
  'barbell-row': { t: [0.4, 0.6, 0.8, 1.0, 1.25] },
  'db-row': { t: [0.2, 0.3, 0.45, 0.6, 0.75] },
  'neutral-pulldown': { t: [0.4, 0.6, 0.8, 1.0, 1.2] },
  'wide-pulldown': { t: [0.4, 0.6, 0.8, 1.0, 1.2] },
  'db-shoulder-press': { t: [0.12, 0.18, 0.26, 0.34, 0.42] },
  'db-lateral-raise': { t: [0.05, 0.095, 0.15, 0.195, 0.275] },
  'cable-lateral-raise': { t: [0.035, 0.08, 0.145, 0.19, 0.3] },
  'face-pull': { t: [0.17, 0.28, 0.43, 0.56, 0.79] },
  'incline-curl': { t: [0.075, 0.12, 0.17, 0.22, 0.3] },
  'hammer-curl': { t: [0.09, 0.145, 0.21, 0.27, 0.38] },
  'cable-curl': { t: [0.21, 0.33, 0.47, 0.6, 0.82] },
  skullcrusher: { t: [0.21, 0.3, 0.4, 0.51, 0.68] },
  'pec-deck': { t: [0.46, 0.61, 0.81, 1.04, 1.36] },
  'cable-fly': { t: [0.045, 0.095, 0.165, 0.215, 0.33] },
  'low-high-fly': { t: [0.035, 0.075, 0.13, 0.17, 0.26] },
  'leg-extension': { t: [0.53, 0.72, 0.94, 1.22, 1.58] },
  'smith-squat': { t: [0.6, 0.81, 1.06, 1.37, 1.77] },
  'seated-leg-curl': { t: [0.44, 0.58, 0.76, 0.98, 1.27] },
  'hip-abduction': { t: [0.43, 0.63, 0.88, 1.13, 1.52] },
  shrug: { t: [0.29, 0.43, 0.6, 0.77, 1.05] },
  'cable-crunch': { t: [0.22, 0.37, 0.56, 0.72, 1.02] },
  'seated-calf': { t: [0.35, 0.57, 0.86, 1.11, 1.58] },
  'rope-pushdown': { t: [0.2, 0.32, 0.47, 0.62, 0.8] },
  squat: { t: [0.75, 1.0, 1.25, 1.6, 2.0] },
  'leg-press': { t: [1.0, 1.5, 2.0, 2.75, 3.5] },
  'hack-squat': { t: [0.7, 1.0, 1.3, 1.7, 2.1] },
  bulgarian: { t: [0.15, 0.25, 0.35, 0.45, 0.55] },
  deadlift: { t: [1.0, 1.25, 1.6, 2.0, 2.5] },
  rdl: { t: [0.75, 1.0, 1.3, 1.65, 2.0] },
  'leg-curl': { t: [0.3, 0.45, 0.6, 0.8, 1.0] },
  'db-bench': { t: [0.15, 0.25, 0.35, 0.45, 0.55] },
  'machine-chest-press': { t: [0.4, 0.6, 0.85, 1.1, 1.35] },
  'chin-up': { t: [1.0, 1.1, 1.25, 1.45, 1.7], bodyweight: true },
  'seated-cable-row': { t: [0.4, 0.6, 0.8, 1.0, 1.2] },
  't-bar-row': { t: [0.4, 0.6, 0.8, 1.0, 1.25] },
  'military-press': { t: [0.3, 0.45, 0.6, 0.75, 0.9] },
  'arnold-press': { t: [0.1, 0.16, 0.23, 0.3, 0.37] },
  'barbell-curl': { t: [0.2, 0.3, 0.45, 0.6, 0.75] },
  'close-grip-bench': { t: [0.4, 0.6, 0.85, 1.1, 1.3] },
  'front-squat': { t: [0.6, 0.85, 1.1, 1.35, 1.65] },
  'goblet-squat': { t: [0.2, 0.3, 0.4, 0.55, 0.7] },
  'hip-thrust': { t: [0.6, 1.0, 1.5, 2.0, 2.5] },
  'sumo-deadlift': { t: [1.0, 1.25, 1.6, 2.0, 2.5] },
};

export const GROUPS: { id: string; name: string; short: string; lifts: string[] }[] = [
  { id: 'chest', name: tr('Pectoraux'), short: tr('Pecs'), lifts: ['bench', 'incline-db-press', 'dips', 'db-bench', 'machine-chest-press', 'pec-deck', 'cable-fly', 'low-high-fly'] },
  { id: 'shoulders', name: tr('Épaules'), short: tr('Épaules'), lifts: ['db-shoulder-press', 'db-lateral-raise', 'military-press', 'arnold-press', 'cable-lateral-raise', 'face-pull'] },
  { id: 'arms', name: tr('Bras'), short: tr('Bras'), lifts: ['incline-curl', 'hammer-curl', 'rope-pushdown', 'barbell-curl', 'close-grip-bench', 'cable-curl', 'skullcrusher'] },
  { id: 'hamstrings', name: tr('Ischios et fessiers'), short: tr('Ischios'), lifts: ['deadlift', 'rdl', 'leg-curl', 'hip-thrust', 'sumo-deadlift', 'seated-leg-curl', 'hip-abduction'] },
  { id: 'quads', name: tr('Quadriceps'), short: tr('Quadris'), lifts: ['squat', 'leg-press', 'hack-squat', 'bulgarian', 'front-squat', 'goblet-squat', 'leg-extension', 'smith-squat'] },
  { id: 'back', name: tr('Dos'), short: tr('Dos'), lifts: ['pullup', 'chin-up', 'barbell-row', 'db-row', 't-bar-row', 'seated-cable-row', 'neutral-pulldown', 'wide-pulldown', 'shrug'] },
];

/** Les repères d'un exercice, s'il en a. */
export function standardOf(key: string): Standard | null {
  return STANDARDS[key] ?? null;
}

/**
 * À poids égal, une femme soulève environ 65 % des charges d'un homme en haut du corps (un peu plus sur
 * l'isolation), 80 % en bas, 90 % sur les fessiers : on ramène ses repères à son échelle.
 */
export function sexFactor(key: string, sex?: Sex): number {
  if (sex !== 'female') return 1;
  if (key === 'hip-thrust' || key === 'hip-abduction') return 0.9;
  const e = catalogEntry(key);
  if (e?.group === 'legs') return 0.8;
  return e?.kind === 'isolation' ? 0.72 : 0.65;
}

/** Le ratio 1RM / poids de corps qui correspond à une note (l'inverse de la note). */
export function ratioAt(t: Standard['t'], score: number): number {
  if (score <= 1) return t[0] * Math.max(0.3, score);
  if (score >= 5) return t[4];
  const i = Math.floor(score) - 1;
  return t[i] + (t[i + 1] - t[i]) * (score - Math.floor(score));
}

/** Le groupe de la fiche de force où compte un exercice (ou celui de son muscle principal). */
export function groupOfLift(key: string, custom: AppState['customExercises'] = {}): string | null {
  const g = GROUPS.find((x) => x.lifts.includes(key));
  if (g) return g.id;
  const e = catalogEntry(key, custom);
  if (!e) return null;
  if (e.group === 'legs') return regionOf(key, custom) === 'posterior' ? 'hamstrings' : 'quads';
  return ['chest', 'shoulders', 'arms', 'back'].includes(e.group) ? e.group : null;
}

/** Niveau par défaut d'après ce que tu as déclaré, tant qu'aucune charge ne le dit. */
const EXPERIENCE_SCORE: Record<Experience, number> = { beginner: 1.2, intermediate: 2.4, advanced: 3.4 };

/**
 * Ton niveau sur un exercice jamais fait : la note du même groupe (tes autres exercices de pecs pour un écarté),
 * sinon la moyenne de tes groupes notés, sinon ton expérience déclarée.
 */
export function levelFor(s: AppState, key: string, today: string): { score: number; from: 'group' | 'lifts' | 'experience' } {
  const p = strengthProfile(s, today);
  const id = groupOfLift(key, s.customExercises);
  const g = p.groups.find((x) => x.id === id);
  if (g?.score != null) return { score: g.score, from: 'group' };
  const rated = p.groups.filter((x) => x.score !== null);
  if (rated.length) return { score: rated.reduce((a, x) => a + x.score!, 0) / rated.length, from: 'lifts' };
  return { score: EXPERIENCE_SCORE[s.settings.athlete.experience] ?? 1.2, from: 'experience' };
}

/** Formule d'Epley, reps plafonnées à 15 au-delà desquelles l'estimation devient peu fiable. */
export function e1rm(weight: number, reps: number): number {
  const r = Math.min(Math.max(reps, 1), 15);
  return r === 1 ? weight : weight * (1 + r / 30);
}

function scoreFor(ratio: number, t: Standard['t']): number {
  if (ratio < t[0]) return Math.max(0, ratio / t[0]);
  for (let i = 0; i < 4; i++) {
    if (ratio < t[i + 1]) return i + 1 + (ratio - t[i]) / (t[i + 1] - t[i]);
  }
  return 5;
}

/** La note d'un exercice pour un ratio 1RM / poids de corps (déjà ramené à l'échelle de ton sexe). */
export function scoreOf(key: string, ratio: number): number {
  const std = STANDARDS[key];
  return std ? scoreFor(ratio, std.t) : 0;
}

export function gradeFor(score: number): Grade {
  return GRADES[Math.max(0, Math.min(4, Math.floor(score) - 1))];
}

const nameOf = (key: string) => exerciseName(key);

export interface LiftScore {
  key: string;
  name: string;
  /** Meilleure série retenue : charge saisie (lest pour tractions et dips) et reps. */
  w: number;
  r: number;
  bodyweight: boolean;
  e1rm: number;
  ratio: number;
  score: number;
  date: string;
}

export interface GroupScore {
  id: string;
  name: string;
  short: string;
  score: number | null;
  grade: Grade | null;
  lifts: LiftScore[];
}

export function bodyweight(s: AppState): { kg: number; estimated: boolean } {
  const last = Object.entries(s.body.weight).sort(([a], [b]) => b.localeCompare(a))[0];
  return last ? { kg: last[1], estimated: false } : { kg: 75, estimated: true };
}

/** Le poids à une date : la dernière pesée jusqu'à ce jour, sinon la première après, sinon 75 kg. */
export function bodyweightAt(s: AppState, date: string): { kg: number; estimated: boolean } {
  const all = Object.entries(s.body.weight).sort(([a], [b]) => a.localeCompare(b));
  const before = all.filter(([d]) => d <= date).pop() ?? all[0];
  return before ? { kg: before[1], estimated: false } : { kg: 75, estimated: true };
}

/** Meilleure performance par exercice sur les `days` derniers jours. */
export function strengthProfile(s: AppState, today: string, days = 56) {
  const { kg: bw, estimated } = bodyweightAt(s, today);
  const sex = s.settings.athlete.sex;
  const from = addDays(today, -days);
  const best: Record<string, { value: number; date: string; w: number; r: number }> = {};
  for (const [date, d] of Object.entries(s.days)) {
    if (date < from || date > today) continue;
    for (const [key, logs] of Object.entries(d.sets)) {
      const std = STANDARDS[key];
      if (!std) continue;
      for (const l of logs) {
        if (!l.done || !l.r) continue;
        const load = std.bodyweight ? bw + (l.w ?? 0) : l.w;
        if (!load || load <= 0) continue;
        const v = e1rm(load, l.r);
        if (!best[key] || v > best[key].value) best[key] = { value: v, date, w: l.w ?? 0, r: l.r };
      }
    }
  }

  const groups: GroupScore[] = GROUPS.map((g) => {
    const lifts = g.lifts
      .filter((k) => best[k])
      .map((k) => {
        const ratio = best[k].value / bw / sexFactor(k, sex);
        return { key: k, name: nameOf(k), w: best[k].w, r: best[k].r, bodyweight: !!STANDARDS[k].bodyweight, e1rm: best[k].value, ratio, score: scoreFor(ratio, STANDARDS[k].t), date: best[k].date };
      });
    const score = lifts.length ? lifts.reduce((a, l) => a + l.score, 0) / lifts.length : null;
    return { id: g.id, name: g.name, short: g.short, score, grade: score === null ? null : gradeFor(score), lifts };
  });

  const rated = groups.filter((g) => g.score !== null);
  const weakest = rated.length >= 2 ? rated.reduce((a, b) => (b.score! < a.score! ? b : a)) : null;
  const strongest = rated.length >= 2 ? rated.reduce((a, b) => (b.score! > a.score! ? b : a)) : null;
  return { groups, weakest, strongest, bodyweight: bw, estimatedBodyweight: estimated };
}

export function profileSummary(s: AppState, today: string): string {
  const p = strengthProfile(s, today);
  const parts = p.groups.map((g) => `${g.name} ${g.grade ?? tr('non évalué')}`);
  return tr('Fiche de force (8 dernières semaines, rapportée à {bodyweight} kg) : {join}{v}.', { bodyweight: p.bodyweight, join: parts.join(', '), v: p.weakest ? tr('. Point faible : {name}', { name: p.weakest.name }) : '' });
}
