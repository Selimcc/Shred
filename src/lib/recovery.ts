// Récupération : semaine de décharge toutes les 6 à 8 semaines, et forme du jour d'après le sommeil,
// le cœur au repos et la VFC envoyés par Apple Santé.
import { addDays, diffDays } from './date';
import type { AppState, Form } from './state';
import { tr } from '../../shared/i18n';

/** Semaines d'entraînement avant de proposer une décharge (plus tôt si plusieurs exercices plafonnent). */
export const DELOAD_AFTER = 6;
export const DELOAD_MAX = 8;

export function isDeload(s: AppState, date: string): boolean {
  const w = s.deload?.week;
  return Boolean(w && date >= w && date <= addDays(w, 6));
}

/** Premier jour avec des séries notées, ou fin de la dernière décharge. */
function blockStart(s: AppState): string | null {
  if (s.deload?.lastEnd) return s.deload.lastEnd;
  const lifted = Object.entries(s.days)
    .filter(([, d]) => Object.values(d.sets).some((l) => l.some((x) => x.done && x.w)))
    .map(([date]) => date)
    .sort();
  return lifted[0] ?? null;
}

/** Semaines d'entraînement depuis le début du bloc. */
export function weeksInBlock(s: AppState, today: string): number {
  const start = blockStart(s);
  return start ? Math.floor(diffDays(today, start) / 7) : 0;
}

/** À appeler au changement de jour : une décharge finie devient le début du bloc suivant. */
export function closeDeload(d: AppState, today: string) {
  const w = d.deload?.week;
  if (w && today > addDays(w, 6)) d.deload = { lastEnd: addDays(w, 6) };
}

/* ---------- Forme du jour d'après Santé ---------- */

export interface FormHint {
  form: Form;
  reasons: string[];
}

const fmtSleep = (min: number) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;

/** Moyenne des 14 jours précédents (référence personnelle). */
function baseline(s: AppState, today: string, key: 'hrv' | 'restingHr' | 'sleepMin'): number | null {
  const v = Array.from({ length: 14 }, (_, i) => s.health[addDays(today, -i - 1)]?.[key]).filter((x): x is number => typeof x === 'number');
  return v.length >= 4 ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Ce que disent le sommeil et le cœur ce matin. null si Santé n'a rien envoyé. */
export function formHint(s: AppState, today: string): FormHint | null {
  const h = s.health[today];
  if (!h || (h.sleepMin === undefined && h.hrv === undefined && h.restingHr === undefined)) return null;
  const low: string[] = [];
  const good: string[] = [];
  if (h.sleepMin !== undefined) {
    if (h.sleepMin < 6 * 60) low.push(tr('{fmtSleep} de sommeil', { fmtSleep: fmtSleep(h.sleepMin) }));
    else if (h.sleepMin >= 7.5 * 60) good.push(tr('{fmtSleep} de sommeil', { fmtSleep: fmtSleep(h.sleepMin) }));
  }
  const hrv0 = baseline(s, today, 'hrv');
  if (h.hrv !== undefined && hrv0) {
    if (h.hrv < hrv0 * 0.8) low.push(tr('VFC basse ({hrv} ms contre {n} d’habitude)', { hrv: h.hrv, n: Math.round(hrv0) }));
    else if (h.hrv >= hrv0 * 1.05) good.push(tr('VFC au-dessus de ta moyenne'));
  }
  const hr0 = baseline(s, today, 'restingHr');
  if (h.restingHr !== undefined && hr0 && h.restingHr >= hr0 + 5) low.push(tr('cœur au repos à {restingHr} bpm ({n} d’habitude)', { restingHr: h.restingHr, n: Math.round(hr0) }));
  if (low.length) return { form: 'low', reasons: low };
  if (good.length >= 2 || (good.length === 1 && h.hrv === undefined)) return { form: 'high', reasons: good };
  return { form: 'ok', reasons: h.sleepMin !== undefined ? [tr('{fmtSleep} de sommeil', { fmtSleep: fmtSleep(h.sleepMin) })] : [] };
}
