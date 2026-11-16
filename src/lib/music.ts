// Musique des publications : recherche (extraits Apple Music de 30 s, via le serveur) et un seul lecteur
// pour toute l'app, comme sur Instagram : lancer un extrait arrête le précédent.
import { useEffect, useState } from 'react';
import { api, DEMO } from './api';

export type MusicSource = 'apple' | 'deezer' | 'soundcloud';

export interface Track {
  /** Absent sur les anciennes publications : Apple Music. */
  source?: MusicSource;
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

export const SOURCE_NAME: Record<MusicSource, string> = { apple: 'Apple Music', deezer: 'Deezer', soundcloud: 'SoundCloud' };

export const isSoundCloud = (q: string) => /^https?:\/\/(www\.|m\.|on\.)?soundcloud\.com\//i.test(q.trim());

/** Lien SoundCloud collé : le morceau, avec titre, artiste et pochette. */
export async function soundcloudTrack(link: string): Promise<Track> {
  if (DEMO) return { source: 'soundcloud', id: link, title: 'Morceau SoundCloud', artist: 'Artiste', artwork: '', link };
  return (await api<{ track: Track }>(`/api/music/soundcloud?url=${encodeURIComponent(link.trim())}`)).track;
}

export async function searchMusic(q: string): Promise<Track[]> {
  if (DEMO) {
    await new Promise((r) => setTimeout(r, 250));
    const n = q.toLowerCase();
    return DEMO_TRACKS.filter((t) => `${t.title} ${t.artist}`.toLowerCase().includes(n));
  }
  return (await api<{ tracks: Track[] }>(`/api/music/search?country=${country()}&q=${encodeURIComponent(q)}`)).tracks;
}

/* ---------- Lecteur ---------- */
//
// Un seul extrait à la fois. Pour que ça démarre vite :
// - l'adresse des extraits Deezer (qui expirent) est demandée dès que la publication est visible ;
// - le fichier se télécharge dès que le doigt touche le bouton (avant même le « clic »), et les premiers
//   résultats d'une recherche sont préchargés ;
// - chaque extrait garde son propre lecteur (6 au plus en mémoire) : revenir à un extrait déjà chargé est immédiat.

let current: string | null = null;
let loading = false;
let progress = 0;
let active: HTMLAudioElement | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const fresh = new Map<string, { url: string | null; at: number; promise?: Promise<string | null> }>();
const pool = new Map<string, HTMLAudioElement>();
let shared: HTMLAudioElement | null = null;

function watch(el: HTMLAudioElement) {
  el.addEventListener('timeupdate', () => {
    if (el !== active) return;
    progress = el.duration ? el.currentTime / el.duration : 0;
    emit();
  });
  el.addEventListener('playing', () => {
    if (el !== active) return;
    loading = false;
    emit();
  });
  el.addEventListener('ended', () => {
    if (el !== active) return;
    current = null;
    loading = false;
    progress = 0;
    emit();
  });
  return el;
}

function elementFor(url: string, preload: 'auto' | 'metadata' = 'auto'): HTMLAudioElement {
  let el = pool.get(url);
  if (!el) {
    el = watch(new Audio());
    el.preload = preload;
    el.src = url;
    pool.set(url, el);
    // On garde les 6 derniers : au-delà, le plus ancien est libéré.
    while (pool.size > 6) {
      const [oldUrl, old] = pool.entries().next().value as [string, HTMLAudioElement];
      if (old === active) break;
      old.pause();
      old.removeAttribute('src');
      old.load();
      pool.delete(oldUrl);
    }
  } else {
    // Le plus récent passe en fin de file.
    pool.delete(url);
    pool.set(url, el);
  }
  if (preload === 'auto' && el.preload !== 'auto') {
    el.preload = 'auto';
    el.load();
  }
  return el;
}

const saveData = () => Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);

/** Adresse de l'extrait, tout de suite si on la connaît déjà. */
function knownUrl(t: Track): string | null {
  if (t.preview) return t.preview;
  if (t.source !== 'deezer') return null;
  const f = fresh.get(t.id);
  return f?.url && Date.now() - f.at < 20 * 60_000 ? f.url : null;
}

function resolveUrl(t: Track): Promise<string | null> {
  const known = knownUrl(t);
  if (known || t.source !== 'deezer' || DEMO) return Promise.resolve(known);
  const f = fresh.get(t.id);
  if (f?.promise && Date.now() - f.at < 20 * 60_000) return f.promise;
  const promise = api<{ preview: string }>(`/api/music/deezer/${t.id}`).then(
    (r) => (fresh.set(t.id, { url: r.preview, at: Date.now() }), r.preview),
    () => (fresh.delete(t.id), null),
  );
  fresh.set(t.id, { url: null, at: Date.now(), promise });
  return promise;
}

/** Préparer un extrait : l'adresse (publication visible), ou le fichier (doigt posé, premiers résultats). */
export function warm(t: Track, level: 'url' | 'file' = 'file') {
  if (!playable(t)) return;
  if (level === 'url') return void resolveUrl(t);
  if (saveData()) return;
  void resolveUrl(t).then((u) => u && elementFor(u));
}

/** Un extrait se joue-t-il dans l'app ? (SoundCloud passe par son propre lecteur) */
export const playable = (t: Track) => t.source !== 'soundcloud' && (Boolean(t.preview) || t.source === 'deezer');

function start(el: HTMLAudioElement, key: string) {
  active = el;
  // Un extrait relancé repart toujours du début : 30 secondes, autant les réentendre en entier.
  try {
    el.currentTime = 0;
  } catch {
    // fichier pas encore prêt : il démarrera au début de toute façon
  }
  void el.play().catch(() => {
    if (current !== key) return;
    current = null;
    loading = false;
    emit();
  });
}

/** Extraits mis en pause à la main : la lecture automatique du fil ne les relance pas. */
const pausedByHand = new Set<string>();
export const pausedByUser = (key: string) => pausedByHand.has(key);

export function toggle(t: Track, key = t.id) {
  if (!playable(t)) return;
  if (current === key && active) {
    if (!active.paused) {
      active.pause();
      current = null;
      loading = false;
      pausedByHand.add(key);
    } else start(active, key);
    return emit();
  }
  pausedByHand.delete(key);
  active?.pause();
  current = key;
  loading = true;
  progress = 0;
  emit();
  const url = knownUrl(t);
  if (url) return start(elementFor(url), key);
  // Adresse pas encore là : on « débloque » un lecteur pendant le toucher (sinon l'iPhone refuse de jouer
  // après l'attente), puis on lui donne l'extrait.
  shared ??= watch(new Audio());
  const el = shared;
  active = el;
  el.removeAttribute('src');
  void el.play().catch(() => undefined);
  void resolveUrl(t).then((u) => {
    if (current !== key) return;
    if (!u) {
      current = null;
      loading = false;
      return emit();
    }
    el.src = u;
    start(el, key);
  });
}

/**
 * Débloquer le son au premier toucher : l'iPhone n'autorise un lecteur à jouer seul (lecture automatique du
 * fil) que s'il a déjà été lancé pendant un geste. On lance donc le lecteur partagé une fois, à vide.
 */
export function unlockAudio() {
  shared ??= watch(new Audio());
  if (!shared.getAttribute('src')) void shared.play().catch(() => undefined);
}

/**
 * Lecture automatique d'un extrait (publication au centre de l'écran, son activé), avec le lecteur partagé
 * déjà débloqué. Renvoie false si le téléphone refuse (aucun toucher encore) : un appui sur le bouton son suffira.
 */
export async function autoplay(t: Track, key: string): Promise<boolean> {
  if (!playable(t) || pausedByHand.has(key)) return false;
  if (current === key) return true;
  const url = knownUrl(t) ?? (await resolveUrl(t));
  if (!url) return false;
  active?.pause();
  shared ??= watch(new Audio());
  const el = shared;
  current = key;
  loading = true;
  progress = 0;
  active = el;
  emit();
  if (el.getAttribute('src') !== url) el.src = url;
  try {
    el.currentTime = 0;
  } catch {
    // pas encore prêt
  }
  try {
    await el.play();
    return true;
  } catch {
    if (current === key) {
      current = null;
      loading = false;
      emit();
    }
    return false;
  }
}

export function stopMusic() {
  active?.pause();
  for (const el of pool.values()) el.pause();
  shared?.pause();
  current = null;
  loading = false;
  emit();
}

/** Avancer ou reculer dans l'extrait en cours (0 à 1). */
export function seek(key: string, ratio: number) {
  if (current !== key || !active?.duration) return;
  active.currentTime = Math.max(0, Math.min(1, ratio)) * active.duration;
  progress = active.currentTime / active.duration;
  emit();
}

/** Arrête l'extrait seulement si c'est celui-là qui joue (une publication qui disparaît de l'écran). */
export function stopIf(key: string) {
  if (current === key) stopMusic();
}

/** État du lecteur pour un extrait : en cours, en chargement, et avancement (0 à 1). */
export function usePlayer(key: string): { playing: boolean; loading: boolean; progress: number; duration: number } {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  const mine = current === key;
  return { playing: mine, loading: mine && loading, progress: mine ? progress : 0, duration: mine && active?.duration && Number.isFinite(active.duration) ? active.duration : 30 };
}
