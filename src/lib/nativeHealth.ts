// Apple Santé lu directement par l'app iPhone (HealthKit), sans raccourci : pas, distance, énergie,
// minutes d'exercice, sommeil, cœur au repos, VFC, et les séances de la montre. Sur Android, Health Connect.
import type { HealthDataType, Workout, WorkoutType } from '@capgo/capacitor-health';
import { importActivities, type ImportResult } from './activities';
import { api } from './api';
import { addDays, dayKey } from './date';
import { applyHealthDays } from './health';
import { isNative } from './native';
import { signedIn } from './session';
import type { Activity, HealthDay } from './store';

const READ: HealthDataType[] = ['steps', 'distance', 'calories', 'basalCalories', 'exerciseTime', 'sleep', 'restingHeartRate', 'heartRateVariability', 'workouts'];

const plugin = async () => (await import('@capgo/capacitor-health')).Health;

const SPORT: Partial<Record<WorkoutType, Activity['sport']>> = {
  running: 'run', runningTreadmill: 'run', trackAndField: 'run',
  cycling: 'bike', bikingStationary: 'bike', handCycling: 'bike',
  swimming: 'swim', swimmingPool: 'swim', swimmingOpenWater: 'swim',
  walking: 'walk', hiking: 'walk',
  rowing: 'row', rowingMachine: 'row',
  traditionalStrengthTraining: 'lift', functionalStrengthTraining: 'lift', strengthTraining: 'lift', weightlifting: 'lift', crossTraining: 'lift', coreTraining: 'lift', highIntensityIntervalTraining: 'lift',
  boxing: 'combat', kickboxing: 'combat', martialArts: 'combat', wrestling: 'combat',
};

const NAMES: Record<Activity['sport'], string> = { run: 'Course', bike: 'Vélo', swim: 'Natation', walk: 'Marche', row: 'Rameur', ski: 'Ski', combat: 'Combat', lift: 'Musculation', other: 'Séance' };

/** Date locale AAAA-MM-JJ d'un horodatage ISO. */
const localDay = (iso: string) => dayKey(new Date(iso));
const localIso = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dayKey(d)}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
};

export async function nativeHealthAvailable(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    return (await (await plugin()).isAvailable()).available;
  } catch {
    return false;
  }
}

/** Demande l'accès en lecture (une fenêtre iOS, une seule fois). */
export async function connectNativeHealth(): Promise<boolean> {
  const Health = await plugin();
  const st = await Health.requestAuthorization({ read: READ });
  return st.readAuthorized.length > 0 || st.readDenied.length < READ.length;
}

function toActivity(w: Workout): Activity | null {
  const min = w.duration / 60;
  if (!(min >= 3)) return null;
  // Strava écrit aussi dans Santé : l'import Strava s'en charge, on évite le doublon.
  if (/strava/i.test(w.sourceName ?? '')) return null;
  const sport = SPORT[w.workoutType] ?? 'other';
  return {
    id: `health:${w.platformId ?? w.startDate}`,
    source: 'health',
    sport,
    name: `${NAMES[sport]}${w.sourceName ? `, ${w.sourceName}` : ''}`,
    start: localIso(w.startDate),
    min: Math.round(min * 10) / 10,
    ...(w.totalDistance && w.totalDistance > 50 ? { km: Math.round((w.totalDistance / 1000) * 100) / 100 } : {}),
    ...(w.totalEnergyBurned ? { kcal: Math.round(w.totalEnergyBurned) } : {}),
  };
}

let last = 0;
let inflight: Promise<ImportResult | null> | null = null;

/** Lit les `days` derniers jours et les range dans l'app ; prévient aussi le serveur pour les rappels. */
export function syncNativeHealth(force = false, days = 7): Promise<ImportResult | null> {
  if (!isNative()) return Promise.resolve(null);
  if (!force && Date.now() - last < 5 * 60_000) return Promise.resolve(null);
  if (inflight) return inflight;
  last = Date.now();
  inflight = (async () => {
    try {
      const Health = await plugin();
      const today = dayKey();
      const start = new Date(`${addDays(today, -(days - 1))}T00:00:00`);
      const range = { startDate: start.toISOString(), endDate: new Date().toISOString() };
      const out: Record<string, HealthDay> = {};
      const at = new Date().toISOString();
      const put = (date: string, patch: Partial<HealthDay>) => (out[date] = { ...out[date], ...patch, at });

      const daily = async (dataType: HealthDataType, aggregation: 'sum' | 'average') => {
        try {
          return (await Health.queryAggregated({ ...range, dataType, bucket: 'day', aggregation })).samples;
        } catch {
          return [];
        }
      };
      for (const x of await daily('steps', 'sum')) put(localDay(x.startDate), { steps: Math.round(x.value) });
      for (const x of await daily('distance', 'sum')) put(localDay(x.startDate), { distanceKm: Math.round((x.value / 1000) * 10) / 10 });
      for (const x of await daily('calories', 'sum')) put(localDay(x.startDate), { active: Math.round(x.value) });
      for (const x of await daily('basalCalories', 'sum')) put(localDay(x.startDate), { resting: Math.round(x.value) });
      for (const x of await daily('exerciseTime', 'sum')) put(localDay(x.startDate), { exerciseMin: Math.round(x.value) });
      for (const x of await daily('restingHeartRate', 'average')) put(localDay(x.startDate), { restingHr: Math.round(x.value) });
      for (const x of await daily('heartRateVariability', 'average')) put(localDay(x.startDate), { hrv: Math.round(x.value) });

      // Sommeil : on compte le temps endormi, rangé au jour du réveil.
      try {
        const sleep = await Health.readSamples({ dataType: 'sleep', startDate: new Date(start.getTime() - 86400_000).toISOString(), endDate: range.endDate, limit: 2000 });
        const asleep: Record<string, number> = {};
        for (const x of sleep.samples) {
          if (x.sleepState === 'inBed' || x.sleepState === 'awake') continue;
          const minutes = (Date.parse(x.endDate) - Date.parse(x.startDate)) / 60_000;
          if (minutes > 0) asleep[localDay(x.endDate)] = (asleep[localDay(x.endDate)] ?? 0) + minutes;
        }
        for (const [date, m] of Object.entries(asleep)) if (date >= addDays(today, -(days - 1))) put(date, { sleepMin: Math.round(m) });
      } catch {
        // Pas de sommeil enregistré, ou accès refusé : on passe.
      }

      applyHealthDays(out);

      // Le serveur garde la journée en cours (rappels, autres appareils).
      const t = out[today];
      if (t && signedIn()) {
        void api('/api/health/ingest', {
          body: { date: today, steps: t.steps, active_kcal: t.active, resting_kcal: t.resting, sleep_min: t.sleepMin, resting_hr: t.restingHr, hrv: t.hrv, exercise_min: t.exerciseMin, distance_km: t.distanceKm },
        }).catch(() => undefined);
      }

      try {
        const { workouts } = await Health.queryWorkouts({ ...range, limit: 60 });
        return importActivities(workouts.map(toActivity).filter((a): a is Activity => Boolean(a)));
      } catch {
        return null;
      }
    } catch {
      return null;
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
