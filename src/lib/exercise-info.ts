// Démos des exercices. Images : Free Exercise DB (domaine public, licence Unlicense),
// github.com/yuhonas/free-exercise-db. Une démo = deux images <key>-0.jpg et <key>-1.jpg.
import { catalogEntry } from '../../shared/catalog';
import type { CatalogEntry } from '../../shared/types';
import { tr } from '../../shared/i18n';

const frames = import.meta.glob('../assets/exercises/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export function exerciseInfo(key: string, custom: Record<string, CatalogEntry> = {}): { muscles: string[]; cue: string } {
  const e = catalogEntry(key, custom);
  if (!e) return { muscles: [], cue: '' };
  // La bibliothèque est traduite ; un exercice créé par l'utilisateur garde ses mots.
  return e.custom ? { muscles: e.muscles, cue: e.cue ?? '' } : { muscles: e.muscles.map((m) => tr(m)), cue: e.cue ? tr(e.cue) : '' };
}

/** Les deux positions (départ, arrivée) de la démo, ou null si aucune image. */
export function exerciseFrames(key: string): [string, string] | null {
  const a = frames[`../assets/exercises/${key}-0.jpg`];
  const b = frames[`../assets/exercises/${key}-1.jpg`];
  return a && b ? [a, b] : null;
}

export function videoUrl(name: string): string {
  const clean = name.replace(/\(.*?\)/g, '').trim();
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(tr('{clean} exécution', { clean }))}`;
}
