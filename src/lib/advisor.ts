// Conseils de charge et de volume, calculés à partir des séries notées.
// - Charge : 1RM estimé (Epley) sur les dernières séances, puis la charge qui laisse ~2 reps en réserve
//   dans la fourchette visée. Détecte la progression, la stagnation et propose un allègement.
// - Volume : séries effectives par groupe musculaire et par semaine, comparées aux repères
//   hypertrophie (≈10 à 20 séries), croisées avec la fiche de force pour dire quoi prioriser.
// Ce sont des estimations : elles servent à choisir un point de départ, pas à remplacer les sensations.
import { catalogEntry } from '../../shared/catalog';
import type { Exercise, MuscleGroup } from '../../shared/types';
import { isBarbell } from '../../shared/warmup';
import { addDays } from './date';
import type { AppState, SetLog } from './state';
import { isDeload } from './recovery';
import { bodyweightAt, e1rm, GRADES, type Grade, gradeFor, levelFor, ratioAt, scoreOf, sexFactor, standardOf, strengthProfile } from './strength';
import { loc, lower, tn, tr } from '../../shared/i18n';

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

/** Une série vaut en général la charge d'un exercice ; pour un haltère, c'est le poids d'un haltère. */
const minLoad = (ex: Exercise, step: number) => (isBarbell(ex.key, catalogEntry(ex.key)?.name ?? ex.name) ? 20 : step);

export interface StartLoad {
  weight: number;
  /** D'où vient ton niveau : tes autres exercices du même groupe, tous tes groupes, ou ton expérience déclarée. */
  from: 'group' | 'lifts' | 'experience';
}

/**
 * Charge de départ d'un exercice jamais fait : les repères de l'exercice à ton poids, à ton niveau (un cran en
 * dessous, le temps d'apprendre le mouvement), pour le milieu de la fourchette avec 3 reps en réserve.
 */
export function startingLoad(s: AppState, ex: Exercise, date: string): StartLoad | null {
  if (ex.noLoad || ex.kind === 'task' || ex.kind === 'cardio') return null;
  const std = standardOf(ex.key);
  if (!std || std.bodyweight) return null;
  const { kg } = bodyweightAt(s, date);
  const lvl = levelFor(s, ex.key, date);
  const oneRm = kg * ratioAt(std.t, Math.max(0.6, lvl.score - 0.3)) * sexFactor(ex.key, s.settings.athlete.sex);
  const [lo, hi] = range(ex);
  const step = ex.step ?? 2.5;
  const weight = Math.max(minLoad(ex, step), floorTo(loadFor(oneRm, Math.round((lo + hi) / 2), 3), step));
  return { weight, from: lvl.from };
}

/** La première fois : la charge de départ estimée, et d'où elle vient. */
export function firstTimeText(start: StartLoad, ex: Exercise): string {
  const vars = { fmt: fmt(start.weight), reps: ex.reps };
  return start.from === 'experience'
    ? tr('Première fois : environ {fmt} pour {reps} reps, avec 2 à 3 reps en réserve. Estimé d’après ton poids et ton niveau déclaré : ajuste dès la 1re série.', vars)
    : tr('Première fois : environ {fmt} pour {reps} reps, avec 2 à 3 reps en réserve. Estimé d’après ton poids et tes charges sur tes autres exercices : ajuste dès la 1re série.', vars);
}

export interface Benchmark {
  grade: Grade;
  weight: number;
}

/**
 * Ce que soulèvent les pratiquants de ton poids sur cet exercice, du niveau E au niveau A, pour le milieu de ta
 * fourchette de reps (2 en réserve) : de quoi voir qu'une élévation latérale à 8 kg, c'est normal. Et ta note.
 */
export function benchmarks(s: AppState, ex: Exercise, date: string): { reps: number; levels: Benchmark[]; mine: Grade | null; bodyweight: number } | null {
  if (ex.noLoad || ex.kind === 'task' || ex.kind === 'cardio') return null;
  const std = standardOf(ex.key);
  if (!std || std.bodyweight) return null;
  const { kg } = bodyweightAt(s, date);
  const f = sexFactor(ex.key, s.settings.athlete.sex);
  const [lo, hi] = range(ex);
  const reps = Math.round((lo + hi) / 2);
  const step = ex.step ?? 2.5;
  const min = minLoad(ex, step);
  const levels = GRADES.map((grade, i) => ({ grade, weight: Math.max(min, roundTo(loadFor(kg * std.t[i] * f, reps), step)) }));
  const best = history(s, ex.key, addDays(date, 1), 4).reduce((m, o) => Math.max(m, o.best), 0);
  return { reps, levels, mine: best ? gradeFor(scoreOf(ex.key, best / kg / f)) : null, bodyweight: kg };
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
  // Petit muscle, petites charges : l'haltère du dessus est un gros saut (8 → 10 kg, c'est +25 %). On monte d'abord
  // les reps au-delà de la fourchette, puis la charge, pour retomber dans la fourchette après le saut.
  const jump = last.top > 0 ? step / last.top : 0;
  const repsFirst = ex.kind !== 'compound' && jump > 0.12;
  const top = repsFirst ? Math.min(hi + 3, 25) : hi;
  const allTop = last.sets.length >= ex.sets && last.sets.every((l) => (l.r ?? 0) >= top);
  let weight: number;
  let sets = ex.sets;
  let text: string;

  if (trend === 'stall') {
    weight = roundTo(last.top * 0.9, step);
    text = tr('Stagnation depuis 3 séances : repars à {fmt} (−10 %), remonte en 2 à 3 séances et tu passeras le palier.', { fmt: fmt(weight) });
  } else if (trend === 'down') {
    weight = last.top;
    text = tr('Moins bien que d’habitude (sommeil, calories ?). Garde {fmt} et vise juste {lo} reps propres.', { fmt: fmt(weight), lo });
  } else if (allTop) {
    weight = Math.max(roundTo(last.top + step, step), ideal);
    text =
      weight > last.top + step
        ? tr('Trop facile : {length} séries à {hi} reps ou plus. Passe directement à {fmt} pour {lo} à {hi} reps.', { length: last.sets.length, hi: top, fmt: fmt(weight), lo })
        : tr('Toutes tes séries à {hi} reps : passe à {fmt} et vise {lo} reps.', { hi: top, fmt: fmt(weight), lo });
  } else if (!repsFirst && ideal >= last.top + step) {
    weight = ideal;
    text = tr('Tu as de la marge : {fmt} pour {lo} à {hi} reps devrait passer.', { fmt: fmt(weight), lo, hi });
  } else {
    weight = last.top;
    const reps = last.sets.map((l) => l.r ?? 0);
    const goal = Math.min(top, Math.max(...reps) + 1);
    text =
      repsFirst && Math.max(...reps) >= hi
        ? tr('La charge du dessus, c’est +{pct} % : reste à {fmt} et monte jusqu’à {top} reps sur chaque série, puis passe à {next}.', {
            pct: Math.round(jump * 100),
            fmt: fmt(weight),
            top,
            next: fmt(roundTo(last.top + step, step)),
          })
        : tr('Reste à {fmt} et ajoute 1 rep par série (vise {goal}) avant de monter.', { fmt: fmt(weight), goal });
  }

  // À la limite haute du volume ou en plein déficit, une série de plus n'aide pas : on le signale seulement si le groupe manque de volume.
  const group = catalogEntry(ex.key, s.customExercises)?.group;
  if (group && trend === 'flat') {
    const v = weeklySets(s, date)[group] ?? 0;
    const t = TARGETS[group];
    if (t && v < t[0] && ex.kind === 'compound') {
      sets = ex.sets + 1;
      text += tr(' Tes {GROUP_NAMES} manquent de volume : fais {sets} séries.', { GROUP_NAMES: lower(GROUP_NAMES[group]), sets });
    }
  }

  // Forme du jour : on allège les jours sans, on pousse un peu les bons jours.
  const form = s.days[date]?.form;
  if (form === 'low' && trend !== 'stall') {
    weight = floorTo(weight * 0.93, step);
    text = tr('Forme basse : {fmt} aujourd’hui (−7 %), mêmes reps, 2 reps en réserve. On remonte la prochaine fois.', { fmt: fmt(weight) });
  } else if (form === 'high' && trend !== 'stall' && trend !== 'down') {
    text += tr(' En forme : sur la dernière série, va jusqu’à 1 rep de l’échec.');
  }
  // Semaine de décharge : tout plus léger, pour repartir plus fort.
  if (isDeload(s, date)) {
    weight = floorTo(Math.min(weight, last.top) * 0.9, step);
    sets = ex.sets;
    text = tr('Semaine de décharge : {fmt} (−10 %), {sets} séries, 3 reps en réserve. Tu repars plus fort lundi.', { fmt: fmt(weight), sets });
  }

  const table = [3, 5, 6, 8, 10, 12, 15].map((r) => ({ reps: r, weight: floorTo(loadFor(oneRm, r), step) }));
  return { oneRm, weight, reps: `${lo === hi ? lo : `${lo}–${hi}`}`, sets, trend, text, table };
}

const fmt = (w: number) => `${w.toLocaleString(loc())} kg`;

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
  chest: tr('Pectoraux'),
  back: tr('Dos'),
  shoulders: tr('Épaules'),
  arms: tr('Bras'),
  legs: tr('Jambes'),
  core: tr('Abdos'),
  neck: tr('Cou'),
  cardio: tr('Cardio'),
  other: tr('Autre'),
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
        ? tn(missing, '{fmtSets} par semaine : ajoute {n} série pour atteindre le minimum utile.', '{fmtSets} par semaine : ajoute {n} séries pour atteindre le minimum utile.', { fmtSets: fmtSets(sets) })
        : status === 'high'
          ? tr('{fmtSets} par semaine : c’est beaucoup, surtout en déficit. Retire quelques séries d’isolation.', { fmtSets: fmtSets(sets) })
          : tr('{fmtSets} par semaine : dans la bonne zone.', { fmtSets: fmtSets(sets) });
    return { group: g, name: GROUP_NAMES[g], sets, target, status, weak: g === weak, text };
  });

  // Priorité : point faible en force d'abord, puis les groupes sous le minimum.
  items.sort((a, b) => Number(b.weak) - Number(a.weak) || rank(a) - rank(b) || a.sets / a.target[0] - b.sets / b.target[0]);
  const top = items.find((i) => i.weak) ?? items.find((i) => i.status === 'low');
  const headline = !logged
    ? null
    : top
      ? top.weak
        ? tr('Priorité : {name}. C’est ton groupe le moins fort par rapport à ton poids{v}.', { name: lower(top.name), v: top.status === 'low' ? tr(', et il manque de volume') : '' })
        : tr('Priorité : {name}, sous le minimum de séries.', { name: lower(top.name) })
      : tr('Volume équilibré : continue à monter les charges.');
  return { items, headline, logged };
}

const rank = (i: FocusItem) => (i.status === 'low' ? 0 : i.status === 'ok' ? 1 : 2);
const fmtSets = (n: number) => tn(n, '{n} série', '{n} séries', { n: n.toLocaleString(loc()) });
