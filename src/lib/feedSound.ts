// Son du fil, comme sur Instagram : la publication la plus visible joue sa musique (ou le son de sa vidéo)
// toute seule, et un bouton en bas à droite de la photo ou de la vidéo coupe ou remet le son de tout le fil.
// Activé par défaut ; le choix reste sur le téléphone.
import { useEffect, useState, type RefObject } from 'react';
import { unlockAudio } from './music';

const KEY = 'shred:sound';
const read = () => {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
};

let on = typeof window === 'undefined' ? true : read();
let activeId: string | null = null;
const ratios = new Map<string, number>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function useStore<T>(get: () => T): T {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return get();
}

export function setSound(v: boolean) {
  on = v;
  try {
    localStorage.setItem(KEY, v ? 'on' : 'off');
  } catch {
    // navigation privée : le choix vaut pour cette visite
  }
  if (v) unlockAudio();
  emit();
}

export const useSound = () => useStore(() => on);
/** Publication active (sans le suffixe de sa fiche ouverte). */
export const activePostId = () => activeId?.split(':')[0] ?? null;
export const useActive = (id: string) => useStore(() => activeId === id);
export const useNear = (id: string) => useStore(() => ratios.has(id));

function pick() {
  let best: string | null = null;
  let max = 0.55;
  for (const [id, r] of ratios) if (r >= max) [best, max] = [id, r];
  if (best !== activeId) {
    activeId = best;
    emit();
  }
}

/** Suivre la part visible d'une publication ; la plus visible (plus de la moitié) devient « active ». */
export function useVisibility(ref: RefObject<HTMLElement | null>, id: string) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([e]) => {
        const had = ratios.has(id);
        // Part de l'écran occupée, pour qu'une publication plus haute que l'écran puisse aussi devenir active.
        const seen = e.intersectionRect.height / Math.max(1, Math.min(e.boundingClientRect.height, e.rootBounds?.height ?? window.innerHeight));
        if (e.isIntersecting) ratios.set(id, seen);
        else ratios.delete(id);
        if (had !== ratios.has(id)) emit();
        pick();
      },
      { threshold: Array.from({ length: 21 }, (_, i) => i / 20) },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      ratios.delete(id);
      pick();
      emit();
    };
  }, [ref, id]);
}

// App en arrière-plan : plus rien n'est actif ; au retour, la publication visible reprend.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      activeId = null;
      emit();
    } else pick();
  });
}

// Premier toucher sur la page : le son est débloqué pour la lecture automatique.
if (typeof document !== 'undefined') {
  const first = () => {
    unlockAudio();
    for (const ev of ['touchend', 'click', 'keydown']) document.removeEventListener(ev, first, true);
  };
  for (const ev of ['touchend', 'click', 'keydown']) document.addEventListener(ev, first, true);
}
