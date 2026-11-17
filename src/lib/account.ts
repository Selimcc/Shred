// Inscription, connexion, déconnexion et gestion du compte.
import { setMe } from './me';
import { api } from './api';
import { hasData, reconcile, resetBackupMeta, uploadBackup } from './backup';
import { deriveKeys, normEmail } from './crypto';
import { clearPhotos } from './photos';
import { forgetPublishedProfile } from './profile';
import { disablePush } from './push';
import { type Account, COOKIE, getSession, type Role, setSession, storedToken } from './session';
import { isNative } from './native';
import { getState, resetAll, setState } from './store';
import { tr } from '../../shared/i18n';

interface AuthResult {
  token: string;
  user: { id: string; email: string; name: string; role: Role };
  backupCleared?: boolean;
}

export const MIN_PASSWORD = 8;

function checkPassword(password: string) {
  if (password.length < MIN_PASSWORD) throw new Error(tr('Mot de passe trop court : {MIN_PASSWORD} caractères minimum.', { MIN_PASSWORD }));
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Efface tout ce qui est sur ce téléphone : données, photos, état de la sauvegarde. */
async function wipeLocal() {
  resetAll();
  resetBackupMeta();
  forgetPublishedProfile();
  setMe(null);
  await clearPhotos().catch(() => undefined);
}

/** Après une connexion réussie : range la session et réconcilie les données du téléphone avec le compte. */
async function signIn(res: AuthResult, dataKey: string) {
  const prev = getSession();
  const mine = prev.owner === res.user.id;
  if (prev.owner && !mine) {
    // Les données présentes appartiennent à quelqu'un d'autre : elles ne doivent pas se mélanger.
    await wipeLocal();
  }
  const account: Account = {
    ...res.user,
    token: storedToken(res.token, isNative()),
    dataKey,
    syncedAt: mine ? prev.account?.syncedAt : undefined,
  };
  setSession({ account, owner: res.user.id });
  if (!getState().settings.name) setState((d) => void (d.settings.name = res.user.name));
  try {
    await reconcile(account, mine);
  } catch {
    // Hors ligne : la sauvegarde se fera plus tard.
  }
}

export async function register(p: { name: string; email: string; password: string; invite: string }) {
  checkPassword(p.password);
  const keys = await deriveKeys(p.email, p.password);
  const res = await api<AuthResult>('/api/auth/register', {
    auth: false,
    body: { name: p.name.trim(), email: normEmail(p.email), invite: p.invite.trim(), key: keys.auth },
  });
  await signIn(res, keys.data);
}

export async function login(email: string, password: string) {
  const keys = await deriveKeys(email, password);
  const res = await api<AuthResult>('/api/auth/login', { auth: false, body: { email: normEmail(email), key: keys.auth } });
  await signIn(res, keys.data);
}

/** Mot de passe oublié : avec le code donné par l'administrateur. */
export async function resetPassword(email: string, code: string, password: string) {
  checkPassword(password);
  const keys = await deriveKeys(email, password);
  const res = await api<AuthResult>('/api/auth/reset', {
    auth: false,
    body: { email: normEmail(email), code: code.trim(), key: keys.auth },
  });
  await signIn(res, keys.data);
  return { backupCleared: Boolean(res.backupCleared) };
}

export async function changePassword(current: string, next: string) {
  checkPassword(next);
  const acc = getSession().account;
  if (!acc) throw new Error(tr('Pas de compte connecté'));
  const [cur, nxt] = await Promise.all([deriveKeys(acc.email, current), deriveKeys(acc.email, next)]);
  const res = await api<AuthResult>('/api/account/password', { body: { current: cur.auth, next: nxt.auth } });
  setSession((s) => ({ ...s, account: { ...acc, token: storedToken(res.token, isNative()), dataKey: nxt.data, expired: false } }));
  // La sauvegarde est rechiffrée avec la nouvelle clé.
  await uploadBackup(true);
}

/**
 * Changer l'email de connexion. Les clés viennent du mot de passe et de l'email : on calcule les deux
 * (ancien et nouvel email), le serveur vérifie l'ancienne, puis la sauvegarde est rechiffrée.
 */
export async function changeEmail(email: string, password: string) {
  const acc = getSession().account;
  if (!acc) throw new Error(tr('Pas de compte connecté'));
  const next = normEmail(email);
  if (next === normEmail(acc.email)) throw new Error(tr('C’est déjà ton email'));
  const [cur, nxt] = await Promise.all([deriveKeys(acc.email, password), deriveKeys(next, password)]);
  const res = await api<AuthResult>('/api/account/email', { body: { email: next, current: cur.auth, next: nxt.auth } });
  setSession((s) => ({ ...s, account: { ...acc, email: res.user.email, token: storedToken(res.token, isNative()), dataKey: nxt.data, expired: false } }));
  await uploadBackup(true);
}

/**
 * Déconnexion : dernière sauvegarde, arrêt des notifications de ce téléphone, puis tout est effacé ici.
 * Les données restent sur le compte.
 */
export async function logout({ force = false } = {}) {
  const acc = getSession().account;
  if (acc && !acc.expired) {
    try {
      await uploadBackup();
    } catch (e) {
      if (!force) throw e;
    }
    if (getState().settings.pushEnabled) await Promise.race([disablePush().catch(() => undefined), wait(3000)]);
    await api('/api/auth/logout', { body: {} }).catch(() => undefined);
  }
  await wipeLocal();
  setSession({});
}

export async function deleteAccount(password: string) {
  const acc = getSession().account;
  if (!acc) throw new Error(tr('Pas de compte connecté'));
  const keys = await deriveKeys(acc.email, password);
  if (getState().settings.pushEnabled) await Promise.race([disablePush().catch(() => undefined), wait(3000)]);
  await api('/api/account', { method: 'DELETE', body: { key: keys.auth } });
  await wipeLocal();
  setSession({});
}

/** Utiliser l'app sans compte (rien n'est envoyé au serveur). */
export function continueWithoutAccount() {
  setSession({ local: true });
}

/** Quitte le mode sans compte pour se connecter ; les données du téléphone sont proposées au compte. */
export function leaveLocalMode() {
  setSession({});
}

export async function createShortcutKey(): Promise<string> {
  const { key } = await api<{ key: string }>('/api/account/device-key', { body: {} });
  setState((d) => void (d.settings.shortcutKey = key));
  return key;
}

export { hasData };

/**
 * Téléphones connectés avant le cookie : le jeton gardé dans le stockage passe dans le cookie HttpOnly,
 * puis il est effacé du téléphone. Sans effet dans l'app iPhone.
 */
export async function moveSessionToCookie() {
  const acc = getSession().account;
  if (!acc || acc.expired || isNative() || acc.token === COOKIE) return;
  try {
    await api('/api/auth/cookie', { body: {} });
    setSession((s) => (s.account ? { ...s, account: { ...s.account, token: COOKIE } } : s));
  } catch {
    // Hors ligne : on réessaiera au prochain lancement.
  }
}
