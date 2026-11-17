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

export { isBarbell, warmupSets } from '../../shared/warmup';

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
