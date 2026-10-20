// Le compte connecté sur ce téléphone. Gardé à part des données de l'app : il n'est jamais sauvegardé ni exporté.
import { useSyncExternalStore } from 'react';

export type Role = 'admin' | 'member';

export interface Account {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** Jeton de session (180 jours). */
  token: string;
  /** Clé de chiffrement de la sauvegarde, dérivée du mot de passe. Ne quitte jamais le téléphone. */
  dataKey: string;
  /** Date (serveur) de la dernière sauvegarde envoyée ou récupérée par ce téléphone. */
  syncedAt?: number;
  /** Le serveur a refusé la session : il faut se reconnecter. */
  expired?: boolean;
}

export interface Session {
  account?: Account;
  /** Utilisation sans compte, choisie à l'accueil. */
  local?: boolean;
  /** Compte auquel appartiennent les données présentes sur ce téléphone. */
  owner?: string;
}

const KEY = 'shred:account';

function load(): Session {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Session;
  } catch {
    return {};
  }
}

let session: Session = load();
const listeners = new Set<() => void>();

export function getSession(): Session {
  return session;
}

export function setSession(next: Session | ((s: Session) => Session)) {
  session = typeof next === 'function' ? next(session) : next;
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Stockage indisponible : la session reste en mémoire.
  }
  listeners.forEach((l) => l());
}

export function useSession(): Session {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => session,
  );
}

/** Jeton à envoyer au serveur, si un compte valide est connecté. */
export function authToken(): string | undefined {
  const a = session.account;
  return a && !a.expired ? a.token : undefined;
}

export function signedIn(): boolean {
  return Boolean(authToken());
}

export function markExpired() {
  if (session.account && !session.account.expired) setSession((s) => ({ ...s, account: { ...s.account!, expired: true } }));
}
