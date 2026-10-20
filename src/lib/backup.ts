// Sauvegarde du téléphone sur le compte, chiffrée avant l'envoi avec une clé tirée du mot de passe.
// Permet de retrouver ses données sur un nouveau téléphone, et de passer de l'un à l'autre.
import { choose, toast } from '../components/ui';
import { api, DEMO } from './api';
import { type Sealed, seal, sha256, unseal } from './crypto';
import { type Account, getSession, setSession } from './session';
import { type AppState, getState, migrate, replaceState, subscribe } from './store';

/** Au plus une sauvegarde automatique tous les quarts d'heure (la base gratuite limite les écritures). */
const MIN_INTERVAL = 15 * 60_000;
const META_KEY = 'shred:sync';

interface Meta {
  /** Des changements locaux ne sont pas encore sauvegardés. */
  dirty: boolean;
  /** Empreinte du dernier contenu envoyé, pour ne pas renvoyer la même chose. */
  hash?: string;
  /** Heure locale du dernier envoi. */
  uploadedAt?: number;
}

function loadMeta(): Meta {
  try {
    return { dirty: false, ...JSON.parse(localStorage.getItem(META_KEY) ?? '{}') };
  } catch {
    return { dirty: false };
  }
}

let meta: Meta = loadMeta();
let restoring = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let inflight: Promise<unknown> | null = null;
let lastCheck = 0;
/** Deux versions attendent une décision : pas de sauvegarde automatique d'ici là. */
let conflict = false;

function saveMeta(patch: Partial<Meta>) {
  meta = { ...meta, ...patch };
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    // Pas grave : au pire, une sauvegarde de plus.
  }
}

export function resetBackupMeta() {
  clearTimeout(timer);
  timer = undefined;
  conflict = false;
  saveMeta({ dirty: false, hash: undefined, uploadedAt: undefined });
}

export const hasUnsaved = () => meta.dirty;
export const lastUpload = () => getSession().account?.syncedAt;

/** Le téléphone contient-il de vraies données (pas seulement les réglages par défaut) ? */
export function hasData(s: AppState = getState()): boolean {
  return Object.keys(s.days).length > 0 || Object.keys(s.body.weight).length > 0;
}

function activeAccount(): Account | undefined {
  const a = getSession().account;
  return !DEMO && a && !a.expired ? a : undefined;
}

/** Envoie la sauvegarde si quelque chose a changé depuis la dernière. */
export async function uploadBackup(force = false): Promise<'saved' | 'same' | 'skipped'> {
  const acc = activeAccount();
  if (!acc || (conflict && !force)) return 'skipped';
  const text = JSON.stringify(getState());
  const hash = await sha256(text);
  if (!force && hash === meta.hash) {
    saveMeta({ dirty: false });
    return 'same';
  }
  const box = await seal(acc.dataKey, text);
  const { savedAt } = await api<{ savedAt: number }>('/api/backup', { method: 'PUT', body: box });
  saveMeta({ dirty: false, hash, uploadedAt: Date.now() });
  setSession((s) => (s.account ? { ...s, account: { ...s.account, syncedAt: savedAt } } : s));
  return 'saved';
}

function tryUpload() {
  if (inflight) return inflight;
  inflight = uploadBackup()
    .catch(() => undefined)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function schedule() {
  if (timer || !activeAccount()) return;
  const wait = Math.max(20_000, MIN_INTERVAL - (Date.now() - (meta.uploadedAt ?? 0)));
  timer = setTimeout(() => {
    timer = undefined;
    void tryUpload();
  }, wait);
}

export type Remote = { state: AppState; savedAt: number } | 'unreadable' | null;

/** Récupère et déchiffre la sauvegarde du compte. */
export async function fetchBackup(acc: Account): Promise<Remote> {
  const box = await api<Partial<Sealed> & { savedAt: number | null }>('/api/backup');
  if (!box.savedAt || !box.data || !box.iv) return null;
  try {
    const text = await unseal(acc.dataKey, box as Sealed);
    return { state: migrate(JSON.parse(text)), savedAt: box.savedAt };
  } catch {
    return 'unreadable';
  }
}

/** Remplace les données du téléphone par celles du compte. */
export async function restore(remote: { state: AppState; savedAt: number }) {
  const next = remote.state;
  // Les notifications sont propres à chaque appareil.
  next.settings.pushEnabled = getState().settings.pushEnabled;
  restoring = true;
  try {
    replaceState(next);
  } finally {
    restoring = false;
  }
  saveMeta({ dirty: false, hash: await sha256(JSON.stringify(getState())) });
  setSession((s) => (s.account ? { ...s, account: { ...s.account, syncedAt: remote.savedAt } } : s));
}

const when = (ms: number) =>
  new Date(ms).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/**
 * Compare le téléphone et le compte.
 * `mine` : les données du téléphone appartiennent déjà à ce compte.
 */
export async function reconcile(acc: Account, mine: boolean): Promise<void> {
  const remote = await fetchBackup(acc);
  if (remote === 'unreadable') {
    // Chiffrée avec un ancien mot de passe : on la remplace par ce téléphone.
    if (hasData()) await uploadBackup(true);
    return;
  }
  if (!remote) {
    if (hasData()) await uploadBackup(true);
    return;
  }
  const newer = remote.savedAt > (acc.syncedAt ?? 0);
  if (!hasData()) return restore(remote);
  if (mine && !newer) {
    if (meta.dirty) await uploadBackup();
    return;
  }
  if (mine && !meta.dirty) {
    await restore(remote);
    toast('Données à jour depuis ton compte');
    return;
  }
  const question = mine
    ? `Ton compte a des données plus récentes, enregistrées depuis un autre appareil ${when(remote.savedAt)}. Lesquelles garder ? Les autres seront remplacées.`
    : `Ce téléphone contient déjà des données, et ton compte aussi (sauvegarde du ${when(remote.savedAt)}). Lesquelles garder ? Les autres seront remplacées.`;
  conflict = true;
  const pick = await choose(question, [{ label: 'Celles de ce téléphone' }, { label: 'Celles du compte', tone: 'primary' }], 'Deux versions');
  if (pick === null) {
    // Fermé sans choisir : rien n'est écrasé, la question reviendra au prochain retour dans l'app.
    lastCheck = 0;
    return;
  }
  conflict = false;
  if (pick === 1) await restore(remote);
  else await uploadBackup(true);
}

/** Au démarrage et au retour dans l'app : sauvegarde ce qui a changé, récupère ce qui vient d'ailleurs. */
async function check() {
  const acc = activeAccount();
  if (!acc || Date.now() - lastCheck < 5 * 60_000) return;
  lastCheck = Date.now();
  try {
    const { savedAt } = await api<{ savedAt: number | null }>('/api/backup?meta=1');
    if (savedAt && savedAt > (acc.syncedAt ?? 0)) await reconcile(acc, true);
    else if (meta.dirty || !savedAt) schedule();
  } catch {
    // Hors ligne : on réessaiera.
  }
}

export function startBackup() {
  if (DEMO) return;
  subscribe(() => {
    if (restoring) return;
    if (!meta.dirty) saveMeta({ dirty: true });
    schedule();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // En quittant l'app, on envoie tout de suite ce qui a changé.
      if (meta.dirty && Date.now() - (meta.uploadedAt ?? 0) > 60_000) void tryUpload();
    } else {
      void check();
    }
  });
  void check();
}
