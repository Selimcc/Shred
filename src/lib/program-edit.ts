// Toutes les modifications du programme, des repas prévus et des habitudes passent par ici.
import { catalogEntry } from '../../shared/catalog';
import { TEMPLATES } from '../../shared/templates';
import type { CatalogEntry, ExerciseSlot, HabitDef, MealSlot, PlannedMeal, SessionDef, SessionType } from '../../shared/types';
import { setState, uid } from './store';
import { tr } from '../../shared/i18n';

const findDef = (sessions: SessionDef[], id: string) => sessions.find((s) => s.id === id);

/* ---------- Programme ---------- */

export function applyTemplate(templateId: string) {
  const t = TEMPLATES.find((x) => x.id === templateId);
  if (!t) return;
  setState((d) => {
    d.program = structuredClone(t.program);
  });
}

export function renameProgram(name: string) {
  setState((d) => {
    d.program.name = name.slice(0, 40);
  });
}

export function setScheduleDay(weekday: number, sessionId: string) {
  setState((d) => {
    d.program.schedule[weekday] = sessionId;
  });
}

export function addSession(type: SessionType = 'lifting'): string {
  const id = `s-${uid()}`;
  setState((d) => {
    const n = d.program.sessions.filter((s) => s.type === type).length + 1;
    d.program.sessions.push({
      id,
      name: type === 'lifting' ? tr('Séance {n}', { n }) : type === 'cardio' ? tr('Cardio {n}', { n }) : tr('Repos {n}', { n }),
      focus: '',
      type,
      exercises: type === 'rest' ? [{ key: 'walk' }, { key: 'mobility' }] : [],
    });
  });
  return id;
}

export function updateSession(id: string, patch: Partial<Pick<SessionDef, 'name' | 'focus' | 'type'>>) {
  setState((d) => {
    const s = findDef(d.program.sessions, id);
    if (s) Object.assign(s, patch);
  });
}

/** Supprime une séance ; les jours qui l'utilisaient passent sur la première séance restante. */
export function deleteSession(id: string) {
  setState((d) => {
    if (d.program.sessions.length <= 1) return;
    d.program.sessions = d.program.sessions.filter((s) => s.id !== id);
    const fallback = d.program.sessions.find((s) => s.type === 'rest')?.id ?? d.program.sessions[0].id;
    d.program.schedule = d.program.schedule.map((x) => (x === id ? fallback : x));
  });
}

export function addExercise(sessionId: string, key: string) {
  setState((d) => {
    const s = findDef(d.program.sessions, sessionId);
    const e = catalogEntry(key, d.customExercises);
    if (!s || !e) return;
    s.exercises.push({ key, sets: e.defaults.sets, reps: e.defaults.reps });
  });
}

export function updateSlot(sessionId: string, index: number, patch: Partial<ExerciseSlot>) {
  setState((d) => {
    const slot = findDef(d.program.sessions, sessionId)?.exercises[index];
    if (slot) Object.assign(slot, patch);
  });
}

export function moveSlot(sessionId: string, index: number, dir: -1 | 1) {
  setState((d) => {
    const list = findDef(d.program.sessions, sessionId)?.exercises;
    const j = index + dir;
    if (!list || j < 0 || j >= list.length) return;
    [list[index], list[j]] = [list[j], list[index]];
  });
}

export function removeSlot(sessionId: string, index: number) {
  setState((d) => {
    findDef(d.program.sessions, sessionId)?.exercises.splice(index, 1);
  });
}

export function createCustomExercise(entry: Omit<CatalogEntry, 'key' | 'custom'>): string {
  const key = `custom-${uid()}`;
  setState((d) => {
    d.customExercises[key] = { ...entry, key, custom: true };
  });
  return key;
}

/* ---------- Repas prévus ---------- */

export function addPlannedMeal(slot: MealSlot): string {
  const id = `m-${uid()}`;
  setState((d) => {
    d.mealPlan.push({ id, slot, label: tr('Nouveau repas'), detail: '', kcal: 500, protein: 30, carbs: 50, fat: 15 });
  });
  return id;
}

export function updatePlannedMeal(id: string, patch: Partial<PlannedMeal>) {
  setState((d) => {
    const m = d.mealPlan.find((x) => x.id === id);
    if (m) Object.assign(m, patch);
  });
}

export function removePlannedMeal(id: string) {
  setState((d) => {
    d.mealPlan = d.mealPlan.filter((m) => m.id !== id);
  });
}

/* ---------- Habitudes ---------- */

export function addHabit(name = tr('Nouvelle habitude')): string {
  const id = `h-${uid()}`;
  setState((d) => {
    d.habits.push({ id, name, icon: 'check' });
  });
  return id;
}

export function updateHabit(id: string, patch: Partial<HabitDef>) {
  setState((d) => {
    const h = d.habits.find((x) => x.id === id);
    if (h) Object.assign(h, patch);
  });
}

export function removeHabit(id: string) {
  setState((d) => {
    d.habits = d.habits.filter((h) => h.id !== id);
  });
}
