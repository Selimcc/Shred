// Installer Shred sur l'écran d'accueil : repérer le téléphone et le navigateur, garder la proposition
// d'installation de Chrome (Android) pour un bouton « Installer », et faire suivre le code d'invitation.
import { isNative } from './native';

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: PromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as PromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

export type Platform = 'ios-safari' | 'ios-other' | 'android' | 'other';

export function installInfo() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const platform: Platform = ios ? (/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? 'ios-other' : 'ios-safari') : /Android/.test(ua) ? 'android' : 'other';
  return { platform, standalone: standalone || isNative(), canPrompt: Boolean(deferred) };
}

export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Android, Chrome : ouvre la fenêtre d'installation du navigateur. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  listeners.forEach((l) => l());
  return outcome === 'accepted';
}

/**
 * Lien d'invitation : l'app installée doit s'ouvrir avec le code déjà rempli. Le manifeste servi par le
 * serveur reprend le code dans son adresse de départ.
 */
export function carryInvite() {
  try {
    const invite = new URLSearchParams(location.search).get('invite');
    if (!invite || !/^[A-Za-z0-9-]{4,40}$/.test(invite)) return;
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (link) link.href = `/manifest.webmanifest?invite=${encodeURIComponent(invite)}`;
  } catch {
    // Aperçu sans document complet : rien à faire.
  }
}

const DISMISS_KEY = 'shred:install-later';

export function installDismissed(): boolean {
  try {
    return Number(localStorage.getItem(DISMISS_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

export function dismissInstall(days = 7) {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + days * 86400_000));
  } catch {
    // Stockage indisponible : la carte reviendra, sans gravité.
  }
}
