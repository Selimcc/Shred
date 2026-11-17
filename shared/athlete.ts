// Qui est la personne, ce qu'elle vise, où elle s'entraîne : tout ce qui sert à adapter
// le programme, les calories, les repas et le bilan. Calculs purs, testables.
import type { Physique, Region } from './generator';
import type { Macros } from './types';
import { tr } from './i18n';

export type Sex = 'male' | 'female';
export type Activity = 'sedentary' | 'light' | 'moderate' | 'active';
export type Experience = 'beginner' | 'intermediate' | 'advanced';
export type Sport = 'strength' | 'running' | 'hyrox' | 'mixed' | 'combat' | 'swimming' | 'cycling' | 'triathlon';
export type RaceDistance = '5k' | '10k' | 'half' | 'marathon';
/** Objectifs datés hors course à pied : triathlons, natation, cyclosportives. */
export type EnduranceEvent = 'tri-sprint' | 'tri-olympic' | 'tri-half' | 'tri-full' | 'swim-1500' | 'swim-5k' | 'bike-100' | 'bike-160';
export type EventDistance = RaceDistance | 'hyrox' | EnduranceEvent;

/** Les sports d'endurance : programme bâti autour des sorties, la muscu en complément. */
export const ENDURANCE_SPORTS: Sport[] = ['running', 'swimming', 'cycling', 'triathlon'];
export const isEndurance = (s: Sport) => ENDURANCE_SPORTS.includes(s);

export interface DietPrefs {
  vegetarian: boolean;
  noPork: boolean;
  lactoseFree: boolean;
  /** Temps de cuisine accepté en semaine. */
  cook: 'quick' | 'normal';
  budget: 'tight' | 'normal';
  /** Repas principaux par jour (3 ou 4 : avec collation). */
  meals: 3 | 4;
  /** Aliments refusés, en clair (« saumon, champignons »). */
  dislikes: string;
}

export interface Athlete {
  sex?: Sex;
  activity: Activity;
  experience: Experience;
  /** Pourcentage de masse grasse estimé (facultatif). */
  bodyFat?: number;
  /** Pourcentage visé, pour une sèche ou une recompo. */
  targetBodyFat?: number;
  sport: Sport;
  /** Jours d'entraînement disponibles par semaine. */
  days: number;
  /** Minutes par séance. */
  minutes: number;
  /** Objectif daté. Sans date : un bloc de progression de 8 semaines, renouvelable. */
  race?: { distance: EventDistance; date?: string; /** Chrono récent en course à pied, en secondes, sur refKm. */ refSec?: number; refKm?: number };
  /** Natation : allure seuil (CSS), en secondes aux 100 m. */
  swimPace?: number;
  /** Vélo : puissance seuil (FTP), en watts, si tu la connais. */
  ftp?: number;
  diet: DietPrefs;
  /** Le physique visé : oriente le split et le volume par muscle. */
  physique?: Physique;
  /** Zones à faire passer en priorité (3 au plus). */
  priorities?: Region[];
}

export const DEFAULT_ATHLETE: Athlete = {
  activity: 'light',
  experience: 'intermediate',
  sport: 'strength',
  days: 4,
  minutes: 60,
  diet: { vegetarian: false, noPork: false, lactoseFree: false, cook: 'normal', budget: 'normal', meals: 4, dislikes: '' },
};

const PHYSIQUE_LABELS: Record<Physique, string> = {
  aesthetic: tr('esthétique et sec'),
  'v-taper': tr('dos en V, épaules larges'),
  mass: tr('masse'),
  strength: tr('force'),
  athletic: tr('athlète hybride'),
  lower: tr('bas du corps et fessiers'),
};

/* ---------- Salle et matériel ---------- */

export type GymChain = 'fitness-park' | 'basic-fit' | 'on-air' | 'other' | 'small' | 'home';

export type Equipment =
  | 'barbell'
  | 'dumbbells'
  | 'machines'
  | 'cables'
  | 'pullup'
  | 'treadmill'
  | 'bike'
  | 'rower'
  | 'skierg'
  | 'sled'
  | 'wallball'
  | 'kettlebell'
  | 'sandbag'
  | 'heavybag';

export const EQUIPMENT: { id: Equipment; name: string }[] = [
  { id: 'barbell', name: tr('Barres et racks') },
  { id: 'dumbbells', name: tr('Haltères') },
  { id: 'machines', name: tr('Machines guidées') },
  { id: 'cables', name: tr('Poulies') },
  { id: 'pullup', name: tr('Barre de traction') },
  { id: 'treadmill', name: tr('Tapis de course') },
  { id: 'bike', name: tr('Vélo') },
  { id: 'rower', name: tr('Rameur') },
  { id: 'skierg', name: 'SkiErg' },
  { id: 'sled', name: tr('Traîneau (sled)') },
  { id: 'wallball', name: tr('Médecine-ball (wall ball)') },
  { id: 'kettlebell', name: tr('Kettlebells') },
  { id: 'sandbag', name: tr('Sandbag') },
  { id: 'heavybag', name: tr('Sac de frappe') },
];

const BIG_GYM: Equipment[] = ['barbell', 'dumbbells', 'machines', 'cables', 'pullup', 'treadmill', 'bike', 'rower', 'kettlebell'];

/**
 * Matériel coché par défaut. Les équipements Hyrox (SkiErg, traîneau, wall ball, sandbag) dépendent du club :
 * ils restent décochés, chacun coche ce que sa salle a vraiment.
 */
export const GYMS: { id: GymChain; name: string; equipment: Equipment[] }[] = [
  { id: 'fitness-park', name: tr('Fitness Park'), equipment: BIG_GYM },
  { id: 'basic-fit', name: 'Basic-Fit', equipment: BIG_GYM },
  { id: 'on-air', name: tr('On Air'), equipment: BIG_GYM },
  { id: 'other', name: tr('Grande salle'), equipment: BIG_GYM },
  { id: 'small', name: tr('Petite salle'), equipment: ['barbell', 'dumbbells', 'pullup', 'machines'] },
  { id: 'home', name: tr('Maison ou extérieur'), equipment: ['dumbbells', 'pullup'] },
];

/** Type de salle proposé sur l'écran (les chaînes françaises sont reconnues à leur nom sur la carte). */
export const GYM_KINDS: GymChain[] = ['other', 'small', 'home'];

/** Reconnaît une chaîne connue dans le nom d'une salle trouvée sur la carte. */
export function chainFromName(name: string): GymChain | null {
  const n = name.toLowerCase().replace(/[^a-z]/g, '');
  if (n.includes('basicfit')) return 'basic-fit';
  if (n.includes('fitnesspark')) return 'fitness-park';
  if (n.includes('onair')) return 'on-air';
  return null;
}

/** Salle choisie sur la carte (OpenStreetMap), n'importe où dans le monde. */
export interface GymPlace {
  id: string;
  name: string;
  lat: number;
  lon: number;
  address?: string;
}

export interface Gym {
  chain: GymChain;
  /** Nom ou ville du club, pour le repérer (« Basic-Fit Sartrouville »). */
  club?: string;
  /** Position de la salle, pour proposer la séance en arrivant. */
  place?: GymPlace;
  equipment: Partial<Record<Equipment, boolean>>;
}

export function gymDefaults(chain: GymChain): Gym {
  const g = GYMS.find((x) => x.id === chain) ?? GYMS[0];
  return { chain, equipment: Object.fromEntries(EQUIPMENT.map((e) => [e.id, g.equipment.includes(e.id)])) };
}

export const DEFAULT_GYM: Gym = gymDefaults('fitness-park');

export const has = (gym: Gym | undefined, e: Equipment) => (gym ? Boolean(gym.equipment[e]) : true);

/* ---------- Objectifs ---------- */

export type WeightGoal = 'cut' | 'recomp' | 'maintain' | 'bulk';

/** Variation de poids visée par semaine (moyenne sur 7 jours), en kg. */
export const WEIGHT_GOALS: Record<WeightGoal, { label: string; min: number; max: number; text: string }> = {
  cut: { label: tr('Sèche'), min: -0.7, max: -0.4, text: tr('Perdre du gras en gardant ton muscle et tes charges.') },
  recomp: { label: tr('Recompo'), min: -0.2, max: 0.1, text: tr('Perdre du gras et prendre du muscle en même temps, poids presque stable.') },
  maintain: { label: tr('Maintien'), min: -0.2, max: 0.2, text: tr('Garder ton poids et progresser en force ou en endurance.') },
  bulk: { label: tr('Prise de masse'), min: 0.1, max: 0.35, text: tr('Prendre du muscle avec le moins de gras possible.') },
};

const ACTIVITY: Record<Activity, { factor: number; label: string; text: string }> = {
  sedentary: { factor: 1.3, label: tr('Assis'), text: tr('Bureau, moins de 5 000 pas') },
  light: { factor: 1.45, label: tr('Un peu actif'), text: tr('5 000 à 8 000 pas') },
  moderate: { factor: 1.6, label: tr('Actif'), text: tr('8 000 à 12 000 pas ou métier debout') },
  active: { factor: 1.75, label: tr('Très actif'), text: tr('Métier physique, plus de 12 000 pas') },
};
export const ACTIVITIES = ACTIVITY;

/** Métabolisme de base, Mifflin-St Jeor. Sans sexe renseigné : moyenne des deux formules. */
export function bmr(weight: number, height: number, age: number, sex?: Sex): number {
  const base = 10 * weight + 6.25 * height - 5 * age;
  return sex === 'male' ? base + 5 : sex === 'female' ? base - 161 : base - 78;
}

/** Les séances ajoutent à l'activité quotidienne : ~5 % par séance hebdomadaire au-delà de 2, plafonné. */
export function tdee(weight: number, height: number, age: number, a: Pick<Athlete, 'sex' | 'activity' | 'days' | 'sport'>): number {
  const training = Math.min(0.24, Math.max(0, a.days - 2) * (isEndurance(a.sport) || a.sport === 'hyrox' || a.sport === 'combat' ? 0.05 : 0.035));
  return bmr(weight, height, age, a.sex) * (ACTIVITY[a.activity].factor + training);
}

export interface Plan {
  maintenance: number;
  targets: Macros;
  /** Kilos par semaine visés. */
  rate: number;
  /** Projection vers le % de masse grasse visé, si on l'a. */
  projection?: { targetWeight: number; weeks: number; leanMass: number };
}

const round = (n: number, step: number) => Math.round(n / step) * step;

/**
 * Calories et macros à partir du profil. Les endurants ont plus de glucides, les sèches plus de protéines.
 * C'est un point de départ : la courbe de poids sur 2 à 3 semaines dit s'il faut ajuster.
 */
export function nutritionPlan(p: { weight: number; height: number; age: number; goal: WeightGoal; athlete: Athlete }): Plan {
  const { weight, goal, athlete } = p;
  const maintenance = tdee(weight, p.height, p.age, athlete);
  const rate = goal === 'cut' ? -Math.min(0.7, Math.max(0.35, weight * 0.0065)) : goal === 'bulk' ? weight * 0.0035 : goal === 'recomp' ? -0.1 : 0;
  // 1 kg de tissu ≈ 7 700 kcal : écart quotidien = rate × 7 700 / 7.
  const delta = goal === 'recomp' ? -maintenance * 0.08 : (rate * 7700) / 7;
  const kcal = round(Math.max(p.athlete.sex === 'female' ? 1300 : 1500, maintenance + delta), 50);

  const endurance = isEndurance(athlete.sport) || athlete.sport === 'hyrox';
  // Protéines rapportées à la masse maigre si on la connaît, sinon au poids.
  const lean = athlete.bodyFat ? weight * (1 - athlete.bodyFat / 100) : undefined;
  const perKg = goal === 'cut' || goal === 'recomp' ? 2.2 : endurance ? 1.7 : 1.9;
  const protein = round(Math.min(lean ? lean * 2.6 : weight * perKg, weight * perKg), 5);
  const fat = round(Math.max(weight * (endurance ? 0.8 : 0.85), (kcal * 0.22) / 9), 5);
  const carbs = round(Math.max(0, (kcal - protein * 4 - fat * 9) / 4), 5);

  const plan: Plan = { maintenance: round(maintenance, 10), targets: { kcal, protein, carbs, fat }, rate: Math.round(rate * 100) / 100 };
  if (athlete.bodyFat && athlete.targetBodyFat && athlete.targetBodyFat < athlete.bodyFat) {
    const leanMass = weight * (1 - athlete.bodyFat / 100);
    // On suppose la masse maigre conservée : c'est le but d'une sèche bien menée.
    const targetWeight = leanMass / (1 - athlete.targetBodyFat / 100);
    const weekly = goal === 'recomp' ? 0.15 : Math.abs(rate) || 0.4;
    plan.projection = {
      targetWeight: Math.round(targetWeight * 10) / 10,
      weeks: Math.max(1, Math.ceil((weight - targetWeight) / weekly)),
      leanMass: Math.round(leanMass * 10) / 10,
    };
  }
  return plan;
}

/** Fourchettes indicatives de masse grasse, pour aider à s'estimer sans balance à impédance. */
export const BODY_FAT_HINTS: Record<Sex, { bf: number; text: string }[]> = {
  male: [
    { bf: 10, text: tr('Abdos bien visibles') },
    { bf: 13, text: tr('Abdos visibles en lumière directe') },
    { bf: 17, text: tr('Contours des abdos, un peu de ventre') },
    { bf: 22, text: tr('Pas d’abdos visibles, ventre doux') },
    { bf: 28, text: tr('Ventre marqué') },
  ],
  female: [
    { bf: 18, text: tr('Abdos visibles') },
    { bf: 22, text: tr('Silhouette athlétique') },
    { bf: 26, text: tr('Silhouette tonique, un peu de ventre') },
    { bf: 31, text: tr('Formes douces') },
    { bf: 36, text: tr('Ventre et hanches marqués') },
  ],
};

export const EVENT_NAMES: Record<EventDistance, string> = {
  '5k': tr('5 km'),
  '10k': tr('10 km'),
  half: tr('Semi-marathon'),
  marathon: tr('Marathon'),
  hyrox: tr('Hyrox'),
  'tri-sprint': tr('Triathlon S'),
  'tri-olympic': tr('Triathlon M (olympique)'),
  'tri-half': tr('Half Ironman (70.3)'),
  'tri-full': tr('Ironman'),
  'swim-1500': tr('1 500 m nage'),
  'swim-5k': tr('5 km en eau libre'),
  'bike-100': tr('Cyclosportive 100 km'),
  'bike-160': tr('Cyclosportive 160 km'),
};

export function sportLabel(a: Athlete): string {
  const dated = a.race?.date ? EVENT_NAMES[a.race.distance] : null;
  if (a.sport === 'running') return a.race?.date ? (dated ?? tr('Course à pied')) : tr('Course à pied');
  if (a.sport === 'swimming') return a.race?.date && a.race.distance.startsWith('swim') ? dated! : tr('Natation');
  if (a.sport === 'cycling') return a.race?.date && a.race.distance.startsWith('bike') ? dated! : tr('Vélo');
  if (a.sport === 'triathlon') return a.race?.date && a.race.distance.startsWith('tri') ? dated! : tr('Triathlon');
  if (a.sport === 'hyrox') return tr('Hyrox');
  if (a.sport === 'mixed') return tr('Muscu et cardio');
  if (a.sport === 'combat') return tr('Sport de combat');
  return tr('Musculation');
}

/** Résumé texte du profil, pour le coach et le bilan. */
export function athleteSummary(a: Athlete, gym: Gym): string {
  const parts = [
    tr('Sport : {sportLabel}{v}', { sportLabel: sportLabel(a), v: a.race?.date ? tr(', objectif le {date}', { date: a.race.date }) : '' }),
    tr('{days} séances par semaine de {minutes} min, niveau {v}', { days: a.days, minutes: a.minutes, v: a.experience === 'beginner' ? tr('débutant') : a.experience === 'advanced' ? tr('avancé') : tr('intermédiaire') }),
    a.bodyFat ? tr('Masse grasse estimée {bodyFat} %{v}', { bodyFat: a.bodyFat, v: a.targetBodyFat ? tr(', visée {n} %', { n: a.targetBodyFat }) : '' }) : '',
    a.physique ? tr('Physique visé : {PHYSIQUE_LABELS}{v}', { PHYSIQUE_LABELS: PHYSIQUE_LABELS[a.physique], v: a.priorities?.length ? tr(', priorités : {list}', { list: a.priorities.join(', ') }) : '' }) : '',
    tr('Salle : {n}{v}, matériel : {join}', { n: GYMS.find((g) => g.id === gym.chain)?.name ?? tr('autre'), v: gym.club ? ` (${gym.club})` : '', join: EQUIPMENT.filter((e) => gym.equipment[e.id]).map((e) => e.name.toLowerCase()).join(', ') }),
    [a.diet.vegetarian && tr('végétarien'), a.diet.noPork && tr('sans porc'), a.diet.lactoseFree && tr('sans lactose')].filter(Boolean).join(', '),
    a.diet.dislikes.trim() ? tr('N’aime pas : {dislikes}', { dislikes: a.diet.dislikes.trim() }) : '',
  ];
  return parts.filter(Boolean).join('. ') + '.';
}
