// Conseils de charge et de volume, calculés à partir des séries notées.
// - Charge : 1RM estimé (Epley) sur les dernières séances, puis la charge qui laisse ~2 reps en réserve
//   dans la fourchette visée. Détecte la progression, la stagnation et propose un allègement.
// - Volume : séries effectives par groupe musculaire et par semaine, comparées aux repères
//   hypertrophie (≈10 à 20 séries), croisées avec la fiche de force pour dire quoi prioriser.
// Ce sont des estimations : elles servent à choisir un point de départ, pas à remplacer les sensations.
import { catalogEntry } from '../../shared/catalog';
import type { Exercise, MuscleGroup } from '../../shared/types';
import { addDays } from './date';
import type { AppState, SetLog } from './store';
import { e1rm, strengthProfile } from './strength';

/** Charge réalisable pour `reps` reps en gardant `rir` reps en réserve. */
export function loadFor(oneRm: number, reps: number, rir = 2): number {
  const r = Math.min(Math.max(reps + rir, 1), 15);
  return r === 1 ? oneRm : oneRm / (1 + r / 30);
}

/** Nombre de reps qu'on peut espérer faire à `weight` (jusqu'à l'échec). */
export function repsAt(oneRm: number, weight: number): number {
  if (weight >= oneRm) return 1;
  return Math.max(1, Math.floor(30 * (oneRm / weight - 1)));
}

const roundTo = (w: number, step: number) => Math.max(step, Math.round(w / step) * step);
const floorTo = (w: number, step: number) => Math.max(step, Math.floor(w / step) * step);

export interface Outing {
  date: string;
  sets: SetLog[];
  best: number;
  top: number;
}

/** Les dernières séances (plus récente en premier) où l'exercice a été fait avec une charge. */
export function history(s: AppState, key: string, before: string, n = 6): Outing[] {
  const out: Outing[] = [];
  const dates = Object.keys(s.days)
    .filter((d) => d < before)
    .sort()
    .reverse();
  for (const d of dates) {
    const sets = (s.days[d].sets[key] ?? []).filter((l) => l.done && l.w && l.r);
    if (!sets.length) continue;
    out.push({ date: d, sets, best: Math.max(...sets.map((l) => e1rm(l.w!, l.r!))), top: Math.max(...sets.map((l) => l.w!)) });
    if (out.length >= n) break;
  }
  return out;
}

export type Trend = 'new' | 'up' | 'flat' | 'stall' | 'down';

export interface LoadAdvice {
  oneRm: number;
  weight: number;
  reps: string;
  sets: number;
  trend: Trend;
  /** Une phrase courte, affichée sous l'exercice. */
  text: string;
  /** Charge → reps visées, pour le calculateur. */
  table: { reps: number; weight: number }[];
}

function range(ex: Exercise): [number, number] {
  const min = ex.repMin ?? (parseInt(ex.reps, 10) || 8);
  return [min, ex.repMax ?? min];
}

export function adviseLoad(s: AppState, ex: Exercise, date: string): LoadAdvice | null {
  if (ex.noLoad || ex.kind === 'task' || ex.kind === 'cardio') return null;
  const h = history(s, ex.key, date);
  if (!h.length) return null;
  const step = ex.step ?? 2.5;
  const [lo, hi] = range(ex);
  const last = h[0];
  const oneRm = Math.max(...h.slice(0, 2).map((o) => o.best));

  // Tendance : on compare le meilleur 1RM estimé de la dernière séance aux précédentes.
  let trend: Trend = 'new';
  if (h.length >= 2) {
    const prevBest = Math.max(...h.slice(1, 4).map((o) => o.best));
    if (last.best > prevBest * 1.01) trend = 'up';
    else if (last.best < prevBest * 0.95) trend = 'down';
    else trend = 'flat';
    // Trois séances d'affilée sans battre le record d'avant = stagnation.
    if (h.length >= 4) {
      const before = Math.max(...h.slice(3).map((o) => o.best));
      if (Math.max(...h.slice(0, 3).map((o) => o.best)) <= before * 1.005) trend = 'stall';
    }
  }

  const ideal = floorTo(loadFor(oneRm, Math.round((lo + hi) / 2)), step);
  const allTop = last.sets.length >= ex.sets && last.sets.every((l) => (l.r ?? 0) >= hi);
  let weight: number;
  let sets = ex.sets;
  let text: string;

  if (trend === 'stall') {
    weight = roundTo(last.top * 0.9, step);
    text = `Stagnation depuis 3 séances : repars à ${fmt(weight)} (−10 %), remonte en 2 à 3 séances et tu passeras le palier.`;
  } else if (trend === 'down') {
    weight = last.top;
    text = `Moins bien que d’habitude (sommeil, calories ?). Garde ${fmt(weight)} et vise juste ${lo} reps propres.`;
  } else if (allTop) {
    weight = Math.max(roundTo(last.top + step, step), ideal);
    text =
      weight > last.top + step
        ? `Trop facile : ${last.sets.length} séries à ${hi} reps ou plus. Passe directement à ${fmt(weight)} pour ${lo} à ${hi} reps.`
        : `Toutes tes séries à ${hi} reps : passe à ${fmt(weight)} et vise ${lo} reps.`;
  } else if (ideal >= last.top + step) {
    weight = ideal;
    text = `Tu as de la marge : ${fmt(weight)} pour ${lo} à ${hi} reps devrait passer.`;
  } else {
    weight = last.top;
    const reps = last.sets.map((l) => l.r ?? 0);
    const goal = Math.min(hi, Math.max(...reps) + 1);
    text = `Reste à ${fmt(weight)} et ajoute 1 rep par série (vise ${goal}) avant de monter.`;
  }

  // À la limite haute du volume ou en plein déficit, une série de plus n'aide pas : on le signale seulement si le groupe manque de volume.
  const group = catalogEntry(ex.key, s.customExercises)?.group;
  if (group && trend === 'flat') {
    const v = weeklySets(s, date)[group] ?? 0;
    const t = TARGETS[group];
    if (t && v < t[0] && ex.kind === 'compound') {
      sets = ex.sets + 1;
      text += ` Tes ${GROUP_NAMES[group].toLowerCase()} manquent de volume : fais ${sets} séries.`;
    }
  }

  const table = [3, 5, 6, 8, 10, 12, 15].map((r) => ({ reps: r, weight: floorTo(loadFor(oneRm, r), step) }));
  return { oneRm, weight, reps: `${lo === hi ? lo : `${lo}–${hi}`}`, sets, trend, text, table };
}

const fmt = (w: number) => `${w.toLocaleString('fr-FR')} kg`;

/* ---------- Volume par muscle ---------- */

/** Repères de séries effectives par semaine (minimum utile, maximum récupérable). */
const TARGETS: Partial<Record<MuscleGroup, [number, number]>> = {
  chest: [10, 20],
  back: [12, 22],
  shoulders: [10, 20],
  arms: [8, 16],
  legs: [12, 22],
  core: [6, 14],
  neck: [4, 10],
};

export const GROUP_NAMES: Record<MuscleGroup, string> = {
  chest: 'Pectoraux',
  back: 'Dos',
  shoulders: 'Épaules',
  arms: 'Bras',
  legs: 'Jambes',
  core: 'Abdos',
  neck: 'Cou',
  cardio: 'Cardio',
  other: 'Autre',
};

/** Séries faites par groupe, moyenne par semaine sur les `weeks` dernières semaines. */
export function weeklySets(s: AppState, today: string, weeks = 2): Partial<Record<MuscleGroup, number>> {
  const out: Partial<Record<MuscleGroup, number>> = {};
  const from = addDays(today, -7 * weeks);
  for (const [date, d] of Object.entries(s.days)) {
    if (date <= from || date > today) continue;
    for (const [key, logs] of Object.entries(d.sets)) {
      const e = catalogEntry(key, s.customExercises);
      if (!e || e.kind === 'task' || e.kind === 'cardio') continue;
      const n = logs.filter((l) => l.done).length;
      if (n) out[e.group] = (out[e.group] ?? 0) + n;
    }
  }
  for (const k of Object.keys(out) as MuscleGroup[]) out[k] = Math.round((out[k]! / weeks) * 10) / 10;
  return out;
}

export interface FocusItem {
  group: MuscleGroup;
  name: string;
  sets: number;
  target: [number, number];
  status: 'low' | 'ok' | 'high';
  weak: boolean;
  text: string;
}

/** Où mettre l'effort : volume hebdo par muscle, et le point faible de la fiche de force. */
export function focusPlan(s: AppState, today: string): { items: FocusItem[]; headline: string | null; logged: boolean } {
  const v = weeklySets(s, today);
  const logged = Object.values(v).some((n) => (n ?? 0) > 0);
  const profile = strengthProfile(s, today);
  const weakMap: Record<string, MuscleGroup> = { chest: 'chest', shoulders: 'shoulders', arms: 'arms', back: 'back', quads: 'legs', hamstrings: 'legs' };
  const weak = profile.weakest ? weakMap[profile.weakest.id] : undefined;

  const items: FocusItem[] = (Object.keys(TARGETS) as MuscleGroup[]).map((g) => {
    const target = TARGETS[g]!;
    const sets = v[g] ?? 0;
    const status = sets < target[0] ? 'low' : sets > target[1] ? 'high' : 'ok';
    const missing = Math.ceil(target[0] - sets);
    const text =
      status === 'low'
        ? `${fmtSets(sets)} par semaine : ajoute ${missing} série${missing > 1 ? 's' : ''} pour atteindre le minimum utile.`
        : status === 'high'
          ? `${fmtSets(sets)} par semaine : c’est beaucoup, surtout en déficit. Retire quelques séries d’isolation.`
          : `${fmtSets(sets)} par semaine : dans la bonne zone.`;
    return { group: g, name: GROUP_NAMES[g], sets, target, status, weak: g === weak, text };
  });

  // Priorité : point faible en force d'abord, puis les groupes sous le minimum.
  items.sort((a, b) => Number(b.weak) - Number(a.weak) || rank(a) - rank(b) || a.sets / a.target[0] - b.sets / b.target[0]);
  const top = items.find((i) => i.weak) ?? items.find((i) => i.status === 'low');
  const headline = !logged
    ? null
    : top
      ? top.weak
        ? `Priorité : ${top.name.toLowerCase()}. C’est ton groupe le moins fort par rapport à ton poids${top.status === 'low' ? ', et il manque de volume' : ''}.`
        : `Priorité : ${top.name.toLowerCase()}, sous le minimum de séries.`
      : 'Volume équilibré : continue à monter les charges.';
  return { items, headline, logged };
}

const rank = (i: FocusItem) => (i.status === 'low' ? 0 : i.status === 'ok' ? 1 : 2);
const fmtSets = (n: number) => `${n.toLocaleString('fr-FR')} série${n > 1 ? 's' : ''}`;
