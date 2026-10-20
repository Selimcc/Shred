// Fiche de force : note de A à E par groupe musculaire, calculée à partir des charges notées.
// Principe : 1RM estimé (formule d'Epley) rapporté au poids de corps, comparé à des repères
// approximatifs pour un homme (débutant → avancé). C'est un ordre de grandeur, pas une mesure.
import { catalogEntry } from '../../shared/catalog';
import { addDays } from './date';
import type { AppState } from './store';

export type Grade = 'A' | 'B' | 'C' | 'D' | 'E';
export const GRADES: Grade[] = ['E', 'D', 'C', 'B', 'A'];

interface Standard {
  /** Ratio 1RM / poids de corps pour atteindre E, D, C, B, A. */
  t: [number, number, number, number, number];
  /** Le poids saisi est un lest qui s'ajoute au poids de corps (tractions, dips). */
  bodyweight?: boolean;
}

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
  'db-lateral-raise': { t: [0.08, 0.13, 0.19, 0.25, 0.32] },
  'incline-curl': { t: [0.1, 0.15, 0.21, 0.28, 0.35] },
  'hammer-curl': { t: [0.12, 0.18, 0.25, 0.32, 0.4] },
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
  { id: 'chest', name: 'Pectoraux', short: 'Pecs', lifts: ['bench', 'incline-db-press', 'dips', 'db-bench', 'machine-chest-press'] },
  { id: 'shoulders', name: 'Épaules', short: 'Épaules', lifts: ['db-shoulder-press', 'db-lateral-raise', 'military-press', 'arnold-press'] },
  { id: 'arms', name: 'Bras', short: 'Bras', lifts: ['incline-curl', 'hammer-curl', 'rope-pushdown', 'barbell-curl', 'close-grip-bench'] },
  { id: 'hamstrings', name: 'Ischios et fessiers', short: 'Ischios', lifts: ['deadlift', 'rdl', 'leg-curl', 'hip-thrust', 'sumo-deadlift'] },
  { id: 'quads', name: 'Quadriceps', short: 'Quadris', lifts: ['squat', 'leg-press', 'hack-squat', 'bulgarian', 'front-squat', 'goblet-squat'] },
  { id: 'back', name: 'Dos', short: 'Dos', lifts: ['pullup', 'chin-up', 'barbell-row', 'db-row', 't-bar-row', 'seated-cable-row', 'neutral-pulldown', 'wide-pulldown'] },
];

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

export function gradeFor(score: number): Grade {
  return GRADES[Math.max(0, Math.min(4, Math.floor(score) - 1))];
}

const nameOf = (key: string) => catalogEntry(key)?.name ?? key;

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

/** Meilleure performance par exercice sur les `days` derniers jours. */
export function strengthProfile(s: AppState, today: string, days = 56) {
  const { kg: bw, estimated } = bodyweight(s);
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
        const ratio = best[k].value / bw;
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
  const parts = p.groups.map((g) => `${g.name} ${g.grade ?? 'non évalué'}`);
  return `Fiche de force (8 dernières semaines, rapportée à ${p.bodyweight} kg) : ${parts.join(', ')}${p.weakest ? `. Point faible : ${p.weakest.name}` : ''}.`;
}
