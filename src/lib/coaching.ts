// Ce qui transforme le profil en programme, en calories et en repas, et applique les conseils du bilan.
import { type Athlete, type Gym, nutritionPlan, type RaceDistance, type WeightGoal } from '../../shared/athlete';
import { catalogEntry } from '../../shared/catalog';
import { generateMealPlan } from '../../shared/meals';
import { adaptToGym, hyroxPlan, runningPlan } from '../../shared/plans';
import { TEMPLATES } from '../../shared/templates';
import type { Program } from '../../shared/types';
import { dayKey } from './date';
import type { Advice } from './report';
import { type AppState, getState, setState } from './store';

const nameOf = (key: string) => catalogEntry(key, getState().customExercises)?.name ?? key;

export function lastWeight(s: AppState): number | undefined {
  return Object.entries(s.body.weight).sort(([a], [b]) => b.localeCompare(a))[0]?.[1];
}

/** Calories et macros d'après le profil complet, ou null s'il manque poids, taille ou âge. */
export function planFor(s: AppState, over: { weight?: number; goal?: WeightGoal; athlete?: Athlete } = {}) {
  const weight = over.weight ?? lastWeight(s);
  const { height, age } = s.settings;
  if (!weight || !height || !age) return null;
  return nutritionPlan({ weight, height, age, goal: over.goal ?? s.settings.weightGoal, athlete: over.athlete ?? s.settings.athlete });
}

export function applyTargets() {
  const plan = planFor(getState());
  if (!plan) return null;
  setState((d) => void (d.settings.targets = plan.targets));
  return plan;
}

/** Programme adapté au profil : préparation de course, Hyrox, ou un modèle de musculation selon les jours dispo. */
export function programFor(a: Athlete, gym: Gym, today = dayKey()): { program: Program; swaps: ReturnType<typeof adaptToGym>['swaps'] } {
  const ref = a.race?.refSec ? { sec: a.race.refSec, km: a.race.refKm ?? 10 } : undefined;
  let program: Program;
  if (a.sport === 'running' && a.race?.date && a.race.distance !== 'hyrox') {
    program = runningPlan({ distance: a.race.distance as RaceDistance, date: a.race.date, athlete: a, ref, today });
  } else if (a.sport === 'hyrox' && a.race?.date) {
    program = hyroxPlan({ date: a.race.date, athlete: a, ref, today });
  } else {
    const id = a.days <= 3 ? 'full-body' : a.days === 4 ? 'upper-lower' : a.days === 5 ? 'ppl-ul' : 'ppl6';
    program = structuredClone(TEMPLATES.find((t) => t.id === id)!.program);
  }
  return adaptToGym(program, gym, nameOf);
}

export function applyProgram(program: Program) {
  setState((d) => void (d.program = program));
}

export function adaptCurrentProgram() {
  const s = getState();
  const r = adaptToGym(s.program, s.settings.gym, nameOf);
  if (r.swaps.length) applyProgram(r.program);
  return r.swaps;
}

export function buildMealPlan(seed = 0) {
  const s = getState();
  return generateMealPlan(s.settings.targets, s.settings.athlete, { seed });
}

export function applyMealPlan(plan: ReturnType<typeof buildMealPlan>) {
  setState((d) => {
    d.mealPlan = [...plan.meals, ...d.mealPlan.filter((m) => m.slot === 'extra')];
    d.prep = plan.prep;
  });
}

/* ---------- Conseils du bilan ---------- */

export function applyAdvice(a: Advice): string | null {
  const action = a.action;
  if (!action) return null;
  if (action.kind === 'kcal') {
    setState((d) => {
      const t = d.settings.targets;
      t.kcal = Math.max(1300, t.kcal + action.delta);
      t.carbs = Math.max(0, t.carbs + Math.round(action.delta / 4));
    });
    return `Objectif ajusté : ${getState().settings.targets.kcal} kcal par jour`;
  }
  if (action.kind === 'add-exercise') {
    setState((d) => {
      const def = d.program.sessions.find((x) => x.id === action.session);
      if (def && !def.exercises.some((e) => e.key === action.key)) def.exercises.push({ key: action.key, sets: 3 });
    });
    return `${nameOf(action.key)} ajouté au programme`;
  }
  if (action.kind === 'swap') {
    setState((d) => {
      for (const def of d.program.sessions) for (const e of def.exercises) if (e.key === action.from) e.key = action.to;
    });
    return `${nameOf(action.from)} remplacé par ${nameOf(action.to)}`;
  }
  return null;
}
