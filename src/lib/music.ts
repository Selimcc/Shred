// Musique des publications : recherche (extraits Apple Music de 30 s, via le serveur) et un seul lecteur
// pour toute l'app, comme sur Instagram : lancer un extrait arrête le précédent.
import { useEffect, useState } from 'react';
import { api, DEMO } from './api';

export interface Track {
  id: string;
  title: string;
  artist: string;
  artwork: string;
  preview?: string;
  link: string;
}

const DEMO_TRACKS: Track[] = [
  { id: '1', title: 'Lose Yourself', artist: 'Eminem', artwork: '', link: 'https://music.apple.com/' },
  { id: '2', title: 'Till I Collapse', artist: 'Eminem, Nate Dogg', artwork: '', link: 'https://music.apple.com/' },
  { id: '3', title: 'Eye of the Tiger', artist: 'Survivor', artwork: '', link: 'https://music.apple.com/' },
  { id: '4', title: 'Stronger', artist: 'Kanye West', artwork: '', link: 'https://music.apple.com/' },
];

/** Pays du magasin Apple Music, d'après la langue du téléphone (FR par défaut). */
function country(): string {
  const r = (navigator.language || 'fr-FR').split('-')[1]?.toUpperCase();
  return r && /^[A-Z]{2}$/.test(r) ? r : 'FR';
}

export async function searchMusic(q: string): Promise<Track[]> {
  if (DEMO) {
    await new Promise((r) => setTimeout(r, 250));
    const n = q.toLowerCase();
    return DEMO_TRACKS.filter((t) => `${t.title} ${t.artist}`.toLowerCase().includes(n));
  }
  return (await api<{ tracks: Track[] }>(`/api/music/search?country=${country()}&q=${encodeURIComponent(q)}`)).tracks;
}

/* ---------- Lecteur unique ---------- */

let audio: HTMLAudioElement | null = null;
let current: string | null = null;
let progress = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toggle(t: Track, key = t.id) {
  if (!t.preview) return;
  if (!audio) {
    audio = new Audio();
    audio.preload = 'none';
    audio.addEventListener('timeupdate', () => {
      progress = audio && audio.duration ? audio.currentTime / audio.duration : 0;
      emit();
    });
    audio.addEventListener('ended', () => {
      current = null;
      progress = 0;
      emit();
    });
  }
  if (current === key && !audio.paused) {
    audio.pause();
    current = null;
  } else {
    if (current !== key) {
      audio.src = t.preview;
      progress = 0;
    }
    current = key;
    void audio.play().catch(() => {
      current = null;
      emit();
    });
  }
  emit();
}

export function stopMusic() {
  audio?.pause();
  current = null;
  emit();
}

/** État du lecteur pour un extrait : en cours ou non, et avancement (0 à 1). */
export function usePlayer(key: string): { playing: boolean; progress: number } {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return { playing: current === key, progress: current === key ? progress : 0 };
}
