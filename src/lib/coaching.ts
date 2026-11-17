// Ce qui transforme le profil en programme, en calories et en repas, et applique les conseils du bilan.
import { type Athlete, type Gym, isEndurance, nutritionPlan, type WeightGoal } from '../../shared/athlete';
import { endurancePlan } from '../../shared/endurance';
import { catalogEntry } from '../../shared/catalog';
import { generateMealPlan } from '../../shared/meals';
import { generateProgram, runnerStrength } from '../../shared/generator';
import { adaptToGym, hyroxPlan, isRoadRace, runningPlan } from '../../shared/plans';
import type { Program } from '../../shared/types';
import { dayKey } from './date';
import type { Advice } from './report';
import { type AppState, getState, setState } from './store';
import { lower, tr } from '../../shared/i18n';

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

/** Exercices déjà pratiqués (au moins une série notée), pour garder la continuité des charges. */
export function knownExercises(s: AppState): string[] {
  const seen = new Set<string>();
  for (const d of Object.values(s.days)) for (const [k, logs] of Object.entries(d.sets)) if (logs.some((l) => l.done)) seen.add(k);
  return [...seen];
}

/**
 * Programme adapté au profil : préparation de course ou Hyrox (avec un renfo selon le physique visé),
 * plan d'endurance (natation, vélo, triathlon, course sans date), sinon un split construit sur mesure.
 * `block` : numéro du prochain bloc d'endurance quand on enchaîne.
 */
export function programFor(
  a: Athlete,
  gym: Gym,
  today = dayKey(),
  s: AppState = getState(),
  block?: number,
): { program: Program; swaps: ReturnType<typeof adaptToGym>['swaps']; notes: string[] } {
  const ref = a.race?.refSec ? { sec: a.race.refSec, km: a.race.refKm ?? 10 } : undefined;
  const input = { athlete: a, gym, known: knownExercises(s), custom: s.customExercises };
  let program: Program;
  let notes: string[] = [];
  const date = a.race?.date;
  if ((a.sport === 'running' && date && isRoadRace(a.race?.distance)) || (a.sport === 'hyrox' && date)) {
    program =
      a.sport === 'running'
        ? runningPlan({ distance: a.race!.distance as Parameters<typeof runningPlan>[0]['distance'], date: date!, athlete: a, ref, today })
        : hyroxPlan({ date: date!, athlete: a, ref, today });
    const renfo = runnerStrength(input);
    program.sessions = program.sessions.map((x) => (x.id === renfo.id ? renfo : x));
    program.meta = { physique: a.physique ?? 'athletic', priorities: a.priorities ?? [], generatedAt: today };
  } else if (isEndurance(a.sport)) {
    program = endurancePlan({ ...input, today, block });
    notes = enduranceNotes(a, program);
  } else {
    const r = generateProgram(input);
    program = r.program;
    notes = r.notes;
  }
  return { ...adaptToGym(program, gym, nameOf), notes };
}

/** Ce que le plan d'endurance a pris en compte, en clair. */
function enduranceNotes(a: Athlete, p: Program): string[] {
  const out: string[] = [];
  if (p.event) out.push(tr('{n} semaines jusqu’au {name} : fondamental, développement, spécifique puis affûtage. Une semaine sur quatre est allégée.', { n: p.weeks?.length ?? 0, name: lower(p.event.name) }));
  else out.push(tr('Un bloc de {n} semaines : la charge monte par paliers, les semaines 4 et 8 sont allégées. À la fin, Pulse te propose le bloc suivant, un cran plus fort.', { n: p.weeks?.length ?? 8 }));
  if ((a.sport === 'swimming' || a.sport === 'triathlon') && !a.swimPace) out.push(tr('Natation : sans chrono, les allures partent d’une estimation selon ton niveau. Note ton temps sur 400 m dans ton profil pour les affiner.'));
  if ((a.sport === 'cycling' || a.sport === 'triathlon') && !a.ftp) out.push(tr('Vélo : sans FTP, les intensités sont données en sensations et en % de FTP. Ajoute ta FTP pour avoir des watts.'));
  if ((a.sport === 'running' || a.sport === 'triathlon') && !a.race?.refSec) out.push(tr('Course : sans chrono récent, les allures partent d’une estimation selon ton niveau.'));
  return out;
}

/** Applique un programme en gardant l'ancien de côté (5 derniers), pour pouvoir revenir en arrière. */
export function applyProgram(program: Program) {
  setState((d) => {
    d.programHistory = [{ program: d.program, replacedAt: dayKey() }, ...(d.programHistory ?? [])].slice(0, 5);
    d.program = program;
  });
}

export function restorePreviousProgram(): boolean {
  const prev = getState().programHistory?.[0];
  if (!prev) return false;
  setState((d) => {
    d.program = prev.program;
    d.programHistory = d.programHistory!.slice(1);
  });
  return true;
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
    return tr('Objectif ajusté : {kcal} kcal par jour', { kcal: getState().settings.targets.kcal });
  }
  if (action.kind === 'add-exercise') {
    setState((d) => {
      const def = d.program.sessions.find((x) => x.id === action.session);
      if (def && !def.exercises.some((e) => e.key === action.key)) def.exercises.push({ key: action.key, sets: 3 });
    });
    return tr('{nameOf} ajouté au programme', { nameOf: nameOf(action.key) });
  }
  if (action.kind === 'swap') {
    setState((d) => {
      for (const def of d.program.sessions) for (const e of def.exercises) if (e.key === action.from) e.key = action.to;
    });
    return tr('{nameOf} remplacé par {nameOf2}', { nameOf: nameOf(action.from), nameOf2: nameOf(action.to) });
  }
  return null;
}
