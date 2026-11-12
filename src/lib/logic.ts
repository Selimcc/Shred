import { adaptSession } from './dynamic';
import { type Exercise, findSession, type Macros, resolveSession, scheduleFor, type Session } from '../../shared/program';
import { addDays, mondayOf, weekdayOf } from './date';
import { type AppState, type DayLog, readDay, type SetLog } from './store';

/** Id de la séance du jour : celle choisie ce jour-là, sinon celle du planning. */
export function sessionIdFor(s: AppState, key: string): string {
  return s.days[key]?.session ?? scheduleFor(s.program, key)[weekdayOf(key)];
}

/** La séance du jour, avec les changements du jour (remplacements, pannes, forme, temps dispo). */
export function sessionFor(s: AppState, key: string): Session {
  const def = findSession(s.program, sessionIdFor(s, key));
  return adaptSession(def, resolveSession(def, s.customExercises), s, key);
}

/** Règle de validation d'une journée, d'après les réglages et les modules actifs. */
export interface Rule {
  workout: boolean;
  minMeals: number;
}

export function ruleOf(s: AppState): Rule {
  const minMeals = s.settings.modules.nutrition ? Math.max(0, Math.min(4, s.settings.goal.minMeals)) : 0;
  return { workout: s.settings.goal.workout || minMeals === 0, minMeals };
}

export function doneCount(logs?: SetLog[]): number {
  return logs?.filter((l) => l.done).length ?? 0;
}

export function exerciseDone(ex: Exercise, day: DayLog): boolean {
  return doneCount(day.sets[ex.key]) >= ex.sets;
}

export function setProgress(session: Session, day: DayLog): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const ex of session.exercises) {
    total += ex.sets;
    done += Math.min(ex.sets, doneCount(day.sets[ex.key]));
  }
  return { done, total };
}

/** La séance est-elle terminée d'après les séries cochées ? */
export function sessionAutoComplete(session: Session, day: DayLog): boolean {
  if (!session.exercises.length) return false;
  if (session.completeWhen === 'first') return exerciseDone(session.exercises[0], day);
  if (session.completeWhen === 'any') return session.exercises.some((e) => exerciseDone(e, day));
  return session.exercises.every((e) => exerciseDone(e, day));
}

const MAIN_SLOTS = ['breakfast', 'lunch', 'snack', 'dinner'] as const;

export function mealsCount(day: DayLog): number {
  return MAIN_SLOTS.filter((slot) => day.meals.some((m) => m.slot === slot)).length;
}

export function isValidated(day: DayLog | undefined, rule: Rule): boolean {
  if (!day) return false;
  return (!rule.workout || day.mainDone) && mealsCount(day) >= rule.minMeals;
}

export function totals(day: DayLog): Macros {
  return day.meals.reduce(
    (acc, m) => ({
      kcal: acc.kcal + m.kcal,
      protein: acc.protein + m.protein,
      carbs: acc.carbs + m.carbs,
      fat: acc.fat + m.fat,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

/**
 * Met à jour la série jusqu'à hier (à appeler à l'ouverture et à chaque changement de jour).
 * Jour validé → +1 (et un gel gagné tous les 7 jours, 2 max).
 * Jour manqué → un gel est consommé s'il en reste, sinon la série retombe à 0.
 */
export function reconcileStreak(draft: AppState, today: string) {
  const st = draft.streak;
  const rule = ruleOf(draft);
  const yesterday = addDays(today, -1);
  if (st.through >= yesterday) return;
  let d = addDays(st.through, 1);
  let guard = 0;
  while (d <= yesterday && guard++ < 1000) {
    if (isValidated(draft.days[d], rule)) {
      st.banked += 1;
      if (st.banked % 7 === 0 && st.freezes < 2) st.freezes += 1;
    } else if (st.banked > 0 && st.freezes > 0) {
      st.freezes -= 1;
      st.frozen.push(d);
    } else {
      st.banked = 0;
    }
    st.best = Math.max(st.best, st.banked);
    d = addDays(d, 1);
  }
  st.through = yesterday;
  st.frozen = st.frozen.slice(-60);
}

export function streakInfo(s: AppState, today: string) {
  const todayValidated = isValidated(s.days[today], ruleOf(s));
  const current = s.streak.banked + (todayValidated ? 1 : 0);
  return {
    current,
    banked: s.streak.banked,
    best: Math.max(s.streak.best, current),
    freezes: s.streak.freezes,
    todayValidated,
  };
}

export type DayStatus = 'validated' | 'frozen' | 'missed' | 'today' | 'future' | 'empty';

export function dayStatus(s: AppState, key: string, today: string): DayStatus {
  if (key > today) return 'future';
  if (isValidated(s.days[key], ruleOf(s))) return 'validated';
  if (key === today) return 'today';
  if (s.streak.frozen.includes(key)) return 'frozen';
  if (key < s.createdAt) return 'empty';
  return 'missed';
}

export function weekKeys(today: string): string[] {
  const monday = mondayOf(today);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/* ---------- XP et niveaux ---------- */

export function dayXp(day: DayLog, rule: Rule): number {
  const sets = Object.values(day.sets).reduce((n, logs) => n + doneCount(logs), 0);
  const habits = Object.values(day.habits).filter(Boolean).length;
  return sets * 2 + mealsCount(day) * 10 + habits * 5 + (day.mainDone ? 50 : 0) + (isValidated(day, rule) ? 50 : 0);
}

export function totalXp(s: AppState): number {
  const rule = ruleOf(s);
  let xp = Object.values(s.days).reduce((n, d) => n + dayXp(d, rule), 0);
  xp += Object.keys(s.body.weight).length * 5;
  return xp;
}

/** Niveau n atteint à 250 × n(n−1)/2 XP. */
export function levelFor(xp: number) {
  const level = Math.floor((1 + Math.sqrt(1 + (8 * xp) / 250)) / 2);
  const floor = (250 * level * (level - 1)) / 2;
  const next = (250 * (level + 1) * level) / 2;
  return { level, xp, floor, next, progress: (xp - floor) / (next - floor) };
}

/* ---------- Progression des charges ---------- */

export function lastPerformance(s: AppState, key: string, before: string): { date: string; sets: SetLog[] } | null {
  const dates = Object.keys(s.days)
    .filter((d) => d < before)
    .sort()
    .reverse();
  for (const d of dates) {
    const logs = s.days[d].sets[key];
    if (logs?.some((l) => l.done)) return { date: d, sets: logs.filter((l) => l.done) };
  }
  return null;
}

/** Double progression : toutes les séries au plafond de reps → charge suivante. */
export function nextTarget(ex: Exercise, last: { sets: SetLog[] } | null): { weight?: number; up: boolean } {
  if (!last || ex.noLoad) return { up: false };
  const weights = last.sets.map((l) => l.w).filter((w): w is number => typeof w === 'number');
  if (!weights.length) return { up: false };
  const top = Math.max(...weights);
  const allTop =
    ex.repMax !== undefined &&
    last.sets.length >= ex.sets &&
    last.sets.every((l) => (l.r ?? 0) >= (ex.repMax ?? Infinity));
  return allTop ? { weight: round(top + (ex.step ?? 2.5)), up: true } : { weight: top, up: false };
}

const round = (n: number) => Math.round(n * 100) / 100;

export function formatSets(sets: SetLog[]): string {
  const sameWeight = sets.every((l) => l.w === sets[0].w);
  if (sameWeight && sets[0].w !== undefined) {
    return `${fmtKg(sets[0].w)} × ${sets.map((l) => l.r ?? '?').join(', ')}`;
  }
  return sets.map((l) => (l.w !== undefined ? `${fmtKg(l.w)}×${l.r ?? '?'}` : `${l.r ?? '?'}`)).join(', ');
}

export const fmtKg = (w: number) => `${w.toLocaleString('fr-FR')} kg`;

/* ---------- Poids de corps ---------- */

export function weightSeries(s: AppState, days: number, today: string) {
  const out: { date: string; kg?: number; avg?: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const window: number[] = [];
    for (let j = 0; j < 7; j++) {
      const v = s.body.weight[addDays(date, -j)];
      if (v) window.push(v);
    }
    out.push({
      date,
      kg: s.body.weight[date],
      avg: window.length >= 3 ? window.reduce((a, b) => a + b, 0) / window.length : undefined,
    });
  }
  return out;
}

/** Variation de la moyenne sur 7 jours par rapport à la semaine précédente. */
export function weeklyChange(s: AppState, today: string): number | null {
  const avg = (end: string) => {
    const v: number[] = [];
    for (let j = 0; j < 7; j++) {
      const x = s.body.weight[addDays(end, -j)];
      if (x) v.push(x);
    }
    return v.length >= 3 ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const a = avg(today);
  const b = avg(addDays(today, -7));
  return a !== null && b !== null ? a - b : null;
}

export function bestLifts(s: AppState) {
  const keys: [string, string][] = [
    ['squat', 'Squat'],
    ['bench', 'Développé couché'],
    ['deadlift', 'Soulevé de terre'],
    ['incline-db-press', 'Développé incliné haltères'],
    ['db-shoulder-press', 'Développé militaire'],
    ['pullup', 'Tractions (lest)'],
  ];
  return keys.map(([key, name]) => {
    let best: { w: number; r: number; date: string } | null = null;
    for (const [date, d] of Object.entries(s.days)) {
      for (const l of d.sets[key] ?? []) {
        if (!l.done || l.w === undefined) continue;
        if (!best || l.w > best.w || (l.w === best.w && (l.r ?? 0) > best.r)) best = { w: l.w, r: l.r ?? 0, date };
      }
    }
    return { key, name, best };
  });
}

export function emptyIfMissing(s: AppState, key: string) {
  return readDay(s, key);
}
