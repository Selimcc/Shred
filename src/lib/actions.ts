import { type Exercise, type HabitId, type PlannedMeal, scheduleFor, type SessionId } from '../../shared/program';
import { weekdayOf } from './date';
import { lastPerformance, nextTarget, sessionAutoComplete, sessionFor } from './logic';
import { ensureDay, getState, type MealEntry, setState, type SetLog, uid } from './store';

/** Coche ou décoche une série. Remplit automatiquement charge et reps avec l'objectif du jour. */
export function toggleSet(date: string, ex: Exercise, index: number): boolean {
  let nowDone = false;
  setState((d) => {
    const day = ensureDay(d, date);
    const logs: SetLog[] = (day.sets[ex.key] ??= []);
    while (logs.length <= index) logs.push({ done: false });
    const log = logs[index];
    log.done = !log.done;
    nowDone = log.done;
    if (log.done) {
      const last = lastPerformance(d, ex.key, date);
      const target = nextTarget(ex, last);
      if (log.w === undefined && !ex.noLoad) {
        log.w = previousWeight(logs, index) ?? target.weight;
      }
      if (log.r === undefined && ex.repMin !== undefined) {
        log.r = target.up ? ex.repMin : (last?.sets[index]?.r ?? ex.repMin);
      }
    }
    const session = sessionFor(d, date);
    if (!day.mainDone && sessionAutoComplete(session, day)) {
      day.mainDone = true;
      day.mainDoneAt = Date.now();
    }
  });
  return nowDone;
}

/** La dernière charge saisie avant cette série, dans la séance du jour. */
export function previousWeight(logs: SetLog[], index: number): number | undefined {
  for (let j = Math.min(index, logs.length) - 1; j >= 0; j--) if (logs[j]?.w !== undefined) return logs[j].w;
  return undefined;
}

/**
 * Modifie une série. Une charge ou des reps saisies se recopient sur les séries suivantes pas encore faites,
 * sauf celles déjà changées à la main : si tu restes à la même charge, il ne reste qu'à valider.
 */
export function updateSet(date: string, exKey: string, index: number, patch: Partial<SetLog>, sets?: number) {
  setState((d) => {
    const day = ensureDay(d, date);
    const logs = (day.sets[exKey] ??= []);
    const total = Math.max(sets ?? 0, index + 1);
    while (logs.length < total) logs.push({ done: false });
    const before = { ...logs[index] };
    Object.assign(logs[index], patch);
    for (const field of ['w', 'r'] as const) {
      if (!(field in patch) || patch[field] === undefined) continue;
      for (let j = index + 1; j < logs.length; j++) {
        const next = logs[j];
        if (next.done) continue;
        if (next[field] === undefined || next[field] === before[field]) next[field] = patch[field];
        else break;
      }
    }
  });
}

export function finishSession(date: string, done = true) {
  setState((d) => {
    const day = ensureDay(d, date);
    day.mainDone = done;
    day.mainDoneAt = done ? Date.now() : undefined;
  });
}

export function chooseSession(date: string, id: SessionId) {
  setState((d) => {
    const day = ensureDay(d, date);
    day.session = id === scheduleFor(d.program, date)[weekdayOf(date)] ? undefined : id;
  });
}

export function addMeal(date: string, entry: Omit<MealEntry, 'id' | 'at'>) {
  setState((d) => {
    ensureDay(d, date).meals.push({ ...entry, id: uid(), at: Date.now() });
  });
}

export function removeMeal(date: string, id: string) {
  setState((d) => {
    const day = ensureDay(d, date);
    day.meals = day.meals.filter((m) => m.id !== id);
  });
}

export function togglePlannedMeal(date: string, meal: PlannedMeal) {
  const day = getState().days[date];
  const existing = day?.meals.find((m) => m.planId === meal.id);
  if (existing) return removeMeal(date, existing.id);
  const { kcal, protein, carbs, fat } = meal;
  addMeal(date, { slot: meal.slot, label: meal.label, kcal, protein, carbs, fat, source: 'plan', planId: meal.id });
}

export function toggleHabit(date: string, id: HabitId) {
  setState((d) => {
    const day = ensureDay(d, date);
    day.habits[id] = !day.habits[id];
  });
}

export function logBody(kind: 'weight' | 'waist', date: string, value: number | undefined) {
  setState((d) => {
    if (value === undefined) delete d.body[kind][date];
    else d.body[kind][date] = value;
  });
}

export function parseDecimal(v: string): number | undefined {
  const n = Number(v.replace(',', '.').trim());
  return v.trim() && Number.isFinite(n) ? n : undefined;
}
