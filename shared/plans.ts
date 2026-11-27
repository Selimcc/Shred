// Programmes générés : préparation 10 km, semi-marathon, marathon et Hyrox, datés jusqu'au jour de la course,
// et adaptation de n'importe quel programme au matériel de la salle.
import { type Athlete, type Equipment, type Experience, type Gym, has, type RaceDistance } from './athlete';
import type { ExerciseSlot, Program, SessionDef } from './types';
import { list, loc, lower, tn, tr } from './i18n';

/* ---------- Dates ---------- */

export const DAY = 86_400_000;
export const parse = (d: string) => Date.parse(`${d}T12:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => iso(parse(d) + n * DAY);
export const weekday = (d: string) => new Date(parse(d)).getUTCDay();
export const mondayOf = (d: string) => addDays(d, -((weekday(d) + 6) % 7));

/* ---------- Allures ---------- */

export const RACE_KM: Record<RaceDistance, number> = { '5k': 5, '10k': 10, half: 21.0975, marathon: 42.195 };
const RACE_NAME: Record<RaceDistance, string> = { '5k': tr('5 km'), '10k': tr('10 km'), half: 'Semi-marathon', marathon: tr('Marathon') };
export const isRoadRace = (d?: string): d is RaceDistance => d === '5k' || d === '10k' || d === 'half' || d === 'marathon';

/** Prédiction de Riegel : temps sur une autre distance, à partir d'un temps de référence. */
export function riegel(sec: number, fromKm: number, toKm: number): number {
  return sec * Math.pow(toKm / fromKm, 1.06);
}

export function fmtPace(secPerKm: number): string {
  const s = Math.round(secPerKm);
  return tr('{floor}:{padStart}/km', { floor: Math.floor(s / 60), padStart: String(s % 60).padStart(2, '0') });
}

export function fmtDuration(sec: number): string {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
}

export interface Paces {
  easy: [number, number];
  tempo: number;
  interval: number;
  race: number;
  /** Temps prévu sur la course, en secondes. */
  predicted: number;
}

/** Temps de 10 km par défaut selon le niveau, si on n'a pas de chrono récent. */
const DEFAULT_10K: Record<Experience, number> = { beginner: 62 * 60, intermediate: 52 * 60, advanced: 43 * 60 };

export function paces(distance: RaceDistance, experience: Experience, ref?: { sec: number; km: number }): Paces {
  const t10 = ref && ref.sec > 0 && ref.km > 0 ? riegel(ref.sec, ref.km, 10) : DEFAULT_10K[experience];
  const p10 = t10 / 10;
  const predicted = riegel(t10, 10, RACE_KM[distance]);
  return {
    easy: [p10 + 60, p10 + 90],
    tempo: p10 + 12,
    interval: p10 - 12,
    race: predicted / RACE_KM[distance],
    predicted,
  };
}

/* ---------- Plans de course ---------- */

/** Durée conseillée du plan, et sortie longue de départ et de pointe (km). */
const RACE_SPEC: Record<RaceDistance, { weeks: number; longStart: number; longPeak: number; taper: number }> = {
  '5k': { weeks: 6, longStart: 6, longPeak: 10, taper: 1 },
  '10k': { weeks: 8, longStart: 7, longPeak: 13, taper: 1 },
  half: { weeks: 12, longStart: 9, longPeak: 19, taper: 2 },
  marathon: { weeks: 16, longStart: 14, longPeak: 32, taper: 3 },
};

export interface WeekPlan {
  phase: string;
  /** 0 → 1 dans le plan, hors affûtage. */
  progress: number;
  recovery: boolean;
  taper: number;
}

export function weekPlans(n: number, taper: number): WeekPlan[] {
  return Array.from({ length: n }, (_, i) => {
    const taperIdx = i - (n - taper);
    const build = n - taper;
    const progress = Math.min(1, i / Math.max(1, build - 1));
    const phase = taperIdx >= 0 ? tr('Affûtage') : progress < 0.35 ? tr('Fondamental') : progress < 0.75 ? tr('Développement') : tr('Spécifique');
    // Une semaine allégée toutes les 4 semaines, pour assimiler.
    const recovery = taperIdx < 0 && i > 0 && (i + 1) % 4 === 0;
    return { phase, progress, recovery, taper: taperIdx >= 0 ? taperIdx + 1 : 0 };
  });
}

const RENFO: SessionDef = {
  id: 'run-strength',
  name: tr('Renfo coureur'),
  focus: tr('Jambes, hanches et gainage : protège tes genoux et tes tendons'),
  type: 'lifting',
  exercises: [
    { key: 'squat', sets: 3, reps: '6–8' },
    { key: 'rdl', sets: 3, reps: '8–10' },
    { key: 'bulgarian', sets: 2, reps: '8–10' },
    { key: 'standing-calf', sets: 3, reps: '12–15' },
    { key: 'side-plank', sets: 2, reps: '30–45 s' },
  ],
};

const REST: SessionDef = {
  id: 'rest',
  name: tr('Repos actif'),
  focus: tr('Marche et mobilité'),
  type: 'rest',
  exercises: [{ key: 'walk' }, { key: 'mobility' }],
};

/**
 * Jours de course dans la semaine (index Date.getDay()) : la séance de qualité le mardi,
 * la sortie longue le dimanche, le reste en endurance.
 */
function runDays(n: number): { quality: number; long: number; easy: number[]; strength: number[] } {
  const plans: Record<number, { quality: number; long: number; easy: number[]; strength: number[] }> = {
    3: { quality: 2, long: 0, easy: [4], strength: [] },
    4: { quality: 2, long: 0, easy: [4], strength: [6] },
    5: { quality: 2, long: 0, easy: [4, 6], strength: [3] },
    6: { quality: 2, long: 0, easy: [1, 4, 6], strength: [3] },
  };
  return plans[Math.max(3, Math.min(6, n))];
}

export interface RaceInput {
  distance: RaceDistance;
  date: string;
  athlete: Pick<Athlete, 'experience' | 'days'>;
  ref?: { sec: number; km: number };
  today: string;
}

export function runningPlan(input: RaceInput): Program {
  const { distance, date, athlete, today } = input;
  const spec = RACE_SPEC[distance];
  const p = paces(distance, athlete.experience, input.ref);
  const raceMonday = mondayOf(date);
  const available = Math.floor((parse(raceMonday) - parse(mondayOf(today))) / (7 * DAY)) + 1;
  const n = Math.max(Math.min(6, available), Math.min(spec.weeks, available));
  const start = addDays(raceMonday, -(n - 1) * 7);
  const days = runDays(athlete.days);
  const beginner = athlete.experience === 'beginner';
  const easyText = tr('{replace} à {pace}', { replace: fmtPace(p.easy[0]).replace('/km', ''), pace: fmtPace(p.easy[1]) });
  const sessions: SessionDef[] = [RENFO, REST];
  const weeks: string[][] = [];
  const phases: string[] = [];

  const add = (def: SessionDef) => {
    sessions.push({ ...def, generated: true });
    return def.id;
  };

  weekPlans(n, spec.taper).forEach((w, i) => {
    const k = `w${i + 1}`;
    const scale = w.recovery ? 0.75 : 1;
    // Sortie longue : progression linéaire, allégée en semaine de récupération et pendant l'affûtage.
    let longKm = spec.longStart + (spec.longPeak - spec.longStart) * w.progress;
    if (w.taper) longKm = spec.longPeak * (w.taper === spec.taper ? 0.4 : 0.65 - 0.1 * (w.taper - 1));
    longKm = Math.max(5, Math.round(longKm * scale));
    if (beginner) longKm = Math.max(5, Math.round(longKm * 0.85));

    const easyMin = Math.round((30 + 20 * w.progress) * scale * (w.taper ? 0.7 : 1) / 5) * 5;
    const isRaceWeek = i === n - 1;

    // Séance de qualité : fractionné les semaines impaires, seuil ou allure course les paires.
    let quality: SessionDef;
    if (w.taper) {
      quality = {
        id: `${k}-q`,
        name: tr('Rappel d’allure'),
        focus: tr('Garder les sensations, {pace}', { pace: fmtPace(p.race) }),
        type: 'cardio',
        exercises: [{ key: 'run-race', sets: isRaceWeek ? 2 : 3, reps: isRaceWeek ? tr('1 km') : tr('2 km'), rest: 120, note: tr('Allure course : {pace}. Échauffement 15 min.', { pace: fmtPace(p.race) }) }],
      };
    } else if (i % 2 === 0) {
      const reps = w.progress < 0.35 ? { sets: 8, reps: '400 m' } : w.progress < 0.75 ? { sets: 6, reps: '800 m' } : { sets: 5, reps: '1000 m' };
      quality = {
        id: `${k}-q`,
        name: tr('Fractionné'),
        focus: tr('{sets} × {reps} à {pace}', { sets: reps.sets, reps: reps.reps, pace: fmtPace(p.interval) }),
        type: 'cardio',
        exercises: [
          { key: 'run-intervals', sets: Math.round(reps.sets * scale), reps: reps.reps, rest: 90, note: tr('Allure : {pace}. 15 min d’échauffement, 10 min de retour au calme.', { pace: fmtPace(p.interval) }) },
        ],
      };
    } else if (w.progress >= 0.5 && distance !== '10k' && distance !== '5k') {
      const blocks = distance === 'marathon' ? { sets: 2, reps: `${Math.round(4 + 4 * w.progress)} km` } : { sets: 3, reps: `${w.progress > 0.8 ? 3 : 2} km` };
      quality = {
        id: `${k}-q`,
        name: tr('Allure course'),
        focus: tr('{sets} × {reps} à {pace}', { sets: blocks.sets, reps: blocks.reps, pace: fmtPace(p.race) }),
        type: 'cardio',
        exercises: [{ key: 'run-race', sets: blocks.sets, reps: blocks.reps, rest: 120, note: tr('Allure : {pace}. Récupération 2 min en trottinant.', { pace: fmtPace(p.race) }) }],
      };
    } else {
      const min = Math.round((15 + 15 * w.progress) * scale);
      quality = {
        id: `${k}-q`,
        name: tr('Seuil'),
        focus: tr('{min} min à {pace}', { min, pace: fmtPace(p.tempo) }),
        type: 'cardio',
        exercises: [{ key: 'run-tempo', sets: 1, reps: `${min} min`, note: tr('Allure : {pace}. 15 min d’échauffement, 10 min de retour au calme.', { pace: fmtPace(p.tempo) }) }],
      };
    }

    const long: SessionDef = isRaceWeek
      ? {
          id: `${k}-race`,
          name: RACE_NAME[distance],
          focus: tr('Objectif : {duration}, {pace}', { duration: fmtDuration(p.predicted), pace: fmtPace(p.race) }),
          type: 'cardio',
          exercises: [{ key: 'race-day', note: tr('Pars à {pace} les premiers kilomètres, puis {pace2}. Mange ton dernier repas 3 h avant.', { pace: fmtPace(p.race + 5), pace2: fmtPace(p.race) }) }],
        }
      : {
          id: `${k}-long`,
          name: tr('Sortie longue'),
          focus: tr('{longKm} km en endurance, environ {duration}', { longKm, duration: fmtDuration(longKm * (p.easy[0] + p.easy[1]) / 2) }),
          type: 'cardio',
          exercises: [
            {
              key: 'run-long',
              sets: 1,
              reps: `${longKm} km`,
              note:
                distance === 'marathon' && w.progress > 0.6 && !w.taper
                  ? tr('Endurance à {easyText}, dont les {n} derniers km à {pace}. Teste ton ravitaillement.', { easyText, n: Math.round(longKm / 3), pace: fmtPace(p.race) })
                  : tr('Allure : {easyText}.', { easyText }),
            },
          ],
        };

    const easy: SessionDef = {
      id: `${k}-easy`,
      name: tr('Footing'),
      focus: tr('{easyMin} min à {easyText}', { easyMin, easyText }),
      type: 'cardio',
      exercises: [
        { key: 'run-easy', sets: 1, reps: `${easyMin} min`, note: tr('Allure : {easyText}.', { easyText }) },
        ...(w.progress > 0.2 && !w.taper ? [{ key: 'strides', sets: 6, reps: '80 m', rest: 60 } as ExerciseSlot] : []),
      ],
    };

    const week = Array(7).fill('rest');
    week[days.quality] = add(quality);
    const raceDay = isRaceWeek ? weekday(date) : days.long;
    week[raceDay] = add(long);
    const easyId = add(easy);
    for (const dIdx of days.easy) if (dIdx !== raceDay) week[dIdx] = easyId;
    if (!w.taper) for (const dIdx of days.strength) if (dIdx !== raceDay) week[dIdx] = RENFO.id;
    // Semaine de course : rien de dur les deux jours d'avant.
    if (isRaceWeek) {
      for (const before of [1, 2]) {
        const dIdx = (raceDay + 7 - before) % 7;
        if (week[dIdx] !== week[raceDay] && week[dIdx] !== 'rest' && before === 1) week[dIdx] = 'rest';
      }
    }
    weeks.push(week);
    phases.push(w.recovery ? tr('{phase}, semaine allégée', { phase: w.phase }) : w.phase);
  });

  const easyBase = add({
    id: 'base-easy',
    name: tr('Footing'),
    focus: tr('40 min à {easyText}', { easyText }),
    type: 'cardio',
    exercises: [{ key: 'run-easy', sets: 1, reps: tr('40 min'), note: tr('Allure : {easyText}.', { easyText }) }],
  });
  // Avant le début du plan et après la course : 3 footings et un renfo.
  const schedule = ['rest', 'rest', easyBase, RENFO.id, easyBase, 'rest', easyBase];

  return {
    name: tr('{RACE_NAME} du {toLocaleDateString}', { RACE_NAME: RACE_NAME[distance], toLocaleDateString: new Date(parse(date)).toLocaleDateString(loc(), { day: 'numeric', month: 'long' }) }),
    template: `run-${distance}`,
    sessions,
    schedule,
    start,
    weeks,
    phases,
    event: { name: RACE_NAME[distance], date },
  };
}

/* ---------- Hyrox ---------- */

/**
 * Une séance Hyrox par phase : les répétitions montent, les stations s'enchaînent de plus en plus.
 * Avec une date, le plan va jusqu'à la course (affûtage compris). Sans date, c'est un bloc de 8 semaines
 * (semaines 4 et 8 allégées, une simulation en semaine 7) que Pulse renouvelle, un cran plus fort.
 */
export function hyroxPlan(input: { date?: string; athlete: Pick<Athlete, 'experience' | 'days'>; ref?: { sec: number; km: number }; today: string; block?: number }): Program {
  const { date, athlete, today } = input;
  const p = paces('10k', athlete.experience, input.ref);
  const block = Math.max(1, input.block ?? 1);
  let n = 8;
  let start = mondayOf(today);
  if (date) {
    const raceMonday = mondayOf(date);
    const available = Math.floor((parse(raceMonday) - parse(mondayOf(today))) / (7 * DAY)) + 1;
    n = Math.max(Math.min(6, available), Math.min(12, available));
    start = addDays(raceMonday, -(n - 1) * 7);
  }
  const plans = weekPlans(n, 0);
  const runPace = fmtPace(p.tempo + 10);
  const easyText = tr('{replace} à {pace}', { replace: fmtPace(p.easy[0]).replace('/km', ''), pace: fmtPace(p.easy[1]) });
  const sessions: SessionDef[] = [REST];
  const add = (def: SessionDef) => {
    sessions.push({ ...def, generated: true });
    return def.id;
  };
  type Phase = 'base' | 'build' | 'peak' | 'taper' | 'recovery';
  const phaseOf = (i: number): Phase => {
    if (date) return i >= n - 1 ? 'taper' : i >= n * 0.66 ? 'peak' : i >= n * 0.33 ? 'build' : 'base';
    const w = plans[i];
    return w.recovery ? 'recovery' : w.progress < 0.35 ? 'base' : w.progress < 0.75 ? 'build' : 'peak';
  };
  // Bloc suivant : un peu plus de volume à chaque fois (plafonné).
  const boost = date ? 1 : Math.min(1.3, 1 + 0.06 * (block - 1));
  const vol: Record<Phase, number> = { base: boost, build: 1.25 * boost, peak: 1.4 * boost, taper: 0.6, recovery: 0.7 };
  const ids = new Map<string, string>();
  const once = (key: string, def: () => SessionDef) => {
    if (!ids.has(key)) ids.set(key, add(def()));
    return ids.get(key)!;
  };

  const weeks: string[][] = [];
  const phases: string[] = [];
  for (let i = 0; i < n; i++) {
    const ph = phaseOf(i);
    const v = vol[ph];
    const lower = once(`lower-${ph}`, () => ({
      id: `hx-lower-${ph}`,
      name: tr('Force bas du corps et traîneau'),
      focus: tr('Squat, soulevé de terre, sled push et pull'),
      type: 'lifting',
      exercises: [
        { key: 'squat', sets: ph === 'recovery' ? 3 : 4, reps: ph === 'base' || ph === 'recovery' ? '6–8' : '4–6' },
        { key: 'rdl', sets: 3, reps: '6–8' },
        { key: 'sled-push', sets: Math.round(4 * v), reps: '25 m', rest: 90 },
        { key: 'sled-pull', sets: Math.round(4 * v), reps: '25 m', rest: 90 },
        { key: 'sandbag-lunge', sets: 3, reps: '20 m', rest: 90 },
      ],
    }));
    const upper = once(`upper-${ph}`, () => ({
      id: `hx-upper-${ph}`,
      name: tr('Force haut du corps et ergos'),
      focus: tr('Tirage, poussée, SkiErg, rameur, wall balls'),
      type: 'lifting',
      exercises: [
        { key: 'pullup', sets: 4, reps: '6–10' },
        { key: 'db-bench', sets: 3, reps: '8–10' },
        { key: 'ski-erg', sets: Math.round(4 * v), reps: '500 m', rest: 90 },
        { key: 'rowing-erg', sets: Math.round(3 * v), reps: '500 m', rest: 90 },
        { key: 'wall-ball', sets: ph === 'recovery' ? 3 : 4, reps: ph === 'base' || ph === 'recovery' ? '15' : '25', rest: 75 },
        { key: 'farmer-walk', sets: 3, reps: '50 m', rest: 75 },
      ],
    }));
    const run = once(`run-${ph}`, () => ({
      id: `hx-run-${ph}`,
      name: tr('Course fractionnée'),
      focus: tr('Kilomètres à l’allure Hyrox, {runPace}', { runPace }),
      type: 'cardio',
      exercises: [{ key: 'run-intervals', sets: Math.round(5 * v), reps: tr('1 km'), rest: 90, note: tr('Allure : {runPace}. C’est l’allure à tenir entre les stations.', { runPace }) }],
    }));
    const compromised = once(`comp-${ph}`, () => ({
      id: `hx-comp-${ph}`,
      name: ph === 'peak' ? tr('Simulation Hyrox') : tr('Course et stations enchaînées'),
      focus: ph === 'peak' ? tr('La moitié de la course, sans pause') : tr('1 km de course, une station, et on recommence'),
      type: 'cardio',
      exercises:
        ph === 'peak'
          ? [{ key: 'hyrox-sim', note: tr('4 × (1 km + station) : SkiErg 1000 m, sled push 50 m, sled pull 50 m, burpees 80 m. Note ton temps.') }]
          : [
              { key: 'run-intervals', sets: Math.round(4 * v), reps: tr('1 km'), rest: 0, note: tr('Allure {runPace}, enchaîne directement la station.', { runPace }) },
              { key: 'burpee-broad-jump', sets: Math.round(4 * v), reps: '20 m', rest: 0 },
              { key: 'wall-ball', sets: Math.round(4 * v), reps: '20', rest: 60 },
            ],
    }));
    const long = once(`long-${ph}`, () => ({
      id: `hx-long-${ph}`,
      name: tr('Footing long'),
      focus: tr('{v} min en endurance', { v: ph === 'taper' ? 30 : Math.round((40 + 15 * v) / 5) * 5 }),
      type: 'cardio',
      exercises: [{ key: 'run-easy', sets: 1, reps: `${ph === 'taper' ? 30 : Math.round((40 + 15 * v) / 5) * 5} min`, note: tr('Allure : {easyText}.', { easyText }) }],
    }));

    const week = Array(7).fill('rest');
    const d = Math.max(3, Math.min(5, athlete.days));
    week[1] = lower;
    week[3] = run;
    week[5] = upper;
    if (d >= 4) week[6] = compromised;
    if (d >= 5) week[0] = long;
    if (date && i === n - 1) {
      week[weekday(date)] = add({
        id: 'hx-race',
        name: tr('Hyrox'),
        focus: tr('8 × 1 km et 8 stations'),
        type: 'cardio',
        exercises: [{ key: 'race-day', note: tr('Pars à {runPace} sur les premiers kilomètres. Respire avant chaque station plutôt que de t’y précipiter.', { runPace }) }],
      });
      for (const before of [1, 2]) week[(weekday(date) + 7 - before) % 7] = 'rest';
    }
    weeks.push(week);
    if (date) phases.push({ base: tr('Fondamental'), build: tr('Développement'), peak: tr('Spécifique'), taper: tr('Affûtage'), recovery: tr('Fondamental') }[ph]);
    else {
      const phase = plans[i].phase === tr('Spécifique') ? tr('Intensification') : plans[i].phase;
      phases.push(plans[i].recovery ? tr('{phase}, semaine allégée', { phase }) : phase);
    }
  }

  if (!date) {
    return {
      name: tr('Bloc Hyrox{v}, {n} semaines', { v: block > 1 ? ` ${block}` : '', n }),
      template: 'hyrox',
      sessions,
      // Avant et après le bloc : une semaine type de développement.
      schedule: weeks[4],
      start,
      weeks,
      phases,
    };
  }
  return {
    name: tr('Hyrox du {toLocaleDateString}', { toLocaleDateString: new Date(parse(date)).toLocaleDateString(loc(), { day: 'numeric', month: 'long' }) }),
    template: 'hyrox',
    sessions,
    schedule: ['rest', ids.get('lower-base')!, 'rest', ids.get('run-base')!, 'rest', ids.get('upper-base')!, 'rest'],
    start,
    weeks,
    phases,
    event: { name: tr('Hyrox'), date },
  };
}

/* ---------- Adaptation au matériel ---------- */

/** Matériel nécessaire (l'un ou l'autre suffit). Absent de la liste : rien de spécial. */
const NEEDS: Record<string, Equipment[]> = {
  bench: ['barbell'], 'barbell-row': ['barbell'], 't-bar-row': ['barbell', 'machines'], 'military-press': ['barbell'], 'barbell-curl': ['barbell'],
  skullcrusher: ['barbell', 'dumbbells'], 'close-grip-bench': ['barbell'], 'arms-superset': ['barbell'], squat: ['barbell'], 'front-squat': ['barbell'],
  deadlift: ['barbell'], 'sumo-deadlift': ['barbell'], rdl: ['barbell', 'dumbbells'], 'good-morning': ['barbell'], 'hip-thrust': ['barbell', 'dumbbells'],
  'machine-chest-press': ['machines'], 'pec-deck': ['machines'], 'smith-squat': ['machines'], 'leg-press': ['machines'], 'hack-squat': ['machines'],
  'leg-extension': ['machines'], 'leg-curl': ['machines'], 'seated-leg-curl': ['machines'], 'hip-abduction': ['machines'], 'machine-shoulder-press': ['machines'], 'seated-calf': ['machines'],
  'standing-calf': ['machines', 'dumbbells'], 'low-high-fly': ['cables'], 'cable-fly': ['cables'], 'seated-cable-row': ['cables'], 'neutral-pulldown': ['cables', 'machines'],
  'wide-pulldown': ['cables', 'machines'], 'straight-arm-pulldown': ['cables'], 'cable-lateral-raise': ['cables'], 'rear-delt': ['cables', 'machines'], 'face-pull': ['cables'],
  'cable-curl': ['cables'], 'rope-pushdown': ['cables'], 'cable-crunch': ['cables'], pallof: ['cables'], 'incline-db-press': ['dumbbells'], 'db-bench': ['dumbbells'],
  'db-row': ['dumbbells'], shrug: ['dumbbells', 'barbell'], 'db-shoulder-press': ['dumbbells'], 'arnold-press': ['dumbbells'], 'db-lateral-raise': ['dumbbells'],
  'incline-curl': ['dumbbells'], 'hammer-curl': ['dumbbells'], 'preacher-curl': ['dumbbells', 'machines'], 'overhead-triceps': ['dumbbells', 'cables'],
  'goblet-squat': ['dumbbells', 'kettlebell'], bulgarian: ['dumbbells'], lunge: ['dumbbells'], 'walking-lunge': ['dumbbells'], 'farmer-walk': ['dumbbells', 'kettlebell'],
  pullup: ['pullup'], 'chin-up': ['pullup'], 'hanging-leg-raise': ['pullup'], dips: ['pullup'], 'rowing-erg': ['rower'], bike: ['bike'], intervals: ['bike', 'rower'],
  'kettlebell-swing': ['kettlebell'], 'ski-erg': ['skierg'], 'sled-push': ['sled'], 'sled-pull': ['sled'], 'wall-ball': ['wallball'], 'sandbag-lunge': ['sandbag', 'dumbbells'],
  'bag-rounds': ['heavybag'], 'med-ball-slam': ['wallball'],
};

/** Remplaçants dans l'ordre de préférence. Le dernier ne demande presque rien. */
const SWAPS: Record<string, string[]> = {
  bench: ['db-bench', 'machine-chest-press', 'pushup'], 'barbell-row': ['db-row', 'seated-cable-row'], 't-bar-row': ['db-row', 'seated-cable-row'],
  'military-press': ['db-shoulder-press', 'machine-shoulder-press', 'pushup'], 'barbell-curl': ['hammer-curl', 'cable-curl'], skullcrusher: ['overhead-triceps', 'rope-pushdown', 'dips'],
  'close-grip-bench': ['dips', 'pushup'], 'arms-superset': ['hammer-curl', 'cable-curl'], squat: ['smith-squat', 'hack-squat', 'leg-press', 'goblet-squat', 'bulgarian'],
  'front-squat': ['goblet-squat', 'hack-squat', 'bulgarian'], deadlift: ['rdl', 'hip-thrust', 'bulgarian'], 'sumo-deadlift': ['rdl', 'hip-thrust'], rdl: ['hip-thrust', 'bulgarian'],
  'good-morning': ['rdl', 'hip-thrust'], 'hip-thrust': ['bulgarian', 'lunge'], 'machine-chest-press': ['db-bench', 'bench', 'pushup'], 'pec-deck': ['cable-fly', 'db-bench', 'pushup'],
  'smith-squat': ['squat', 'goblet-squat', 'bulgarian'], 'leg-press': ['hack-squat', 'squat', 'goblet-squat', 'bulgarian'], 'hack-squat': ['leg-press', 'squat', 'goblet-squat', 'bulgarian'],
  'leg-extension': ['bulgarian', 'goblet-squat', 'lunge'], 'leg-curl': ['seated-leg-curl', 'rdl', 'hip-thrust'], 'seated-leg-curl': ['leg-curl', 'rdl', 'hip-thrust'], 'hip-abduction': ['lunge', 'side-plank'], 'machine-shoulder-press': ['db-shoulder-press', 'military-press', 'pushup'],
  'seated-calf': ['standing-calf'], 'standing-calf': [], 'low-high-fly': ['cable-fly', 'incline-db-press', 'pushup'], 'cable-fly': ['pec-deck', 'db-bench', 'pushup'],
  'seated-cable-row': ['db-row', 'barbell-row'], 'neutral-pulldown': ['pullup', 'chin-up', 'db-row'], 'wide-pulldown': ['pullup', 'db-row'], 'straight-arm-pulldown': ['pullup', 'db-row'],
  'cable-lateral-raise': ['db-lateral-raise'], 'rear-delt': ['face-pull', 'db-row'], 'face-pull': ['rear-delt', 'db-lateral-raise'], 'cable-curl': ['hammer-curl', 'barbell-curl'],
  'rope-pushdown': ['overhead-triceps', 'dips', 'pushup'], 'cable-crunch': ['crunch'], pallof: ['side-plank'], 'incline-db-press': ['bench', 'machine-chest-press', 'pushup'],
  'db-bench': ['bench', 'machine-chest-press', 'pushup'], 'db-row': ['seated-cable-row', 'barbell-row'], shrug: ['farmer-walk'], 'db-shoulder-press': ['machine-shoulder-press', 'military-press', 'pushup'],
  'arnold-press': ['db-shoulder-press', 'machine-shoulder-press'], 'db-lateral-raise': ['cable-lateral-raise'], 'incline-curl': ['cable-curl', 'barbell-curl'], 'hammer-curl': ['cable-curl', 'barbell-curl'],
  'preacher-curl': ['cable-curl', 'barbell-curl'], 'overhead-triceps': ['rope-pushdown', 'dips', 'pushup'], 'goblet-squat': ['squat', 'leg-press', 'bulgarian'], bulgarian: ['leg-press', 'squat'],
  lunge: ['leg-press', 'squat'], 'walking-lunge': ['lunge', 'leg-press'], 'farmer-walk': ['plank'], pullup: ['neutral-pulldown', 'wide-pulldown', 'db-row'], 'chin-up': ['neutral-pulldown', 'db-row'],
  'hanging-leg-raise': ['crunch'], dips: ['close-grip-bench', 'pushup'], 'rowing-erg': ['bike', 'running'], bike: ['rowing-erg', 'running'], intervals: ['running', 'mountain-climber'],
  'kettlebell-swing': ['rdl', 'hip-thrust'], 'ski-erg': ['rowing-erg', 'mountain-climber'], 'sled-push': ['walking-lunge', 'leg-press', 'bulgarian'], 'sled-pull': ['seated-cable-row', 'db-row', 'barbell-row'],
  'wall-ball': ['goblet-squat', 'squat'], 'sandbag-lunge': ['walking-lunge', 'lunge'],
  'bag-rounds': ['shadow-boxing'], 'med-ball-slam': ['kettlebell-swing', 'burpee-broad-jump'],
};

const EQUIP_NAME: Partial<Record<Equipment, string>> = {
  barbell: tr('barre'), machines: tr('machine'), cables: tr('poulie'), dumbbells: tr('haltères'), pullup: tr('barre de traction'), rower: tr('rameur'), bike: tr('vélo'),
  kettlebell: tr('kettlebell'), skierg: 'SkiErg', sled: tr('traîneau'), wallball: tr('médecine-ball'), sandbag: tr('sandbag'), heavybag: tr('sac de frappe'),
};

/** Remplaçants conseillés d'un exercice, dans l'ordre. */
export const swapsFor = (key: string): string[] => SWAPS[key] ?? [];

export function usable(key: string, gym: Gym): boolean {
  const need = NEEDS[key];
  return !need || need.some((e) => has(gym, e));
}

/** Le meilleur remplaçant disponible, ou null si l'exercice est faisable tel quel. */
export function substitute(key: string, gym: Gym): string | null {
  if (usable(key, gym)) return null;
  return (SWAPS[key] ?? []).find((k) => usable(k, gym)) ?? 'plank';
}

export interface Adaptation {
  program: Program;
  swaps: { session: string; from: string; to: string; missing: string }[];
}

/** Remplace dans tout le programme les exercices impossibles dans cette salle. */
export function adaptToGym(program: Program, gym: Gym, names: (key: string) => string = (k) => k): Adaptation {
  const swaps: Adaptation['swaps'] = [];
  const sessions = program.sessions.map((def) => {
    const seen = new Set<string>();
    const exercises: ExerciseSlot[] = [];
    for (const slot of def.exercises) {
      const to = substitute(slot.key, gym);
      if (!to) {
        exercises.push(slot);
        seen.add(slot.key);
        continue;
      }
      // Deux exercices remplacés par le même : on garde un seul bloc, avec le plus de séries.
      if (seen.has(to)) continue;
      const missing = list((NEEDS[slot.key] ?? []).map((e) => EQUIP_NAME[e] ?? e), 'disjunction');
      // Un plan semaine par semaine répète les mêmes exercices : chaque remplacement n'est compté qu'une fois.
      if (!swaps.some((x) => x.from === names(slot.key) && x.to === names(to))) swaps.push({ session: def.name, from: names(slot.key), to: names(to), missing });
      exercises.push({ ...slot, key: to, note: tr('Remplace {names} (pas de {missing} dans ta salle).{v}', { names: lower(names(slot.key)), missing, v: slot.note ? ` ${slot.note}` : '' }) });
      seen.add(to);
    }
    return { ...def, exercises };
  });
  return { program: { ...program, sessions }, swaps };
}

/** Le matériel qui manque pour faire un programme tel quel. */
export function missingEquipment(program: Program, gym: Gym): Equipment[] {
  const out = new Set<Equipment>();
  for (const def of program.sessions) for (const slot of def.exercises) if (!usable(slot.key, gym)) for (const e of NEEDS[slot.key] ?? []) out.add(e);
  return [...out];
}

export function planSummary(program: Program, today: string): string | null {
  if (!program.start || !program.weeks) return null;
  const d = Math.floor((parse(today) - parse(program.start)) / DAY);
  if (!program.event) {
    // Bloc de progression sans course : la semaine et la phase, puis l'invitation à enchaîner.
    if (d < 0) return null;
    const w = Math.floor(d / 7);
    if (w >= program.weeks.length) return tr('Bloc de {length} semaines terminé. Lance le suivant depuis Programme pour continuer à progresser.', { length: program.weeks.length });
    return tr('Semaine {n} sur {length} du bloc{v}.', { n: w + 1, length: program.weeks.length, v: program.phases?.[w] ? `, ${lower(program.phases[w])}` : '' });
  }
  const days = Math.round((parse(program.event.date) - parse(today)) / DAY);
  if (d < 0) return tr('{name} : le plan commence le {toLocaleDateString}', { name: program.event.name, toLocaleDateString: new Date(parse(program.start)).toLocaleDateString(loc(), { day: 'numeric', month: 'long' }) });
  const w = Math.floor(d / 7);
  if (w >= program.weeks.length) return tr('{name} terminé. Semaine type en attendant le prochain objectif.', { name: program.event.name });
  return tr('Semaine {n} sur {length}{v}. {v2}.', { n: w + 1, length: program.weeks.length, v: program.phases?.[w] ? `, ${lower(program.phases[w])}` : '', v2: days > 0 ? tn(days, 'J-{n}', 'J-{n}') : tr('C’est le jour J') });
}
