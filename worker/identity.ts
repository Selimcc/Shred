// Identité publique : prénom, @pseudo unique, surnom et bio, ce que les autres membres voient de toi.
//
// Le @pseudo :
//   - 3 à 20 caractères, minuscules, chiffres, point et tiret bas, commence par une lettre ;
//   - unique, et sans sosie : « se1im » est refusé si « selim » existe (mêmes lettres une fois 0/o, 1/l/i… rapprochés) ;
//   - quelques noms réservés (admin, shred, coach…) pour qu'on ne puisse pas se faire passer pour l'app ;
//   - 2 changements par période de 14 jours, et l'ancien pseudo reste réservé 14 jours à son ancien
//     propriétaire (personne ne peut le prendre aussitôt pour se faire passer pour lui).
//
// KV : handle:<pseudo> → id (recherche), hold:<pseudo> → id (ancien pseudo réservé, expire seul).
import { BIO_MAX, fold, HANDLE_MAX, handleProblem, NICK_MAX, normHandle, skeleton } from '../shared/handle';
import { type Env, HttpError, json, readJson } from './env';
import { requestLang, say, tx } from './i18n';
import { capDaily, counters } from './usage';
import { type Account, getAccount, indexEntry, type IndexEntry, listAccounts, saveIndex, type User, writeAccount } from './users';

const CHANGE_WINDOW = 14 * 86400 * 1000;
const CHANGES_PER_WINDOW = 2;
const HOLD_TTL = 14 * 86400;

/** Texte libre affiché aux autres : une ligne (ou quelques-unes pour la bio), sans caractères de contrôle. */
export function cleanText(v: unknown, max: number, lines = 1): string {
  let s = String(v ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
    .replace(/[ \t]+/g, ' ');
  s = s
    .split('\n')
    .map((l) => l.trim())
    .filter((l, i, a) => l || (i > 0 && a[i - 1]))
    .slice(0, lines)
    .join('\n')
    .trim();
  return [...s].slice(0, max).join('');
}

/** Le pseudo de quelqu'un d'autre, ou un sosie, ou un ancien pseudo encore réservé : pris. */
async function takenBy(env: Env, h: string, me: string, list: IndexEntry[]): Promise<string | null> {
  const sk = skeleton(h);
  const other = list.find((u) => u.id !== me && u.handle && (u.handle === h || skeleton(u.handle) === sk));
  if (other) return other.handle === h ? say('Ce pseudo est déjà pris') : say('Trop proche du pseudo d’un autre membre');
  const hold = await env.KV.get(`hold:${h}`);
  if (hold && hold !== me) return say('Ce pseudo est déjà pris');
  return null;
}

/** Propositions libres à partir d'une base (prénom ou pseudo voulu). */
async function suggestions(env: Env, base: string, me: string, list: IndexEntry[]): Promise<string[]> {
  const root =
    fold(base)
      .replace(/[^a-z0-9]+/g, '')
      .replace(/^[^a-z]+/, '')
      .slice(0, HANDLE_MAX - 3) || 'membre';
  const year = String(new Date().getFullYear()).slice(2);
  const tries = [
    root,
    `${root}.fit`,
    `${root}_${year}`,
    `${root}.shred`,
    `le.${root}`,
    `${root}${Math.floor(10 + Math.random() * 89)}`,
    `${root}${Math.floor(100 + Math.random() * 899)}`,
  ];
  const out: string[] = [];
  for (const t of tries) {
    const h = t.slice(0, HANDLE_MAX).replace(/[._]+$/, '');
    if (out.includes(h) || handleProblem(h)) continue;
    if (!(await takenBy(env, h, me, list))) out.push(h);
    if (out.length === 3) break;
  }
  return out;
}

/** Un pseudo libre pour un compte qui n'en a pas encore (inscription, ou comptes d'avant les pseudos). */
export async function freeHandle(env: Env, name: string, me: string, list: IndexEntry[]): Promise<string> {
  const s = await suggestions(env, name, me, list);
  if (s[0]) return s[0];
  return `membre${Math.floor(1000 + Math.random() * 8999)}`;
}

/** Donne un pseudo aux comptes qui n'en ont pas (créés avant cette version), en une seule écriture de l'index. */
export async function ensureHandles(env: Env, list: IndexEntry[]): Promise<IndexEntry[]> {
  const missing = list.filter((u) => !u.handle);
  if (!missing.length) return list;
  const out = list.map((u) => ({ ...u }));
  for (const u of out.filter((x) => !x.handle)) {
    u.handle = await freeHandle(env, u.name, u.id, out);
    const acct = await getAccount(env, u.id);
    if (acct && !acct.handle) {
      acct.handle = u.handle;
      await writeAccount(env, acct);
    }
    await env.KV.put(`handle:${u.handle}`, u.id);
  }
  await saveIndex(env, out);
  return out;
}

function changesLeft(acct: Account, now = Date.now()) {
  const recent = (acct.handleChanges ?? []).filter((t) => now - Date.parse(t) < CHANGE_WINDOW);
  const left = Math.max(0, CHANGES_PER_WINDOW - recent.length);
  const next = left ? null : new Date(Math.min(...recent.map((t) => Date.parse(t))) + CHANGE_WINDOW).toISOString();
  return { recent, left, next };
}

export interface Identity {
  name: string;
  handle: string;
  nick: string;
  bio: string;
  email: string;
  handleChangesLeft: number;
  nextHandleChange: string | null;
}

function identityOf(acct: Account): Identity {
  const c = changesLeft(acct);
  return {
    name: acct.name,
    handle: acct.handle ?? '',
    nick: acct.nick ?? '',
    bio: acct.bio ?? '',
    email: acct.email,
    handleChangesLeft: c.left,
    nextHandleChange: c.next,
  };
}

/** Libère les pseudos d'un compte supprimé. */
export async function releaseHandle(env: Env, acct: Account) {
  if (acct.handle && (await env.KV.get(`handle:${acct.handle}`)) === acct.id) await env.KV.delete(`handle:${acct.handle}`);
}

export async function identityRoutes(req: Request, env: Env, user: User, url: URL): Promise<Response | null> {
  const { pathname } = url;
  if (!pathname.startsWith('/api/account/identity') && pathname !== '/api/account/handle') return null;

  if (pathname === '/api/account/handle' && req.method === 'GET') {
    // Vérification en direct pendant la saisie : valable ? libre ? sinon, trois propositions libres.
    await capDaily(env, user.id, 'handle');
    const h = normHandle(url.searchParams.get('h'));
    const list = await listAccounts(env);
    const mine = list.find((u) => u.id === user.id)?.handle;
    if (h && h === mine) return json({ handle: h, ok: true, mine: true });
    const problem = handleProblem(h) ?? (await takenBy(env, h, user.id, list));
    if (!problem) return json({ handle: h, ok: true });
    return json({
      handle: h,
      ok: false,
      reason: tx(requestLang(req), problem),
      suggestions: await suggestions(env, h.length >= 2 ? h : user.name, user.id, list),
    });
  }

  if (pathname === '/api/account/identity' && req.method === 'GET') {
    let acct = await getAccount(env, user.id);
    if (!acct) throw new HttpError(404, 'Compte introuvable');
    if (!acct.handle) {
      await ensureHandles(env, await listAccounts(env));
      acct = (await getAccount(env, user.id))!;
    }
    return json(identityOf(acct));
  }

  if (pathname === '/api/account/identity' && req.method === 'PUT') {
    const b = await readJson<{
      name?: unknown;
      handle?: unknown;
      nick?: unknown;
      bio?: unknown;
    }>(req, 4_000);
    const acct = await getAccount(env, user.id);
    if (!acct) throw new HttpError(404, 'Compte introuvable');

    if (b.name !== undefined) {
      const name = cleanText(b.name, 30);
      if (!name) throw new HttpError(400, 'Indique ton prénom');
      acct.name = name;
    }
    if (b.nick !== undefined) acct.nick = cleanText(b.nick, NICK_MAX) || undefined;
    if (b.bio !== undefined) acct.bio = cleanText(b.bio, BIO_MAX, 4) || undefined;

    let released: string | null = null;
    if (b.handle !== undefined) {
      const h = normHandle(b.handle);
      if (h !== acct.handle) {
        const problem = handleProblem(h);
        if (problem) throw new HttpError(400, problem);
        const c = changesLeft(acct);
        if (!c.left) {
          const when = new Date(c.next!).toLocaleDateString('fr-FR', {
            day: 'numeric',
            month: 'long',
          });
          throw new HttpError(429, 'Tu as déjà changé de pseudo {n} fois en 14 jours. Prochain changement possible le {date}.', { n: CHANGES_PER_WINDOW, date: when });
        }
        // Deux personnes qui veulent le même pseudo à la même seconde : une seule passe.
        if (!(await counters.once(env, `claim:${skeleton(h)}`, 30))) throw new HttpError(409, 'Ce pseudo vient d’être pris, choisis-en un autre');
        const taken = await takenBy(env, h, user.id, await listAccounts(env));
        if (taken) throw new HttpError(409, taken);
        released = acct.handle ?? null;
        acct.handle = h;
        // Le premier pseudo, donné automatiquement, ne compte pas comme un changement.
        if (released) acct.handleChanges = [...c.recent, new Date().toISOString()];
      }
    }

    await writeAccount(env, acct);
    const list = await listAccounts(env);
    const entry = indexEntry(acct);
    await saveIndex(env, list.some((u) => u.id === acct.id) ? list.map((u) => (u.id === acct.id ? entry : u)) : [...list, entry]);
    if (released) {
      await env.KV.put(`hold:${released}`, acct.id, {
        expirationTtl: HOLD_TTL,
      });
      await env.KV.delete(`handle:${released}`);
    }
    if (acct.handle) await env.KV.put(`handle:${acct.handle}`, acct.id);
    return json(identityOf(acct));
  }

  throw new HttpError(404, 'Route inconnue');
}
