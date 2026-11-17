// Les disques côté app : le solde (gardé pour l'afficher tout de suite) et la journée validée envoyée au serveur,
// qui ajoute un disque par jour et un bonus à chaque palier de série.
import { useSyncExternalStore } from 'react';
import { DEMO } from './api';
import { type ChallengeState, club, type WalletView } from './club';
import { dayKey } from './date';
import { streakInfo } from './logic';
import { moment } from './moments';
import { signedIn } from './session';
import { getState, subscribe } from './store';

const KEY = 'shred:wallet';
const CLAIMED = 'shred:plates-day';

const read = <T,>(k: string): T | null => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    // Sans stockage : on redemandera au serveur.
  }
};

let current: WalletView | null = DEMO ? null : read<WalletView>(KEY);
const listeners = new Set<() => void>();

export function setWallet(w: WalletView | undefined) {
  if (!w || (current && current.plates === w.plates && current.cap === w.cap)) return;
  current = w;
  if (!DEMO) write(KEY, w);
  for (const l of listeners) l();
}

/** Le solde connu, mis à jour à chaque échange avec le club. */
export function useWallet(): WalletView | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => current,
  );
}

/** Les défis et le porte-monnaie d'un coup (le solde suit). */
export async function loadChallenges(): Promise<ChallengeState> {
  const r = await club.challenges();
  setWallet(r.wallet);
  return r;
}

let sending = false;

/** Journée validée : on la déclare une fois au serveur, qui ajoute les disques. */
async function claim() {
  if (sending || !(DEMO || signedIn())) return;
  const today = dayKey();
  const st = streakInfo(getState(), today);
  if (!st.todayValidated || read<string>(CLAIMED) === today) return;
  sending = true;
  try {
    const r = await club.claimPlates(today, st.current);
    write(CLAIMED, today);
    setWallet(r.wallet);
    if (r.bonus > 0) setTimeout(() => moment('plates', `+${r.gained} disques`, `${st.current} jours de série : bonus de palier`), 4200);
  } catch {
    // Hors ligne : on réessaiera au prochain changement ou au retour dans l'app.
  } finally {
    sending = false;
  }
}

export function startWallet() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const later = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void claim(), ms);
  };
  subscribe(() => later(2_500));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') later(1_500);
  });
  later(4_000);
}
