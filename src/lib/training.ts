// Ce que tu as vraiment fait : minutes d'entraînement par sport, distances, séances, progression des charges.
// Calculé à partir des séries cochées (et des distances et durées notées pour l'endurance).
import { catalogEntry, exerciseName } from '../../shared/catalog';
import { repMeters, repSeconds } from '../../shared/effort';
import { resolveExercise, scheduleFor, findSession } from '../../shared/program';
import type { Discipline, Exercise } from '../../shared/types';
import { addDays, mondayOf } from './date';
import { sessionFor } from './logic';
import type { AppState } from './state';
import { e1rm } from './strength';
import { tr } from '../../shared/i18n';

export type Bucket = 'lift' | 'run' | 'bike' | 'swim' | 'other';
export const BUCKETS: Bucket[] = ['lift', 'run', 'bike', 'swim', 'other'];
export const BUCKET_NAMES: Record<Bucket, string> = { lift: tr('Muscu'), run: tr('Course'), bike: tr('Vélo'), swim: tr('Natation'), other: tr('Autre cardio') };

export interface Training {
  /** Minutes par sport. */
  min: Record<Bucket, number>;
  /** Kilomètres par sport d'endurance. */
  km: Partial<Record<Discipline, number>>;
  /** Jours avec au moins une série cochée. */
  sessions: number;
}

export const empty = (): Training => ({ min: { lift: 0, run: 0, bike: 0, swim: 0, other: 0 }, km: {}, sessions: 0 });

const bucketOf = (d?: Discipline): Bucket => (d === 'run' || d === 'bike' || d === 'swim' ? d : 'other');

export function dayTraining(s: AppState, date: string): Training {
  const out = empty();
  const day = s.days[date];
  if (!day) return out;
  const session = sessionFor(s, date);
  const byKey = new Map<string, Exercise>(session.exercises.map((x) => [x.key, x]));
  let any = false;
  // Les sorties importées comptent avec leurs vrais chiffres ; les blocs qu'elles ont validés ne comptent pas deux fois.
  const linked = new Set<string>();
  let watchLift = 0;
  for (const a of day.activities ?? []) {
    for (const k of a.linked ?? []) linked.add(k);
    if (a.sport === 'walk') continue;
    any = true;
    // La muscu de la montre et les séries notées décrivent la même séance : on garde la plus longue des deux.
    if (a.sport === 'lift') {
      watchLift += a.min;
      continue;
    }
    const b: Bucket = a.sport === 'run' || a.sport === 'bike' || a.sport === 'swim' ? a.sport : 'other';
    out.min[b] += a.min;
    if (a.km && a.sport !== 'other') out.km[a.sport as Discipline] = (out.km[a.sport as Discipline] ?? 0) + a.km;
  }
  for (const [key, logs] of Object.entries(day.sets)) {
    const done = logs.filter((l) => l.done);
    if (!done.length || linked.has(key)) continue;
    const ex = byKey.get(key) ?? resolveExercise({ key }, s.customExercises);
    if (ex.discipline && ex.discipline !== 'combat') {
      if (ex.discipline === 'walk') continue;
      any = true;
      const b = bucketOf(ex.discipline);
      for (const l of done) {
        out.min[b] += l.min ?? repSeconds(ex) / 60;
        const m = l.km !== undefined ? l.km * 1000 : repMeters(ex);
        out.km[ex.discipline] = (out.km[ex.discipline] ?? 0) + m / 1000;
      }
      out.min[b] += (Math.max(0, done.length - 1) * ex.rest) / 60;
      continue;
    }
    if (ex.kind === 'task') continue;
    any = true;
    const entry = catalogEntry(key, s.customExercises);
    const b: Bucket = ex.kind === 'cardio' || entry?.group === 'cardio' ? 'other' : 'lift';
    out.min[b] += (done.length * (40 + Math.min(ex.rest, 180))) / 60;
  }
  out.min.lift = Math.max(out.min.lift, watchLift);
  if (any || day.mainDone) out.sessions = 1;
  return out;
}

export function addTraining(a: Training, b: Training): Training {
  const out = empty();
  for (const k of BUCKETS) out.min[k] = a.min[k] + b.min[k];
  for (const d of new Set([...Object.keys(a.km), ...Object.keys(b.km)]) as Set<Discipline>) out.km[d] = (a.km[d] ?? 0) + (b.km[d] ?? 0);
  out.sessions = a.sessions + b.sessions;
  return out;
}

export const totalMinutes = (t: Training) => BUCKETS.reduce((n, k) => n + t.min[k], 0);

export interface WeekTraining extends Training {
  monday: string;
  /** Séances prévues par le programme cette semaine-là. */
  planned: number;
}

/** Les `n` dernières semaines, de la plus ancienne à la semaine en cours. */
export function trainingWeeks(s: AppState, today: string, n = 8): WeekTraining[] {
  const thisMonday = mondayOf(today);
  return Array.from({ length: n }, (_, i) => {
    const monday = addDays(thisMonday, -7 * (n - 1 - i));
    let t = empty();
    for (let d = 0; d < 7; d++) {
      const date = addDays(monday, d);
      if (date > today) break;
      t = addTraining(t, dayTraining(s, date));
    }
    const week = scheduleFor(s.program, monday);
    const planned = week.filter((id) => findSession(s.program, id).type !== 'rest').length;
    return { ...t, monday, planned };
  });
}

/** Fenêtres glissantes de 7 jours, la dernière finit aujourd'hui : pas de chute artificielle le lundi. */
export function rollingWeeks(s: AppState, today: string, n = 8): Training[] {
  return Array.from({ length: n }, (_, i) => {
    const end = addDays(today, -7 * (n - 1 - i));
    let t = empty();
    for (let d = 0; d < 7; d++) t = addTraining(t, dayTraining(s, addDays(end, -d)));
    return t;
  });
}

/* ---------- Progression des charges ---------- */

export interface LiftPoint {
  date: string;
  /** 1RM estimé de la meilleure série du jour. */
  e1rm: number;
  w: number;
  r: number;
  /** Nouveau record ce jour-là. */
  pr: boolean;
}

/** La meilleure série de chaque séance, sur les `days` derniers jours. */
export function liftSeries(s: AppState, key: string, today: string, days = 120): LiftPoint[] {
  const from = addDays(today, -days);
  const out: LiftPoint[] = [];
  let best = 0;
  for (const date of Object.keys(s.days).sort()) {
    const sets = (s.days[date].sets[key] ?? []).filter((l) => l.done && l.w && l.r);
    if (!sets.length) continue;
    const top = sets.reduce((a, l) => (e1rm(l.w!, l.r!) > e1rm(a.w!, a.r!) ? l : a));
    const v = e1rm(top.w!, top.r!);
    const pr = v > best + 0.01 && best > 0;
    best = Math.max(best, v);
    if (date >= from && date <= today) out.push({ date, e1rm: Math.round(v * 10) / 10, w: top.w!, r: top.r!, pr });
  }
  return out;
}

/** Les exercices chargés les plus suivis, ceux qui ont le plus de séances notées. */
export function trackedLifts(s: AppState, today: string, max = 5): { key: string; name: string; points: number }[] {
  const from = addDays(today, -120);
  const count = new Map<string, number>();
  for (const [date, d] of Object.entries(s.days)) {
    if (date < from) continue;
    for (const [key, logs] of Object.entries(d.sets)) if (logs.some((l) => l.done && l.w && l.r)) count.set(key, (count.get(key) ?? 0) + 1);
  }
  // Les gros mouvements d'abord : ce sont eux qui racontent la progression.
  const ORDER: Record<string, number> = { compound: 0, power: 1, isolation: 2, core: 3, neck: 4 };
  const rank = (key: string) => ORDER[catalogEntry(key, s.customExercises)?.kind ?? 'isolation'] ?? 3;
  return [...count.entries()]
    .filter(([key, n]) => n >= 2 && !catalogEntry(key, s.customExercises)?.noLoad && catalogEntry(key, s.customExercises)?.kind !== 'neck')
    .sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1])
    .slice(0, max)
    .map(([key, points]) => ({ key, name: exerciseName(key, s.customExercises), points }));
}

/** Records des 14 derniers jours, tous exercices confondus. */
export function recentRecords(s: AppState, today: string): { key: string; name: string; date: string; w: number; r: number }[] {
  const out: { key: string; name: string; date: string; w: number; r: number }[] = [];
  const keys = new Set(Object.values(s.days).flatMap((d) => Object.keys(d.sets)));
  for (const key of keys) {
    const pts = liftSeries(s, key, today, 14).filter((p) => p.pr);
    const last = pts[pts.length - 1];
    if (last) out.push({ key, name: exerciseName(key, s.customExercises), date: last.date, w: last.w, r: last.r });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
