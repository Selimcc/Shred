// Types partagés par l'app et le serveur. Tout ce qui est « programme » est de la donnée :
// l'utilisateur peut tout modifier dans l'app, le code ne fait que l'interpréter.

export type ExerciseKind = 'compound' | 'isolation' | 'core' | 'neck' | 'power' | 'cardio' | 'task';

export type MuscleGroup = 'chest' | 'back' | 'shoulders' | 'arms' | 'legs' | 'core' | 'neck' | 'cardio' | 'other';

/** Le sport d'un exercice d'endurance : sert aux allures, aux durées et aux stats par discipline. */
export type Discipline = 'run' | 'bike' | 'swim' | 'row' | 'ski' | 'walk' | 'combat';

/** Intensité d'un bloc, de 1 (récupération) à 5 (maximal). */
export type Zone = 1 | 2 | 3 | 4 | 5;

/** Un exercice de la bibliothèque (ou créé par l'utilisateur). */
export interface CatalogEntry {
  key: string;
  name: string;
  kind: ExerciseKind;
  group: MuscleGroup;
  muscles: string[];
  cue?: string;
  note?: string;
  /** Valeurs proposées quand on l'ajoute à une séance. */
  defaults: { sets: number; reps: string; rest: number };
  /** Saut de charge conseillé quand la fourchette haute est atteinte (kg). */
  step?: number;
  /** Pas de charge à saisir (poids du corps, chrono, tâche). */
  noLoad?: boolean;
  /** Créé par l'utilisateur dans l'app. */
  custom?: boolean;
  /** Endurance : le sport (course, vélo, natation…). */
  discipline?: Discipline;
  /** Intensité habituelle, de 1 à 5. */
  zone?: Zone;
}

/** Un exercice placé dans une séance, avec ses réglages propres. */
export interface ExerciseSlot {
  key: string;
  sets?: number;
  reps?: string;
  rest?: number;
  note?: string;
  /** Endurance : durée estimée d'une répétition, en secondes (calculée avec tes allures). */
  sec?: number;
  /** Endurance : intensité de ce bloc, si elle diffère de celle de l'exercice. */
  zone?: Zone;
  /** Endurance : l'allure ou la zone visée, en clair (« 4:35/km », « 88–94 % FTP »). */
  target?: string;
  /** Isolation : garder cet exercice à chaque bloc au lieu de passer à une autre variante. */
  pin?: boolean;
}

export type SessionType = 'lifting' | 'cardio' | 'rest';

export interface SessionDef {
  id: string;
  name: string;
  focus: string;
  type: SessionType;
  exercises: ExerciseSlot[];
  /** Séance générée pour un plan daté (course, Hyrox) : cachée de l'éditeur. */
  generated?: boolean;
}

export interface Program {
  name: string;
  /** Modèle d'origine, pour information. */
  template?: string;
  sessions: SessionDef[];
  /** Séance de chaque jour, index = Date.getDay() (0 = dimanche). Sert aussi avant et après un plan daté. */
  schedule: string[];
  /** Plan daté : lundi de la première semaine, et le planning de chaque semaine. */
  start?: string;
  weeks?: string[][];
  /** Nom de la phase de chaque semaine (« Fondamental », « Affûtage »…). */
  phases?: string[];
  /** La course visée. */
  event?: { name: string; date: string };
  /** Programme construit par le générateur : avec quels choix. */
  meta?: { physique: string; priorities: string[]; generatedAt: string; /** Bloc d'endurance sans course : son numéro. */ block?: number };
}

/** Exercice prêt à l'emploi : entrée de la bibliothèque + réglages de la séance. */
export interface Exercise {
  key: string;
  name: string;
  sets: number;
  reps: string;
  repMin?: number;
  repMax?: number;
  rest: number;
  kind: ExerciseKind;
  note?: string;
  step?: number;
  noLoad?: boolean;
  /** Clé de l'exercice prévu dans le programme, quand il est remplacé aujourd'hui. */
  slotKey?: string;
  /** Pourquoi il a changé : remplacé à la main, machine en panne, ou ajouté pour la séance. */
  change?: 'swap' | 'broken' | 'extra' | 'rotate' | 'catchup';
  /** Variante du bloc : son numéro. Rattrapage : la zone à rattraper. */
  because?: string;
  discipline?: Discipline;
  zone?: Zone;
  sec?: number;
  target?: string;
}

export interface Session {
  id: string;
  name: string;
  focus: string;
  type: SessionType;
  duration: string;
  /** 'all' : toutes les séries ; 'any' : un bloc suffit ; 'first' : la première tâche suffit. */
  completeWhen: 'all' | 'any' | 'first';
  lifting: boolean;
  exercises: Exercise[];
}

export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export type MealSlot = 'breakfast' | 'lunch' | 'snack' | 'dinner' | 'extra';

export interface PlannedMeal extends Macros {
  id: string;
  slot: MealSlot;
  label: string;
  detail: string;
}

export interface HabitDef {
  id: string;
  name: string;
  icon: string;
}
