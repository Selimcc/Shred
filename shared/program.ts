// Interprète un programme (donnée modifiable) en séances prêtes à l'emploi,
// et fournit les valeurs par défaut de la nutrition et des habitudes.
import { catalogEntry } from './catalog';
import { blocksSeconds, fmtClock, sessionBlocks } from './effort';
import { DEFAULT_PROGRAM } from './templates';
import type { CatalogEntry, Exercise, HabitDef, Macros, MealSlot, PlannedMeal, Program, Session, SessionDef } from './types';
import { tr } from './i18n';

export type { Exercise, HabitDef, Macros, MealSlot, PlannedMeal, Program, Session, SessionDef } from './types';
export type SessionId = string;
export type HabitId = string;

/* ---------- Résolution d'un programme ---------- */

function parseReps(reps: string): { repMin?: number; repMax?: number } {
  const m = reps.match(/^(\d+)(?:\s*[–-]\s*(\d+))?$/);
  return m ? { repMin: Number(m[1]), repMax: Number(m[2] ?? m[1]) } : {};
}

export function resolveExercise(slot: SessionDef['exercises'][number], custom: Record<string, CatalogEntry> = {}): Exercise {
  const e = catalogEntry(slot.key, custom);
  // Le nom affiché : la bibliothèque est traduite, un exercice créé par l'utilisateur reste tel quel.
  const name = e ? (e.custom ? e.name : tr(e.name)) : slot.key;
  const reps = slot.reps ?? e?.defaults.reps ?? '10';
  return {
    key: slot.key,
    name,
    sets: Math.max(1, Math.min(12, slot.sets ?? e?.defaults.sets ?? 3)),
    reps,
    ...parseReps(reps),
    rest: slot.rest ?? e?.defaults.rest ?? 90,
    kind: e?.kind ?? 'isolation',
    note: slot.note ?? (e?.note ? tr(e.note) : undefined),
    step: e?.step ?? 2.5,
    noLoad: e?.noLoad ?? false,
    ...(e?.discipline ? { discipline: e.discipline } : {}),
    ...((slot.zone ?? e?.zone) ? { zone: slot.zone ?? e?.zone } : {}),
    ...(slot.sec ? { sec: slot.sec } : {}),
    ...(slot.target ? { target: slot.target } : {}),
  };
}

/** Durée estimée : 40 s d'effort par série + le repos prévu, arrondie à 5 min. */
export function estimateDuration(exercises: Exercise[]): string {
  const sec = exercises.reduce((n, e) => n + e.sets * (40 + e.rest), 0);
  const min = Math.max(10, Math.round(sec / 60 / 5) * 5);
  return min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`;
}

/** Durée d'une séance : les blocs d'endurance au temps près, le reste à 40 s par série plus le repos. */
export function sessionDuration(exercises: Exercise[]): string {
  const blocks = sessionBlocks(exercises);
  if (!blocks.length) return estimateDuration(exercises);
  const others = exercises.filter((x) => !x.discipline || !x.zone).filter((x) => x.kind !== 'task');
  const sec = blocksSeconds(blocks) + others.reduce((n, e) => n + e.sets * (40 + e.rest), 0);
  return fmtClock(Math.round(sec / 300) * 300 || sec);
}

export function resolveSession(def: SessionDef, custom: Record<string, CatalogEntry> = {}): Session {
  const exercises = def.exercises.map((x) => resolveExercise(x, custom));
  return {
    id: def.id,
    // Noms des modèles traduits à l'affichage ; ceux qu'on a tapés soi-même ne changent pas.
    name: tr(def.name),
    focus: tr(def.focus),
    type: def.type,
    duration: sessionDuration(exercises),
    completeWhen: def.type === 'lifting' ? 'all' : def.type === 'rest' ? 'first' : 'any',
    lifting: def.type === 'lifting',
    exercises,
  };
}

/** Jours entre deux dates AAAA-MM-JJ. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/** Semaine du plan daté (0 = première), ou null avant ou après. */
export function planWeek(program: Program, date: string): number | null {
  if (!program.start || !program.weeks?.length) return null;
  const d = daysBetween(program.start, date);
  if (d < 0) return null;
  const w = Math.floor(d / 7);
  return w < program.weeks.length ? w : null;
}

/** Planning de la semaine qui contient cette date : celui du plan daté s'il y en a un, sinon la semaine type. */
export function scheduleFor(program: Program, date: string): string[] {
  const w = planWeek(program, date);
  return w === null ? program.schedule : program.weeks![w];
}

export function findSession(program: Program, id: string): SessionDef {
  return program.sessions.find((s) => s.id === id) ?? program.sessions[0] ?? { id: 'empty', name: tr('Séance'), focus: '', type: 'lifting', exercises: [] };
}

/* ---------- Nutrition et habitudes par défaut ---------- */

export const SLOTS: { id: MealSlot; name: string }[] = [
  { id: 'breakfast', name: tr('Petit-déjeuner') },
  { id: 'lunch', name: tr('Déjeuner') },
  { id: 'snack', name: tr('Collation') },
  { id: 'dinner', name: tr('Dîner') },
  { id: 'extra', name: tr('Extras') },
];

/** « Ajouter au … » écrit en entier pour chaque repas : l’article change selon le mot et selon la langue. */
export const ADD_TO_SLOT: Record<MealSlot, string> = {
  breakfast: tr('Ajouter au petit-déjeuner'),
  lunch: tr('Ajouter au déjeuner'),
  snack: tr('Ajouter à la collation'),
  dinner: tr('Ajouter au dîner'),
  extra: tr('Ajouter aux extras'),
};

export const DEFAULT_MEAL_PLAN: PlannedMeal[] = [
  { id: 'oats', slot: 'breakfast', label: tr('Avoine, lait, whey, banane'), detail: tr('80 g d’avoine, 300 ml de lait demi-écrémé, 30 g de whey, 1 banane'), kcal: 650, protein: 46, carbs: 90, fat: 12 },
  { id: 'chicken-box', slot: 'lunch', label: tr('Box poulet riz'), detail: tr('150 g de poulet, 90 g de riz cru, 200 g de légumes, 1 c. à soupe d’huile'), kcal: 630, protein: 46, carbs: 78, fat: 14 },
  { id: 'skyr', slot: 'snack', label: tr('Skyr, fruits rouges, beurre de cacahuète'), detail: tr('250 g de skyr, 100 g de fruits rouges, 20 g de beurre de cacahuète'), kcal: 320, protein: 33, carbs: 21, fat: 11 },
  { id: 'bolo-box', slot: 'dinner', label: tr('Box bolognaise'), detail: tr('150 g de bœuf 5 %, 100 g de pâtes crues, coulis, légumes, 1 c. à soupe d’huile'), kcal: 730, protein: 46, carbs: 86, fat: 19 },
  { id: 'fish-dinner', slot: 'dinner', label: tr('Sardines et pâtes'), detail: tr('2 boîtes de sardines, 80 g de pâtes crues, légumes'), kcal: 680, protein: 52, carbs: 66, fat: 23 },
  { id: 'fruit', slot: 'extra', label: tr('Fruit'), detail: tr('Pomme, clémentines…'), kcal: 80, protein: 1, carbs: 20, fat: 0 },
];

/** Alias conservé pour le code existant. */
export const PLANNED_MEALS = DEFAULT_MEAL_PLAN;

export const DEFAULT_HABITS: HabitDef[] = [
  { id: 'steps', name: tr('8 000 pas'), icon: 'steps' },
  { id: 'creatine', name: tr('Créatine'), icon: 'pill' },
  { id: 'magnesium', name: tr('Magnésium'), icon: 'moon' },
  { id: 'd3', name: tr('Vitamine D3'), icon: 'sun' },
];

export const HABIT_ICONS = ['steps', 'pill', 'moon', 'sun', 'flame', 'bolt', 'apple', 'scale', 'check'];

export const DEFAULT_TARGETS: Macros = { kcal: 2400, protein: 170, carbs: 280, fat: 60 };

export const MIN_MEALS_FOR_VALIDATION = 3;

/* ---------- Résumé texte pour le coach IA ---------- */

const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

export function programSummary(
  program: Program = DEFAULT_PROGRAM,
  opts: { custom?: Record<string, CatalogEntry>; meals?: PlannedMeal[]; targets?: Macros; nutrition?: boolean; today?: string } = {},
): string {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const schedule = scheduleFor(program, today);
  const week = [1, 2, 3, 4, 5, 6, 0].map((d) => `${DAY_NAMES[d]} ${findSession(program, schedule[d]).name}`).join(', ');
  const used = new Set(schedule);
  const sessions = program.sessions
    .filter((s) => used.has(s.id))
    .map((def) => {
      const s = resolveSession(def, opts.custom);
      const list = s.exercises.map((e) => `  - ${tr('{name} : {detail}', { name: e.name, detail: `${e.sets} × ${e.reps}` })}`).join('\n');
      return `${s.name} (${s.focus}) :\n${list || `  ${tr('(vide)')}`}`;
    })
    .join('\n');
  const w = planWeek(program, today);
  const parts = [
    tr('PROGRAMME « {name} »', { name: program.name }),
    program.event && w !== null ? tr('Plan daté : semaine {n} sur {length}{v}, {name} le {date}.', { n: w + 1, length: program.weeks!.length, v: program.phases?.[w] ? ` (${program.phases[w]})` : '', name: program.event.name, date: program.event.date }) : '',
    `${tr('{name} : {detail}', { name: w !== null ? tr('Cette semaine') : tr('Semaine type'), detail: week })}.`,
    sessions,
    tr('RÈGLES : double progression (haut de fourchette sur toutes les séries → charge suivante), polyarticulaires à 1–2 reps de l\'échec, décharge toutes les 6–8 semaines.'),
  ];
  if (opts.nutrition !== false) {
    const t = opts.targets ?? DEFAULT_TARGETS;
    parts.push(tr('NUTRITION : objectif {kcal} kcal/jour, {protein} g de protéines, {carbs} g de glucides, {fat} g de lipides.', { kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat }));
    const meals = (opts.meals ?? DEFAULT_MEAL_PLAN).map((m) => tr('- {label} ({detail}) : {kcal} kcal, {protein} g P', { label: m.label, detail: m.detail, kcal: m.kcal, protein: m.protein })).join('\n');
    if (meals) parts.push(tr('Repas prévus :\n{meals}', { meals }));
  }
  return parts.filter(Boolean).join('\n\n');
}
