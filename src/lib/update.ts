// Mise à jour automatique : l'app compare son build à celui en ligne (/version.json). S'ils diffèrent, elle
// affiche l'écran « Nouvelle version », prépare la nouvelle version et se recharge seule. Les données sont
// déjà enregistrées sur le téléphone à chaque changement : rien n'est perdu.
import { DEMO } from './api';
import { isNative } from './native';

export type UpdateStep = 'checking' | 'download' | 'install' | 'restart';
type Listener = (s: { step: UpdateStep; version: string } | null) => void;

const listeners = new Set<Listener>();
let state: { step: UpdateStep; version: string } | null = null;
let lastCheck = 0;
let running = false;
const TRIED = 'shred:update-tried';

const set = (s: typeof state) => {
  state = s;
  listeners.forEach((l) => l(s));
};

export function onUpdate(fn: Listener): () => void {
  listeners.add(fn);
  fn(state);
  return () => void listeners.delete(fn);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Une saisie en cours ? On attend le prochain retour dans l'app plutôt que de couper la personne. */
function busyTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));
}

export async function checkForUpdate({ force = false } = {}): Promise<void> {
  if (DEMO || isNative() || running) return;
  if (!force && Date.now() - lastCheck < 60_000) return;
  lastCheck = Date.now();
  let live: { version: string; build: string };
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    live = await res.json();
  } catch {
    return; // hors ligne : on réessaiera
  }
  if (!live?.build || live.build === __BUILD__) return;
  // Garde-fou : une seule tentative par version toutes les 5 minutes (si le CDN sert encore l'ancienne).
  try {
    const tried = JSON.parse(sessionStorage.getItem(TRIED) ?? 'null') as { build: string; at: number } | null;
    if (tried?.build === live.build && Date.now() - tried.at < 5 * 60_000) return;
    sessionStorage.setItem(TRIED, JSON.stringify({ build: live.build, at: Date.now() }));
  } catch {
    // stockage indisponible : on tente quand même
  }
  if (busyTyping() && !force) return;

  running = true;
  const started = Date.now();
  set({ step: 'download', version: live.version });
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    // Préchauffe la nouvelle page et ses fichiers pendant que l'écran s'affiche.
    const html = await fetch(`/?update=${encodeURIComponent(live.build)}`, { cache: 'no-store' })
      .then((r) => r.text())
      .catch(() => '');
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    await Promise.all(assets.map((a) => fetch(a).catch(() => undefined)));
    set({ step: 'install', version: live.version });
    await reg?.update().catch(() => undefined);
  } catch {
    // on recharge de toute façon
  }
  // L'écran reste au moins une seconde : assez pour être lu, pas assez pour agacer.
  await wait(Math.max(0, 1100 - (Date.now() - started)));
  set({ step: 'restart', version: live.version });
  await wait(250);
  location.reload();
}

/** Au lancement, au retour dans l'app et toutes les 10 minutes. */
export function startUpdates() {
  if (DEMO || isNative()) return;
  setTimeout(() => void checkForUpdate({ force: true }), 800);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') void checkForUpdate();
  }, 10 * 60_000);
}
