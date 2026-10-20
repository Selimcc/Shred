// Chaque personne a son compte (email + mot de passe) et toutes ses données serveur
// (rappels, Santé, salle, quotas, sauvegarde) sont rangées sous son identifiant : u:<id>:…
//
// Ce qui est gardé dans la base KV :
//   acct:<id>          le compte : email, prénom, rôle, empreinte du mot de passe (jamais le mot de passe)
//   email:<sha256>     email → identifiant
//   idx:users          liste des comptes (pour les rappels et la page Testeurs)
//   sess:<sha256>      sessions ouvertes (on ne garde que l'empreinte du jeton), expirent seules
//   dkey:<sha256>      clé des Raccourcis iPhone → identifiant
//   inv:<code>         invitations en attente, rst:<code> codes de réinitialisation
//   u:<id>:…           les données de la personne
import { type Env, HttpError } from './env';

export interface Store {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export type Role = 'admin' | 'member';

export interface Account {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** Sel aléatoire et empreinte HMAC de la clé dérivée du mot de passe sur le téléphone. */
  salt: string;
  hash: string;
  /** Incrémenté à chaque changement de mot de passe : les anciennes sessions tombent. */
  epoch: number;
  createdAt: string;
  /** Empreinte de la clé des Raccourcis iPhone, s'il y en a une. */
  deviceKey?: string;
}

export interface IndexEntry {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  store: Store;
  /** Empreinte du jeton utilisé pour cette requête (pour la déconnexion). */
  tokenHash: string;
}

export async function loadJson<T>(store: Pick<Store, 'get'>, key: string): Promise<T | null> {
  const raw = await store.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256hex(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

export function userStore(kv: KVNamespace, id: string): Store {
  const prefix = `u:${id}:`;
  return {
    get: (k) => kv.get(prefix + k),
    put: (k, v, opts) => kv.put(prefix + k, v, opts),
    delete: (k) => kv.delete(prefix + k),
  };
}

export const getAccount = (env: Env, id: string) => loadJson<Account>(env.KV, `acct:${id}`);

export async function listAccounts(env: Env): Promise<IndexEntry[]> {
  return (await loadJson<IndexEntry[]>(env.KV, 'idx:users')) ?? [];
}

export async function saveIndex(env: Env, entries: IndexEntry[]) {
  await env.KV.put('idx:users', JSON.stringify(entries));
}

export const indexEntry = (a: Account): IndexEntry => ({ id: a.id, name: a.name, email: a.email, role: a.role, createdAt: a.createdAt });

/** Rattrape un compte absent de l'index (deux inscriptions à la même seconde). */
export async function ensureIndexed(env: Env, id: string) {
  const list = await listAccounts(env);
  if (list.some((u) => u.id === id)) return;
  const acct = await getAccount(env, id);
  if (acct) await saveIndex(env, [...list, indexEntry(acct)]);
}

/**
 * Identifie la personne d'après l'en-tête Authorization.
 * Un jeton de session donne accès à tout ; une clé Raccourcis (shk_…) seulement aux routes qui l'acceptent.
 */
export async function authenticate(req: Request, env: Env, opts: { deviceKey?: boolean } = {}): Promise<User> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'Connecte-toi pour utiliser cette fonction');
  const h = await sha256hex(token);
  let acct: Account | null = null;

  if (token.startsWith('shk_')) {
    if (!opts.deviceKey) throw new HttpError(403, 'Cette clé sert uniquement aux Raccourcis iPhone');
    const id = await env.KV.get(`dkey:${h}`);
    acct = id ? await getAccount(env, id) : null;
    if (!acct || acct.deviceKey !== h) throw new HttpError(401, 'Clé Raccourcis invalide : recrée-la dans Réglages, Apple Santé');
  } else {
    const sess = await loadJson<{ uid: string; epoch: number }>(env.KV, `sess:${h}`);
    acct = sess ? await getAccount(env, sess.uid) : null;
    if (!acct || !sess || acct.epoch !== sess.epoch) throw new HttpError(401, 'Session expirée, reconnecte-toi');
  }
  return { id: acct.id, name: acct.name, email: acct.email, role: acct.role, store: userStore(env.KV, acct.id), tokenHash: h };
}

/** Toutes les personnes inscrites, pour les rappels. */
export async function allUsers(env: Env): Promise<{ id: string; name: string; store: Store }[]> {
  return (await listAccounts(env)).map((u) => ({ id: u.id, name: u.name, store: userStore(env.KV, u.id) }));
}
