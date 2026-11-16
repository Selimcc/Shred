// La séance s'adapte au jour : exercice remplacé (machine prise ou en panne, douleur, envie de varier),
// sauté ou ajouté, forme du jour, temps disponible. Le programme ne change que si tu le demandes.
import { CATALOG, catalogEntry } from '../../shared/catalog';
import { patternsOf, PATTERNS, type PatternId, regionOf } from '../../shared/generator';
import { swapsFor, usable } from '../../shared/plans';
import { estimateDuration, resolveExercise } from '../../shared/program';
import type { Exercise, Session, SessionDef } from '../../shared/types';
import { addDays } from './date';
import { isDeload } from './recovery';
import { type AppState, ensureDay, type Form, setState } from './store';

export type SwapReason = 'busy' | 'broken' | 'pain' | 'vary';

export const SWAP_REASONS: { id: SwapReason; label: string }[] = [
  { id: 'busy', label: 'Machine prise' },
  { id: 'broken', label: 'Machine en panne' },
  { id: 'pain', label: 'Douleur, gêne' },
  { id: 'vary', label: 'Envie de varier' },
];

/** Durée de remplacement automatique d'une machine signalée en panne. */
export const BROKEN_DAYS = 7;

export function isBroken(s: AppState, key: string, date: string): boolean {
  const b = s.settings.broken?.[key];
  return Boolean(b && b.since <= date && date <= b.until);
}

export interface Alternative {
  key: string;
  name: string;
  why: string;
  muscles: string[];
}

/**
 * Remplaçants d'un exercice : même mouvement d'abord, puis les remplaçants conseillés, puis le même muscle.
 * Seulement ce que ta salle a, sans les machines en panne ni ce qui est déjà dans la séance.
 */
export function alternatives(s: AppState, key: string, date: string, exclude: string[] = []): Alternative[] {
  const gym = s.settings.gym;
  const custom = s.customExercises;
  const seen = new Set<string>([key, ...exclude]);
  const out: Alternative[] = [];
  const self = catalogEntry(key, custom);
  const push = (k: string, why: string) => {
    if (seen.has(k)) return;
    const e = catalogEntry(k, custom);
    if (!e || e.kind === 'task' || (e.kind === 'cardio' && self?.kind !== 'cardio')) return;
    if (!usable(k, gym) || isBroken(s, k, date)) return;
    seen.add(k);
    out.push({ key: k, name: e.name, why, muscles: e.muscles });
  };
  for (const p of patternsOf(key)) for (const k of (PATTERNS[p as PatternId] as { keys: string[] }).keys) push(k, 'Même mouvement');
  for (const k of swapsFor(key)) push(k, 'Remplaçant conseillé');
  const region = regionOf(key, custom);
  if (region) for (const e of [...CATALOG, ...Object.values(custom)]) if (regionOf(e.key, custom) === region) push(e.key, 'Même muscle');
  if (self) for (const e of [...CATALOG, ...Object.values(custom)]) if (e.group === self.group) push(e.key, 'Même groupe');
  return out;
}

/** Applique à la séance prévue les changements du jour : remplacements, pannes, sauts, ajouts, forme, temps. */
export function adaptSession(def: SessionDef, base: Session, s: AppState, date: string): Session {
  const day = s.days[date];
  const custom = s.customExercises;
  if (!day && !s.settings.broken && !s.deload?.week) return base;
  const exercises: Exercise[] = [];
  const used = new Set<string>();
  const planned = new Set(def.exercises.map((x) => x.key));

  for (const slot of def.exercises) {
    if (day?.skipped?.includes(slot.key)) continue;
    let key = slot.key;
    let change: Exercise['change'];
    const manual = day?.swaps?.[slot.key];
    if (manual) {
      key = manual;
      change = 'swap';
    } else if (isBroken(s, slot.key, date)) {
      const alt = alternatives(s, slot.key, date, [...planned, ...used])[0];
      if (alt) {
        key = alt.key;
        change = 'broken';
      }
    }
    if (used.has(key)) continue;
    used.add(key);
    if (!change) {
      exercises.push(resolveExercise(slot, custom));
      continue;
    }
    const from = catalogEntry(slot.key, custom);
    const to = catalogEntry(key, custom);
    // Même famille (polyarticulaire ↔ polyarticulaire) : on garde les reps prévues ; sinon celles du nouvel exercice.
    const sameKind = from && to && from.kind === to.kind;
    const ex = resolveExercise({ key, sets: slot.sets, reps: sameKind ? slot.reps : undefined, rest: sameKind ? slot.rest : undefined }, custom);
    exercises.push({ ...ex, slotKey: slot.key, change });
  }
  for (const slot of day?.extra ?? []) {
    if (used.has(slot.key)) continue;
    used.add(slot.key);
    exercises.push({ ...resolveExercise(slot, custom), change: 'extra' });
  }

  let list = exercises;
  // Décharge : un tiers de séries en moins sur la muscu.
  if (isDeload(s, date)) list = list.map((e) => (isLift(e) ? { ...e, sets: Math.max(2, Math.ceil(e.sets * 0.6)) } : e));
  else if (day?.form === 'low') list = list.map((e, i) => (isLift(e) && e.sets >= 3 ? { ...e, sets: e.sets - (i === 0 ? 0 : 1) } : e));
  if (day?.express) list = compress(list, day.express);

  return { ...base, exercises: list, duration: estimateDuration(list) };
}

const isLift = (e: Exercise) => e.kind !== 'cardio' && e.kind !== 'task';

/** Séance express : moins de repos, puis moins de séries sur l'isolation, puis on retire la fin. Le premier exercice reste entier. */
export function compress(list: Exercise[], minutes: number): Exercise[] {
  const out = list.map((e, i) => ({ ...e, rest: i === 0 ? Math.min(e.rest, 150) : Math.min(e.rest, e.kind === 'compound' ? 105 : 60) }));
  const secs = () => out.reduce((n, e) => n + e.sets * (40 + e.rest), 0);
  for (let guard = 0; guard < 60 && secs() > minutes * 60; guard++) {
    const iso = out
      .map((e, i) => ({ e, i }))
      .filter(({ e, i }) => i > 0 && isLift(e) && e.sets > 2)
      .sort((x, y) => Number(x.e.kind === 'compound') - Number(y.e.kind === 'compound') || y.e.sets - x.e.sets)[0];
    if (iso) {
      iso.e.sets--;
      continue;
    }
    if (out.length > 1) {
      // On retire la fin de séance (isolation et gainage d'abord).
      const idx = [...out.keys()].reverse().find((i) => i > 0 && out[i].kind !== 'compound') ?? out.length - 1;
      out.splice(idx, 1);
      continue;
    }
    break;
  }
  return out;
}

/* ---------- Actions ---------- */

export function swapExercise(date: string, slotKey: string, toKey: string, opts: { reason: SwapReason; always?: boolean; sessionId?: string }) {
  setState((d) => {
    const day = ensureDay(d, date);
    if (opts.always && opts.sessionId) {
      const def = d.program.sessions.find((x) => x.id === opts.sessionId);
      const slot = def?.exercises.find((x) => x.key === slotKey);
      if (slot) {
        const from = catalogEntry(slotKey, d.customExercises);
        const to = catalogEntry(toKey, d.customExercises);
        slot.key = toKey;
        slot.note = undefined;
        if (from && to && from.kind !== to.kind) {
          slot.reps = undefined;
          slot.rest = undefined;
        }
        if (day.swaps) delete day.swaps[slotKey];
        return;
      }
    }
    (day.swaps ??= {})[slotKey] = toKey;
    if (opts.reason === 'broken') (d.settings.broken ??= {})[slotKey] = { since: date, until: addDays(date, BROKEN_DAYS) };
  });
}

export function undoSwap(date: string, slotKey: string) {
  setState((d) => {
    const day = ensureDay(d, date);
    if (day.swaps) delete day.swaps[slotKey];
    const b = d.settings.broken?.[slotKey];
    if (b && b.since === date) delete d.settings.broken![slotKey];
  });
}

export function markRepaired(key: string) {
  setState((d) => {
    if (d.settings.broken) delete d.settings.broken[key];
  });
}

export function skipExercise(date: string, slotKey: string, skip = true) {
  setState((d) => {
    const day = ensureDay(d, date);
    const list = new Set(day.skipped ?? []);
    if (skip) list.add(slotKey);
    else list.delete(slotKey);
    day.skipped = [...list];
  });
}

export function addExtra(date: string, key: string) {
  setState((d) => {
    const day = ensureDay(d, date);
    if (!day.extra?.some((x) => x.key === key)) (day.extra ??= []).push({ key });
  });
}

export function removeExtra(date: string, key: string) {
  setState((d) => {
    const day = ensureDay(d, date);
    day.extra = (day.extra ?? []).filter((x) => x.key !== key);
  });
}

export function setForm(date: string, form: Form | undefined) {
  setState((d) => void (ensureDay(d, date).form = form));
}

export function setExpress(date: string, minutes: number | undefined) {
  setState((d) => void (ensureDay(d, date).express = minutes));
}
