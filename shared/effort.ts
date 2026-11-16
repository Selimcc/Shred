// Ce que représente une séance d'endurance dans le temps : blocs, intensité, durée et distance.
// Sert au profil de séance (le graphique d'intensité), à la durée affichée et aux stats par sport.
import type { Discipline, Exercise, Zone } from './types';

export interface Block {
  key: string;
  /** Durée du bloc, en secondes. */
  sec: number;
  zone: Zone;
  /** Récupération entre deux répétitions. */
  rest?: boolean;
  /** Échauffement ou retour au calme ajouté parce que la consigne le prévoit. */
  implicit?: boolean;
  /** Index de l'exercice et de la répétition. */
  ex: number;
  rep: number;
}

export const ZONE_NAMES: Record<Zone, string> = {
  1: 'Récupération',
  2: 'Endurance',
  3: 'Tempo',
  4: 'Seuil',
  5: 'Maximal',
};

/* ---------- Allures par défaut (sans chrono) ---------- */

/** Secondes par mètre selon la zone, pour estimer une durée à partir d'une distance. */
const SEC_PER_M: Record<Discipline, Record<Zone, number>> = {
  // 6:45, 6:00, 5:20, 4:55, 4:30 au km
  run: { 1: 0.405, 2: 0.36, 3: 0.32, 4: 0.295, 5: 0.27 },
  // 22, 27, 30, 33, 35 km/h
  bike: { 1: 0.164, 2: 0.133, 3: 0.12, 4: 0.109, 5: 0.103 },
  // 2:30, 2:10, 2:00, 1:55, 1:45 aux 100 m
  swim: { 1: 1.5, 2: 1.3, 3: 1.2, 4: 1.15, 5: 1.05 },
  row: { 1: 0.32, 2: 0.29, 3: 0.27, 4: 0.25, 5: 0.23 },
  ski: { 1: 0.34, 2: 0.31, 3: 0.29, 4: 0.27, 5: 0.25 },
  walk: { 1: 0.8, 2: 0.72, 3: 0.65, 4: 0.6, 5: 0.55 },
  combat: { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3 },
};

export function secPerMeter(d: Discipline, zone: Zone): number {
  return SEC_PER_M[d][zone];
}

/** « 45 min », « 1 h 30 », « 30 s », « 12 km », « 800 m » : durée ou distance d'une répétition. */
export function parseSpan(reps: string): { sec?: number; m?: number } {
  const t = reps.replace(',', '.').trim();
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s*h(?:\s*(\d+))?/))) return { sec: Number(m[1]) * 3600 + Number(m[2] ?? 0) * 60 };
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s*min/))) return { sec: Number(m[1]) * 60 };
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s*km/))) return { m: Number(m[1]) * 1000 };
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s*m\b/))) return { m: Number(m[1]) };
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*s\b/))) return { sec: Number(m[1]) };
  return {};
}

type Rep = Pick<Exercise, 'key' | 'reps' | 'discipline' | 'zone' | 'sec'>;

/** Durée d'une répétition, en secondes : la valeur calculée par le plan, sinon d'après la consigne. */
export function repSeconds(ex: Rep): number {
  if (ex.sec) return ex.sec;
  const span = parseSpan(ex.reps);
  if (span.sec) return span.sec;
  if (span.m && ex.discipline) return span.m * secPerMeter(ex.discipline, ex.zone ?? 2);
  return 0;
}

/** Distance d'une répétition, en mètres : la consigne si elle est en distance, sinon estimée d'après la durée. */
export function repMeters(ex: Rep): number {
  if (!ex.discipline || ex.discipline === 'combat') return 0;
  const span = parseSpan(ex.reps);
  if (span.m) return span.m;
  const sec = ex.sec ?? span.sec ?? 0;
  return sec ? sec / secPerMeter(ex.discipline, ex.zone ?? 2) : 0;
}

const NEEDS_WARMUP = new Set(['run-intervals', 'run-tempo', 'run-hills', 'run-race', 'run-fartlek']);

/** Les blocs d'une séance d'endurance, dans l'ordre. Les exercices sans sport (gainage…) sont ignorés. */
export function sessionBlocks(exercises: Exercise[]): Block[] {
  const blocks: Block[] = [];
  const endurance = exercises.filter((x) => x.discipline && x.zone);
  if (!endurance.length) return blocks;
  // Les plans de course mettent l'échauffement dans la consigne : on le dessine quand même.
  const implicit = endurance.some((x) => NEEDS_WARMUP.has(x.key)) && !endurance.some((x) => /warmup/.test(x.key));
  if (implicit) blocks.push({ key: 'run-warmup', sec: 15 * 60, zone: 1, implicit: true, ex: -1, rep: 0 });
  exercises.forEach((x, ex) => {
    if (!x.discipline || !x.zone) return;
    const sec = repSeconds(x);
    if (!sec) return;
    for (let rep = 0; rep < x.sets; rep++) {
      blocks.push({ key: x.key, sec, zone: x.zone, ex, rep });
      if (x.rest > 0 && rep < x.sets - 1) blocks.push({ key: x.key, sec: x.rest, zone: 1, rest: true, ex, rep });
    }
  });
  if (implicit) blocks.push({ key: 'run-cooldown', sec: 10 * 60, zone: 1, implicit: true, ex: -1, rep: 0 });
  return blocks;
}

export function blocksSeconds(blocks: Block[]): number {
  return blocks.reduce((n, b) => n + b.sec, 0);
}

/** « 45 min », « 1 h 05 ». */
export function fmtClock(sec: number): string {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${Math.max(1, m)} min`;
}

/** Les sports présents dans une séance, dans l'ordre d'apparition. */
export function disciplinesOf(exercises: Pick<Exercise, 'discipline'>[]): Discipline[] {
  const out: Discipline[] = [];
  for (const x of exercises) if (x.discipline && !out.includes(x.discipline)) out.push(x.discipline);
  return out;
}

/** Minutes passées en zone 4 et 5 : la part « dure » d'une séance. */
export function hardSeconds(blocks: Block[]): number {
  return blocks.filter((b) => !b.rest && b.zone >= 4).reduce((n, b) => n + b.sec, 0);
}
