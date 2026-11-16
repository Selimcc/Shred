// Générateur de programme : du physique visé, des points faibles, des jours dispo, du temps par séance
// et du matériel de la salle, il construit un split complet (séances, exercices, séries, reps, repos).
// Logique : on choisit le split selon les jours, on place des « mouvements » (pousser horizontal,
// tirer vertical, squat, charnière…), on vise un volume hebdomadaire par muscle qui dépend du physique
// et des priorités, puis on coupe ce qui dépasse le temps par séance. Calculs purs, testables.
import { type Athlete, type Experience, type Gym } from './athlete';
import { catalogEntry } from './catalog';
import { usable } from './plans';
import { estimateDuration, resolveExercise } from './program';
import type { CatalogEntry, ExerciseSlot, MuscleGroup, Program, SessionDef } from './types';

/* ---------- Physiques et zones musculaires ---------- */

export type Physique = 'aesthetic' | 'v-taper' | 'mass' | 'strength' | 'athletic' | 'lower';

export type Region = 'chest' | 'back' | 'delts' | 'rear' | 'biceps' | 'triceps' | 'quads' | 'posterior' | 'calves' | 'abs' | 'traps' | 'neck';

export const REGIONS: { id: Region; name: string; group: MuscleGroup; small?: boolean }[] = [
  { id: 'chest', name: 'Pectoraux', group: 'chest' },
  { id: 'back', name: 'Dos (largeur et épaisseur)', group: 'back' },
  { id: 'delts', name: 'Épaules', group: 'shoulders' },
  { id: 'rear', name: 'Arrière d’épaules', group: 'shoulders', small: true },
  { id: 'biceps', name: 'Biceps', group: 'arms', small: true },
  { id: 'triceps', name: 'Triceps', group: 'arms', small: true },
  { id: 'quads', name: 'Quadriceps', group: 'legs' },
  { id: 'posterior', name: 'Ischios et fessiers', group: 'legs' },
  { id: 'calves', name: 'Mollets', group: 'legs', small: true },
  { id: 'abs', name: 'Abdos et obliques', group: 'core', small: true },
  { id: 'traps', name: 'Trapèzes', group: 'back', small: true },
  { id: 'neck', name: 'Cou', group: 'neck', small: true },
];

export const regionName = (r: Region) => REGIONS.find((x) => x.id === r)?.name ?? r;

interface PhysiqueDef {
  label: string;
  text: string;
  /** Multiplicateur du volume de base, par zone. Absent = 1. */
  emphasis: Partial<Record<Region, number>>;
  /** Reps du premier gros mouvement de la séance, des autres polyarticulaires, de l'isolation. */
  reps: { main: string; compound: string; iso: string };
  mainSets: number;
  /** Ajoute des exercices explosifs et un finisher cardio. */
  athletic?: boolean;
}

export const PHYSIQUES: Record<Physique, PhysiqueDef> = {
  aesthetic: {
    label: 'Esthétique et sec',
    text: 'Abdos visibles, épaules rondes, proportions équilibrées. Le look « shredded ».',
    emphasis: { delts: 1.3, rear: 1.2, chest: 1.1, back: 1.1, biceps: 1.1, triceps: 1.1, quads: 0.85, posterior: 0.85, calves: 0.8, abs: 1.4, traps: 0.8 },
    reps: { main: '6–10', compound: '8–12', iso: '12–15' },
    mainSets: 4,
  },
  'v-taper': {
    label: 'Dos en V, épaules larges',
    text: 'Grand dorsal, épaules larges, taille fine. La silhouette en V.',
    emphasis: { back: 1.4, delts: 1.5, rear: 1.3, chest: 0.9, biceps: 1, triceps: 0.9, quads: 0.8, posterior: 0.8, calves: 0.7, abs: 1.1, traps: 0.9 },
    reps: { main: '6–10', compound: '8–12', iso: '12–20' },
    mainSets: 4,
  },
  mass: {
    label: 'Masse et gabarit',
    text: 'Prendre du muscle partout, gros volume, charges lourdes.',
    emphasis: { chest: 1.2, back: 1.2, delts: 1.1, quads: 1.2, posterior: 1.1, biceps: 1.1, triceps: 1.1, traps: 1.1 },
    reps: { main: '6–8', compound: '8–10', iso: '10–15' },
    mainSets: 4,
  },
  strength: {
    label: 'Force (powerbuilding)',
    text: 'Monter tes charges sur les gros mouvements, avec assez de volume pour le physique.',
    emphasis: { chest: 1.1, back: 1.1, quads: 1.1, posterior: 1.2, delts: 0.9, rear: 0.9, biceps: 0.8, triceps: 0.9, calves: 0.7, abs: 1 },
    reps: { main: '3–5', compound: '6–8', iso: '10–12' },
    mainSets: 5,
  },
  athletic: {
    label: 'Athlète hybride',
    text: 'Fort, explosif et endurant : muscu, puissance et cardio dans la même semaine.',
    emphasis: { posterior: 1.2, quads: 1.1, back: 1.1, abs: 1.3, biceps: 0.8, triceps: 0.8, calves: 1, traps: 0.9 },
    reps: { main: '4–6', compound: '6–10', iso: '10–15' },
    mainSets: 4,
    athletic: true,
  },
  lower: {
    label: 'Bas du corps et fessiers',
    text: 'Jambes et fessiers en priorité, le haut du corps entretenu.',
    emphasis: { quads: 1.3, posterior: 1.6, calves: 1.1, chest: 0.75, back: 0.9, delts: 0.9, biceps: 0.7, triceps: 0.7, abs: 1.1, traps: 0.6 },
    reps: { main: '6–10', compound: '8–12', iso: '12–15' },
    mainSets: 4,
  },
};

/** Séries par semaine pour un gros groupe (et un petit), selon le niveau. */
const BASE: Record<Experience, { big: number; small: number }> = {
  beginner: { big: 9, small: 6 },
  intermediate: { big: 12, small: 8 },
  advanced: { big: 15, small: 10 },
};

/* ---------- Mouvements ---------- */

type Role = 'main' | 'compound' | 'iso' | 'small' | 'core' | 'power' | 'finisher';

interface Pattern {
  region: Region;
  role: Role;
  /** Candidats par ordre de préférence. */
  keys: string[];
}

export const PATTERNS = {
  hpush: { region: 'chest', role: 'compound', keys: ['bench', 'db-bench', 'machine-chest-press', 'dips', 'pushup'] },
  ipush: { region: 'chest', role: 'compound', keys: ['incline-db-press', 'machine-chest-press', 'db-bench', 'bench', 'pushup'] },
  chestIso: { region: 'chest', role: 'iso', keys: ['cable-fly', 'pec-deck', 'low-high-fly', 'dips'] },
  vpush: { region: 'delts', role: 'compound', keys: ['military-press', 'db-shoulder-press', 'machine-shoulder-press', 'arnold-press', 'pushup'] },
  lateral: { region: 'delts', role: 'small', keys: ['db-lateral-raise', 'cable-lateral-raise'] },
  rear: { region: 'rear', role: 'small', keys: ['face-pull', 'rear-delt', 'db-row'] },
  vpull: { region: 'back', role: 'compound', keys: ['pullup', 'wide-pulldown', 'neutral-pulldown', 'chin-up', 'db-row'] },
  hpull: { region: 'back', role: 'compound', keys: ['barbell-row', 'seated-cable-row', 'db-row', 't-bar-row'] },
  latIso: { region: 'back', role: 'iso', keys: ['straight-arm-pulldown', 'neutral-pulldown', 'db-row'] },
  traps: { region: 'traps', role: 'small', keys: ['shrug', 'farmer-walk'] },
  biceps: { region: 'biceps', role: 'small', keys: ['incline-curl', 'barbell-curl', 'hammer-curl', 'cable-curl', 'preacher-curl'] },
  triceps: { region: 'triceps', role: 'small', keys: ['rope-pushdown', 'overhead-triceps', 'skullcrusher', 'dips', 'close-grip-bench', 'pushup'] },
  squat: { region: 'quads', role: 'compound', keys: ['squat', 'hack-squat', 'leg-press', 'smith-squat', 'front-squat', 'goblet-squat', 'bulgarian'] },
  quad2: { region: 'quads', role: 'compound', keys: ['leg-press', 'bulgarian', 'hack-squat', 'walking-lunge', 'goblet-squat', 'lunge'] },
  quadIso: { region: 'quads', role: 'iso', keys: ['leg-extension', 'bulgarian', 'lunge'] },
  hinge: { region: 'posterior', role: 'compound', keys: ['rdl', 'deadlift', 'hip-thrust', 'good-morning', 'kettlebell-swing'] },
  glute: { region: 'posterior', role: 'compound', keys: ['hip-thrust', 'bulgarian', 'walking-lunge', 'lunge'] },
  hamIso: { region: 'posterior', role: 'iso', keys: ['leg-curl', 'hip-thrust', 'rdl'] },
  calves: { region: 'calves', role: 'small', keys: ['standing-calf', 'seated-calf'] },
  abs: { region: 'abs', role: 'core', keys: ['hanging-leg-raise', 'cable-crunch', 'ab-wheel', 'crunch'] },
  obliques: { region: 'abs', role: 'core', keys: ['pallof', 'wood-chop', 'side-plank', 'russian-twist'] },
  neck: { region: 'neck', role: 'small', keys: ['neck-flexion', 'neck-extension'] },
  power: { region: 'quads', role: 'power', keys: ['box-jump', 'kettlebell-swing', 'burpee-broad-jump'] },
  finisher: { region: 'abs', role: 'finisher', keys: ['intervals', 'rowing-erg', 'ski-erg', 'mountain-climber'] },
} satisfies Record<string, Pattern>;

export type PatternId = keyof typeof PATTERNS;

/** Zone principale de chaque exercice connu : sert au volume par muscle et aux remplacements. */
export const REGION_OF: Record<string, Region> = (() => {
  const out: Record<string, Region> = {};
  // Les mouvements polyarticulaires d'abord : un rowing haltère reste du dos même s'il dépanne pour l'arrière d'épaule.
  const order: Role[] = ['compound', 'iso', 'small', 'core'];
  for (const role of order) for (const p of Object.values(PATTERNS) as Pattern[]) if (p.role === role) for (const k of p.keys) out[k] ??= p.region;
  Object.assign(out, { dips: 'chest', 'close-grip-bench': 'triceps', 'arms-superset': 'biceps', 'sled-push': 'quads', 'sled-pull': 'back', 'wall-ball': 'quads', 'sandbag-lunge': 'quads', 'hip-abduction': 'posterior', 'seated-calf': 'calves', plank: 'abs', crunch: 'abs', 'neck-extension': 'neck' });
  return out;
})();

export function regionOf(key: string, custom: Record<string, CatalogEntry> = {}): Region | null {
  if (REGION_OF[key]) return REGION_OF[key];
  const e = catalogEntry(key, custom);
  if (!e) return null;
  const byGroup: Partial<Record<MuscleGroup, Region>> = { chest: 'chest', back: 'back', shoulders: 'delts', legs: 'quads', core: 'abs', neck: 'neck' };
  if (e.group === 'arms') return /curl|biceps/i.test(e.name) ? 'biceps' : 'triceps';
  return byGroup[e.group] ?? null;
}

/** Les mouvements qui contiennent cet exercice (pour proposer des remplaçants du même type). */
export function patternsOf(key: string): PatternId[] {
  return (Object.keys(PATTERNS) as PatternId[]).filter((id) => (PATTERNS[id] as Pattern).keys.includes(key));
}

/* ---------- Types de séance ---------- */

interface DayType {
  name: string;
  focus: string;
  /** Mouvements de base, dans l'ordre. */
  core: PatternId[];
  /** Mouvements ajoutés si une zone manque de volume. */
  optional: PatternId[];
}

const DAYS: Record<string, DayType> = {
  full: { name: 'Full body', focus: 'Tout le corps', core: ['squat', 'hpush', 'hpull', 'vpush', 'hinge', 'abs'], optional: ['lateral', 'biceps', 'triceps', 'vpull', 'rear', 'calves', 'obliques', 'neck', 'glute'] },
  fullB: { name: 'Full body', focus: 'Tout le corps', core: ['hinge', 'ipush', 'vpull', 'quad2', 'lateral', 'obliques'], optional: ['rear', 'biceps', 'triceps', 'hpull', 'calves', 'abs', 'neck', 'glute'] },
  upper: { name: 'Haut du corps', focus: 'Pecs, dos, épaules, bras', core: ['hpush', 'hpull', 'vpush', 'vpull', 'lateral', 'biceps', 'triceps'], optional: ['rear', 'chestIso', 'latIso', 'traps', 'neck', 'abs'] },
  lower: { name: 'Bas du corps', focus: 'Quadris, ischios, fessiers, mollets, abdos', core: ['squat', 'hinge', 'quad2', 'hamIso', 'calves', 'abs'], optional: ['glute', 'quadIso', 'obliques'] },
  push: { name: 'Push', focus: 'Pecs, épaules, triceps', core: ['hpush', 'vpush', 'ipush', 'lateral', 'triceps'], optional: ['chestIso', 'lateral', 'abs'] },
  pull: { name: 'Pull', focus: 'Dos, arrière d’épaules, biceps', core: ['vpull', 'hpull', 'rear', 'biceps'], optional: ['latIso', 'traps', 'biceps', 'neck', 'abs'] },
  legs: { name: 'Legs', focus: 'Quadris, ischios, fessiers, mollets', core: ['squat', 'hinge', 'quad2', 'hamIso', 'calves'], optional: ['glute', 'quadIso', 'abs', 'obliques'] },
};

/** Split selon le nombre de jours de muscu. Jours de la semaine : 0 = dimanche. */
function splitFor(days: number, physique: Physique): { type: string; variant: number; weekday: number }[] {
  const lowerBias = physique === 'lower';
  switch (Math.max(2, Math.min(6, days))) {
    case 2:
      return [
        { type: 'full', variant: 0, weekday: 1 },
        { type: 'fullB', variant: 1, weekday: 4 },
      ];
    case 3:
      return [
        { type: 'full', variant: 0, weekday: 1 },
        { type: 'fullB', variant: 1, weekday: 3 },
        { type: 'full', variant: 2, weekday: 5 },
      ];
    case 4:
      return [
        { type: 'upper', variant: 0, weekday: 1 },
        { type: 'lower', variant: 0, weekday: 2 },
        { type: 'upper', variant: 1, weekday: 4 },
        { type: 'lower', variant: 1, weekday: 5 },
      ];
    case 5:
      return lowerBias
        ? [
            { type: 'lower', variant: 0, weekday: 1 },
            { type: 'upper', variant: 0, weekday: 2 },
            { type: 'legs', variant: 1, weekday: 3 },
            { type: 'upper', variant: 1, weekday: 5 },
            { type: 'lower', variant: 2, weekday: 6 },
          ]
        : [
            { type: 'push', variant: 0, weekday: 1 },
            { type: 'pull', variant: 0, weekday: 2 },
            { type: 'legs', variant: 0, weekday: 3 },
            { type: 'upper', variant: 1, weekday: 5 },
            { type: 'lower', variant: 1, weekday: 6 },
          ];
    default:
      return [
        { type: 'push', variant: 0, weekday: 1 },
        { type: 'pull', variant: 0, weekday: 2 },
        { type: 'legs', variant: 0, weekday: 3 },
        { type: 'push', variant: 1, weekday: 4 },
        { type: 'pull', variant: 1, weekday: 5 },
        { type: 'legs', variant: 1, weekday: 6 },
      ];
  }
}

/* ---------- Génération ---------- */

export interface GenInput {
  athlete: Athlete;
  gym: Gym;
  /** Exercices qui stagnent : on prend la variante suivante. */
  avoid?: string[];
  /** Exercices déjà pratiqués : préférés à choix égal, pour garder l'historique des charges. */
  known?: string[];
  custom?: Record<string, CatalogEntry>;
}

export interface GenResult {
  program: Program;
  /** Séries par semaine et par zone : prévu, et cible visée. */
  volume: { region: Region; sets: number; target: number; priority: boolean }[];
  /** Durée estimée de chaque séance de muscu, en minutes. */
  minutes: Record<string, number>;
  notes: string[];
}

interface Slot {
  pattern: PatternId;
  key: string;
  sets: number;
  reps: string;
  rest: number;
  role: Role;
  region: Region;
  optional?: boolean;
}

interface Day {
  id: string;
  type: string;
  variant: number;
  weekday: number;
  slots: Slot[];
}

const WEEKDAY = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

function targetsFor(a: Athlete): Record<Region, number> {
  const physique = PHYSIQUES[a.physique ?? 'aesthetic'];
  const base = BASE[a.experience];
  const out = {} as Record<Region, number>;
  for (const r of REGIONS) {
    let t = (r.small ? base.small : base.big) * (physique.emphasis[r.id] ?? 1);
    if (a.priorities?.includes(r.id)) t = t * 1.2 + 2;
    if (r.id === 'neck' && !a.priorities?.includes('neck')) t = 0;
    out[r.id] = Math.round(Math.min(r.small ? 14 : 20, t));
  }
  return out;
}

function restFor(role: Role, physique: Physique): number {
  if (role === 'main') return physique === 'strength' ? 180 : 150;
  if (role === 'compound') return 120;
  if (role === 'iso') return 75;
  if (role === 'power') return 90;
  if (role === 'finisher') return 0;
  return 60;
}

/** Exercices qui se comptent en mètres ou en secondes : on garde les reps de la bibliothèque. */
const OWN_REPS = new Set(['farmer-walk', 'plank', 'side-plank', 'pallof', 'wood-chop']);

function repsFor(role: Role, key: string, physique: Physique): string {
  const p = PHYSIQUES[physique];
  if (OWN_REPS.has(key)) return catalogEntry(key)?.defaults.reps ?? '30 s';
  // Le soulevé de terre ne se fait pas en séries longues.
  if (key === 'deadlift' || key === 'sumo-deadlift') return role === 'main' ? p.reps.main : physique === 'strength' ? '3–5' : '5–8';
  if (role === 'main') return p.reps.main;
  if (role === 'compound') return p.reps.compound;
  if (role === 'iso') return p.reps.iso;
  if (role === 'power') return key === 'kettlebell-swing' ? '12–15' : '5';
  if (role === 'finisher') return '10 min';
  // Petits muscles, gainage : on garde les reps de la bibliothèque si ce sont des durées.
  const def = catalogEntry(key)?.defaults.reps ?? '12–15';
  if (/s|min/.test(def)) return def;
  return key === 'db-lateral-raise' || key === 'cable-lateral-raise' || key === 'face-pull' || key === 'rear-delt' ? '12–20' : '10–15';
}

/** Choisit l'exercice d'un mouvement : disponible dans la salle, pas en stagnation, varié selon la séance. */
function pick(pattern: PatternId, variantIn: number, taken: Set<string>, input: GenInput, main = false): string | null {
  const pat = PATTERNS[pattern] as Pattern;
  // On varie les gros mouvements d'une séance à l'autre ; l'isolation garde le meilleur choix.
  const variant =
    main && input.athlete.physique === 'strength' ? 0 : pat.role === 'compound' || pat.role === 'core' || pat.role === 'power' || pat.role === 'finisher' ? variantIn : pat.role === 'small' && pattern !== 'traps' && pattern !== 'calves' ? variantIn % 2 : 0;
  const keys = pat.keys.filter((k) => usable(k, input.gym) && !taken.has(k) && catalogEntry(k, input.custom));
  if (!keys.length) return null;
  // En force, le mouvement principal est un des quatre gros : squat, développé couché, soulevé de terre, militaire.
  if (main && input.athlete.physique === 'strength') {
    const big = ['squat', 'bench', 'deadlift', 'military-press'].find((k) => keys.includes(k) && !input.avoid?.includes(k));
    if (big) return big;
  }
  const fresh = keys.filter((k) => !input.avoid?.includes(k));
  const pool = fresh.length ? fresh : keys;
  // Les trois premiers candidats se valent à peu près : on préfère ceux déjà pratiqués.
  const head = pool.slice(0, 3);
  const known = head.filter((k) => input.known?.includes(k));
  const ordered = [...known, ...head.filter((k) => !known.includes(k)), ...pool.slice(3)];
  return ordered[variant % Math.min(ordered.length, 3)] ?? ordered[0];
}

function slotMinutes(slots: Slot[]): number {
  return slots.reduce((n, s) => n + (s.role === 'finisher' ? 10 * 60 : s.sets * (45 + s.rest)), 0) / 60;
}

export function generateProgram(input: GenInput): GenResult {
  const a = input.athlete;
  const physique: Physique = a.physique ?? 'aesthetic';
  const def = PHYSIQUES[physique];
  const notes: string[] = [];
  const sport = a.sport;

  // Jours de muscu selon le sport : le reste va au cardio.
  let liftDays = a.days;
  let cardioDays = 0;
  if (sport === 'mixed') {
    liftDays = a.days >= 5 ? a.days - 2 : a.days >= 3 ? a.days - 1 : a.days;
    cardioDays = a.days - liftDays;
  } else if (sport === 'combat') {
    liftDays = Math.min(3, Math.max(2, a.days - 2));
    cardioDays = Math.max(0, a.days - liftDays);
  }
  liftDays = Math.max(2, Math.min(6, liftDays));
  if (sport === 'combat') {
    notes.push(`${liftDays} séances de force et ${cardioDays} de cardio combat. Tes entraînements au club comptent à part : place-les sur les autres jours, ou remplace un cardio par un entraînement.`);
  }

  const split = sport === 'combat' ? splitFor(Math.min(liftDays, 3), 'athletic').slice(0, liftDays) : splitFor(liftDays, physique);
  const days: Day[] = split.map((d, i) => ({ id: `gen-${d.type}-${i + 1}`, type: d.type, variant: d.variant, weekday: d.weekday, slots: [] }));

  // 1. Mouvements de base de chaque séance.
  for (const day of days) {
    const taken = new Set<string>();
    const t = DAYS[day.type];
    let first = true;
    // Les zones prioritaires passent en premier, quand tu es frais (gros mouvements d'abord, isolation ensuite).
    const rank = (pid: PatternId) => {
      const pat = PATTERNS[pid] as Pattern;
      const heavy = pat.role === 'compound' ? 0 : 1;
      return heavy * 10 + (a.priorities?.includes(pat.region) ? 0 : 1);
    };
    const order = t.core.map((pid, i) => ({ pid, i })).sort((x, y) => rank(x.pid) - rank(y.pid) || x.i - y.i).map((x) => x.pid);
    for (const pid of order) {
      const pat = PATTERNS[pid] as Pattern;
      const isMain = first && pat.role === 'compound';
      const key = pick(pid, day.variant, taken, input, isMain);
      if (!key) continue;
      taken.add(key);
      const role: Role = isMain ? 'main' : pat.role;
      if (role === 'main') first = false;
      day.slots.push({ pattern: pid, key, role, region: pat.region, sets: role === 'main' ? def.mainSets : 3, reps: repsFor(role, key, physique), rest: restFor(role, physique) });
    }
    // Hybride ou combat : un mouvement explosif en début de séance, un finisher à la fin.
    if (def.athletic || sport === 'combat') {
      const p = pick('power', day.variant, taken, input);
      if (p) {
        taken.add(p);
        day.slots.unshift({ pattern: 'power', key: p, role: 'power', region: 'quads', sets: 3, reps: repsFor('power', p, physique), rest: 90 });
      }
    }
  }

  // 2. Volume : on rapproche chaque zone de sa cible.
  const targets = targetsFor(a);
  const volume = () => {
    const v = Object.fromEntries(REGIONS.map((r) => [r.id, 0])) as Record<Region, number>;
    for (const d of days) for (const s of d.slots) if (s.role !== 'power' && s.role !== 'finisher') v[s.region] += s.sets;
    return v;
  };
  const priority = (r: Region) => Boolean(a.priorities?.includes(r));

  for (let guard = 0; guard < 80; guard++) {
    const v = volume();
    // Zone la plus en retard (en proportion), priorités d'abord.
    const short = REGIONS.map((r) => r.id)
      .filter((r) => targets[r] > 0 && v[r] < targets[r] - 1)
      .sort((x, y) => Number(priority(y)) - Number(priority(x)) || v[x] / targets[x] - v[y] / targets[y]);
    if (!short.length) break;
    const r = short[0];
    // a) Ajouter une série à un mouvement existant de cette zone (5 max, 4 pour l'isolation).
    const slots = days.flatMap((d) => d.slots.filter((s) => s.region === r && s.role !== 'power' && s.role !== 'finisher'));
    const grow = slots.filter((s) => s.sets < (s.role === 'main' || s.role === 'compound' ? 5 : 4)).sort((x, y) => x.sets - y.sets)[0];
    if (grow && slots.length >= 2) {
      grow.sets++;
      continue;
    }
    // b) Sinon, ajouter un mouvement optionnel de cette zone dans la séance la moins chargée qui l'accepte.
    const candidates = days
      .map((d) => ({ d, pid: DAYS[d.type].optional.find((pid) => (PATTERNS[pid] as Pattern).region === r && !d.slots.some((s) => s.pattern === pid)) }))
      .filter((x): x is { d: Day; pid: PatternId } => Boolean(x.pid))
      .sort((x, y) => slotMinutes(x.d.slots) - slotMinutes(y.d.slots));
    const c = candidates[0];
    if (c) {
      const taken = new Set(c.d.slots.map((s) => s.key));
      const key = pick(c.pid, c.d.variant + 1, taken, input);
      if (key) {
        const pat = PATTERNS[c.pid] as Pattern;
        c.d.slots.push({ pattern: c.pid, key, role: pat.role, region: pat.region, sets: 3, reps: repsFor(pat.role, key, physique), rest: restFor(pat.role, physique), optional: true });
        continue;
      }
    }
    if (grow) {
      grow.sets++;
      continue;
    }
    // Rien d'autre à faire pour cette zone : on la retire de la course.
    targets[r] = Math.min(targets[r], v[r]);
  }

  // Zones en trop (hors priorités) : on retire des séries d'isolation.
  for (let guard = 0; guard < 40; guard++) {
    const v = volume();
    const over = REGIONS.map((r) => r.id).find((r) => !priority(r) && v[r] > Math.max(targets[r] * 1.35, targets[r] + 4));
    if (!over) break;
    const s = days.flatMap((d) => d.slots).filter((x) => x.region === over && x.sets > 2 && x.role !== 'main').sort((x, y) => y.sets - x.sets)[0];
    if (!s) break;
    s.sets--;
  }

  // 3. Temps par séance : on retire une série là où la zone est la mieux servie, pour garder un peu de tout.
  const budget = Math.max(30, a.minutes || 60);
  for (const d of days) {
    for (let guard = 0; guard < 60 && slotMinutes(d.slots) > budget + 3; guard++) {
      const v = volume();
      const ratio = (x: Slot) => (targets[x.region] ? v[x.region] / targets[x.region] : 9) + (priority(x.region) ? -0.5 : 0);
      const pool = d.slots.filter((x) => x.role !== 'power' && x.role !== 'finisher' && (x.role === 'main' ? x.sets >= def.mainSets : true));
      const cut = pool.sort((x, y) => ratio(y) - ratio(x) || y.sets - x.sets)[0];
      if (!cut) break;
      if (cut.sets <= 2) d.slots.splice(d.slots.indexOf(cut), 1);
      else cut.sets--;
    }
    // Finisher cardio s'il reste du temps (hybride, combat) ou si la séance est courte.
    if ((def.athletic || sport === 'combat' || sport === 'mixed') && slotMinutes(d.slots) + 10 <= budget + 3) {
      const key = pick('finisher', d.variant, new Set(d.slots.map((s) => s.key)), input);
      if (key) d.slots.push({ pattern: 'finisher', key, role: 'finisher', region: 'abs', sets: 1, reps: '10 min', rest: 0 });
    }
  }

  // 4. Mise en forme du programme.
  const counts: Record<string, number> = {};
  const sessions: SessionDef[] = days.map((d) => {
    const t = DAYS[d.type];
    counts[t.name] = (counts[t.name] ?? 0) + 1;
    const letter = days.filter((x) => DAYS[x.type].name === t.name).length > 1 ? ` ${String.fromCharCode(64 + counts[t.name])}` : '';
    const prio = (a.priorities ?? []).filter((r) => d.slots.some((s) => s.region === r));
    return {
      id: d.id,
      name: `${t.name}${letter}`,
      focus: prio.length ? `${t.focus}. Priorité : ${prio.map((r) => regionName(r).toLowerCase()).join(', ')}` : t.focus,
      type: 'lifting',
      exercises: d.slots.map<ExerciseSlot>((s) => ({
        key: s.key,
        sets: s.sets,
        reps: s.reps,
        rest: s.rest,
        ...(s.role === 'main' ? { note: physique === 'strength' ? 'Mouvement principal : charge lourde, technique parfaite.' : 'Mouvement principal de la séance : c’est lui qui doit progresser.' } : {}),
        ...(s.role === 'finisher' ? { note: '10 min : 30 s fort, 30 s facile.' } : {}),
      })),
    };
  });

  // Cardio : zone 2 et intervalles, ou cardio combat.
  const cardio: SessionDef[] = [];
  if (cardioDays > 0) {
    if (sport === 'combat') {
      cardio.push({
        id: 'gen-fight-cardio',
        name: 'Cardio combat',
        focus: 'Rounds de 3 min, 1 min de repos : le cardio du combat',
        type: 'cardio',
        exercises: [
          { key: 'rope-shadow', sets: 5, reps: '3 min', rest: 60 },
          { key: usable('intervals', input.gym) ? 'intervals' : 'mountain-climber', sets: 1, reps: '10 min', note: '30 s à fond, 30 s facile.' },
          { key: 'burpee-broad-jump', sets: 3, reps: '10', rest: 60 },
          { key: 'neck-flexion', sets: 2, reps: '15', rest: 45 },
          { key: 'neck-extension', sets: 2, reps: '15', rest: 45 },
        ],
      });
    } else {
      cardio.push({
        id: 'gen-zone2',
        name: 'Cardio zone 2',
        focus: '30 à 45 min à allure facile : tu peux parler en courtes phrases',
        type: 'cardio',
        exercises: [{ key: 'zone2', reps: '40 min' }, { key: 'mobility' }],
      });
      if (cardioDays > 1)
        cardio.push({
          id: 'gen-intervals',
          name: 'Cardio intervalles',
          focus: 'Fractionné court : le moteur',
          type: 'cardio',
          exercises: [{ key: usable('intervals', input.gym) ? 'intervals' : 'running', sets: 1, reps: '20 min', note: '8 × (1 min fort, 1 min facile), échauffement et retour au calme compris.' }, { key: 'plank', sets: 3 }],
        });
    }
  }

  const schedule = Array<string>(7).fill('rest');
  for (const d of days) schedule[d.weekday] = d.id;
  // Cardio sur les jours libres, en évitant le dimanche si possible.
  const free = [4, 6, 3, 0, 2, 5, 1].filter((w) => schedule[w] === 'rest');
  for (let i = 0; i < cardioDays && i < free.length; i++) schedule[free[i]] = cardio[i % Math.max(1, cardio.length)]?.id ?? 'rest';

  const rest: SessionDef = {
    id: 'rest',
    name: 'Repos',
    focus: 'Marche et récupération',
    type: 'rest',
    exercises: [{ key: 'walk' }, { key: 'mobility' }],
  };

  const minutes = Object.fromEntries(sessions.map((x) => [x.id, Math.round(slotMinutes(days.find((d) => d.id === x.id)!.slots))]));
  const v = volume();
  const tgt = targetsFor(a);
  const volumeOut = REGIONS.filter((r) => tgt[r.id] > 0 || v[r.id] > 0).map((r) => ({ region: r.id, sets: v[r.id], target: tgt[r.id], priority: priority(r.id) }));

  const short = volumeOut.filter((x) => x.sets < x.target - 2);
  if (short.length)
    notes.push(
      `Avec ${liftDays} séances de ${budget} min, ${short.map((x) => regionName(x.region).toLowerCase()).join(', ')} ${short.length > 1 ? 'restent' : 'reste'} un peu sous la cible. Ajoute du temps ou un jour si tu veux tout couvrir.`,
    );
  const missing = (Object.keys(PATTERNS) as PatternId[]).filter((p) => !['power', 'finisher', 'neck'].includes(p) && !(PATTERNS[p] as Pattern).keys.some((k) => usable(k, input.gym)));
  if (missing.length) notes.push('Ta salle manque de matériel pour certains mouvements : ils sont remplacés au mieux.');
  notes.unshift(splitNote(liftDays, physique, sport));

  return {
    program: {
      name: `${def.label}${sport === 'combat' ? ' + combat' : sport === 'mixed' ? ' + cardio' : ''}`,
      template: `gen-${physique}`,
      sessions: [...sessions, ...cardio, rest],
      schedule,
      meta: { physique, priorities: a.priorities ?? [], generatedAt: new Date().toISOString().slice(0, 10) },
    },
    volume: volumeOut,
    minutes,
    notes,
  };
}

function splitNote(days: number, physique: Physique, sport: Athlete['sport']): string {
  const why: Record<number, string> = {
    2: '2 full body : chaque muscle travaillé 2 fois par semaine, le minimum efficace.',
    3: '3 full body : chaque muscle 3 fois par semaine, idéal pour progresser vite avec peu de jours.',
    4: 'Haut / bas deux fois : chaque muscle 2 fois par semaine, avec le temps de récupérer.',
    5: physique === 'lower' ? 'Bas, haut, jambes, haut, bas : 3 séances jambes pour tes fessiers.' : 'Push, pull, legs puis haut et bas : chaque muscle 2 fois par semaine sur 5 jours.',
    6: 'Push, pull, legs deux fois : volume maximal, pour qui récupère bien.',
  };
  return sport === 'combat' ? 'Full body de force et de puissance : ce qui sert sur le tapis, sans te cramer pour le club.' : why[days] ?? why[4];
}

/** Séance de renfo pour les plans de course et Hyrox, selon le physique visé. */
export function runnerStrength(input: GenInput): SessionDef {
  const a = input.athlete;
  const physique = a.physique ?? 'athletic';
  const taken = new Set<string>();
  const exercises: ExerciseSlot[] = [];
  const add = (pid: PatternId, sets: number, reps?: string) => {
    const key = pick(pid, 0, taken, input);
    if (!key) return;
    taken.add(key);
    const pat = PATTERNS[pid] as Pattern;
    exercises.push({ key, sets, reps: reps ?? repsFor(pat.role, key, physique), rest: restFor(pat.role === 'compound' ? 'compound' : pat.role, physique) });
  };
  add('squat', 3, '6–8');
  add('hinge', 3, '8–10');
  add('glute', 2, '8–10');
  // Le haut du corps selon les priorités, sinon un tirage (posture de coureur).
  const upper: PatternId[] = [];
  for (const r of a.priorities ?? []) {
    const pid = (['vpull', 'hpull', 'vpush', 'hpush', 'lateral', 'biceps', 'triceps'] as PatternId[]).find((p) => (PATTERNS[p] as Pattern).region === r);
    if (pid && !upper.includes(pid)) upper.push(pid);
  }
  if (!upper.length) upper.push(physique === 'v-taper' || physique === 'aesthetic' ? 'vpull' : 'hpull');
  for (const pid of upper.slice(0, 2)) add(pid, 3);
  add('calves', 3, '12–15');
  add('obliques', 2);
  return { id: 'run-strength', name: 'Renfo', focus: 'Jambes, hanches et gainage, plus le haut du corps que tu veux développer', type: 'lifting', exercises };
}

/**
 * Renfo des sports d'endurance. Course et triathlon : jambes, hanches, gainage (le renfo coureur).
 * Natation : dos, épaules protégées, gainage, un peu de jambes pour les départs et les virages.
 * Vélo : jambes unilatérales, chaîne postérieure, gainage et dos pour la position.
 */
export function enduranceStrength(input: GenInput, kind: 'run' | 'swim' | 'bike' | 'tri'): SessionDef {
  if (kind === 'run') return runnerStrength(input);
  const a = input.athlete;
  const physique = a.physique ?? 'athletic';
  const taken = new Set<string>();
  const exercises: ExerciseSlot[] = [];
  const add = (pid: PatternId, sets: number, reps?: string) => {
    const key = pick(pid, 0, taken, input);
    if (!key) return;
    taken.add(key);
    const pat = PATTERNS[pid] as Pattern;
    exercises.push({ key, sets, reps: reps ?? repsFor(pat.role, key, physique), rest: restFor(pat.role === 'compound' ? 'compound' : pat.role, physique) });
  };
  if (kind === 'swim') {
    add('vpull', 3, '6–10');
    add('hpull', 3, '8–10');
    add('latIso', 2, '12–15');
    add('rear', 2, '15');
    exercises.push({ key: 'external-rotation', sets: 2, reps: '15', rest: 45 });
    add('squat', 3, '8–10');
    add('obliques', 2);
    add('abs', 2);
    return { id: 'swim-strength', name: 'Renfo nageur', focus: 'Dos, épaules protégées et gainage : plus de puissance dans l’eau', type: 'lifting', exercises };
  }
  if (kind === 'bike') {
    add('squat', 3, '6–8');
    add('quad2', 3, '8–10');
    add('hinge', 3, '8–10');
    add('glute', 2, '10–12');
    add('hpull', 2, '10–12');
    add('calves', 2, '12–15');
    add('obliques', 2);
    return { id: 'bike-strength', name: 'Renfo cycliste', focus: 'Jambes une par une, fessiers et gainage : plus de watts, moins de douleurs de dos', type: 'lifting', exercises };
  }
  const tri = runnerStrength(input);
  if (!tri.exercises.some((x) => (PATTERNS.vpull as Pattern).keys.includes(x.key))) {
    const key = pick('vpull', 0, new Set(tri.exercises.map((x) => x.key)), input);
    if (key) tri.exercises.splice(3, 0, { key, sets: 3, reps: '6–10', rest: 120 });
  }
  return { ...tri, id: 'tri-strength', name: 'Renfo triathlète', focus: 'Jambes, hanches, dos et gainage : tenir la position sur les trois sports' };
}

/** Le volume hebdomadaire par zone d'un programme quelconque (semaine type). */
export function programVolume(program: Program, custom: Record<string, CatalogEntry> = {}): Record<Region, number> {
  const v = Object.fromEntries(REGIONS.map((r) => [r.id, 0])) as Record<Region, number>;
  for (const id of program.schedule) {
    const s = program.sessions.find((x) => x.id === id);
    if (!s || s.type !== 'lifting') continue;
    for (const slot of s.exercises) {
      const e = resolveExercise(slot, custom);
      if (e.kind === 'cardio' || e.kind === 'task' || e.kind === 'power') continue;
      const r = regionOf(slot.key, custom);
      if (r) v[r] += e.sets;
    }
  }
  return v;
}

export { targetsFor, WEEKDAY, estimateDuration };
