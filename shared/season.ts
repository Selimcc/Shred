import { tr } from './i18n';
// Thèmes de saison : les fêtes, leurs dates, ce que Pulse en dit. Partagé par l'app (habillage) et le serveur
// (le coach, qui n'accepte qu'un identifiant de cette liste).

export type SeasonId = 'halloween' | 'noel' | 'nouvel-an' | 'saint-valentin' | 'paques';

export interface Season {
  id: SeasonId;
  name: string;
  /** Ce que la page des réglages affiche sous le nom. */
  when: string;
  /** Le vœu du jour J, en titre d'Aujourd'hui. */
  wish: string;
  /** Une phrase pour le coach : le ton, jamais le contenu des conseils. */
  coach: string;
}

export const SEASONS: Record<SeasonId, Season> = {
  halloween: {
    id: 'halloween',
    name: tr('Halloween'),
    when: tr('Du 18 octobre au 1er novembre'),
    wish: tr('Joyeux Halloween'),
    coach:
      tr('Nous sommes dans la période d’Halloween : tu peux glisser une touche de saison (citrouille, frisson, bonbons à mériter), une fois au plus par réponse.'),
  },
  noel: {
    id: 'noel',
    name: tr('Noël'),
    when: tr('Du 1er au 27 décembre'),
    wish: tr('Joyeux Noël'),
    coach:
      tr('Nous sommes dans la période de Noël : tu peux glisser une touche de saison (sapin, repas de fête, traîneau), une fois au plus par réponse, sans culpabiliser les repas de fête.'),
  },
  'nouvel-an': {
    id: 'nouvel-an',
    name: tr('Nouvel an'),
    when: tr('Du 28 décembre au 3 janvier'),
    wish: tr('Bonne année'),
    coach: tr('Nous sommes autour du Nouvel an : tu peux glisser une touche de saison (bonnes résolutions, nouvelle année), une fois au plus par réponse.'),
  },
  'saint-valentin': {
    id: 'saint-valentin',
    name: 'Saint-Valentin',
    when: tr('Du 10 au 15 février'),
    wish: tr('Joyeuse Saint-Valentin'),
    coach:
      tr('Nous sommes autour de la Saint-Valentin : tu peux glisser une touche de saison (avec tendresse, sans supposer que la personne est en couple), une fois au plus par réponse.'),
  },
  paques: {
    id: 'paques',
    name: tr('Pâques'),
    when: tr('La semaine avant Pâques et le lundi'),
    wish: tr('Joyeuses Pâques'),
    coach: tr('Nous sommes autour de Pâques : tu peux glisser une touche de saison (chocolat, chasse aux œufs, printemps), une fois au plus par réponse.'),
  },
};

export const SEASON_IDS = Object.keys(SEASONS) as SeasonId[];

export const isSeasonId = (v: unknown): v is SeasonId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(SEASONS, v);

const pad = (n: number) => String(n).padStart(2, '0');
const key = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const shift = (date: string, days: number) => {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return key(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
};

/** Dimanche de Pâques (calendrier grégorien, algorithme anonyme de Meeus). */
export function easter(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return key(year, month, day);
}

/** La saison d'une date (« AAAA-MM-JJ », heure locale de l'utilisateur), ou null. */
export function seasonOn(date: string): SeasonId | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const year = Number(date.slice(0, 4));
  const md = date.slice(5);
  if (md >= '10-18' && md <= '11-01') return 'halloween';
  if (md >= '12-01' && md <= '12-27') return 'noel';
  if (md >= '12-28' || md <= '01-03') return 'nouvel-an';
  if (md >= '02-10' && md <= '02-15') return 'saint-valentin';
  const sunday = easter(year);
  if (date >= shift(sunday, -7) && date <= shift(sunday, 1)) return 'paques';
  return null;
}

/** Le jour J d'une fête (le vœu passe en titre), ou null. */
export function holidayOn(date: string): SeasonId | null {
  const md = date.slice(5);
  if (md === '10-31') return 'halloween';
  if (md === '12-24' || md === '12-25') return 'noel';
  if (md === '12-31' || md === '01-01') return 'nouvel-an';
  if (md === '02-14') return 'saint-valentin';
  const sunday = easter(Number(date.slice(0, 4)));
  if (date === sunday || date === shift(sunday, 1)) return 'paques';
  return null;
}

/** Prochaine date où une saison commence, à partir d'aujourd'hui (pour la page des réglages). */
export function nextStart(id: SeasonId, today: string): string {
  const year = Number(today.slice(0, 4));
  const start = (y: number) =>
    id === 'halloween'
      ? key(y, 10, 18)
      : id === 'noel'
        ? key(y, 12, 1)
        : id === 'nouvel-an'
          ? key(y, 12, 28)
          : id === 'saint-valentin'
            ? key(y, 2, 10)
            : shift(easter(y), -7);
  for (const y of [year - 1, year, year + 1]) {
    const s = start(y);
    // La saison en cours compte (elle a commencé, mais pas encore fini).
    let end = s;
    while (seasonOn(shift(end, 1)) === id) end = shift(end, 1);
    if (end >= today) return s;
  }
  return start(year + 1);
}
