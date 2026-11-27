// Variété planifiée, d'après les études sur le sujet : garder les mêmes polyarticulaires pendant des semaines
// permet de suivre et faire monter les charges, alors que changer au hasard à chaque séance n'apporte pas plus de
// muscle (Baz-Valle et coll., 2019). Une variation réfléchie aide en revanche toutes les régions d'un muscle à
// grossir (Fonseca et coll., 2014 ; Kassiano et coll., 2022).
// Donc : les polyarticulaires ne bougent pas ; les exercices d'isolation et de gainage passent à une autre variante
// du même mouvement à chaque bloc de 4 semaines. Et quand un muscle prévu dans la semaine est resté de côté (séance
// sautée, séance écourtée), la séance du jour ajoute un exercice pour le rattraper.
import { catalogEntry } from '../../shared/catalog';
import { PATTERNS, type PatternId, patternsOf, type Region, regionName, regionOf } from '../../shared/generator';
import { usable } from '../../shared/plans';
import { scheduleFor } from '../../shared/program';
import type { ExerciseSlot, SessionDef } from '../../shared/types';
import { addDays, diffDays, mondayOf, weekdayOf } from './date';
import type { AppState } from './state';
import { tr } from '../../shared/i18n';

/** Durée d'un bloc, en semaines. */
export const BLOCK_WEEKS = 4;

const broken = (s: AppState, key: string, date: string) => {
  const b = s.settings.broken?.[key];
  return Boolean(b && b.since <= date && date <= b.until);
};

/** Le bloc d'une date : 0 avant la première rotation, puis 1, 2… Un bloc commence toujours un lundi. */
export function blockOf(s: AppState, date: string): number {
  const v = s.settings.variety;
  if (!v?.on || date < v.since) return 0;
  return 1 + Math.floor(diffDays(date, v.since) / (7 * BLOCK_WEEKS));
}

/** Lundi où les exercices d'isolation changeront de nouveau, ou null si la variété est coupée. */
export function nextRotation(s: AppState, date: string): string | null {
  const v = s.settings.variety;
  if (!v?.on) return null;
  return date < v.since ? v.since : addDays(v.since, blockOf(s, date) * 7 * BLOCK_WEEKS);
}

const ROTATES = new Set(['isolation', 'core']);

/** Ce qui tourne : un exercice de la bibliothèque, d'isolation ou de gainage. Un exercice créé à la main reste. */
export function rotates(s: AppState, key: string): boolean {
  const e = catalogEntry(key, s.customExercises);
  return Boolean(e && !e.custom && ROTATES.has(e.kind));
}

/**
 * Les variantes d'un exercice d'isolation, dans l'ordre des blocs : lui, puis jusqu'à deux autres du même
 * mouvement et du même groupe musculaire, disponibles dans ta salle, qui ne sont pas déjà ailleurs dans la séance
 * ou dans le programme.
 */
export function variantsOf(s: AppState, key: string, taken: Set<string>, date: string): string[] {
  const e = catalogEntry(key, s.customExercises);
  if (!e || !rotates(s, key)) return [key];
  const out = [key];
  for (const p of patternsOf(key))
    for (const k of (PATTERNS[p] as { keys: string[] }).keys) {
      if (out.length >= 3 || out.includes(k) || taken.has(k)) continue;
      const x = catalogEntry(k, s.customExercises);
      if (!x || x.group !== e.group || !ROTATES.has(x.kind) || !usable(k, s.settings.gym) || broken(s, k, date)) continue;
      out.push(k);
    }
  return out;
}

/** Combien de séances avant celle-ci, dans le programme, ont la même place : on décale leurs tours. */
function rank(s: AppState, def: SessionDef, key: string): number {
  const p = patternsOf(key)[0];
  if (!p) return 0;
  let n = 0;
  for (const other of s.program.sessions) {
    if (other.id === def.id) break;
    if (other.type === 'lifting' && other.exercises.some((x) => patternsOf(x.key)[0] === p)) n++;
  }
  return n;
}

/**
 * L'exercice de ce bloc pour chaque place de la séance (clé du programme → clé du jour). Les polyarticulaires, les
 * exercices épinglés et ceux créés à la main gardent leur place.
 */
export function rotationFor(s: AppState, def: SessionDef, date: string): Map<string, string> {
  const out = new Map<string, string>();
  const b = blockOf(s, date);
  if (!b || def.type !== 'lifting') return out;
  const inProgram = new Set(s.program.sessions.flatMap((x) => x.exercises.map((e) => e.key)));
  const inSession = new Set(def.exercises.map((x) => x.key));
  for (const slot of def.exercises) {
    if (slot.pin || !rotates(s, slot.key)) continue;
    const taken = new Set([...inProgram, ...inSession]);
    taken.delete(slot.key);
    const v = variantsOf(s, slot.key, taken, date);
    const key = v[(b + rank(s, def, slot.key)) % v.length];
    if (key === slot.key) continue;
    out.set(slot.key, key);
    inSession.add(key);
  }
  return out;
}

/* ---------- Rattrapage ---------- */

/** Séance d'un jour : celle choisie ce jour-là si `chosen`, sinon celle du planning. */
function sessionOn(s: AppState, date: string, chosen: boolean): SessionDef | undefined {
  const id = (chosen ? s.days[date]?.session : undefined) ?? scheduleFor(s.program, date)[weekdayOf(date)];
  const def = s.program.sessions.find((x) => x.id === id);
  return def?.type === 'lifting' ? def : undefined;
}

function addPlanned(s: AppState, def: SessionDef | undefined, out: Partial<Record<Region, number>>) {
  for (const x of def?.exercises ?? []) {
    const r = regionOf(x.key, s.customExercises);
    if (r) out[r] = (out[r] ?? 0) + (x.sets ?? catalogEntry(x.key, s.customExercises)?.defaults.sets ?? 3);
  }
}

function addDone(s: AppState, date: string, out: Partial<Record<Region, number>>) {
  for (const [key, logs] of Object.entries(s.days[date]?.sets ?? {})) {
    const e = catalogEntry(key, s.customExercises);
    if (!e || e.kind === 'cardio' || e.kind === 'task' || e.kind === 'power') continue;
    const r = regionOf(key, s.customExercises);
    const n = logs.filter((l) => l.done).length;
    if (r && n) out[r] = (out[r] ?? 0) + n;
  }
}

export interface Missed {
  region: Region;
  /** Séries prévues sur la semaine (d'après le planning). */
  planned: number;
  /** Séries qui manqueront même en faisant tout ce qui reste à faire cette semaine. */
  missing: number;
}

/**
 * Les zones que la semaine laisse de côté, vues depuis ce jour : prévu au planning (lundi à dimanche, ou depuis le
 * premier jour dans l'app), moins ce qui a été fait avant ce jour, moins ce qui est encore prévu d'ici dimanche.
 * Seulement les vrais trous : au moins 3 séries et un tiers du prévu de la zone. Les plus grands d'abord.
 */
export function missedThisWeek(s: AppState, date: string): Missed[] {
  const monday = mondayOf(date);
  const from = s.createdAt > monday ? s.createdAt : monday;
  const planned: Partial<Record<Region, number>> = {};
  const done: Partial<Record<Region, number>> = {};
  const ahead: Partial<Record<Region, number>> = {};
  for (let d = from; d <= addDays(monday, 6); d = addDays(d, 1)) {
    addPlanned(s, sessionOn(s, d, false), planned);
    if (d < date) addDone(s, d, done);
    else addPlanned(s, sessionOn(s, d, true), ahead);
  }
  const out: Missed[] = [];
  for (const [r, p] of Object.entries(planned) as [Region, number][]) {
    const missing = p - (done[r] ?? 0) - (ahead[r] ?? 0);
    if (missing >= Math.max(3, Math.ceil(p / 3))) out.push({ region: r, planned: p, missing });
  }
  return out.sort((a, b) => b.missing / b.planned - a.missing / a.planned || b.missing - a.missing);
}

/** Le mouvement qui rattrape une zone : de l'isolation d'abord, peu fatigante et facile à caser en fin de séance. */
const CATCH: Record<Region, PatternId[]> = {
  chest: ['chestIso', 'hpush'],
  back: ['latIso', 'hpull'],
  delts: ['lateral', 'vpush'],
  rear: ['rear'],
  biceps: ['biceps'],
  triceps: ['triceps'],
  quads: ['quadIso', 'quad2'],
  posterior: ['hamIso', 'glute'],
  calves: ['calves'],
  abs: ['abs', 'obliques'],
  traps: ['traps'],
  neck: ['neck'],
};

/**
 * Exercices de rattrapage pour la séance d'un jour (un seul, deux si la séance est courte) : la zone la plus en
 * retard que la séance ne travaille pas déjà, avec 2 ou 3 séries. `minutes` : la durée prévue de la séance.
 */
export function catchUpFor(s: AppState, def: SessionDef, date: string, used: Set<string>, minutes: number): ExerciseSlot[] {
  if (def.type !== 'lifting' || s.settings.variety?.catchUp === false || s.days[date]?.noCatchUp) return [];
  const inSession = new Set(def.exercises.map((x) => regionOf(x.key, s.customExercises)));
  const max = minutes <= s.settings.athlete.minutes - 10 ? 2 : 1;
  const out: ExerciseSlot[] = [];
  for (const m of missedThisWeek(s, date)) {
    if (out.length >= max) break;
    if (inSession.has(m.region)) continue;
    const keys = CATCH[m.region].flatMap((p) => (PATTERNS[p] as { keys: string[] }).keys);
    const key = keys.find((k) => !used.has(k) && catalogEntry(k, s.customExercises) && usable(k, s.settings.gym) && !broken(s, k, date));
    if (!key) continue;
    used.add(key);
    out.push({
      key,
      sets: Math.min(3, Math.max(2, m.missing)),
      note: tr('{region} : {n} séries prévues cette semaine n’ont pas été faites.', { region: regionName(m.region), n: m.missing }),
    });
  }
  return out;
}
