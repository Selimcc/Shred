// Le club : un fil de séances partagées entre les membres, avec photos, étincelles (on en envoie une pour
// saluer une séance, elle rapporte de l'XP à son auteur), commentaires, mentions @, abonnements et notifications. Tout vit dans un seul Durable Object (cohérent, sans course
// entre deux écritures) ; les photos sont rangées dans KV. Rien de la sauvegarde chiffrée n'est lu ici :
// chacun choisit ce qu'il publie, séance par séance.
import { sanitizeTrack, type Track } from './places';
import { capDaily } from './usage';
import { ensureHandles } from './identity';
import { type Env, HttpError, json, readJson } from './env';
import { vapidFromEnv } from './reminders';
import { getAccount, type IndexEntry, listAccounts, loadJson, type User, userStore } from './users';
import { fold } from '../shared/handle';
import { addPlates, claimPlates, GAGE_MAX, GRACE_MS, NULOS_HOURS, OPEN_MAX, PLATES, stakeOf, type Wallet } from '../shared/plates';
import type { StoredProfile } from './profiles';
import { type PushSubscriptionData, sendPush } from './webpush';

export type Visibility = 'all' | 'followers' | 'private';

export interface Mention {
  id: string;
  name: string;
}

/** Résumé d'une séance, préparé par l'app (jamais les données Strava d'un autre service). */
export interface SessionSummary {
  title: string;
  kind: 'lifting' | 'cardio' | 'rest';
  /** Sports d'endurance de la séance (« run », « swim »…). */
  sports?: string[];
  stats: { label: string; value: string }[];
  /** Profil d'intensité : [zone 1 à 5, secondes]. */
  profile?: [number, number][];
  records?: string[];
  date: string;
}

export interface Post {
  id: string;
  author: string;
  authorName: string;
  at: number;
  text: string;
  mentions: Mention[];
  session?: SessionSummary;
  photos: string[];
  /** Courte vidéo (15 s au plus) : fichier, image d'aperçu, format, durée, et si son propre son se joue. */
  video?: PostVideo;
  /** Musique jointe (extrait Apple Music de 30 s). */
  music?: Track;
  visibility: Visibility;
  /** Membres qui ont envoyé une étincelle. */
  sparks: string[];
  comments: number;
  /** Dernière modification du texte par son auteur : l'app affiche « (modifié) ». */
  editedAt?: number;
}

export interface Comment {
  id: string;
  post: string;
  author: string;
  authorName: string;
  at: number;
  text: string;
  mentions: Mention[];
}

export type NoticeType =
  | 'mention'
  | 'comment'
  | 'spark'
  | 'follow'
  | 'request'
  | 'accepted'
  | 'challenge'
  | 'challengeDone'
  | 'challengeFailed'
  | 'challengeExpired'
  | 'gageDone'
  | 'rematch';

/**
 * Un défi : « fais une séance avant telle heure ». Relevé quand la personne défiée valide une séance à temps : elle
 * empoche la mise. Raté : la mise revient à son auteur, la personne défiée porte le bonnet de Nulos 24 h et fait
 * son gage s'il y en a un. Elle peut prendre sa revanche une fois, gratuitement.
 */
export interface Challenge {
  id: string;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  at: number;
  due: number;
  text?: string;
  /** Disques misés par l'auteur (gage compris). */
  stake?: number;
  gage?: string;
  /** Revanche : le défi raté qu'elle venge. */
  rematch?: string;
  status: 'open' | 'done' | 'failed';
  doneAt?: number;
  failedAt?: number;
  /** Gage fait (le bonnet tombe). */
  gageDone?: number;
  /** La revanche lancée après cet échec. */
  revenge?: string;
}

/** Défis relevés et ratés par une personne. */
export interface ChallengeRecord {
  won: number;
  lost: number;
}

/** Délais proposés, en heures. */
export const CHALLENGE_HOURS = [24, 48, 168];

export interface Notice {
  id: string;
  type: NoticeType;
  actor: string;
  actorName: string;
  post?: string;
  text?: string;
  at: number;
}

/** Ce que le Durable Object renvoie au Worker pour prévenir les gens sur leur téléphone. */
interface Push {
  user: string;
  title: string;
  body: string;
  url: string;
}

const LIMITS = { text: 1000, comment: 500, photos: 4, photoBytes: 900_000, videoBytes: 6_000_000, videoSeconds: 16, stats: 6, profile: 90, feed: 20 };

export interface PostVideo {
  id: string;
  poster: string;
  w: number;
  h: number;
  dur: number;
  sound: boolean;
}

/** Tous les fichiers d'une publication (photos, vidéo et son aperçu) : même droit de lecture, même suppression. */
const media = (p: Post) => [...p.photos, ...(p.video ? [p.video.id, p.video.poster] : [])];

const rid = () => {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};
const pad = (n: number) => String(n).padStart(13, '0');
const postKey = (p: Pick<Post, 'at' | 'id'>) => `p:${pad(p.at)}:${p.id}`;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Ne garde que des champs connus et bornés. */
export function sanitizeSummary(input: unknown): SessionSummary | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const s = input as Record<string, unknown>;
  const title = str(s.title, 60);
  if (!title) return undefined;
  const kind = s.kind === 'lifting' || s.kind === 'cardio' || s.kind === 'rest' ? s.kind : 'lifting';
  const stats = Array.isArray(s.stats)
    ? s.stats
        .slice(0, LIMITS.stats)
        .map((x: Record<string, unknown>) => ({ label: str(x?.label, 24), value: str(x?.value, 24) }))
        .filter((x) => x.label && x.value)
    : [];
  const profile = Array.isArray(s.profile)
    ? s.profile
        .slice(0, LIMITS.profile)
        .filter((x): x is [number, number] => Array.isArray(x) && x.length === 2)
        .map(([z, sec]) => [Math.max(1, Math.min(5, Math.round(Number(z) || 1))), Math.max(1, Math.min(36_000, Math.round(Number(sec) || 1)))] as [number, number])
    : undefined;
  const sports = Array.isArray(s.sports) ? s.sports.slice(0, 4).map((x) => str(x, 10)).filter((x) => /^[a-z]+$/.test(x)) : undefined;
  const records = Array.isArray(s.records) ? s.records.slice(0, 3).map((x) => str(x, 80)).filter(Boolean) : undefined;
  const date = typeof s.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : new Date().toISOString().slice(0, 10);
  return { title, kind, stats, date, ...(profile?.length ? { profile } : {}), ...(sports?.length ? { sports } : {}), ...(records?.length ? { records } : {}) };
}

/* ---------- Durable Object ---------- */

interface Req {
  viewer: string;
  viewerName: string;
  admin?: boolean;
  [k: string]: unknown;
}

export class Club {
  constructor(
    private state: DurableObjectState,
    _env: Env,
  ) {}

  private get db() {
    return this.state.storage;
  }

  private async following(user: string): Promise<string[]> {
    return (await this.db.get<string[]>(`f:${user}`)) ?? [];
  }

  /** Comptes privés : leurs publications « tout le club » ne se montrent qu'à leurs abonnés. */
  private async privates(): Promise<Set<string>> {
    return new Set((await this.db.get<string[]>('private')) ?? []);
  }

  private async see(viewer: string): Promise<(p: Post) => boolean> {
    const [follows, privs] = await Promise.all([this.following(viewer), this.privates()]);
    return (p) => this.canSee(p, viewer, follows, privs);
  }

  private canSee(p: Post, viewer: string, follows: string[], privs: Set<string> = new Set()): boolean {
    if (p.author === viewer || p.mentions.some((m) => m.id === viewer)) return true;
    if (p.visibility === 'all') return !privs.has(p.author) || follows.includes(p.author);
    return p.visibility === 'followers' && follows.includes(p.author);
  }

  private async list(key: string): Promise<string[]> {
    return (await this.db.get<string[]>(key)) ?? [];
  }

  /** `follower` suit désormais `target` (abonnement direct ou demande acceptée). */
  private async link(follower: string, target: string) {
    const [f, fb] = await Promise.all([this.list(`f:${follower}`), this.list(`fb:${target}`)]);
    await this.db.put(`f:${follower}`, [...new Set([...f, target])]);
    await this.db.put(`fb:${target}`, [...new Set([...fb, follower])]);
  }

  private async unlink(follower: string, target: string) {
    const [f, fb] = await Promise.all([this.list(`f:${follower}`), this.list(`fb:${target}`)]);
    await this.db.put(`f:${follower}`, f.filter((x) => x !== target));
    await this.db.put(`fb:${target}`, fb.filter((x) => x !== follower));
  }

  /** Retire une demande en attente des deux côtés, et sa notification chez la personne demandée. */
  private async dropRequest(from: string, target: string) {
    const [rq, rqo] = await Promise.all([this.list(`rq:${target}`), this.list(`rqo:${from}`)]);
    await this.db.put(`rq:${target}`, rq.filter((x) => x !== from));
    await this.db.put(`rqo:${from}`, rqo.filter((x) => x !== target));
    const notes = await this.db.list<Notice>({ prefix: `n:${target}:` });
    const stale = [...notes].filter(([, n]) => n.type === 'request' && n.actor === from).map(([k]) => k);
    if (stale.length) await this.db.delete(stale);
  }

  private async notify(user: string, n: Omit<Notice, 'id' | 'at'>): Promise<void> {
    if (user === n.actor) return;
    const at = Date.now();
    await this.db.put(`n:${user}:${pad(at)}:${rid()}`, { ...n, id: rid(), at });
  }

  private async wallet(user: string): Promise<Wallet> {
    return (await this.db.get<Wallet>(`w:${user}`)) ?? { bal: PLATES.start };
  }

  private async record(user: string): Promise<ChallengeRecord> {
    return (await this.db.get<ChallengeRecord>(`rec:${user}`)) ?? { won: 0, lost: 0 };
  }

  private async bump(user: string, field: keyof ChallengeRecord) {
    const r = await this.record(user);
    r[field]++;
    await this.db.put(`rec:${user}`, r);
  }

  /** Fin du bonnet de Nulos, ou 0 s'il n'en porte pas. */
  private async nulos(user: string): Promise<number> {
    const until = (await this.db.get<number>(`nul:${user}`)) ?? 0;
    return until > Date.now() ? until : 0;
  }

  /** Les défis de la personne (reçus et lancés), les plus récents d'abord. */
  private async challengesOf(user: string, limit = 60): Promise<Challenge[]> {
    const ids = await this.db.list<string>({ prefix: `chu:${user}:`, reverse: true, limit });
    return (await Promise.all([...ids.values()].map((id) => this.db.get<Challenge>(`ch:${id}`)))).filter((x): x is Challenge => Boolean(x));
  }

  /** Le bonnet tient tant qu'un défi raté de moins de 24 h n'a pas son gage fait. */
  private async refreshNulos(user: string) {
    const now = Date.now();
    let until = 0;
    for (const c of await this.challengesOf(user)) {
      if (c.to !== user || c.status !== 'failed' || c.gageDone) continue;
      until = Math.max(until, (c.failedAt ?? c.due) + NULOS_HOURS * 3600_000);
    }
    if (until > now) await this.db.put(`nul:${user}`, until);
    else await this.db.delete(`nul:${user}`);
  }

  /** Échéance passée sans séance (demi-heure de grâce comprise) : le défi est raté. True s'il vient d'être réglé. */
  private async settle(c: Challenge, pushes: Push[], now = Date.now()): Promise<boolean> {
    if (c.status !== 'open' || now <= c.due + GRACE_MS) return false;
    c.status = 'failed';
    c.failedAt = c.due;
    await this.db.put(`ch:${c.id}`, c);
    await this.db.delete(`open:${pad(c.due)}:${c.id}`);
    if (c.stake) await this.db.put(`w:${c.from}`, addPlates(await this.wallet(c.from), c.stake));
    const until = c.due + NULOS_HOURS * 3600_000;
    if (until > now) await this.db.put(`nul:${c.to}`, Math.max(until, (await this.db.get<number>(`nul:${c.to}`)) ?? 0));
    await this.bump(c.to, 'lost');
    await this.notify(c.to, { type: 'challengeFailed', actor: c.from, actorName: c.fromName, text: c.gage ?? c.text });
    await this.notify(c.from, { type: 'challengeExpired', actor: c.to, actorName: c.toName, text: c.text });
    if (until > now)
      pushes.push({
        user: c.to,
        title: 'Défi raté : bonnet de Nulos',
        body: c.gage ? `Ton gage : ${c.gage}` : `Pour 24 h. Prends ta revanche contre ${c.fromName} !`,
        url: '/?tab=club',
      });
    pushes.push({
      user: c.from,
      title: `${c.toName} n’a pas relevé ton défi`,
      body: c.stake ? `Ta mise de ${c.stake} disque${c.stake > 1 ? 's' : ''} te revient.` : 'Pas de séance dans les temps.',
      url: '/?tab=club',
    });
    return true;
  }

  private async getPost(id: string): Promise<{ key: string; post: Post } | null> {
    const key = await this.db.get<string>(`pid:${id}`);
    if (!key) return null;
    const post = await this.db.get<Post>(key);
    return post ? { key, post } : null;
  }

  async fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    const b = (await req.json()) as Req;
    const viewer = b.viewer;
    const pushes: Push[] = [];
    const out = (data: Record<string, unknown>) => Response.json({ ...data, pushes });

    switch (pathname) {
      case '/feed': {
        const follows = await this.following(viewer);
        const visible = await this.see(viewer);
        const filter = typeof b.filter === 'string' ? b.filter : 'all';
        const only = filter.startsWith('user:') ? filter.slice(5) : null;
        const posts: Post[] = [];
        let end = typeof b.before === 'string' && b.before.startsWith('p:') ? b.before : undefined;
        // On remonte le fil par paquets jusqu'à avoir de quoi remplir la page.
        let more = true;
        for (let round = 0; round < 6 && posts.length < LIMITS.feed && more; round++) {
          const page = await this.db.list<Post>({ prefix: 'p:', reverse: true, limit: 50, ...(end ? { end } : {}) });
          let seen = 0;
          for (const [key, p] of page) {
            seen++;
            end = key;
            if (!visible(p)) continue;
            if (only && p.author !== only) continue;
            if (filter === 'following' && p.author !== viewer && !follows.includes(p.author)) continue;
            posts.push(p);
            if (posts.length >= LIMITS.feed) break;
          }
          // Page incomplète et entièrement lue : on est au bout du fil.
          if (page.size < 50 && seen === page.size) more = posts.length >= LIMITS.feed && seen < page.size;
        }
        // Les auteurs qui portent le bonnet de Nulos en ce moment.
        const nulos: Record<string, number> = {};
        for (const a of new Set(posts.map((p) => p.author))) {
          const until = await this.nulos(a);
          if (until) nulos[a] = until;
        }
        return out({ posts, next: posts.length >= LIMITS.feed ? end : null, following: follows, nulos });
      }

      case '/create': {
        const p = b.post as Post;
        await this.db.put(postKey(p), p);
        await this.db.put(`pid:${p.id}`, postKey(p));
        for (const ph of media(p)) await this.db.put(`ph:${ph}`, p.id);
        const n = (await this.db.get<number>(`count:${viewer}`)) ?? 0;
        await this.db.put(`count:${viewer}`, n + 1);
        for (const m of p.mentions) {
          await this.notify(m.id, { type: 'mention', actor: viewer, actorName: b.viewerName, post: p.id, text: p.session?.title ?? p.text.slice(0, 80) });
          pushes.push({ user: m.id, title: `${b.viewerName} t’a identifié`, body: p.session?.title ?? p.text.slice(0, 100), url: `/?tab=club&post=${p.id}` });
        }
        return out({ post: p });
      }

      case '/photo-check': {
        // Une photo ne se montre qu'à ceux qui peuvent voir sa publication.
        const photo = String(b.photo);
        let postId = await this.db.get<string>(`ph:${photo}`);
        if (!postId) {
          // Photos d'avant l'index : on retrouve leur publication une fois, puis on retient le lien.
          const all = await this.db.list<Post>({ prefix: 'p:' });
          for (const p of all.values()) {
            for (const ph of media(p)) await this.db.put(`ph:${ph}`, p.id);
            if (media(p).includes(photo)) postId = p.id;
          }
        }
        const found = postId ? await this.getPost(postId) : null;
        return out({ ok: Boolean(found && (await this.see(viewer))(found.post)) });
      }

      case '/post': {
        const found = await this.getPost(String(b.id));
        if (!found || !(await this.see(viewer))(found.post)) return out({ error: 'not-found' });
        const comments = await this.db.list<Comment>({ prefix: `c:${found.post.id}:` });
        return out({ post: found.post, comments: [...comments.values()] });
      }

      case '/delete': {
        const found = await this.getPost(String(b.id));
        if (!found) return out({ error: 'not-found' });
        if (found.post.author !== viewer && !b.admin) return out({ error: 'forbidden' });
        for (const ph of media(found.post)) await this.db.delete(`ph:${ph}`);
        const comments = await this.db.list({ prefix: `c:${found.post.id}:` });
        await this.db.delete([found.key, `pid:${found.post.id}`, ...comments.keys()]);
        const n = (await this.db.get<number>(`count:${found.post.author}`)) ?? 1;
        await this.db.put(`count:${found.post.author}`, Math.max(0, n - 1));
        // Les étincelles de la publication supprimée ne comptent plus.
        const sp = (await this.db.get<number>(`sp:${found.post.author}`)) ?? 0;
        await this.db.put(`sp:${found.post.author}`, Math.max(0, sp - found.post.sparks.length));
        return out({ ok: true, photos: found.post.photos, videos: found.post.video ? [found.post.video.id] : [], posters: found.post.video ? [found.post.video.poster] : [] });
      }

      case '/edit': {
        // Seul l'auteur réécrit son texte (pas même un admin : ses mots restent les siens).
        const found = await this.getPost(String(b.id));
        if (!found) return out({ error: 'not-found' });
        const p = found.post;
        if (p.author !== viewer) return out({ error: 'forbidden-edit' });
        const text = typeof b.text === 'string' ? b.text : '';
        const mentions = Array.isArray(b.mentions) ? (b.mentions as Mention[]) : [];
        if (!text && !p.session && !p.photos.length && !p.video && !p.music) return out({ error: 'Le texte ne peut pas être vide sans photo ni séance' });
        const before = new Set(p.mentions.map((m) => m.id));
        const same = text === p.text && mentions.length === before.size && mentions.every((m) => before.has(m.id));
        if (same) return out({ post: p });
        p.text = text;
        p.mentions = mentions;
        p.editedAt = Date.now();
        await this.db.put(found.key, p);
        // Seules les personnes ajoutées par la modification sont prévenues.
        for (const m of mentions.filter((x) => !before.has(x.id))) {
          await this.notify(m.id, { type: 'mention', actor: viewer, actorName: b.viewerName, post: p.id, text: p.session?.title ?? p.text.slice(0, 80) });
          pushes.push({ user: m.id, title: `${b.viewerName} t’a identifié`, body: p.session?.title ?? p.text.slice(0, 100), url: `/?tab=club&post=${p.id}` });
        }
        return out({ post: p });
      }

      case '/spark': {
        const found = await this.getPost(String(b.id));
        if (!found || !(await this.see(viewer))(found.post)) return out({ error: 'not-found' });
        const p = found.post;
        if (p.author === viewer) return out({ error: 'self' });
        const had = p.sparks.includes(viewer);
        p.sparks = had ? p.sparks.filter((x) => x !== viewer) : [...p.sparks, viewer];
        await this.db.put(found.key, p);
        // Le total reçu par l'auteur : il devient de l'XP dans son app.
        const total = (await this.db.get<number>(`sp:${p.author}`)) ?? 0;
        await this.db.put(`sp:${p.author}`, Math.max(0, total + (had ? -1 : 1)));
        if (!had) await this.notify(p.author, { type: 'spark', actor: viewer, actorName: b.viewerName, post: p.id, text: p.session?.title ?? p.text.slice(0, 80) });
        return out({ post: p });
      }

      case '/comment': {
        const found = await this.getPost(String(b.id));
        if (!found || !(await this.see(viewer))(found.post)) return out({ error: 'not-found' });
        const c = b.comment as Comment;
        await this.db.put(`c:${found.post.id}:${pad(c.at)}:${c.id}`, c);
        found.post.comments++;
        await this.db.put(found.key, found.post);
        const told = new Set<string>([viewer]);
        if (!told.has(found.post.author)) {
          told.add(found.post.author);
          await this.notify(found.post.author, { type: 'comment', actor: viewer, actorName: b.viewerName, post: found.post.id, text: c.text.slice(0, 100) });
          pushes.push({ user: found.post.author, title: `${b.viewerName} a commenté ta séance`, body: c.text.slice(0, 120), url: `/?tab=club&post=${found.post.id}` });
        }
        for (const m of c.mentions) {
          if (told.has(m.id)) continue;
          told.add(m.id);
          await this.notify(m.id, { type: 'mention', actor: viewer, actorName: b.viewerName, post: found.post.id, text: c.text.slice(0, 100) });
          pushes.push({ user: m.id, title: `${b.viewerName} t’a mentionné`, body: c.text.slice(0, 120), url: `/?tab=club&post=${found.post.id}` });
        }
        return out({ comment: c, post: found.post });
      }

      case '/uncomment': {
        const found = await this.getPost(String(b.id));
        if (!found) return out({ error: 'not-found' });
        const list = await this.db.list<Comment>({ prefix: `c:${found.post.id}:` });
        const entry = [...list.entries()].find(([, c]) => c.id === b.comment);
        if (!entry) return out({ error: 'not-found' });
        if (entry[1].author !== viewer && found.post.author !== viewer && !b.admin) return out({ error: 'forbidden' });
        await this.db.delete(entry[0]);
        found.post.comments = Math.max(0, found.post.comments - 1);
        await this.db.put(found.key, found.post);
        return out({ post: found.post });
      }

      case '/follow': {
        // Suivre, ne plus suivre, ou (compte privé) demander puis annuler sa demande.
        const target = String(b.target);
        if (target === viewer) return out({ error: 'self' });
        const list = await this.following(viewer);
        if (list.includes(target)) {
          await this.unlink(viewer, target);
          return out({ following: false, requested: false });
        }
        if ((await this.list(`rqo:${viewer}`)).includes(target)) {
          await this.dropRequest(viewer, target);
          return out({ following: false, requested: false });
        }
        if ((await this.privates()).has(target)) {
          const [rq, rqo] = await Promise.all([this.list(`rq:${target}`), this.list(`rqo:${viewer}`)]);
          await this.db.put(`rq:${target}`, [...new Set([...rq, viewer])]);
          await this.db.put(`rqo:${viewer}`, [...new Set([...rqo, target])]);
          await this.notify(target, { type: 'request', actor: viewer, actorName: b.viewerName });
          pushes.push({ user: target, title: 'Demande d’abonnement', body: `${b.viewerName} veut suivre tes séances`, url: '/?tab=club&requests=1' });
          return out({ following: false, requested: true });
        }
        await this.link(viewer, target);
        await this.notify(target, { type: 'follow', actor: viewer, actorName: b.viewerName });
        pushes.push({ user: target, title: 'Nouvel abonné', body: `${b.viewerName} suit tes séances`, url: '/?tab=club' });
        return out({ following: true, requested: false });
      }

      case '/requests': {
        return out({ requests: await this.list(`rq:${viewer}`) });
      }

      case '/answer': {
        // Accepter ou refuser une demande reçue.
        const from = String(b.from);
        if (!(await this.list(`rq:${viewer}`)).includes(from)) return out({ error: 'no-request' });
        await this.dropRequest(from, viewer);
        if (b.accept) {
          await this.link(from, viewer);
          await this.notify(from, { type: 'accepted', actor: viewer, actorName: b.viewerName });
          pushes.push({ user: from, title: 'Demande acceptée', body: `${b.viewerName} a accepté ta demande : tu vois ses séances`, url: '/?tab=club' });
        }
        return out({ ok: true, accepted: Boolean(b.accept) });
      }

      case '/remove-follower': {
        const target = String(b.target);
        await this.unlink(target, viewer);
        return out({ ok: true });
      }

      case '/privacy': {
        const privs = await this.privates();
        const on = Boolean(b.private);
        if (on) privs.add(viewer);
        else privs.delete(viewer);
        await this.db.put('private', [...privs]);
        if (!on) {
          // Compte redevenu public : les demandes en attente sont acceptées.
          for (const from of await this.list(`rq:${viewer}`)) {
            await this.dropRequest(from, viewer);
            await this.link(from, viewer);
            await this.notify(from, { type: 'accepted', actor: viewer, actorName: b.viewerName });
          }
        }
        return out({ private: on });
      }

      case '/social': {
        // Sans liste d'identifiants : les relations de la personne (abonnements, abonnés, demandes).
        const [following, followers, requested, requests, privs] = await Promise.all([
          this.following(viewer),
          this.list(`fb:${viewer}`),
          this.list(`rqo:${viewer}`),
          this.list(`rq:${viewer}`),
          this.privates(),
        ]);
        const ids = Array.isArray(b.ids) ? (b.ids as string[]) : [...new Set([viewer, ...following, ...followers, ...requested, ...requests])];
        const rows = await Promise.all(
          ids.map(async (id) => ({
            id,
            followers: (await this.list(`fb:${id}`)).length,
            following: (await this.list(`f:${id}`)).length,
            posts: (await this.db.get<number>(`count:${id}`)) ?? 0,
            sparks: (await this.db.get<number>(`sp:${id}`)) ?? 0,
            private: privs.has(id),
            nulos: await this.nulos(id),
            record: await this.record(id),
          })),
        );
        return out({ following, followers, requested, requests, rows });
      }

      case '/notices': {
        const list = await this.db.list<Notice>({ prefix: `n:${viewer}:`, reverse: true, limit: 40 });
        const read = (await this.db.get<number>(`nr:${viewer}`)) ?? 0;
        const notices = [...list.values()];
        return out({ notices, unread: notices.filter((n) => n.at > read).length, readAt: read });
      }

      case '/read': {
        await this.db.put(`nr:${viewer}`, Date.now());
        return out({ ok: true });
      }

      case '/challenge': {
        const c = b.challenge as Challenge;
        if (c.to === viewer) return out({ error: 'challenge-self' });
        if ((await this.privates()).has(c.to) && !(await this.following(viewer)).includes(c.to)) return out({ error: 'challenge-private' });
        const now = Date.now();
        const mine = await this.challengesOf(viewer);
        // En cours : lancé par toi, ni relevé ni échu (on ne règle rien ici, le cron et la liste s'en chargent).
        const open = mine.filter((x) => x.from === viewer && x.status === 'open' && now <= x.due + GRACE_MS);
        if (open.some((x) => x.to === c.to)) return out({ error: 'challenge-pair' });
        if (open.length >= OPEN_MAX) return out({ error: 'challenge-many' });
        if (c.rematch) {
          // Revanche : contre qui t'a battu, une seule fois, tant que le bonnet est sur ta tête. Gratuite, sans gage.
          const origin = mine.find((x) => x.id === c.rematch);
          if (!origin || origin.to !== viewer || origin.from !== c.to || origin.status !== 'failed' || origin.revenge || (origin.failedAt ?? origin.due) + NULOS_HOURS * 3600_000 < now)
            return out({ error: 'rematch-closed' });
          c.stake = 0;
          delete c.gage;
          origin.revenge = c.id;
          await this.db.put(`ch:${origin.id}`, origin);
        } else {
          const w = await this.wallet(viewer);
          if (w.bal < (c.stake ?? 0)) return out({ error: 'challenge-poor' });
          if (c.stake) await this.db.put(`w:${viewer}`, addPlates(w, -c.stake));
        }
        await this.db.put(`ch:${c.id}`, c);
        await this.db.put(`chu:${viewer}:${pad(c.at)}:${c.id}`, c.id);
        await this.db.put(`chu:${c.to}:${pad(c.at)}:${c.id}`, c.id);
        await this.db.put(`open:${pad(c.due)}:${c.id}`, c.id);
        await this.notify(c.to, { type: c.rematch ? 'rematch' : 'challenge', actor: viewer, actorName: b.viewerName, text: c.gage ? `${c.text ? `${c.text} ` : ''}Gage : ${c.gage}` : c.text });
        pushes.push({
          user: c.to,
          title: c.rematch ? `${b.viewerName} prend sa revanche` : `${b.viewerName} te lance un défi`,
          body: c.gage ? `Gage si tu rates : ${c.gage}` : c.text || 'Une séance avant la fin du délai. Tu relèves ?',
          url: '/?tab=club',
        });
        return out({ challenge: c, wallet: await this.wallet(viewer) });
      }

      case '/challenges': {
        const now = Date.now();
        const list = await this.challengesOf(viewer, 30);
        // Les défis échus se règlent dès qu'on les regarde, sans attendre le passage du cron.
        for (const c of list) await this.settle(c, pushes, now);
        return out({ challenges: list, wallet: await this.wallet(viewer), nulos: await this.nulos(viewer), record: await this.record(viewer) });
      }

      case '/challenge-done': {
        const c = await this.db.get<Challenge>(`ch:${String(b.id)}`);
        if (!c || c.to !== viewer) return out({ error: 'challenge-missing' });
        if (c.status === 'done') return out({ challenge: c, already: true });
        const now = Date.now();
        const at = typeof b.at === 'number' && Number.isFinite(b.at) ? b.at : now;
        // À temps : maintenant, ou validée hors ligne avant l'échéance et arrivée dans la demi-heure.
        const inTime = c.status === 'open' && at >= c.at && (now <= c.due || (now <= c.due + GRACE_MS && at <= c.due));
        if (!inTime) return out({ error: 'challenge-expired' });
        c.status = 'done';
        c.doneAt = Math.min(now, at);
        await this.db.put(`ch:${c.id}`, c);
        await this.db.delete(`open:${pad(c.due)}:${c.id}`);
        if (c.stake) await this.db.put(`w:${viewer}`, addPlates(await this.wallet(viewer), c.stake));
        await this.bump(viewer, 'won');
        await this.notify(c.from, { type: 'challengeDone', actor: viewer, actorName: b.viewerName, text: c.text });
        pushes.push({
          user: c.from,
          title: `${b.viewerName} a relevé ton défi`,
          body: c.stake ? `Séance validée dans les temps : ta mise de ${c.stake} disque${c.stake > 1 ? 's' : ''} est pour ${b.viewerName}.` : 'Séance validée dans les temps.',
          url: '/?tab=club',
        });
        return out({ challenge: c, wallet: await this.wallet(viewer) });
      }

      case '/gage-done': {
        const c = await this.db.get<Challenge>(`ch:${String(b.id)}`);
        if (!c || c.to !== viewer || c.status !== 'failed' || !c.gage) return out({ error: 'challenge-missing' });
        if (c.gageDone) return out({ challenge: c, already: true, nulos: await this.nulos(viewer) });
        c.gageDone = Date.now();
        await this.db.put(`ch:${c.id}`, c);
        await this.refreshNulos(viewer);
        await this.notify(c.from, { type: 'gageDone', actor: viewer, actorName: b.viewerName, text: c.gage });
        pushes.push({ user: c.from, title: `${b.viewerName} a fait son gage`, body: c.gage, url: '/?tab=club' });
        return out({ challenge: c, nulos: await this.nulos(viewer) });
      }

      case '/wallet': {
        const day = String(b.day ?? '');
        const streak = Number(b.streak);
        const r = claimPlates(await this.wallet(viewer), day, streak);
        if (r.gained || r.wallet.day !== (await this.wallet(viewer)).day) await this.db.put(`w:${viewer}`, r.wallet);
        return out({ wallet: r.wallet, gained: r.gained, bonus: r.bonus });
      }

      case '/sweep': {
        // Passage du cron : les défis échus deviennent ratés, avec notifications.
        if (!(await this.db.get('open-index'))) {
          // Défis d'avant la 0.30 : on indexe une fois ceux qui sont encore ouverts.
          const all = await this.db.list<Challenge>({ prefix: 'ch:' });
          for (const c of all.values()) if (c.status === 'open') await this.db.put(`open:${pad(c.due)}:${c.id}`, c.id);
          await this.db.put('open-index', 1);
        }
        const now = Date.now();
        const due = await this.db.list<string>({ prefix: 'open:', end: `open:${pad(now - GRACE_MS)}`, limit: 100 });
        let settled = 0;
        for (const [key, id] of due) {
          const c = await this.db.get<Challenge>(`ch:${id}`);
          if (c && (await this.settle(c, pushes, now))) settled++;
          else await this.db.delete(key);
        }
        return out({ settled });
      }

      case '/forget': {
        // Compte supprimé : ses publications, commentaires et abonnements partent avec lui.
        const all = await this.db.list<Post>({ prefix: 'p:' });
        const photos: string[] = [];
        const videos: string[] = [];
        for (const [key, p] of all) {
          if (p.author !== viewer) continue;
          photos.push(...p.photos, ...(p.video ? [p.video.poster] : []));
          if (p.video) videos.push(p.video.id);
          const comments = await this.db.list({ prefix: `c:${p.id}:` });
          await this.db.delete([key, `pid:${p.id}`, ...comments.keys()]);
        }
        const challenges = await this.db.list<string>({ prefix: `chu:${viewer}:` });
        await this.db.delete([...challenges.keys(), ...[...challenges.values()].map((id) => `ch:${id}`)]);
        // Ses abonnements et abonnés : on le retire aussi des listes des autres.
        for (const t of await this.following(viewer)) await this.unlink(viewer, t);
        for (const f of await this.list(`fb:${viewer}`)) await this.unlink(f, viewer);
        for (const t of await this.list(`rqo:${viewer}`)) await this.dropRequest(viewer, t);
        for (const f of await this.list(`rq:${viewer}`)) await this.dropRequest(f, viewer);
        const privs = await this.privates();
        if (privs.delete(viewer)) await this.db.put('private', [...privs]);
        await this.db.delete([`f:${viewer}`, `fb:${viewer}`, `rq:${viewer}`, `rqo:${viewer}`, `count:${viewer}`, `nr:${viewer}`, `sp:${viewer}`, `w:${viewer}`, `rec:${viewer}`, `nul:${viewer}`]);
        return out({ ok: true, photos, videos });
      }
    }
    return Response.json({ error: 'route inconnue' }, { status: 404 });
  }
}

/* ---------- Routes du Worker ---------- */

function stub(env: Env) {
  if (!env.CLUB) throw new HttpError(503, 'Le club n’est pas configuré sur ce serveur');
  return env.CLUB.get(env.CLUB.idFromName('club'));
}

async function callClub<T>(env: Env, user: User, path: string, body: Record<string, unknown> = {}): Promise<T & { pushes: Push[]; error?: string }> {
  const res = await stub(env).fetch(`https://club${path}`, {
    method: 'POST',
    // L'identité passe en dernier : aucun champ du corps ne peut la remplacer.
    body: JSON.stringify({ ...body, viewer: user.id, viewerName: user.name, admin: user.role === 'admin' }),
  });
  const data = (await res.json()) as T & { pushes: Push[]; error?: string };
  if (data.error === 'not-found') throw new HttpError(404, 'Publication introuvable');
  if (data.error === 'forbidden') throw new HttpError(403, 'Tu ne peux pas supprimer ça');
  if (data.error === 'forbidden-edit') throw new HttpError(403, 'Seul l’auteur peut modifier sa publication');
  if (data.error === 'self') throw new HttpError(400, 'Pas d’étincelle pour soi-même');
  if (data.error === 'challenge-self') throw new HttpError(400, 'Pas de défi à soi-même');
  if (data.error === 'challenge-private') throw new HttpError(403, 'Compte privé : abonne-toi d’abord pour lancer un défi');
  if (data.error === 'no-request') throw new HttpError(404, 'Demande introuvable ou déjà traitée');
  if (data.error === 'challenge-many') throw new HttpError(429, `Déjà ${OPEN_MAX} défis lancés en cours : attends qu’ils se terminent`);
  if (data.error === 'challenge-pair') throw new HttpError(409, 'Un défi est déjà en cours avec cette personne : attends qu’il se termine');
  if (data.error === 'challenge-poor') throw new HttpError(402, 'Pas assez de disques : valide tes journées pour en gagner');
  if (data.error === 'rematch-closed') throw new HttpError(410, 'La revanche n’est plus possible');
  if (data.error === 'challenge-missing') throw new HttpError(404, 'Défi introuvable');
  if (data.error === 'challenge-expired') throw new HttpError(410, 'Défi expiré');
  if (data.error) throw new HttpError(400, data.error);
  return data;
}

interface SocialRow {
  id: string;
  followers: number;
  following: number;
  posts: number;
  sparks: number;
  private: boolean;
  /** Fin du bonnet de Nulos, 0 sinon. */
  nulos?: number;
  record?: ChallengeRecord;
}
interface Social {
  following: string[];
  followers: string[];
  requested: string[];
  requests: string[];
  rows: SocialRow[];
}

/** Liens de la personne avec ces membres (ou, sans liste, avec toutes ses relations). */
function social(env: Env, user: User, ids?: string[]) {
  return callClub<Social>(env, user, '/social', ids ? { ids } : {});
}

/** Compteurs du club pour une liste de membres (panneau admin). */
export async function clubStats(env: Env, user: User, ids: string[]): Promise<SocialRow[]> {
  return (await social(env, user, ids)).rows;
}

/**
 * Fiches de membres vues par `user`. Un compte privé que la personne ne suit pas ne montre que son nom,
 * son pseudo, sa photo, son surnom, sa bio et ses compteurs : pas sa fiche de force ni ses séances.
 */
async function buildMembers(env: Env, user: User, accounts: IndexEntry[], s: Social) {
  const avatars = await Promise.all(accounts.map((a) => userStore(env.KV, a.id).get('avatar')));
  const profiles = await Promise.all(accounts.map((a) => loadJson<{ visible: boolean; data?: Record<string, unknown> }>(env.KV, `u:${a.id}:profile`)));
  return accounts.map((a, i) => {
    const row = s.rows.find((r) => r.id === a.id);
    const me = a.id === user.id;
    const following = s.following.includes(a.id);
    const priv = row?.private ?? false;
    const open = me || !priv || following;
    const p = profiles[i];
    return {
      id: a.id,
      name: a.name,
      handle: a.handle ?? null,
      ...(a.nick ? { nick: a.nick } : {}),
      ...(a.bio ? { bio: a.bio } : {}),
      me,
      following,
      requested: s.requested.includes(a.id),
      followsMe: s.followers.includes(a.id),
      private: priv,
      followers: row?.followers ?? 0,
      followingCount: row?.following ?? 0,
      posts: row?.posts ?? 0,
      sparks: row?.sparks ?? 0,
      ...(row?.nulos ? { nulos: row.nulos } : {}),
      ...(row?.record && (row.record.won || row.record.lost) ? { record: row.record } : {}),
      avatar: avatars[i] ?? null,
      ...(open && p?.visible ? { profile: p.data ?? {} } : {}),
    };
  });
}

/** Notifications sur le téléphone des personnes concernées (sans bloquer la réponse). */
async function sendPushes(env: Env, pushes: Push[]) {
  const vapid = vapidFromEnv(env);
  if (!vapid || !pushes.length) return;
  await Promise.all(
    pushes.map(async (p) => {
      const store = userStore(env.KV, p.user);
      const sub = await loadJson<PushSubscriptionData>(store, 'sub');
      if (!sub) return;
      const res = await sendPush(sub, { title: p.title, body: p.body, tag: 'club', url: p.url }, vapid, { urgency: 'normal' }).catch(() => null);
      if (res?.gone) await store.delete('sub');
    }),
  );
}

/** Une photo envoyée en data URL JPEG, PNG ou WebP, bornée en taille. */
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

/** Les premiers octets d'un MP4/MOV (« ftyp ») ou d'un WebM (en-tête EBML). */
function looksLikeVideo(b: Uint8Array, type: string): boolean {
  if (b.length < 16) return false;
  if (type === 'video/webm') return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
  const box = String.fromCharCode(b[4], b[5], b[6], b[7]);
  return box === 'ftyp' || box === 'moov' || box === 'mdat' || box === 'wide' || box === 'free';
}

/**
 * Rattache à une publication une vidéo envoyée juste avant par la même personne : elle est gardée pour de bon,
 * avec son image d'aperçu.
 */
async function claimVideo(env: Env, user: User, raw: unknown): Promise<PostVideo> {
  const v = (raw ?? {}) as Record<string, unknown>;
  const id = typeof v.id === 'string' && /^[a-f0-9]{24}$/.test(v.id) ? v.id : null;
  if (!id) throw new HttpError(400, 'Vidéo invalide');
  const { value, metadata } = await env.KV.getWithMetadata<{ type?: string; author?: string; pending?: boolean }>(`club:video:${id}`, 'arrayBuffer');
  if (!value || metadata?.author !== user.id) throw new HttpError(400, 'Vidéo expirée : ajoute-la à nouveau');
  const num = (x: unknown, max: number) => Math.max(0, Math.min(max, Math.round(Number(x) * 10) / 10 || 0));
  const { bytes, type } = decodePhoto(v.poster);
  const poster = rid();
  await env.KV.put(`club:photo:${poster}`, bytes, { metadata: { type, author: user.id } });
  if (metadata.pending) await env.KV.put(`club:video:${id}`, value, { metadata: { type: metadata.type, author: user.id } });
  return { id, poster, w: num(v.w, 4096) || 720, h: num(v.h, 4096) || 1280, dur: num(v.dur, LIMITS.videoSeconds), sound: v.sound !== false };
}

function decodePhoto(data: unknown): { bytes: Uint8Array; type: string } {
  const m = typeof data === 'string' ? data.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/) : null;
  if (!m) throw new HttpError(400, 'Photo invalide');
  const bin = atob(m[2]);
  if (bin.length > LIMITS.photoBytes) throw new HttpError(413, 'Photo trop lourde');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, type: m[1] };
}

/** Droit de voir une photo de publication, gardé 5 minutes en mémoire (une photo se charge plusieurs fois). */
const photoAccess = new Map<string, { ok: boolean; at: number }>();
async function photoVisible(env: Env, user: User, photo: string): Promise<boolean> {
  const k = `${user.id}:${photo}`;
  const hit = photoAccess.get(k);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.ok;
  const data = await callClub<{ ok: boolean }>(env, user, '/photo-check', { photo });
  if (photoAccess.size > 2000) photoAccess.clear();
  photoAccess.set(k, { ok: data.ok, at: Date.now() });
  return data.ok;
}

/** Les mentions envoyées par l'app, vérifiées contre la liste des membres. */
async function checkMentions(env: Env, input: unknown): Promise<Mention[]> {
  if (!Array.isArray(input) || !input.length) return [];
  const members = await listAccounts(env);
  const ids = new Set(input.map((m: Mention) => String(m?.id ?? '')));
  return members.filter((a) => ids.has(a.id)).slice(0, 10).map((a) => ({ id: a.id, name: a.name }));
}

/** Ce que l'app voit de son porte-monnaie. */
const walletView = (w: Wallet | undefined) => ({ plates: w?.bal ?? PLATES.start, cap: PLATES.cap });

/** Passage du cron : règle les défis échus et prévient les deux camps. */
export async function sweepChallenges(env: Env): Promise<number> {
  if (!env.CLUB) return 0;
  const res = await stub(env).fetch('https://club/sweep', { method: 'POST', body: JSON.stringify({ viewer: 'cron', viewerName: 'Shred' }) });
  const data = (await res.json()) as { settled?: number; pushes?: Push[] };
  await sendPushes(env, data.pushes ?? []);
  return data.settled ?? 0;
}

export async function clubRoutes(req: Request, env: Env, user: User, url: URL, ctx?: ExecutionContext): Promise<Response | null> {
  const { pathname } = url;
  if (!pathname.startsWith('/api/club')) return null;
  const method = req.method;
  const later = (pushes: Push[]) => {
    const p = sendPushes(env, pushes);
    if (ctx) ctx.waitUntil(p);
    else return p;
  };

  if (pathname === '/api/club/feed' && method === 'GET') {
    const data = await callClub<{ posts: Post[]; next: string | null; following: string[]; nulos?: Record<string, number> }>(env, user, '/feed', {
      filter: url.searchParams.get('filter') ?? 'all',
      before: url.searchParams.get('before') ?? undefined,
    });
    // Auteurs hors de tes relations : leur pseudo et leur photo voyagent avec la publication.
    const authors = [...new Set(data.posts.map((p) => p.author))];
    const [index, avatars] = await Promise.all([listAccounts(env), Promise.all(authors.map((a) => userStore(env.KV, a).get('avatar')))]);
    const info = new Map(authors.map((a, i) => [a, { handle: index.find((x) => x.id === a)?.handle ?? null, avatar: avatars[i] ?? null }]));
    return json({
      posts: data.posts.map((p) => ({
        ...view(p, user),
        authorHandle: info.get(p.author)?.handle ?? null,
        authorAvatar: info.get(p.author)?.avatar ?? null,
        ...(data.nulos?.[p.author] ? { authorNulos: data.nulos[p.author] } : {}),
      })),
      next: data.next,
      following: data.following,
    });
  }

  if (pathname === '/api/club/posts' && method === 'POST') {
    await capDaily(env, user.id, 'post');
    const b = await readJson<{ text?: string; session?: unknown; photos?: unknown[]; visibility?: Visibility; mentions?: unknown; music?: unknown; video?: unknown }>(req, 5_000_000);
    const music = sanitizeTrack(b.music);
    const text = str(b.text, LIMITS.text);
    const session = sanitizeSummary(b.session);
    const photosIn = Array.isArray(b.photos) ? b.photos.slice(0, LIMITS.photos) : [];
    const video = b.video ? await claimVideo(env, user, b.video) : undefined;
    if (!text && !session && !photosIn.length && !music && !video) throw new HttpError(400, 'Rien à publier');
    const photos: string[] = [];
    for (const raw of photosIn) {
      const { bytes, type } = decodePhoto(raw);
      const id = rid();
      await env.KV.put(`club:photo:${id}`, bytes, { metadata: { type, author: user.id } });
      photos.push(id);
    }
    const post: Post = {
      id: rid(),
      author: user.id,
      authorName: user.name,
      at: Date.now(),
      text,
      mentions: await checkMentions(env, b.mentions),
      ...(session ? { session } : {}),
      photos,
      ...(video ? { video } : {}),
      ...(music ? { music } : {}),
      visibility: b.visibility === 'followers' || b.visibility === 'private' ? b.visibility : 'all',
      sparks: [],
      comments: 0,
    };
    const data = await callClub<{ post: Post }>(env, user, '/create', { post });
    await later(data.pushes);
    return json({ post: view(data.post, user) });
  }

  const one = pathname.match(/^\/api\/club\/posts\/([a-f0-9]{24})(?:\/(spark|comments))?$/);
  if (one) {
    const [, id, sub] = one;
    if (!sub && method === 'GET') {
      const data = await callClub<{ post: Post; comments: Comment[] }>(env, user, '/post', { id });
      return json({ post: view(data.post, user), comments: data.comments.map((c) => ({ ...c, mine: c.author === user.id })) });
    }
    if (!sub && method === 'DELETE') {
      const data = await callClub<{ photos: string[]; videos?: string[]; posters?: string[] }>(env, user, '/delete', { id });
      await Promise.all([
        ...[...data.photos, ...(data.posters ?? [])].map((p) => env.KV.delete(`club:photo:${p}`)),
        ...(data.videos ?? []).map((v) => env.KV.delete(`club:video:${v}`)),
      ]);
      return json({ ok: true });
    }
    if (!sub && method === 'PUT') {
      await capDaily(env, user.id, 'edit');
      const b = await readJson<{ text?: string; mentions?: unknown }>(req, 20_000);
      const text = str(b.text, LIMITS.text);
      const data = await callClub<{ post: Post }>(env, user, '/edit', { id, text, mentions: await checkMentions(env, b.mentions) });
      await later(data.pushes);
      return json({ post: view(data.post, user) });
    }
    if (sub === 'spark' && method === 'POST') {
      await capDaily(env, user.id, 'spark');
      const data = await callClub<{ post: Post }>(env, user, '/spark', { id });
      return json({ post: view(data.post, user) });
    }
    if (sub === 'comments' && method === 'POST') {
      await capDaily(env, user.id, 'comment');
      const b = await readJson<{ text?: string; mentions?: unknown }>(req, 10_000);
      const text = str(b.text, LIMITS.comment);
      if (!text) throw new HttpError(400, 'Commentaire vide');
      const comment: Comment = { id: rid(), post: id, author: user.id, authorName: user.name, at: Date.now(), text, mentions: await checkMentions(env, b.mentions) };
      const data = await callClub<{ comment: Comment; post: Post }>(env, user, '/comment', { id, comment });
      await later(data.pushes);
      return json({ comment: { ...data.comment, mine: true }, post: view(data.post, user) });
    }
  }

  const uncomment = pathname.match(/^\/api\/club\/posts\/([a-f0-9]{24})\/comments\/([a-f0-9]{24})$/);
  if (uncomment && method === 'DELETE') {
    const data = await callClub<{ post: Post }>(env, user, '/uncomment', { id: uncomment[1], comment: uncomment[2] });
    return json({ post: view(data.post, user) });
  }

  const photo = pathname.match(/^\/api\/club\/(photo|avatar|video)\/([a-f0-9]{24}|[A-Za-z0-9_-]{6,64})$/);
  if (photo && method === 'GET') {
    if (photo[1] !== 'avatar' && !(await photoVisible(env, user, photo[2]))) throw new HttpError(404, 'Photo introuvable');
    const key = photo[1] === 'avatar' ? `club:avatar:${photo[2]}` : `club:${photo[1]}:${photo[2]}`;
    const { value, metadata } = await env.KV.getWithMetadata<{ type?: string }>(key, 'arrayBuffer');
    if (!value) throw new HttpError(404, 'Photo introuvable');
    return new Response(value, { headers: { 'content-type': metadata?.type ?? 'image/jpeg', 'cache-control': 'private, max-age=31536000, immutable' } });
  }

  if (pathname === '/api/club/videos' && method === 'POST') {
    // Une courte vidéo, envoyée telle quelle (pas en JSON). Elle n'est gardée qu'une heure si aucune
    // publication ne la reprend.
    await capDaily(env, user.id, 'video');
    const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!VIDEO_TYPES.has(type)) throw new HttpError(415, 'Format vidéo non accepté (MP4, MOV ou WebM)');
    if (Number(req.headers.get('content-length') ?? 0) > LIMITS.videoBytes) throw new HttpError(413, 'Vidéo trop lourde (6 Mo au plus)');
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length > LIMITS.videoBytes) throw new HttpError(413, 'Vidéo trop lourde (6 Mo au plus)');
    if (!looksLikeVideo(bytes, type)) throw new HttpError(415, 'Ce fichier n’est pas une vidéo');
    const id = rid();
    await env.KV.put(`club:video:${id}`, bytes, { metadata: { type, author: user.id, pending: true }, expirationTtl: 3600 });
    return json({ id });
  }

  if (pathname === '/api/club/avatar' && method === 'PUT') {
    await capDaily(env, user.id, 'avatar');
    const b = await readJson<{ photo?: string | null }>(req, 1_500_000);
    if (!b.photo) {
      await env.KV.delete(`club:avatar:${user.id}`);
      await user.store.delete('avatar');
      return json({ ok: true, avatar: null });
    }
    const { bytes, type } = decodePhoto(b.photo);
    await env.KV.put(`club:avatar:${user.id}`, bytes, { metadata: { type } });
    const version = String(Date.now());
    await user.store.put('avatar', version);
    return json({ ok: true, avatar: version });
  }

  if (pathname === '/api/club/members' && method === 'GET') {
    // Seulement tes relations : toi, tes abonnements, tes abonnés et les demandes en cours.
    // Les autres membres se trouvent par leur @pseudo (recherche ci-dessous).
    const s = await social(env, user);
    const accounts = (await ensureHandles(env, await listAccounts(env))).filter((a) => s.rows.some((r) => r.id === a.id));
    return json({ members: await buildMembers(env, user, accounts, s), requests: s.requests.length });
  }

  if (pathname === '/api/club/search' && method === 'GET') {
    const q = fold(url.searchParams.get('q') ?? '')
      .replace(/^@+/, '')
      .replace(/[^a-z0-9._]/g, '')
      .slice(0, 20);
    if (q.length < 2) return json({ members: [] });
    await capDaily(env, user.id, 'search');
    const all = (await ensureHandles(env, await listAccounts(env))).filter((a) => a.handle);
    const starts = all.filter((a) => a.handle!.startsWith(q));
    const inside = all.filter((a) => !a.handle!.startsWith(q) && a.handle!.includes(q));
    const found = [...starts.sort((x, y) => x.handle!.length - y.handle!.length), ...inside].slice(0, 10);
    if (!found.length) return json({ members: [] });
    const s = await social(env, user, found.map((a) => a.id));
    return json({ members: await buildMembers(env, user, found, s) });
  }

  const oneMember = pathname.match(/^\/api\/club\/member\/([a-z0-9._]{2,20}|[0-9a-f]{16})$/);
  if (oneMember && method === 'GET') {
    const a = (await ensureHandles(env, await listAccounts(env))).find((x) => x.handle === oneMember[1] || x.id === oneMember[1]);
    if (!a) throw new HttpError(404, 'Membre introuvable');
    const s = await social(env, user, [a.id]);
    return json({ member: (await buildMembers(env, user, [a], s))[0] });
  }

  if (pathname === '/api/club/leaderboard' && method === 'GET') {
    // Classement de la semaine : toi et les personnes que tu suis (abonnement accepté), si elles l'acceptent.
    const week = url.searchParams.get('week') ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new HttpError(400, 'Semaine invalide');
    await capDaily(env, user.id, 'board');
    const s = await social(env, user);
    const ids = [user.id, ...s.following];
    const accounts = (await listAccounts(env)).filter((a) => ids.includes(a.id));
    const [profiles, avatars] = await Promise.all([
      Promise.all(accounts.map((a) => loadJson<StoredProfile>(env.KV, `u:${a.id}:profile`))),
      Promise.all(accounts.map((a) => userStore(env.KV, a.id).get('avatar'))),
    ]);
    const rows = accounts
      .map((a, i) => {
        const b = profiles[i]?.board;
        const me = a.id === user.id;
        if (!b && !me) return null;
        const current = b?.weekOf === week;
        // Les jours de la semaine où la personne s'est entraînée : aucun si rien de cette semaine, inconnus si
        // son app (d'avant la 0.28) ne les publie pas encore.
        const days = !current ? 0 : typeof b!.days === 'number' ? b!.days : undefined;
        return {
          id: a.id,
          name: a.name,
          handle: a.handle ?? null,
          avatar: avatars[i] ?? null,
          me,
          week: current ? b!.week : 0,
          volume: current ? b!.volume : 0,
          streak: b?.streak ?? 0,
          ...(days !== undefined ? { days } : {}),
          ...(s.rows.find((r) => r.id === a.id)?.nulos ? { nulos: s.rows.find((r) => r.id === a.id)!.nulos } : {}),
        };
      })
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .sort((x, y) => y.week - x.week || y.volume - x.volume || y.streak - x.streak);
    return json({ week, rows });
  }

  if (pathname === '/api/club/requests' && method === 'GET') {
    const ids = (await callClub<{ requests: string[] }>(env, user, '/requests')).requests;
    const accounts = (await listAccounts(env)).filter((a) => ids.includes(a.id));
    const s = await social(env, user, accounts.map((a) => a.id));
    return json({ members: await buildMembers(env, user, accounts, s) });
  }

  const answer = pathname.match(/^\/api\/club\/requests\/([0-9a-f]{16})$/);
  if (answer && method === 'POST') {
    const b = await readJson<{ accept?: boolean }>(req, 200);
    const data = await callClub<{ accepted: boolean }>(env, user, '/answer', { from: answer[1], accept: b.accept === true });
    await later(data.pushes);
    return json({ ok: true, accepted: data.accepted });
  }

  const removeFollower = pathname.match(/^\/api\/club\/followers\/([0-9a-f]{16})$/);
  if (removeFollower && method === 'DELETE') {
    await callClub(env, user, '/remove-follower', { target: removeFollower[1] });
    return json({ ok: true });
  }

  if (pathname === '/api/club/privacy' && method === 'PUT') {
    const b = await readJson<{ private?: boolean }>(req, 200);
    const data = await callClub<{ private: boolean }>(env, user, '/privacy', { private: b.private === true });
    await later(data.pushes);
    return json({ private: data.private });
  }

  const follow = pathname.match(/^\/api\/club\/follow\/([A-Za-z0-9_-]{6,64})$/);
  if (follow && method === 'POST') {
    await capDaily(env, user.id, 'follow');
    if (!(await getAccount(env, follow[1]))) throw new HttpError(404, 'Membre introuvable');
    const data = await callClub<{ following: boolean; requested: boolean }>(env, user, '/follow', { target: follow[1] });
    await later(data.pushes);
    return json({ following: data.following, requested: data.requested });
  }


  if (pathname === '/api/club/challenges' && method === 'POST') {
    await capDaily(env, user.id, 'challenge');
    const b = await readJson<{ to?: string; hours?: number; text?: string; gage?: string; rematch?: string }>(req, 5_000);
    const to = String(b.to ?? '');
    const target = /^[A-Za-z0-9_-]{6,64}$/.test(to) ? await getAccount(env, to) : null;
    if (!target) throw new HttpError(404, 'Membre introuvable');
    const hours = CHALLENGE_HOURS.includes(Number(b.hours)) ? Number(b.hours) : 48;
    const at = Date.now();
    const text = str(b.text, 140);
    const rematch = typeof b.rematch === 'string' && /^[a-f0-9]{24}$/.test(b.rematch) ? b.rematch : undefined;
    const gage = rematch ? '' : str(b.gage, GAGE_MAX);
    const challenge: Challenge = {
      id: rid(),
      from: user.id,
      fromName: user.name,
      to: target.id,
      toName: target.name,
      at,
      due: at + hours * 3600_000,
      status: 'open',
      stake: stakeOf(Boolean(gage), Boolean(rematch)),
      ...(text ? { text } : {}),
      ...(gage ? { gage } : {}),
      ...(rematch ? { rematch } : {}),
    };
    const data = await callClub<{ challenge?: Challenge; wallet: Wallet }>(env, user, '/challenge', { challenge });
    await later(data.pushes);
    return json({ challenge: data.challenge, wallet: walletView(data.wallet) });
  }
  if (pathname === '/api/club/challenges' && method === 'GET') {
    const data = await callClub<{ challenges: Challenge[]; wallet: Wallet; nulos: number; record: ChallengeRecord }>(env, user, '/challenges');
    await later(data.pushes);
    return json({ challenges: data.challenges, wallet: walletView(data.wallet), nulos: data.nulos, record: data.record });
  }
  const chDone = pathname.match(/^\/api\/club\/challenges\/([a-f0-9]{24})\/(done|gage)$/);
  if (chDone && method === 'POST') {
    const b = await readJson<{ at?: number }>(req, 500);
    if (chDone[2] === 'gage') {
      const data = await callClub<{ challenge?: Challenge; already?: boolean; nulos: number }>(env, user, '/gage-done', { id: chDone[1] });
      await later(data.pushes);
      return json({ challenge: data.challenge, already: Boolean(data.already), nulos: data.nulos });
    }
    const data = await callClub<{ challenge?: Challenge; already?: boolean; wallet?: Wallet }>(env, user, '/challenge-done', { id: chDone[1], at: typeof b.at === 'number' ? b.at : undefined });
    await later(data.pushes);
    return json({ challenge: data.challenge, already: Boolean(data.already), ...(data.wallet ? { wallet: walletView(data.wallet) } : {}) });
  }
  if (pathname === '/api/club/wallet' && method === 'POST') {
    // Une journée validée : le serveur ne compte qu'aujourd'hui ou la veille (fuseaux horaires), une fois.
    const b = await readJson<{ day?: string; streak?: number }>(req, 500);
    const day = typeof b.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.day) ? b.day : '';
    const off = day ? Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${new Date(Date.now()).toISOString().slice(0, 10)}T12:00:00Z`)) / 86_400_000) : NaN;
    const streak = Number(b.streak);
    if (!(off >= -1 && off <= 1) || !Number.isInteger(streak) || streak < 0 || streak > 100_000) throw new HttpError(400, 'Journée invalide');
    const data = await callClub<{ wallet: Wallet; gained: number; bonus: number }>(env, user, '/wallet', { day, streak });
    return json({ wallet: walletView(data.wallet), gained: data.gained, bonus: data.bonus });
  }

  if (pathname === '/api/club/notifications' && method === 'GET') {
    const data = await callClub<{ notices: Notice[]; unread: number; readAt: number }>(env, user, '/notices');
    return json({ notices: data.notices, unread: data.unread, readAt: data.readAt });
  }
  if (pathname === '/api/club/notifications/read' && method === 'POST') {
    await callClub(env, user, '/read');
    return json({ ok: true });
  }

  throw new HttpError(404, 'Route inconnue');
}

/** Ce que l'app reçoit : la liste des étincelles devient un compte, avec « j'en ai envoyé une ». */
function view(p: Post, user: User) {
  const { sparks, ...rest } = p;
  return { ...rest, sparks: sparks.length, sparked: sparks.includes(user.id), mine: p.author === user.id };
}

/** À la suppression d'un compte : on efface aussi sa trace dans le club. */
export async function forgetMember(env: Env, user: Pick<User, 'id' | 'name' | 'role'>) {
  if (!env.CLUB) return;
  const res = await stub(env).fetch('https://club/forget', { method: 'POST', body: JSON.stringify({ viewer: user.id, viewerName: user.name }) });
  const data = (await res.json()) as { photos?: string[]; videos?: string[] };
  await Promise.all([
    ...(data.photos ?? []).map((p) => env.KV.delete(`club:photo:${p}`)),
    ...(data.videos ?? []).map((v) => env.KV.delete(`club:video:${v}`)),
    env.KV.delete(`club:avatar:${user.id}`),
  ]);
}
