// Classement de la semaine du club : rangs (les ex æquo partagent leur place) et la phrase sous le titre.
// Séparé de l'écran pour être testé.
import { formatNumber } from './date';
import { tn, tr } from '../../shared/i18n';

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
const days = (n: number) => tn(n, '{n}\u00a0jour', '{n}\u00a0jours');
const sessionsN = (n: number) => tn(n, '{n}\u00a0séance', '{n}\u00a0séances');

/**
 * La phrase sous « Classement de la semaine ». `left` : jours restants après aujourd'hui (0 le dimanche).
 * « Tu es en tête, encore 5 jours à tenir », « Tu es 2e, à 1 séance de Dhia, encore 5 jours »…
 */
export function boardLine(rows: BoardStanding[], left: number): string {
  if (rows.every((r) => r.week === 0 && r.volume === 0)) return tr('La semaine démarre : la première séance prend la tête');
  const ranks = boardRanks(rows);
  const i = rows.findIndex((r) => r.me);
  if (i < 0) return left > 0 ? tr('Encore {days}', { days: days(left) }) : tr('Dernier jour');
  const me = rows[i];
  if (ranks[i] === 1) {
    if (ranks.filter((k) => k === 1).length > 1)
      return left > 0 ? tr('À égalité en tête, {days} pour faire la différence', { days: days(left) }) : tr('À égalité en tête, dernier jour pour faire la différence');
    return left > 0 ? tr('Tu es en tête, encore {days} à tenir', { days: days(left) }) : tr('Tu es en tête, dernier jour à tenir');
  }
  // La personne juste devant : la moins avancée de celles qui te précèdent.
  const before = rows.filter((o) => ahead(o, me)).sort((a, b) => a.week - b.week || a.volume - b.volume)[0];
  const gap =
    before.week > me.week ? tr('à {gap} de {name}', { gap: sessionsN(before.week - me.week), name: before.name }) : tr('à {volume} de {name}', { volume: boardVolume(before.volume - me.volume), name: before.name });
  const tied = ranks.filter((k) => k === ranks[i]).length > 1 ? tr(' ex æquo') : '';
  const rank = ranks[i];
  return left > 0 ? tr('Tu es {rank}e{tied}, {gap}, encore {days}', { rank, tied, gap, days: days(left) }) : tr('Tu es {rank}e{tied}, {gap}, dernier jour', { rank, tied, gap });
}

/** Les jours de la semaine (du lundi au dimanche) où une séance a été validée, d'après le masque publié. */
export function boardDays(mask: number): boolean[] {
  return Array.from({ length: 7 }, (_, i) => (mask & (1 << i)) !== 0);
}
