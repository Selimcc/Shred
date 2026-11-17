// Ce que la personne change à sa séance du jour (remplacer, sauter, ajouter un exercice, forme, temps
// disponible) et la semaine de décharge. Séparé des calculs (dynamic.ts, recovery.ts), que le serveur
// réutilise sans l'état de l'app.
import { catalogEntry } from '../../shared/catalog';
import { addDays, mondayOf } from './date';
import { BROKEN_DAYS, type SwapReason } from './dynamic';
import { ensureDay, type Form, setState } from './store';

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

export function startDeload(today: string) {
  setState((d) => void (d.deload = { ...d.deload, week: mondayOf(today) }));
}

export function stopDeload() {
  setState((d) => void (d.deload = { ...d.deload, week: undefined }));
}
