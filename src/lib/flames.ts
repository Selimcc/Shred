// Les flammes : des paliers de série de plus en plus espacés, à partir de l'objectif choisi.
// 7 jours → 1re flamme, puis 14, 21, 30, 45, 60, 90… Chaque flamme gagnée change la couleur de la tienne.
import { streakInfo } from './logic';
import type { AppState } from './state';
import { tr } from '../../shared/i18n';

export const STREAK_GOALS = [3, 7, 14, 30] as const;

const LADDER = [3, 7, 14, 21, 30, 45, 60, 90, 120, 180, 270, 365];

/** Paliers à partir de l'objectif, prolongés de 100 en 100 après un an. */
export function ladder(goal: number, upTo = 0): number[] {
  const out = LADDER.filter((n) => n >= goal);
  if (!out.length) out.push(goal);
  while (out[out.length - 1] <= upTo) out.push(out[out.length - 1] + 100);
  return out;
}

export interface FlameTier {
  name: string;
  /** Contour, milieu, cœur. */
  colors: [string, string, string];
}

export const TIERS: FlameTier[] = [
  { name: tr('Étincelle'), colors: ['#ff7a1f', '#ffb02e', '#fff1b8'] },
  { name: tr('Flamme ardente'), colors: ['#ff4614', '#ff8f1f', '#ffe08a'] },
  { name: tr('Flamme d’or'), colors: ['#f0a000', '#ffd23d', '#fff8d6'] },
  { name: tr('Flamme bleue'), colors: ['#246bff', '#5cc8ff', '#e8fbff'] },
  { name: tr('Flamme violette'), colors: ['#7a32ff', '#cf6bff', '#fbeaff'] },
  { name: tr('Flamme légendaire'), colors: ['#ff2f78', '#ffc53d', '#ffffff'] },
];

export const tierAt = (earned: number) => Math.min(earned, TIERS.length - 1);

export function flameInfo(s: AppState, today: string) {
  const st = streakInfo(s, today);
  const goal = s.settings.streakGoal || 7;
  const steps = ladder(goal, st.best);
  const earned = steps.filter((n) => n <= st.best);
  const next = steps.find((n) => n > st.best) ?? steps[steps.length - 1];
  const tier = tierAt(earned.length);
  return {
    ...st,
    goal,
    steps,
    earned,
    next,
    /** Jours qui restent, depuis la série actuelle, pour gagner la prochaine flamme. */
    toNext: Math.max(0, next - st.current),
    tier,
    tierInfo: TIERS[tier],
  };
}

export type Celebration = { kind: 'first' } | { kind: 'milestone'; days: number; tier: number } | { kind: 'daily' };

/** Ce qu'il faut fêter aujourd'hui, une seule fois par jour. */
export function celebrationFor(s: AppState, today: string): Celebration | null {
  const st = streakInfo(s, today);
  if (!st.todayValidated || s.ui.celebrated === today) return null;
  const goal = s.settings.streakGoal || 7;
  const steps = ladder(goal, st.current);
  // s.streak.best ne compte pas encore aujourd'hui : un palier dépassé pour la première fois est nouveau.
  if (steps.includes(st.current) && st.current > s.streak.best) {
    return { kind: 'milestone', days: st.current, tier: tierAt(steps.filter((n) => n <= st.current).length) };
  }
  if (!s.ui.metKilo && s.streak.best === 0) return { kind: 'first' };
  return { kind: 'daily' };
}
