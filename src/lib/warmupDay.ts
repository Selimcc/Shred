// L'échauffement d'un jour donné : la séance du jour (remplacements et exercices sautés compris), le matériel de
// la salle et la charge prévue sur le premier gros mouvement. Sans état : l'app et le connecteur Claude s'en servent.
import { firstLoaded, type Warmup, warmupFor } from '../../shared/warmup';
import { adviseLoad } from './advisor';
import { lastPerformance, sessionFor } from './logic';
import type { AppState } from './state';

/** L'échauffement proposé ce jour-là, ou null (repos, récupération, ou échauffement coupé dans les réglages). */
export function dayWarmup(s: AppState, date: string): Warmup | null {
  if (s.settings.warmup === false) return null;
  const session = sessionFor(s, date);
  const first = firstLoaded(session.exercises);
  let work = 0;
  if (first) {
    const day = s.days[date]?.sets[first.key];
    // La charge déjà notée aujourd'hui, sinon celle que conseille Pulse, sinon la meilleure de la dernière fois.
    work =
      day?.find((l) => l.w)?.w ??
      adviseLoad(s, first, date)?.weight ??
      Math.max(0, ...(lastPerformance(s, first.key, date)?.sets.map((l) => l.w ?? 0) ?? []));
  }
  return warmupFor(session, { gym: s.settings.gym, custom: s.customExercises, ramp: first && work ? { key: first.key, work } : undefined });
}
