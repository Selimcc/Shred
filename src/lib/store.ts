// L'état de l'app sur cet appareil : chargé depuis le stockage local, enregistré à chaque changement.
// Les types et la logique sans stockage sont dans state.ts (partagés avec le serveur).
import { useSyncExternalStore } from 'react';
import { demoState } from './demo-seed';
import { type AppState, initial, migrate } from './state';

export * from './state';

const KEY = 'shred:v1';

function load(): AppState {
  const base = initial();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return import.meta.env.MODE === 'demo' ? demoState(base) : base;
    return migrate(JSON.parse(raw), base);
  } catch {
    return import.meta.env.MODE === 'demo' ? demoState(base) : base;
  }
}

let state: AppState = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Sauvegarde locale impossible', e);
  }
}

export function getState(): AppState {
  return state;
}

export function setState(mutate: (draft: AppState) => void) {
  const draft = structuredClone(state);
  mutate(draft);
  state = draft;
  persist();
  listeners.forEach((l) => l());
}

export function replaceState(next: AppState) {
  state = next;
  persist();
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useApp(): AppState {
  return useSyncExternalStore(subscribe, getState);
}

export function resetAll() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Stockage indisponible : l'état en mémoire est quand même réinitialisé.
  }
  replaceState(initial());
}
