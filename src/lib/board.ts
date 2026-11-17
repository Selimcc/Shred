// Classement de la semaine du club : rangs (les ex æquo partagent leur place) et la phrase sous le titre.
// Séparé de l'écran pour être testé.
import { formatNumber } from './date';

export interface BoardStanding {
  name: string;
  me: boolean;
  week: number;
  volume: number;
}

/** Devant : plus de séances, ou autant avec plus de tonnage. La série ne départage pas (elle n'est pas de la semaine). */
const ahead = (a: BoardStanding, b: BoardStanding) => a.week > b.week || (a.week === b.week && a.volume > b.volume);

/** Rang de chaque ligne : 1 + le nombre de personnes devant (deux ex æquo à la 1re place, puis 3e). */
export function boardRanks(rows: BoardStanding[]): number[] {
  return rows.map((r) => 1 + rows.filter((o) => ahead(o, r)).length);
}

export const boardVolume = (kg: number) => (kg >= 1000 ? `${formatNumber(kg / 1000, 1)}\u00a0t` : `${Math.round(kg)}\u00a0kg`);

/** « 5 jours », « 1 séance » : insécable entre le nombre et le mot, pour qu'ils restent sur la même ligne. */
const plural = (n: number, word: string) => `${n}\u00a0${word}${n > 1 ? 's' : ''}`;

/**
 * La phrase sous « Classement de la semaine ». `left` : jours restants après aujourd'hui (0 le dimanche).
 * « Tu es en tête, encore 5 jours à tenir », « Tu es 2e, à 1 séance de Dhia, encore 5 jours »…
 */
export function boardLine(rows: BoardStanding[], left: number): string {
  const time = (rest: string, last: string) => (left > 0 ? `, encore ${plural(left, 'jour')}${rest}` : last);
  if (rows.every((r) => r.week === 0 && r.volume === 0)) return 'La semaine démarre : la première séance prend la tête';
  const ranks = boardRanks(rows);
  const i = rows.findIndex((r) => r.me);
  if (i < 0) return left > 0 ? `Encore ${plural(left, 'jour')}` : 'Dernier jour';
  const me = rows[i];
  if (ranks[i] === 1) {
    if (ranks.filter((k) => k === 1).length > 1) return `À égalité en tête${left > 0 ? `, ${plural(left, 'jour')} pour faire la différence` : ', dernier jour pour faire la différence'}`;
    return `Tu es en tête${time(' à tenir', ', dernier jour à tenir')}`;
  }
  // La personne juste devant : la moins avancée de celles qui te précèdent.
  const before = rows.filter((o) => ahead(o, me)).sort((a, b) => a.week - b.week || a.volume - b.volume)[0];
  const gap =
    before.week > me.week ? `à ${plural(before.week - me.week, 'séance')} de ${before.name}` : `à ${boardVolume(before.volume - me.volume)} de ${before.name}`;
  const tied = ranks.filter((k) => k === ranks[i]).length > 1 ? ' ex æquo' : '';
  return `Tu es ${ranks[i]}e${tied}, ${gap}${time('', ', dernier jour')}`;
}

/** Les jours de la semaine (du lundi au dimanche) où une séance a été validée, d'après le masque publié. */
export function boardDays(mask: number): boolean[] {
  return Array.from({ length: 7 }, (_, i) => (mask & (1 << i)) !== 0);
}
