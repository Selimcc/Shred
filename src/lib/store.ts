import { useSyncExternalStore } from 'react';
import {
  DEFAULT_HABITS,
  DEFAULT_MEAL_PLAN,
  DEFAULT_TARGETS,
  type HabitId,
  type Macros,
  type MealSlot,
  MIN_MEALS_FOR_VALIDATION,
  type SessionId,
} from '../../shared/program';
import { type Athlete, DEFAULT_ATHLETE, DEFAULT_GYM, type Gym, type WeightGoal } from '../../shared/athlete';
import type { MealPrep } from '../../shared/meals';
import { DEFAULT_PROGRAM } from '../../shared/templates';
import type { CatalogEntry, Discipline, ExerciseSlot, HabitDef, PlannedMeal, Program } from '../../shared/types';
import { addDays, dayKey } from './date';
import { demoState } from './demo-seed';

export interface SetLog {
  w?: number;
  r?: number;
  /** Endurance : distance faite (km) et durée (minutes). */
  km?: number;
  min?: number;
  done: boolean;
}

export interface MealItem {
  name: string;
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface MealEntry extends Macros {
  id: string;
  slot: MealSlot;
  label: string;
  source: 'plan' | 'photo' | 'manual' | 'scan';
  planId?: string;
  photoId?: string;
  items?: MealItem[];
  at: number;
}

/** Forme du jour : ajuste les séries et les charges conseillées. */
export type Form = 'low' | 'ok' | 'high';

export interface DayLog {
  /** Séance choisie à la place de celle du planning. */
  session?: SessionId;
  /** Exercices remplacés aujourd'hui : clé prévue → clé faite. */
  swaps?: Record<string, string>;
  /** Exercices sautés aujourd'hui (clé prévue). */
  skipped?: string[];
  /** Exercices ajoutés pour la séance du jour. */
  extra?: ExerciseSlot[];
  form?: Form;
  /** Séance express : minutes disponibles. */
  express?: number;
  sets: Record<string, SetLog[]>;
  /** Sorties importées (Strava, montre via Apple Santé) ce jour-là. */
  activities?: Activity[];
  mainDone: boolean;
  mainDoneAt?: number;
  meals: MealEntry[];
  habits: Partial<Record<HabitId, boolean>>;
}

export type ReminderType = 'morning' | 'lunch' | 'training' | 'evening';

/** Où passe l'IA : l'API Claude (automatique, payante à l'usage), l'app Claude (gratuite avec un abonnement) ou nulle part. */
export type AiMode = 'api' | 'claude' | 'off';

/** Les briques de l'app qu'on peut activer ou couper. */
export interface Modules {
  nutrition: boolean;
  habits: boolean;
  weight: boolean;
  strength: boolean;
  health: boolean;
  gym: boolean;
}

/** Ce qu'il faut faire pour valider une journée et prolonger la série. */
export interface Goal {
  workout: boolean;
  minMeals: number;
  /** Ce qui compte comme séance faite : la moitié des séries suffit, ou la séance entière. */
  level?: 'half' | 'full';
}

export interface Settings {
  name: string;
  age?: number;
  height?: number;
  /** Accueil terminé (prénom, objectif, programme, IA). */
  onboarded: boolean;
  /** Clé que les Raccourcis iPhone utilisent pour envoyer Santé et les passages à la salle. */
  shortcutKey?: string;
  targets: Macros;
  reminders: Record<ReminderType, { on: boolean; time: string }>;
  pushEnabled: boolean;
  ai: AiMode;
  modules: Modules;
  goal: Goal;
  /** Ce que le coach doit savoir sur toi (objectif, goûts, contraintes). */
  coachNotes: string;
  weightGoal: WeightGoal;
  /** Jours à tenir pour la première flamme ; les suivantes s'espacent de plus en plus. */
  streakGoal: number;
  /** Ce que les autres testeurs peuvent voir de toi. */
  profile: PublicProfileSettings;
  /** Profil sportif : sexe, masse grasse, sport, disponibilités, alimentation. */
  athlete: Athlete;
  /** Salle et matériel disponible. */
  gym: Gym;
  /** Envoyer le bilan de la semaine par mail (si le serveur sait envoyer). */
  reportEmail: boolean;
  /** Machines signalées en panne : l'exercice est remplacé automatiquement jusqu'à la date. */
  broken?: Record<string, { since: string; until: string }>;
}

export interface PublicProfileSettings {
  visible: boolean;
  show: { streak: boolean; best: boolean; flames: boolean; level: boolean; radar: boolean; program: boolean };
}

export const DEFAULT_PROFILE: PublicProfileSettings = {
  visible: false,
  show: { streak: true, best: true, flames: true, level: true, radar: true, program: true },
};

export { WEIGHT_GOALS, type WeightGoal } from '../../shared/athlete';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  at: number;
  /** Extraits de l'historique sur lesquels la réponse s'appuie. */
  sources?: string[];
}

export type Pose = 'front' | 'side' | 'back';

export interface BodyPhoto {
  id: string;
  date: string;
  pose: Pose;
}

/** Une sortie enregistrée ailleurs (Strava, Apple Watch) et importée dans Shred. */
export interface Activity {
  /** « strava:123 », « health:… » : sert à ne pas l'importer deux fois. */
  id: string;
  source: 'strava' | 'health';
  sport: Discipline | 'lift' | 'other';
  name: string;
  /** Début, heure locale ISO. */
  start: string;
  min: number;
  km?: number;
  elev?: number;
  hr?: number;
  kcal?: number;
  /** Exercices de la séance du jour que cette sortie a validés. */
  linked?: string[];
}

export interface HealthDay {
  steps?: number;
  active?: number;
  resting?: number;
  /** Sommeil de la nuit (minutes), cœur au repos (bpm), VFC (ms), minutes d'exercice, distance (km). */
  sleepMin?: number;
  restingHr?: number;
  hrv?: number;
  exerciseMin?: number;
  distanceKm?: number;
  /** Heure de la dernière synchro Apple Santé (ISO). */
  at?: string;
  gymIn?: string;
  gymOut?: string;
  gymVisits?: number;
}

export interface AppState {
  version: 1;
  createdAt: string;
  days: Record<string, DayLog>;
  body: {
    weight: Record<string, number>;
    waist: Record<string, number>;
    /** Photos de physique : l'image reste sur l'appareil (IndexedDB), seules ces infos sont sauvegardées. */
    photos?: BodyPhoto[];
  };
  streak: {
    /** Série acquise jusqu'au jour `through` inclus. */
    banked: number;
    best: number;
    freezes: number;
    through: string;
    frozen: string[];
  };
  coach: ChatMessage[];
  settings: Settings;
  /** Le split : séances, exercices, planning. Entièrement modifiable dans l'app. */
  program: Program;
  /** Exercices créés par l'utilisateur, en plus de la bibliothèque. */
  customExercises: Record<string, CatalogEntry>;
  mealPlan: PlannedMeal[];
  habits: HabitDef[];
  /** Données reçues d'Apple Santé et des passages à la salle, par jour. */
  health: Record<string, HealthDay>;
  /** Strava relié : qui, et la dernière synchro. Les jetons restent sur le serveur. */
  strava?: { athlete?: string; connectedAt?: string; lastSync?: string };
  /** Club : étincelles reçues (elles comptent dans l'XP). */
  club?: { sparks: number };
  ui: {
    celebrated?: string;
    /** La mascotte a déjà apporté la première flamme. */
    metKilo?: boolean;
    /** Question préparée pour le coach (depuis le bilan ou une proposition de plat). */
    coachDraft?: string;
    /** Lundi de la dernière semaine dont le bilan a été vu, et envoyé par mail. */
    reportSeen?: string;
    reportMailed?: string;
    /** Propositions d'ajustement écartées, avec la date. */
    dismissedTweaks?: Record<string, string>;
  };
  /** Liste de courses et préparation du meal plan en cours. */
  prep?: MealPrep;
  /** Programmes remplacés (le plus récent d'abord), pour revenir en arrière. */
  programHistory?: { program: Program; replacedAt: string }[];
  /** Semaine de décharge : lundi de la semaine en cours de décharge, et fin de la dernière. */
  deload?: { week?: string; lastEnd?: string };
}

const KEY = 'shred:v1';

export const DEFAULT_REMINDERS: Settings['reminders'] = {
  morning: { on: true, time: '08:00' },
  lunch: { on: true, time: '13:30' },
  training: { on: true, time: '18:00' },
  evening: { on: true, time: '21:30' },
};

export function initial(): AppState {
  const today = dayKey();
  return {
    version: 1,
    createdAt: today,
    days: {},
    body: { weight: {}, waist: {} },
    streak: { banked: 0, best: 0, freezes: 1, through: addDays(today, -1), frozen: [] },
    coach: [],
    settings: {
      name: '',
      onboarded: false,
      targets: { ...DEFAULT_TARGETS },
      reminders: structuredClone(DEFAULT_REMINDERS),
      pushEnabled: false,
      ai: 'claude',
      modules: { ...DEFAULT_MODULES },
      goal: { workout: true, minMeals: MIN_MEALS_FOR_VALIDATION },
      coachNotes: DEFAULT_COACH_NOTES,
      weightGoal: 'cut',
      streakGoal: 7,
      profile: structuredClone(DEFAULT_PROFILE),
      athlete: structuredClone(DEFAULT_ATHLETE),
      gym: structuredClone(DEFAULT_GYM),
      reportEmail: false,
    },
    program: structuredClone(DEFAULT_PROGRAM),
    customExercises: {},
    mealPlan: structuredClone(DEFAULT_MEAL_PLAN),
    habits: structuredClone(DEFAULT_HABITS),
    health: {},
    ui: {},
  };
}

export const DEFAULT_MODULES: Modules = { nutrition: true, habits: true, weight: true, strength: true, health: true, gym: true };

/** Vide par défaut : chacun écrit les siennes à l'accueil ou dans Réglages, Profil. */
export const DEFAULT_COACH_NOTES = '';

/** Point de départ des objectifs nutrition selon le poids et l'objectif (ajustable ensuite). */
export function suggestTargets(weight: number, goal: WeightGoal): Macros {
  const factor = goal === 'cut' ? 31.5 : goal === 'bulk' ? 38 : 35;
  const kcal = Math.round((weight * factor) / 50) * 50;
  const protein = Math.round(weight * (goal === 'cut' ? 2.2 : 1.8));
  const fat = Math.round(weight * 0.8);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, carbs, fat };
}

/** Complète une sauvegarde (éventuellement ancienne) avec les valeurs par défaut. */
export function migrate(saved: Partial<AppState> & { settings?: Partial<Settings> & { schedule?: string[] } }, base = initial()): AppState {
  let program = saved.program;
  if (!program) {
    // Avant la version modulable, le planning vivait dans les réglages.
    program = structuredClone(DEFAULT_PROGRAM);
    const old = saved.settings?.schedule;
    if (Array.isArray(old) && old.length === 7 && old.every((id) => program!.sessions.some((x) => x.id === id))) {
      program.schedule = [...old];
    }
  }
  const {
    schedule: _legacy,
    token: _token,
    ...settings
  } = (saved.settings ?? {}) as Partial<Settings> & { schedule?: string[]; token?: string };
  // Une sauvegarde d'avant l'accueil vient de quelqu'un qui utilisait déjà l'app.
  settings.onboarded ??= true;
  return {
    ...base,
    ...saved,
    body: { ...base.body, ...saved.body },
    streak: { ...base.streak, ...saved.streak },
    settings: {
      ...base.settings,
      ...settings,
      targets: { ...base.settings.targets, ...settings.targets },
      reminders: { ...base.settings.reminders, ...settings.reminders },
      modules: { ...base.settings.modules, ...settings.modules },
      goal: { ...base.settings.goal, ...settings.goal },
      profile: { ...base.settings.profile, ...settings.profile, show: { ...base.settings.profile.show, ...settings.profile?.show } },
      athlete: { ...base.settings.athlete, ...settings.athlete, diet: { ...base.settings.athlete.diet, ...settings.athlete?.diet } },
      gym: { ...base.settings.gym, ...settings.gym, equipment: { ...base.settings.gym.equipment, ...settings.gym?.equipment } },
    },
    program,
    customExercises: { ...saved.customExercises },
    mealPlan: saved.mealPlan ?? base.mealPlan,
    habits: saved.habits ?? base.habits,
    health: { ...saved.health },
    ui: { ...saved.ui },
    ...(saved.strava ? { strava: saved.strava } : {}),
    ...(saved.club ? { club: saved.club } : {}),
  };
}

function load(): AppState {
  const base = initial();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return import.meta.env.MODE === 'demo' ? demoState(base) : base;
    return migrate(JSON.parse(raw), base);
  } catch {
    return import.meta.env.MODE === 'demo' ? demoState(base) : base;
  }
}

let state: AppState = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Sauvegarde locale impossible', e);
  }
}

export function getState(): AppState {
  return state;
}

export function setState(mutate: (draft: AppState) => void) {
  const draft = structuredClone(state);
  mutate(draft);
  state = draft;
  persist();
  listeners.forEach((l) => l());
}

export function replaceState(next: AppState) {
  state = next;
  persist();
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useApp(): AppState {
  return useSyncExternalStore(subscribe, getState);
}

export function emptyDay(): DayLog {
  return { sets: {}, mainDone: false, meals: [], habits: {} };
}

export function readDay(s: AppState, key: string): DayLog {
  return s.days[key] ?? emptyDay();
}

export function ensureDay(draft: AppState, key: string): DayLog {
  draft.days[key] ??= emptyDay();
  return draft.days[key];
}

export function resetAll() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Stockage indisponible : l'état en mémoire est quand même réinitialisé.
  }
  replaceState(initial());
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
