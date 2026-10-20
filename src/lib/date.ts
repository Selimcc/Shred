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

const longFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const shortFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

export const formatLong = (k: string) => {
  const s = longFmt.format(parseKey(k));
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const formatShort = (k: string) => shortFmt.format(parseKey(k));

export function formatNumber(n: number, digits = 0): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export const WEEKDAY_LETTERS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
export const WEEKDAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
