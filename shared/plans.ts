// Programmes générés : préparation 10 km, semi-marathon, marathon et Hyrox, datés jusqu'au jour de la course,
// et adaptation de n'importe quel programme au matériel de la salle.
import { type Athlete, type Equipment, type Experience, type Gym, has, type RaceDistance } from './athlete';
import type { ExerciseSlot, Program, SessionDef } from './types';

/* ---------- Dates ---------- */

const DAY = 86_400_000;
const parse = (d: string) => Date.parse(`${d}T12:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => iso(parse(d) + n * DAY);
const weekday = (d: string) => new Date(parse(d)).getUTCDay();
export const mondayOf = (d: string) => addDays(d, -((weekday(d) + 6) % 7));

/* ---------- Allures ---------- */

export const RACE_KM: Record<RaceDistance, number> = { '10k': 10, half: 21.0975, marathon: 42.195 };
const RACE_NAME: Record<RaceDistance, string> = { '10k': '10 km', half: 'Semi-marathon', marathon: 'Marathon' };

/** Prédiction de Riegel : temps sur une autre distance, à partir d'un temps de référence. */
export function riegel(sec: number, fromKm: number, toKm: number): number {
  return sec * Math.pow(toKm / fromKm, 1.06);
}

export function fmtPace(secPerKm: number): string {
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}/km`;
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
  '10k': { weeks: 8, longStart: 7, longPeak: 13, taper: 1 },
  half: { weeks: 12, longStart: 9, longPeak: 19, taper: 2 },
  marathon: { weeks: 16, longStart: 14, longPeak: 32, taper: 3 },
};

interface WeekPlan {
  phase: string;
  /** 0 → 1 dans le plan, hors affûtage. */
  progress: number;
  recovery: boolean;
  taper: number;
}

function weekPlans(n: number, taper: number): WeekPlan[] {
  return Array.from({ length: n }, (_, i) => {
    const taperIdx = i - (n - taper);
    const build = n - taper;
    const progress = Math.min(1, i / Math.max(1, build - 1));
    const phase = taperIdx >= 0 ? 'Affûtage' : progress < 0.35 ? 'Fondamental' : progress < 0.75 ? 'Développement' : 'Spécifique';
    // Une semaine allégée toutes les 4 semaines, pour assimiler.
    const recovery = taperIdx < 0 && i > 0 && (i + 1) % 4 === 0;
    return { phase, progress, recovery, taper: taperIdx >= 0 ? taperIdx + 1 : 0 };
  });
}

const RENFO: SessionDef = {
  id: 'run-strength',
  name: 'Renfo coureur',
  focus: 'Jambes, hanches et gainage : protège tes genoux et tes tendons',
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
  name: 'Repos actif',
  focus: 'Marche et mobilité',
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
  const easyText = `${fmtPace(p.easy[0]).replace('/km', '')} à ${fmtPace(p.easy[1])}`;
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
        name: 'Rappel d’allure',
        focus: `Garder les sensations, ${fmtPace(p.race)}`,
        type: 'cardio',
        exercises: [{ key: 'run-race', sets: isRaceWeek ? 2 : 3, reps: isRaceWeek ? '1 km' : '2 km', rest: 120, note: `Allure course : ${fmtPace(p.race)}. Échauffement 15 min.` }],
      };
    } else if (i % 2 === 0) {
      const reps = w.progress < 0.35 ? { sets: 8, reps: '400 m' } : w.progress < 0.75 ? { sets: 6, reps: '800 m' } : { sets: 5, reps: '1000 m' };
      quality = {
        id: `${k}-q`,
        name: 'Fractionné',
        focus: `${reps.sets} × ${reps.reps} à ${fmtPace(p.interval)}`,
        type: 'cardio',
        exercises: [
          { key: 'run-intervals', sets: Math.round(reps.sets * scale), reps: reps.reps, rest: 90, note: `Allure : ${fmtPace(p.interval)}. 15 min d’échauffement, 10 min de retour au calme.` },
        ],
      };
    } else if (w.progress >= 0.5 && distance !== '10k') {
      const blocks = distance === 'marathon' ? { sets: 2, reps: `${Math.round(4 + 4 * w.progress)} km` } : { sets: 3, reps: `${w.progress > 0.8 ? 3 : 2} km` };
      quality = {
        id: `${k}-q`,
        name: 'Allure course',
        focus: `${blocks.sets} × ${blocks.reps} à ${fmtPace(p.race)}`,
        type: 'cardio',
        exercises: [{ key: 'run-race', sets: blocks.sets, reps: blocks.reps, rest: 120, note: `Allure : ${fmtPace(p.race)}. Récupération 2 min en trottinant.` }],
      };
    } else {
      const min = Math.round((15 + 15 * w.progress) * scale);
      quality = {
        id: `${k}-q`,
        name: 'Seuil',
        focus: `${min} min à ${fmtPace(p.tempo)}`,
        type: 'cardio',
        exercises: [{ key: 'run-tempo', sets: 1, reps: `${min} min`, note: `Allure : ${fmtPace(p.tempo)}. 15 min d’échauffement, 10 min de retour au calme.` }],
      };
    }

    const long: SessionDef = isRaceWeek
      ? {
          id: `${k}-race`,
          name: RACE_NAME[distance],
          focus: `Objectif : ${fmtDuration(p.predicted)}, ${fmtPace(p.race)}`,
          type: 'cardio',
          exercises: [{ key: 'race-day', note: `Pars à ${fmtPace(p.race + 5)} les premiers kilomètres, puis ${fmtPace(p.race)}. Mange ton dernier repas 3 h avant.` }],
        }
      : {
          id: `${k}-long`,
          name: 'Sortie longue',
          focus: `${longKm} km en endurance, environ ${fmtDuration(longKm * (p.easy[0] + p.easy[1]) / 2)}`,
          type: 'cardio',
          exercises: [
            {
              key: 'run-long',
              sets: 1,
              reps: `${longKm} km`,
              note:
                distance === 'marathon' && w.progress > 0.6 && !w.taper
                  ? `Endurance à ${easyText}, dont les ${Math.round(longKm / 3)} derniers km à ${fmtPace(p.race)}. Teste ton ravitaillement.`
                  : `Allure : ${easyText}.`,
            },
          ],
        };

    const easy: SessionDef = {
      id: `${k}-easy`,
      name: 'Footing',
      focus: `${easyMin} min à ${easyText}`,
      type: 'cardio',
      exercises: [
        { key: 'run-easy', sets: 1, reps: `${easyMin} min`, note: `Allure : ${easyText}.` },
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
    phases.push(w.recovery ? `${w.phase}, semaine allégée` : w.phase);
  });

  const easyBase = add({
    id: 'base-easy',
    name: 'Footing',
    focus: `40 min à ${easyText}`,
    type: 'cardio',
    exercises: [{ key: 'run-easy', sets: 1, reps: '40 min', note: `Allure : ${easyText}.` }],
  });
  // Avant le début du plan et après la course : 3 footings et un renfo.
  const schedule = ['rest', 'rest', easyBase, RENFO.id, easyBase, 'rest', easyBase];

  return {
    name: `${RACE_NAME[distance]} du ${new Date(parse(date)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`,
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

/** Une séance Hyrox par phase : les répétitions montent, les stations s'enchaînent de plus en plus. */
export function hyroxPlan(input: { date: string; athlete: Pick<Athlete, 'experience' | 'days'>; ref?: { sec: number; km: number }; today: string }): Program {
  const { date, athlete, today } = input;
  const p = paces('10k', athlete.experience, input.ref);
  const raceMonday = mondayOf(date);
  const available = Math.floor((parse(raceMonday) - parse(mondayOf(today))) / (7 * DAY)) + 1;
  const n = Math.max(Math.min(6, available), Math.min(12, available));
  const start = addDays(raceMonday, -(n - 1) * 7);
  const runPace = fmtPace(p.tempo + 10);
  const easyText = `${fmtPace(p.easy[0]).replace('/km', '')} à ${fmtPace(p.easy[1])}`;
  const sessions: SessionDef[] = [REST];
  const add = (def: SessionDef) => {
    sessions.push({ ...def, generated: true });
    return def.id;
  };
  const phaseOf = (i: number) => (i >= n - 1 ? 'taper' : i >= n * 0.66 ? 'peak' : i >= n * 0.33 ? 'build' : 'base');
  const vol = { base: 1, build: 1.25, peak: 1.4, taper: 0.6 };
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
      name: 'Force bas du corps et traîneau',
      focus: 'Squat, soulevé de terre, sled push et pull',
      type: 'lifting',
      exercises: [
        { key: 'squat', sets: 4, reps: ph === 'base' ? '6–8' : '4–6' },
        { key: 'rdl', sets: 3, reps: '6–8' },
        { key: 'sled-push', sets: Math.round(4 * v), reps: '25 m', rest: 90 },
        { key: 'sled-pull', sets: Math.round(4 * v), reps: '25 m', rest: 90 },
        { key: 'sandbag-lunge', sets: 3, reps: '20 m', rest: 90 },
      ],
    }));
    const upper = once(`upper-${ph}`, () => ({
      id: `hx-upper-${ph}`,
      name: 'Force haut du corps et ergos',
      focus: 'Tirage, poussée, SkiErg, rameur, wall balls',
      type: 'lifting',
      exercises: [
        { key: 'pullup', sets: 4, reps: '6–10' },
        { key: 'db-bench', sets: 3, reps: '8–10' },
        { key: 'ski-erg', sets: Math.round(4 * v), reps: '500 m', rest: 90 },
        { key: 'rowing-erg', sets: Math.round(3 * v), reps: '500 m', rest: 90 },
        { key: 'wall-ball', sets: 4, reps: ph === 'base' ? '15' : '25', rest: 75 },
        { key: 'farmer-walk', sets: 3, reps: '50 m', rest: 75 },
      ],
    }));
    const run = once(`run-${ph}`, () => ({
      id: `hx-run-${ph}`,
      name: 'Course fractionnée',
      focus: `Kilomètres à l’allure Hyrox, ${runPace}`,
      type: 'cardio',
      exercises: [{ key: 'run-intervals', sets: Math.round(5 * v), reps: '1 km', rest: 90, note: `Allure : ${runPace}. C’est l’allure à tenir entre les stations.` }],
    }));
    const compromised = once(`comp-${ph}`, () => ({
      id: `hx-comp-${ph}`,
      name: ph === 'peak' ? 'Simulation Hyrox' : 'Course et stations enchaînées',
      focus: ph === 'peak' ? 'La moitié de la course, sans pause' : '1 km de course, une station, et on recommence',
      type: 'cardio',
      exercises:
        ph === 'peak'
          ? [{ key: 'hyrox-sim', note: '4 × (1 km + station) : SkiErg 1000 m, sled push 50 m, sled pull 50 m, burpees 80 m. Note ton temps.' }]
          : [
              { key: 'run-intervals', sets: Math.round(4 * v), reps: '1 km', rest: 0, note: `Allure ${runPace}, enchaîne directement la station.` },
              { key: 'burpee-broad-jump', sets: Math.round(4 * v), reps: '20 m', rest: 0 },
              { key: 'wall-ball', sets: Math.round(4 * v), reps: '20', rest: 60 },
            ],
    }));
    const long = once(`long-${ph}`, () => ({
      id: `hx-long-${ph}`,
      name: 'Footing long',
      focus: `${ph === 'taper' ? 30 : Math.round(40 + 15 * v)} min en endurance`,
      type: 'cardio',
      exercises: [{ key: 'run-easy', sets: 1, reps: `${ph === 'taper' ? 30 : Math.round(40 + 15 * v)} min`, note: `Allure : ${easyText}.` }],
    }));

    const week = Array(7).fill('rest');
    const d = Math.max(3, Math.min(5, athlete.days));
    week[1] = lower;
    week[3] = run;
    week[5] = upper;
    if (d >= 4) week[6] = compromised;
    if (d >= 5) week[0] = long;
    if (i === n - 1) {
      week[weekday(date)] = add({
        id: 'hx-race',
        name: 'Hyrox',
        focus: '8 × 1 km et 8 stations',
        type: 'cardio',
        exercises: [{ key: 'race-day', note: `Pars à ${runPace} sur les premiers kilomètres. Respire avant chaque station plutôt que de t’y précipiter.` }],
      });
      for (const before of [1, 2]) week[(weekday(date) + 7 - before) % 7] = 'rest';
    }
    weeks.push(week);
    phases.push({ base: 'Fondamental', build: 'Développement', peak: 'Spécifique', taper: 'Affûtage' }[ph]);
  }

  return {
    name: `Hyrox du ${new Date(parse(date)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`,
    template: 'hyrox',
    sessions,
    schedule: ['rest', ids.get('lower-base')!, 'rest', ids.get('run-base')!, 'rest', ids.get('upper-base')!, 'rest'],
    start,
    weeks,
    phases,
    event: { name: 'Hyrox', date },
  };
}

/* ---------- Adaptation au matériel ---------- */

/** Matériel nécessaire (l'un ou l'autre suffit). Absent de la liste : rien de spécial. */
const NEEDS: Record<string, Equipment[]> = {
  bench: ['barbell'], 'barbell-row': ['barbell'], 't-bar-row': ['barbell', 'machines'], 'military-press': ['barbell'], 'barbell-curl': ['barbell'],
  skullcrusher: ['barbell', 'dumbbells'], 'close-grip-bench': ['barbell'], 'arms-superset': ['barbell'], squat: ['barbell'], 'front-squat': ['barbell'],
  deadlift: ['barbell'], 'sumo-deadlift': ['barbell'], rdl: ['barbell', 'dumbbells'], 'good-morning': ['barbell'], 'hip-thrust': ['barbell', 'dumbbells'],
  'machine-chest-press': ['machines'], 'pec-deck': ['machines'], 'smith-squat': ['machines'], 'leg-press': ['machines'], 'hack-squat': ['machines'],
  'leg-extension': ['machines'], 'leg-curl': ['machines'], 'hip-abduction': ['machines'], 'machine-shoulder-press': ['machines'], 'seated-calf': ['machines'],
  'standing-calf': ['machines', 'dumbbells'], 'low-high-fly': ['cables'], 'cable-fly': ['cables'], 'seated-cable-row': ['cables'], 'neutral-pulldown': ['cables', 'machines'],
  'wide-pulldown': ['cables', 'machines'], 'straight-arm-pulldown': ['cables'], 'cable-lateral-raise': ['cables'], 'rear-delt': ['cables', 'machines'], 'face-pull': ['cables'],
  'cable-curl': ['cables'], 'rope-pushdown': ['cables'], 'cable-crunch': ['cables'], pallof: ['cables'], 'incline-db-press': ['dumbbells'], 'db-bench': ['dumbbells'],
  'db-row': ['dumbbells'], shrug: ['dumbbells', 'barbell'], 'db-shoulder-press': ['dumbbells'], 'arnold-press': ['dumbbells'], 'db-lateral-raise': ['dumbbells'],
  'incline-curl': ['dumbbells'], 'hammer-curl': ['dumbbells'], 'preacher-curl': ['dumbbells', 'machines'], 'overhead-triceps': ['dumbbells', 'cables'],
  'goblet-squat': ['dumbbells', 'kettlebell'], bulgarian: ['dumbbells'], lunge: ['dumbbells'], 'walking-lunge': ['dumbbells'], 'farmer-walk': ['dumbbells', 'kettlebell'],
  pullup: ['pullup'], 'chin-up': ['pullup'], 'hanging-leg-raise': ['pullup'], dips: ['pullup'], 'rowing-erg': ['rower'], bike: ['bike'], intervals: ['bike', 'rower'],
  'kettlebell-swing': ['kettlebell'], 'ski-erg': ['skierg'], 'sled-push': ['sled'], 'sled-pull': ['sled'], 'wall-ball': ['wallball'], 'sandbag-lunge': ['sandbag', 'dumbbells'],
};

/** Remplaçants dans l'ordre de préférence. Le dernier ne demande presque rien. */
const SWAPS: Record<string, string[]> = {
  bench: ['db-bench', 'machine-chest-press', 'pushup'], 'barbell-row': ['db-row', 'seated-cable-row'], 't-bar-row': ['db-row', 'seated-cable-row'],
  'military-press': ['db-shoulder-press', 'machine-shoulder-press', 'pushup'], 'barbell-curl': ['hammer-curl', 'cable-curl'], skullcrusher: ['overhead-triceps', 'rope-pushdown', 'dips'],
  'close-grip-bench': ['dips', 'pushup'], 'arms-superset': ['hammer-curl', 'cable-curl'], squat: ['smith-squat', 'hack-squat', 'leg-press', 'goblet-squat', 'bulgarian'],
  'front-squat': ['goblet-squat', 'hack-squat', 'bulgarian'], deadlift: ['rdl', 'hip-thrust', 'bulgarian'], 'sumo-deadlift': ['rdl', 'hip-thrust'], rdl: ['hip-thrust', 'bulgarian'],
  'good-morning': ['rdl', 'hip-thrust'], 'hip-thrust': ['bulgarian', 'lunge'], 'machine-chest-press': ['db-bench', 'bench', 'pushup'], 'pec-deck': ['cable-fly', 'db-bench', 'pushup'],
  'smith-squat': ['squat', 'goblet-squat', 'bulgarian'], 'leg-press': ['hack-squat', 'squat', 'goblet-squat', 'bulgarian'], 'hack-squat': ['leg-press', 'squat', 'goblet-squat', 'bulgarian'],
  'leg-extension': ['bulgarian', 'goblet-squat', 'lunge'], 'leg-curl': ['rdl', 'hip-thrust'], 'hip-abduction': ['lunge', 'side-plank'], 'machine-shoulder-press': ['db-shoulder-press', 'military-press', 'pushup'],
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
};

const EQUIP_NAME: Partial<Record<Equipment, string>> = {
  barbell: 'barre', machines: 'machine', cables: 'poulie', dumbbells: 'haltères', pullup: 'barre de traction', rower: 'rameur', bike: 'vélo',
  kettlebell: 'kettlebell', skierg: 'SkiErg', sled: 'traîneau', wallball: 'médecine-ball', sandbag: 'sandbag',
};

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
      const missing = (NEEDS[slot.key] ?? []).map((e) => EQUIP_NAME[e] ?? e).join(' ou ');
      swaps.push({ session: def.name, from: names(slot.key), to: names(to), missing });
      exercises.push({ ...slot, key: to, note: `Remplace ${names(slot.key).toLowerCase()} (pas de ${missing} dans ta salle).${slot.note ? ` ${slot.note}` : ''}` });
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
  if (!program.start || !program.weeks || !program.event) return null;
  const d = Math.floor((parse(today) - parse(program.start)) / DAY);
  const days = Math.round((parse(program.event.date) - parse(today)) / DAY);
  if (d < 0) return `${program.event.name} : le plan commence le ${new Date(parse(program.start)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
  const w = Math.floor(d / 7);
  if (w >= program.weeks.length) return `${program.event.name} terminé. Semaine type en attendant le prochain objectif.`;
  return `Semaine ${w + 1} sur ${program.weeks.length}${program.phases?.[w] ? `, ${program.phases[w].toLowerCase()}` : ''}. ${days > 0 ? `J-${days}` : 'C’est le jour J'}.`;
}
