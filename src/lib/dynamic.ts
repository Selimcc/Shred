// La séance s'adapte au jour : exercice remplacé (machine prise ou en panne, douleur, envie de varier),
// sauté ou ajouté, forme du jour, temps disponible. Le programme ne change que si tu le demandes.
import { CATALOG, catalogEntry } from '../../shared/catalog';
import { patternsOf, PATTERNS, type PatternId, regionName, regionOf } from '../../shared/generator';
import { swapsFor, usable } from '../../shared/plans';
import { estimateDuration, resolveExercise } from '../../shared/program';
import type { Exercise, Session, SessionDef } from '../../shared/types';
import { isDeload } from './recovery';
import type { AppState } from './state';
import { dayKey } from './date';
import { blockOf, catchUpFor, rotationFor } from './variety';
import { lower, tr } from '../../shared/i18n';

export type SwapReason = 'busy' | 'broken' | 'pain' | 'vary';

export const SWAP_REASONS: { id: SwapReason; label: string }[] = [
  { id: 'busy', label: tr('Machine prise') },
  { id: 'broken', label: tr('Machine en panne') },
  { id: 'pain', label: tr('Douleur, gêne') },
  { id: 'vary', label: tr('Envie de varier') },
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
    out.push({ key: k, name: e.custom ? e.name : tr(e.name), why, muscles: e.muscles.map((m) => tr(m)) });
  };
  for (const p of patternsOf(key)) for (const k of (PATTERNS[p as PatternId] as { keys: string[] }).keys) push(k, tr('Même mouvement'));
  for (const k of swapsFor(key)) push(k, tr('Remplaçant conseillé'));
  const region = regionOf(key, custom);
  if (region) for (const e of [...CATALOG, ...Object.values(custom)]) if (regionOf(e.key, custom) === region) push(e.key, tr('Même muscle'));
  if (self) for (const e of [...CATALOG, ...Object.values(custom)]) if (e.group === self.group) push(e.key, tr('Même groupe'));
  return out;
}

/**
 * Applique à la séance prévue les changements du jour : variante du bloc, remplacements, pannes, sauts, ajouts,
 * rattrapage d'un muscle oublié dans la semaine, forme, temps.
 */
export function adaptSession(def: SessionDef, base: Session, s: AppState, date: string, today = dayKey()): Session {
  const day = s.days[date];
  const custom = s.customExercises;
  const rotation = rotationFor(s, def, date);
  const catching = def.type === 'lifting' && s.settings.variety?.catchUp !== false && date <= today;
  if (!day && !s.settings.broken && !s.deload?.week && !rotation.size && !catching) return base;
  const exercises: Exercise[] = [];
  const used = new Set<string>();
  const planned = new Set(def.exercises.map((x) => x.key));

  for (const slot of def.exercises) {
    if (day?.skipped?.includes(slot.key)) continue;
    let key = slot.key;
    let change: Exercise['change'];
    const manual = day?.swaps?.[slot.key];
    const turn = rotation.get(slot.key);
    if (manual) {
      key = manual;
      change = 'swap';
    } else if (turn) {
      key = turn;
      change = 'rotate';
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
    exercises.push({ ...ex, slotKey: slot.key, change, ...(change === 'rotate' ? { because: String(blockOf(s, date)) } : {}) });
  }
  for (const slot of day?.extra ?? []) {
    if (used.has(slot.key)) continue;
    used.add(slot.key);
    exercises.push({ ...resolveExercise(slot, custom), change: 'extra' });
  }
  // Un muscle prévu cette semaine est resté de côté : un exercice pour le rattraper, en fin de séance.
  if (catching && !isDeload(s, date) && day?.form !== 'low') {
    const minutes = exercises.reduce((n, e) => n + e.sets * (40 + e.rest), 0) / 60;
    for (const slot of catchUpFor(s, def, date, used, minutes)) {
      const swap = day?.swaps?.[slot.key];
      const key = swap && !used.has(swap) ? swap : slot.key;
      used.add(key);
      const r = regionOf(slot.key, custom);
      exercises.push({ ...resolveExercise({ ...slot, key }, custom), ...(key !== slot.key ? { slotKey: slot.key } : {}), change: 'catchup', ...(r ? { because: lower(regionName(r)) } : {}) });
    }
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
