// La saison affichée : celle du calendrier, aucune si l'utilisateur les a coupées, ou celle qu'il essaie.
// Plus ce que Pulse en dit et les couleurs des fêtes (confettis, lumière de Pulse).
import { useSyncExternalStore } from 'react';
import { easter, holidayOn, isSeasonId, type SeasonId, SEASONS, seasonOn } from '../../shared/season';
import { dayKey } from './date';
import { type AppState, useApp } from './store';

export { SEASONS, type SeasonId } from '../../shared/season';

// Aperçu par l'adresse (« ?saison=noel ») : pour la démo et les captures. Liste blanche, rien d'autre n'est lu.
const fromUrl: SeasonId | null = (() => {
  try {
    const v = new URLSearchParams(globalThis.location?.search ?? '').get('saison');
    return isSeasonId(v) ? v : null;
  } catch {
    return null;
  }
})();

/* ---------- Labo des admins : un thème forcé sur cet appareil, le temps de la session ---------- */

export interface SeasonLab {
  season: SeasonId;
  /** Simuler le jour J (vœu en titre, « Bonne année » du bouquet). */
  holiday: boolean;
}
let lab: SeasonLab | null = null;
const labSubs = new Set<() => void>();

/** Ni enregistré ni synchronisé : il disparaît à la fermeture de l'app. */
export function setSeasonLab(next: SeasonLab | null) {
  lab = next;
  for (const f of labSubs) f();
}

export function useSeasonLab(): SeasonLab | null {
  return useSyncExternalStore(
    (cb) => {
      labSubs.add(cb);
      return () => labSubs.delete(cb);
    },
    () => lab,
    () => lab,
  );
}

/** La date que voient les vœux et les scènes : aujourd'hui, ou le jour J de la fête testée. */
export function seasonDay(today: string): string {
  if (!lab?.holiday) return today;
  const y = Number(today.slice(0, 4));
  switch (lab.season) {
    case 'halloween':
      return `${y}-10-31`;
    case 'noel':
      return `${y}-12-25`;
    case 'nouvel-an':
      return `${y + 1}-01-01`;
    case 'saint-valentin':
      return `${y}-02-14`;
    case 'paques':
      return easter(y);
  }
}

export function activeSeason(s: AppState, today: string): SeasonId | null {
  if (lab) return lab.season;
  if (fromUrl) return fromUrl;
  const pref = s.settings.season ?? 'auto';
  if (pref === 'off') return null;
  if (isSeasonId(pref)) return pref;
  return seasonOn(today);
}

export function useSeason(): SeasonId | null {
  useSeasonLab();
  return activeSeason(useApp(), dayKey());
}

/** Le titre d'Aujourd'hui : le vœu le jour J de la fête affichée, sinon « Salut ». */
export function greeting(season: SeasonId | null, today: string, name: string): string {
  const wish = season && holidayOn(today) === season ? SEASONS[season].wish : 'Salut';
  return name ? `${wish} ${name}` : wish;
}

/** Pulse annonce la séance du jour. `what` : « Pull : 9 exercices, environ 55 min ». */
export function seasonStart(season: SeasonId, today: string, name: string, what: string): string {
  const n = name ? ` ${name}` : '';
  switch (season) {
    case 'halloween':
      return `Bouh${n} ! Aujourd’hui c’est ${what}. Les bonbons, ce sera après la dernière série.`;
    case 'noel':
      return `Ho ho ho${n} ! Aujourd’hui c’est ${what}. Le père Noël livre, toi tu pousses.`;
    case 'nouvel-an':
      return today.slice(5) >= '12-28' ? `Dernière ligne droite de l’année${n} ! Aujourd’hui c’est ${what}.` : `Bonne année${n} ! On démarre fort : ${what}.`;
    case 'saint-valentin':
      return `Rendez-vous${n} ! Aujourd’hui c’est ${what}. La barre ne pose jamais de lapin.`;
    case 'paques':
      return `Chasse aux œufs${n} ? Moi je chasse les records : aujourd’hui c’est ${what}.`;
  }
}

/** La fin du message de journée validée. */
export const SEASON_SHINE: Record<SeasonId, string> = {
  halloween: 'Je brille comme une citrouille grâce à toi, reviens demain.',
  noel: 'Je brille plus que le sapin grâce à toi, reviens demain.',
  'nouvel-an': 'Je pétille comme le champagne grâce à toi, reviens demain.',
  'saint-valentin': 'Mon cœur brille grâce à toi, reviens demain.',
  paques: 'Je brille comme un œuf en or grâce à toi, reviens demain.',
};

/** Confettis et étincelles des fêtes. */
export const SEASON_PALETTE: Record<SeasonId, string[]> = {
  halloween: ['#ff7a1a', '#ffb02e', '#9b6bff', '#7be36b', '#ff4d5e', '#f4f1e8'],
  noel: ['#e8384f', '#ffffff', '#3cb371', '#ffd166', '#bfe3ff'],
  'nouvel-an': ['#ffd166', '#fff3c4', '#e8c07a', '#ffffff', '#c9a7ff'],
  'saint-valentin': ['#ff4d7d', '#ff8fab', '#ffc2d1', '#ffffff', '#e8384f'],
  paques: ['#ffd36e', '#b8f2c8', '#cdb4ff', '#ffb3c7', '#a7d8ff'],
};

/** La lumière de Pulse (bord, milieu, cœur) quand la fête la change ; null : la couleur de tes flammes. */
export const SEASON_LIGHT: Record<SeasonId, readonly [string, string, string] | null> = {
  halloween: ['#c2410c', '#ff8a1f', '#ffe08a'],
  noel: null,
  'nouvel-an': ['#a8740d', '#ffd166', '#fff6d6'],
  'saint-valentin': ['#c2185b', '#ff5c8a', '#ffd6e2'],
  paques: ['#d9a400', '#ffe066', '#fffbe6'],
};

/** Couleur de la barre d'état du téléphone. */
export const SEASON_BAR: Record<SeasonId, string> = {
  halloween: '#120c14',
  noel: '#0d1414',
  'nouvel-an': '#0f0e14',
  'saint-valentin': '#160d12',
  paques: '#10141a',
};
