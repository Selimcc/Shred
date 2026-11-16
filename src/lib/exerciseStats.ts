// Fiche d'un exercice, comme Hevy ou Strong : historique des séances, meilleures séries, tonnage, et deux outils
// de salle (disques à charger sur la barre, séries d'échauffement).
import { e1rm } from './strength';
import type { AppState, SetLog } from './store';

export interface ExerciseSession {
  date: string;
  sets: SetLog[];
  best: { w: number; r: number; e1rm: number } | null;
  volume: number;
}

export interface ExerciseStats {
  sessions: ExerciseSession[];
  bestE1rm: { w: number; r: number; e1rm: number; date: string } | null;
  heaviest: { w: number; r: number; date: string } | null;
  mostReps: { w: number; r: number; date: string } | null;
  totalVolume: number;
  totalSets: number;
}

export function exerciseStats(s: AppState, key: string, before = '9999-12-31'): ExerciseStats {
  const out: ExerciseStats = { sessions: [], bestE1rm: null, heaviest: null, mostReps: null, totalVolume: 0, totalSets: 0 };
  for (const date of Object.keys(s.days).sort().reverse()) {
    if (date > before) continue;
    const sets = (s.days[date].sets[key] ?? []).filter((l) => l.done);
    if (!sets.length) continue;
    let best: ExerciseSession['best'] = null;
    let volume = 0;
    for (const l of sets) {
      out.totalSets++;
      if (!l.w || !l.r) {
        if (l.r && (!out.mostReps || l.r > out.mostReps.r) && !l.w) out.mostReps = { w: 0, r: l.r, date };
        continue;
      }
      const v = e1rm(l.w, l.r);
      volume += l.w * l.r;
      if (!best || v > best.e1rm) best = { w: l.w, r: l.r, e1rm: v };
      if (!out.bestE1rm || v > out.bestE1rm.e1rm) out.bestE1rm = { w: l.w, r: l.r, e1rm: v, date };
      if (!out.heaviest || l.w > out.heaviest.w || (l.w === out.heaviest.w && l.r > out.heaviest.r)) out.heaviest = { w: l.w, r: l.r, date };
      if (!out.mostReps || l.r > out.mostReps.r) out.mostReps = { w: l.w, r: l.r, date };
    }
    out.totalVolume += volume;
    out.sessions.push({ date, sets, best, volume: Math.round(volume) });
  }
  out.totalVolume = Math.round(out.totalVolume);
  return out;
}

/** Exercice à la barre olympique (20 kg), où le calcul des disques a un sens. */
export function isBarbell(key: string, name: string): boolean {
  if (/poulie|guidée|smith|machine|haltère|ez\b|trap/i.test(name)) return false;
  return /\bbarre\b/i.test(name) || ['bench', 'squat', 'deadlift', 'barbell-row', 'military-press', 'front-squat', 'rdl', 'hip-thrust'].includes(key);
}

export const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25] as const;

/** Disques par côté pour une charge totale, avec la barre de 20 kg. Le reste est ce qui ne tombe pas juste. */
export function platesFor(total: number, bar = 20): { plates: number[]; rest: number } {
  let side = Math.max(0, (total - bar) / 2);
  const plates: number[] = [];
  for (const p of PLATES) {
    while (side >= p - 1e-9) {
      plates.push(p);
      side -= p;
    }
  }
  return { plates, rest: Math.round(side * 2 * 100) / 100 };
}

/**
 * Échauffement avant la première série lourde : barre vide puis paliers à 50, 70 et 85 %, de moins en moins de
 * reps pour arriver frais. Charges arrondies au pas de l'exercice.
 */
export function warmupSets(work: number, step = 2.5, barbell = true): { w: number; r: number }[] {
  if (!(work > 0)) return [];
  const round = (x: number) => Math.max(step, Math.round(x / step) * step);
  const out: { w: number; r: number }[] = [];
  if (barbell && work > 30) out.push({ w: 20, r: 10 });
  for (const [pct, r] of [
    [0.5, 6],
    [0.7, 4],
    [0.85, 2],
  ] as const) {
    const w = round(work * pct);
    if (w < work && (!out.length || w > out[out.length - 1].w)) out.push({ w, r });
  }
  return out;
}
