// Comptes : inscription sur invitation, connexion, sessions, mot de passe oublié, administration.
//
// Le mot de passe ne quitte jamais le téléphone : l'app en dérive une clé (PBKDF2, 600 000 tours)
// et n'envoie que cette clé. Le serveur n'en garde qu'une empreinte HMAC avec un sel aléatoire.
// Une seconde clé, dérivée elle aussi du mot de passe, chiffre la sauvegarde sur le téléphone :
// le serveur (et l'administrateur) ne peuvent pas lire les séances et les repas sauvegardés.
import { type Env, HttpError, json, readJson } from './env';
import {
  type Account,
  authenticate,
  getAccount,
  hex,
  indexEntry,
  listAccounts,
  loadJson,
  type Role,
  saveIndex,
  sha256hex,
  type User,
} from './users';

const SESSION_TTL = 180 * 86400;
const INVITE_TTL = 7 * 86400;
const RESET_TTL = 2 * 86400;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const SHORTCUT_KEYS = ['health', 'gymIn', 'gymOut'] as const;

/* ---------- Outils ---------- */

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/** Code lisible à dicter ou recopier : ABCDE-FGHJK. */
function readableCode(): string {
  const bytes = random(10);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

const normCode = (code: unknown) =>
  String(code ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 20);

const prettyCode = (c: string) => (c.length === 10 ? `${c.slice(0, 5)}-${c.slice(5)}` : c);

export function normEmail(email: unknown): string {
  const e = String(email ?? '')
    .trim()
    .toLowerCase();
  if (e.length > 120 || !EMAIL_RE.test(e)) throw new HttpError(400, 'Email invalide');
  return e;
}

function normName(name: unknown): string {
  const n = String(name ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 30);
  if (!n) throw new HttpError(400, 'Indique ton prénom');
  return n;
}

/** La clé envoyée par l'app : 32 octets en base64url. */
function authKey(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length < 40 || value.length > 60) throw new HttpError(400, 'Clé de connexion invalide');
  const bytes = fromB64url(value);
  if (bytes.length !== 32) throw new HttpError(400, 'Clé de connexion invalide');
  return bytes;
}

async function hmac(salt: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function sameText(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  return sameBytes(new Uint8Array(ha), new Uint8Array(hb));
}

async function setPassword(acct: Account, key: Uint8Array) {
  const salt = random(16);
  acct.salt = b64url(salt);
  acct.hash = b64url(await hmac(salt, key));
}

async function checkPassword(acct: Account, key: Uint8Array): Promise<boolean> {
  return sameBytes(await hmac(fromB64url(acct.salt), key), fromB64url(acct.hash));
}

/* ---------- Limitation des essais ---------- */

const ip = (req: Request) => req.headers.get('cf-connecting-ip') ?? 'local';

async function guard(env: Env, keys: string[], max: number) {
  for (const k of keys) {
    if (Number((await env.KV.get(`rl:${k}`)) ?? 0) >= max) {
      throw new HttpError(429, 'Trop d’essais. Réessaie dans un quart d’heure.');
    }
  }
}

async function strike(env: Env, keys: string[]) {
  for (const k of keys) {
    const n = Number((await env.KV.get(`rl:${k}`)) ?? 0);
    await env.KV.put(`rl:${k}`, String(n + 1), { expirationTtl: 900 });
  }
}

/* ---------- Sessions ---------- */

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

const publicUser = (a: Pick<Account, 'id' | 'email' | 'name' | 'role'>): PublicUser => ({ id: a.id, email: a.email, name: a.name, role: a.role });

async function openSession(env: Env, acct: Account) {
  const token = b64url(random(32));
  await env.KV.put(`sess:${await sha256hex(token)}`, JSON.stringify({ uid: acct.id, epoch: acct.epoch }), { expirationTtl: SESSION_TTL });
  return { token, user: publicUser(acct) };
}

async function saveAccount(env: Env, acct: Account) {
  await env.KV.put(`acct:${acct.id}`, JSON.stringify(acct));
}

async function accountByEmail(env: Env, email: string): Promise<Account | null> {
  const id = await env.KV.get(`email:${await sha256hex(email)}`);
  return id ? getAccount(env, id) : null;
}

/** Efface un compte et toutes ses données (clés u:<id>:…). */
export async function purgeAccount(env: Env, acct: Account) {
  let cursor: string | undefined;
  do {
    const page = await env.KV.list({ prefix: `u:${acct.id}:`, cursor });
    await Promise.all(page.keys.map((k) => env.KV.delete(k.name)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  await Promise.all([
    env.KV.delete(`acct:${acct.id}`),
    env.KV.delete(`email:${await sha256hex(acct.email)}`),
    acct.deviceKey ? env.KV.delete(`dkey:${acct.deviceKey}`) : Promise.resolve(),
  ]);
  await saveIndex(env, (await listAccounts(env)).filter((u) => u.id !== acct.id));
}

/* ---------- Routes publiques : /api/auth/… ---------- */

interface AuthBody {
  email?: string;
  name?: string;
  invite?: string;
  key?: string;
  code?: string;
}

export async function authRoutes(req: Request, env: Env, pathname: string): Promise<Response | null> {
  if (req.method !== 'POST') return null;

  if (pathname === '/api/auth/register') {
    const b = await readJson<AuthBody>(req, 4_000);
    const email = normEmail(b.email);
    const name = normName(b.name);
    const key = authKey(b.key);
    await guard(env, [`reg:${ip(req)}`], 10);

    const raw = String(b.invite ?? '').trim();
    let role: Role = 'member';
    let inviteKey: string | null = null;
    if (env.ADMIN_CODE && raw && (await sameText(raw, env.ADMIN_CODE))) {
      role = 'admin';
    } else {
      const code = normCode(raw);
      inviteKey = code ? `inv:${code}` : null;
      if (!inviteKey || !(await env.KV.get(inviteKey))) {
        await strike(env, [`reg:${ip(req)}`]);
        throw new HttpError(403, 'Code d’invitation invalide ou expiré');
      }
    }
    if (await accountByEmail(env, email)) throw new HttpError(409, 'Un compte existe déjà avec cet email. Connecte-toi.');

    const acct: Account = {
      id: hex(random(8)),
      email,
      name,
      role,
      salt: '',
      hash: '',
      epoch: 1,
      createdAt: new Date().toISOString(),
    };
    await setPassword(acct, key);
    await saveAccount(env, acct);
    await env.KV.put(`email:${await sha256hex(email)}`, acct.id);
    await saveIndex(env, [...(await listAccounts(env)), indexEntry(acct)]);
    if (inviteKey) await env.KV.delete(inviteKey);
    return json(await openSession(env, acct));
  }

  if (pathname === '/api/auth/login') {
    const b = await readJson<AuthBody>(req, 2_000);
    const email = normEmail(b.email);
    const key = authKey(b.key);
    const limits = [`login:${await sha256hex(email)}`, `login-ip:${ip(req)}`];
    await guard(env, limits, 10);
    const acct = await accountByEmail(env, email);
    // Même travail que l'email existe ou non : la durée de la réponse ne dit rien.
    const ok = acct ? await checkPassword(acct, key) : (await hmac(random(16), key), false);
    if (!acct || !ok) {
      await strike(env, limits);
      throw new HttpError(401, 'Email ou mot de passe incorrect');
    }
    return json(await openSession(env, acct));
  }

  if (pathname === '/api/auth/reset') {
    // Mot de passe oublié : l'administrateur donne un code, la personne choisit un nouveau mot de passe.
    const b = await readJson<AuthBody>(req, 2_000);
    const email = normEmail(b.email);
    const key = authKey(b.key);
    const limits = [`reset:${ip(req)}`];
    await guard(env, limits, 10);
    const code = normCode(b.code);
    const acct = await accountByEmail(env, email);
    const target = code ? await env.KV.get(`rst:${code}`) : null;
    if (!acct || target !== acct.id) {
      await strike(env, limits);
      throw new HttpError(403, 'Code de réinitialisation invalide ou expiré');
    }
    await setPassword(acct, key);
    acct.epoch += 1;
    await saveAccount(env, acct);
    // La sauvegarde était chiffrée avec l'ancien mot de passe : elle n'est plus lisible.
    await Promise.all([env.KV.delete(`rst:${code}`), env.KV.delete(`u:${acct.id}:backup`)]);
    return json({ ...(await openSession(env, acct)), backupCleared: true });
  }

  return null;
}

/* ---------- Routes connectées : /api/auth/logout, /api/account/… ---------- */

export async function accountRoutes(req: Request, env: Env, user: User, pathname: string): Promise<Response | null> {
  const method = req.method;

  if (pathname === '/api/auth/logout' && method === 'POST') {
    await env.KV.delete(`sess:${user.tokenHash}`);
    return json({ ok: true });
  }

  if (pathname === '/api/account/password' && method === 'POST') {
    const b = await readJson<{ current?: string; next?: string }>(req, 2_000);
    const acct = await getAccount(env, user.id);
    if (!acct) throw new HttpError(404, 'Compte introuvable');
    await guard(env, [`pw:${user.id}`], 10);
    if (!(await checkPassword(acct, authKey(b.current)))) {
      await strike(env, [`pw:${user.id}`]);
      throw new HttpError(403, 'Mot de passe actuel incorrect');
    }
    await setPassword(acct, authKey(b.next));
    acct.epoch += 1;
    await saveAccount(env, acct);
    return json(await openSession(env, acct));
  }

  if (pathname === '/api/account/device-key' && method === 'POST') {
    // Clé pour les Raccourcis iPhone : elle ne permet que d'envoyer Santé et les passages à la salle.
    const acct = await getAccount(env, user.id);
    if (!acct) throw new HttpError(404, 'Compte introuvable');
    if (acct.deviceKey) await env.KV.delete(`dkey:${acct.deviceKey}`);
    const key = `shk_${b64url(random(24))}`;
    acct.deviceKey = await sha256hex(key);
    await Promise.all([saveAccount(env, acct), env.KV.put(`dkey:${acct.deviceKey}`, acct.id)]);
    return json({ key });
  }

  if (pathname === '/api/account' && method === 'DELETE') {
    const b = await readJson<{ key?: string }>(req, 2_000);
    const acct = await getAccount(env, user.id);
    if (!acct) throw new HttpError(404, 'Compte introuvable');
    if (!(await checkPassword(acct, authKey(b.key)))) throw new HttpError(403, 'Mot de passe incorrect');
    await purgeAccount(env, acct);
    await env.KV.delete(`sess:${user.tokenHash}`);
    return json({ ok: true });
  }

  return null;
}

/* ---------- Administration : /api/admin/… ---------- */

export async function adminRoutes(req: Request, env: Env, user: User, url: URL): Promise<Response | null> {
  const { pathname } = url;
  if (!pathname.startsWith('/api/admin/')) return null;
  if (user.role !== 'admin') throw new HttpError(403, 'Réservé à l’administrateur');
  const method = req.method;

  if (pathname === '/api/admin/overview' && method === 'GET') {
    const accounts = await listAccounts(env);
    const users = await Promise.all(
      accounts.map(async (a) => {
        const state = await loadJson<{ date?: string }>(env.KV, `u:${a.id}:state`);
        return { ...a, lastDay: state?.date ?? null, me: a.id === user.id };
      }),
    );
    const list = await env.KV.list<{ note?: string; created?: string }>({ prefix: 'inv:' });
    const invites = list.keys.map((k) => ({
      code: prettyCode(k.name.slice(4)),
      note: k.metadata?.note ?? '',
      created: k.metadata?.created ?? null,
      expires: k.expiration ? new Date(k.expiration * 1000).toISOString() : null,
    }));
    return json({ users, invites });
  }

  if (pathname === '/api/admin/invites' && method === 'POST') {
    const b = await readJson<{ note?: string }>(req, 2_000);
    const note = String(b.note ?? '').trim().slice(0, 40);
    const code = readableCode();
    const created = new Date().toISOString();
    await env.KV.put(`inv:${normCode(code)}`, JSON.stringify({ by: user.id, note, created }), {
      expirationTtl: INVITE_TTL,
      metadata: { note, created },
    });
    return json({ code, note, expires: new Date(Date.now() + INVITE_TTL * 1000).toISOString() });
  }

  if (pathname === '/api/admin/shortcuts' && method === 'PUT') {
    // Liens iCloud des raccourcis partagés : chacun les installe en deux touches depuis l'app.
    const b = await readJson<Record<string, unknown>>(req, 4_000);
    const links: Record<string, string> = {};
    for (const k of SHORTCUT_KEYS) {
      const v = String(b[k] ?? '').trim();
      if (!v) continue;
      if (!/^https:\/\/(www\.)?icloud\.com\/shortcuts\/[A-Za-z0-9]+\/?$/.test(v)) {
        throw new HttpError(400, 'Lien invalide : il doit ressembler à https://www.icloud.com/shortcuts/…');
      }
      links[k] = v;
    }
    await env.KV.put('cfg:shortcuts', JSON.stringify(links));
    return json({ ok: true, shortcuts: links });
  }

  const invite = pathname.match(/^\/api\/admin\/invites\/([A-Za-z0-9-]+)$/);
  if (invite && method === 'DELETE') {
    await env.KV.delete(`inv:${normCode(invite[1])}`);
    return json({ ok: true });
  }

  const target = pathname.match(/^\/api\/admin\/users\/([0-9a-f]{16})(\/reset)?$/);
  if (target) {
    const acct = await getAccount(env, target[1]);
    if (!acct) throw new HttpError(404, 'Compte introuvable');
    if (target[2] && method === 'POST') {
      const code = readableCode();
      await env.KV.put(`rst:${normCode(code)}`, acct.id, { expirationTtl: RESET_TTL });
      return json({ code, expires: new Date(Date.now() + RESET_TTL * 1000).toISOString() });
    }
    if (!target[2] && method === 'DELETE') {
      if (acct.id === user.id) throw new HttpError(400, 'Supprime ton propre compte depuis la page Compte');
      await purgeAccount(env, acct);
      return json({ ok: true });
    }
  }

  throw new HttpError(404, 'Route inconnue');
}

export { authenticate };
