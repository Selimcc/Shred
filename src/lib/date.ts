import { capital, date, loc } from '../../shared/i18n';
const pad = (n: number) => String(n).padStart(2, '0');

/** Clé de jour locale : YYYY-MM-DD. */
export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseKey(k: string): Date {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function addDays(k: string, n: number): string {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/** 0 = dimanche, comme Date.getDay(). */
export function weekdayOf(k: string): number {
  return parseKey(k).getDay();
}

export function mondayOf(k: string): string {
  return addDays(k, -((weekdayOf(k) + 6) % 7));
}

export function diffDays(a: string, b: string): number {
  return Math.round((parseKey(a).getTime() - parseKey(b).getTime()) / 86_400_000);
}

const longFmt = new Intl.DateTimeFormat(loc(), { weekday: 'long', day: 'numeric', month: 'long' });
const shortFmt = new Intl.DateTimeFormat(loc(), { day: 'numeric', month: 'short' });

export const formatLong = (k: string) => capital(longFmt.format(parseKey(k)));
export const formatShort = (k: string) => shortFmt.format(parseKey(k));

export function formatNumber(n: number, digits = 0): string {
  return n.toLocaleString(loc(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Le 1er janvier 2023 est un dimanche : index = Date.getDay(), comme partout dans l'app.
const days = (weekday: 'long' | 'short' | 'narrow') => Array.from({ length: 7 }, (_, i) => date(new Date(2023, 0, 1 + i, 12), { weekday }));
/** Les jours comme on les écrit dans une phrase : « lundi », « Monday », « Montag ». */
export const WEEKDAY_LOWER = days('long');
/** En début de ligne : « Lundi ». */
export const WEEKDAY_NAMES = WEEKDAY_LOWER.map(capital);
/** « lun. », « Mon ». */
export const WEEKDAY_SHORT = days('short').map(capital);
export const WEEKDAY_LETTERS = days('narrow').map((x) => x.toLocaleUpperCase(loc()));
