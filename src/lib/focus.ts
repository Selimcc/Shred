// Mode séance : la séance mise à plat, série par série, et les petits calculs qui vont avec (chrono d'effort,
// reps qu'il faut pour un record, prochaine série à faire). Sans affichage, pour pouvoir le tester.
import type { Exercise } from '../../shared/program';
import type { AppState, DayLog } from './store';
import { e1rm } from './strength';

export interface Step {
  ex: Exercise;
  /** Rang de l'exercice dans la séance. */
  ei: number;
  set: number;
  id: string;
}

export const continuous = (ex: Exercise) => ex.kind === 'cardio' && ex.sets === 1 && !!ex.discipline && ex.discipline !== 'combat';

/** Toutes les séries de la séance, dans l'ordre. Un bloc continu (footing, nage) compte pour une. */
export function stepsOf(exercises: Exercise[]): Step[] {
  return exercises.flatMap((ex, ei) => Array.from({ length: continuous(ex) ? 1 : ex.sets }, (_, set) => ({ ex, ei, set, id: `${ex.key}:${set}` })));
}

/**
 * Effort au temps : durée fixe (« 45 s », « 3 min », « 1:30 ») ou fourchette (« 30–60 s », « 2–3 min »).
 * Fixe : un compte à rebours qui valide tout seul. Fourchette : un chrono qui monte, tu l'arrêtes quand tu lâches.
 */
export function workSpan(ex: Exercise): { min: number; max: number } | null {
  if (ex.kind === 'task' || continuous(ex)) return null;
  const r = ex.reps.trim();
  let span: { min: number; max: number } | null = null;
  const m = r.match(/^(\d+(?:[.,]\d+)?)(?:\s*[–-]\s*(\d+(?:[.,]\d+)?))?\s*(s|sec|secondes?|min|minutes?)$/i);
  if (m) {
    const k = /^m/i.test(m[3]) ? 60 : 1;
    const a = Math.round(Number(m[1].replace(',', '.')) * k);
    const b = m[2] ? Math.round(Number(m[2].replace(',', '.')) * k) : a;
    span = { min: Math.min(a, b), max: Math.max(a, b) };
  } else {
    const c = r.match(/^(\d{1,2}):([0-5]\d)$/);
    if (c) span = { min: Number(c[1]) * 60 + Number(c[2]), max: Number(c[1]) * 60 + Number(c[2]) };
  }
  return span && span.min >= 5 && span.max <= 3600 ? span : null;
}

/** Durée fixe d'une série au temps, sinon null. */
export function workSeconds(ex: Exercise): number | null {
  const w = workSpan(ex);
  return w && w.min === w.max ? w.max : null;
}

/** Les reps qu'il faut à cette charge pour battre ton meilleur 1RM estimé. Null sans historique ou hors de portée. */
export function recordReps(s: AppState, key: string, date: string, w: number | undefined): number | null {
  if (!w) return null;
  let best = 0;
  let history = false;
  for (const [d, day] of Object.entries(s.days))
    for (const l of day.sets[key] ?? []) {
      if (!l.done || !l.w || !l.r) continue;
      if (d !== date) history = true;
      best = Math.max(best, e1rm(l.w, l.r));
    }
  if (!history) return null;
  for (let r = 1; r <= 15; r++) if (e1rm(w, r) > best + 0.01) return r;
  return null;
}

/** La prochaine série pas encore faite après `from`, en repartant du début s'il le faut. */
export function nextUndone(steps: Step[], day: DayLog, from: number): Step | null {
  const order = [...steps.slice(from + 1), ...steps.slice(0, Math.max(0, from))];
  return order.find((st) => !day.sets[st.ex.key]?.[st.set]?.done) ?? null;
}

/** « 45 min » → 45, « 1 h 30 » → 90. */
export const minutesOf = (reps: string) => {
  const h = reps.match(/(\d+)\s*h(?![a-z])\s*(\d+)?/i);
  if (h) return Number(h[1]) * 60 + Number(h[2] ?? 0);
  const m = reps.match(/(\d+)\s*min/);
  return m ? Number(m[1]) : undefined;
};
