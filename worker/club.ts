// Le club : un fil de séances partagées entre les membres (comme Strava), avec photos, kudos, commentaires,
// mentions @, abonnements et notifications. Tout vit dans un seul Durable Object (cohérent, sans course
// entre deux écritures) ; les photos sont rangées dans KV. Rien de la sauvegarde chiffrée n'est lu ici :
// chacun choisit ce qu'il publie, séance par séance.
import { type Env, HttpError, json, readJson } from './env';
import { vapidFromEnv } from './reminders';
import { getAccount, listAccounts, loadJson, type User, userStore } from './users';
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
  visibility: Visibility;
  kudos: string[];
  comments: number;
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

export type NoticeType = 'mention' | 'comment' | 'kudos' | 'follow';

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

const LIMITS = { text: 1000, comment: 500, photos: 4, photoBytes: 900_000, stats: 6, profile: 90, feed: 20 };

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

  private canSee(p: Post, viewer: string, follows: string[]): boolean {
    if (p.author === viewer || p.mentions.some((m) => m.id === viewer)) return true;
    if (p.visibility === 'all') return true;
    return p.visibility === 'followers' && follows.includes(p.author);
  }

  private async notify(user: string, n: Omit<Notice, 'id' | 'at'>): Promise<void> {
    if (user === n.actor) return;
    const at = Date.now();
    await this.db.put(`n:${user}:${pad(at)}:${rid()}`, { ...n, id: rid(), at });
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
            if (!this.canSee(p, viewer, follows)) continue;
            if (only && p.author !== only) continue;
            if (filter === 'following' && p.author !== viewer && !follows.includes(p.author)) continue;
            posts.push(p);
            if (posts.length >= LIMITS.feed) break;
          }
          // Page incomplète et entièrement lue : on est au bout du fil.
          if (page.size < 50 && seen === page.size) more = posts.length >= LIMITS.feed && seen < page.size;
        }
        return out({ posts, next: posts.length >= LIMITS.feed ? end : null, following: follows });
      }

      case '/create': {
        const p = b.post as Post;
        await this.db.put(postKey(p), p);
        await this.db.put(`pid:${p.id}`, postKey(p));
        const n = (await this.db.get<number>(`count:${viewer}`)) ?? 0;
        await this.db.put(`count:${viewer}`, n + 1);
        for (const m of p.mentions) {
          await this.notify(m.id, { type: 'mention', actor: viewer, actorName: b.viewerName, post: p.id, text: p.session?.title ?? p.text.slice(0, 80) });
          pushes.push({ user: m.id, title: `${b.viewerName} t’a identifié`, body: p.session?.title ?? p.text.slice(0, 100), url: `/?tab=club&post=${p.id}` });
        }
        return out({ post: p });
      }

      case '/post': {
        const found = await this.getPost(String(b.id));
        if (!found || !this.canSee(found.post, viewer, await this.following(viewer))) return out({ error: 'not-found' });
        const comments = await this.db.list<Comment>({ prefix: `c:${found.post.id}:` });
        return out({ post: found.post, comments: [...comments.values()] });
      }

      case '/delete': {
        const found = await this.getPost(String(b.id));
        if (!found) return out({ error: 'not-found' });
        if (found.post.author !== viewer && !b.admin) return out({ error: 'forbidden' });
        const comments = await this.db.list({ prefix: `c:${found.post.id}:` });
        await this.db.delete([found.key, `pid:${found.post.id}`, ...comments.keys()]);
        const n = (await this.db.get<number>(`count:${found.post.author}`)) ?? 1;
        await this.db.put(`count:${found.post.author}`, Math.max(0, n - 1));
        return out({ ok: true, photos: found.post.photos });
      }

      case '/kudos': {
        const found = await this.getPost(String(b.id));
        if (!found || !this.canSee(found.post, viewer, await this.following(viewer))) return out({ error: 'not-found' });
        const p = found.post;
        const had = p.kudos.includes(viewer);
        p.kudos = had ? p.kudos.filter((x) => x !== viewer) : [...p.kudos, viewer];
        await this.db.put(found.key, p);
        if (!had) await this.notify(p.author, { type: 'kudos', actor: viewer, actorName: b.viewerName, post: p.id, text: p.session?.title ?? p.text.slice(0, 80) });
        return out({ post: p });
      }

      case '/comment': {
        const found = await this.getPost(String(b.id));
        if (!found || !this.canSee(found.post, viewer, await this.following(viewer))) return out({ error: 'not-found' });
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
        const target = String(b.target);
        if (target === viewer) return out({ error: 'self' });
        const list = await this.following(viewer);
        const on = !list.includes(target);
        await this.db.put(`f:${viewer}`, on ? [...list, target] : list.filter((x) => x !== target));
        const followers = (await this.db.get<string[]>(`fb:${target}`)) ?? [];
        await this.db.put(`fb:${target}`, on ? [...new Set([...followers, viewer])] : followers.filter((x) => x !== viewer));
        if (on) {
          await this.notify(target, { type: 'follow', actor: viewer, actorName: b.viewerName });
          pushes.push({ user: target, title: 'Nouvel abonné', body: `${b.viewerName} suit tes séances`, url: '/?tab=club' });
        }
        return out({ following: on });
      }

      case '/social': {
        const ids = (b.ids as string[]) ?? [];
        const following = await this.following(viewer);
        const rows = await Promise.all(
          ids.map(async (id) => ({ id, followers: ((await this.db.get<string[]>(`fb:${id}`)) ?? []).length, posts: (await this.db.get<number>(`count:${id}`)) ?? 0 })),
        );
        return out({ following, rows });
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

      case '/forget': {
        // Compte supprimé : ses publications, commentaires et abonnements partent avec lui.
        const all = await this.db.list<Post>({ prefix: 'p:' });
        const photos: string[] = [];
        for (const [key, p] of all) {
          if (p.author !== viewer) continue;
          photos.push(...p.photos);
          const comments = await this.db.list({ prefix: `c:${p.id}:` });
          await this.db.delete([key, `pid:${p.id}`, ...comments.keys()]);
        }
        await this.db.delete([`f:${viewer}`, `fb:${viewer}`, `count:${viewer}`, `nr:${viewer}`]);
        return out({ ok: true, photos });
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
    body: JSON.stringify({ viewer: user.id, viewerName: user.name, admin: user.role === 'admin', ...body }),
  });
  const data = (await res.json()) as T & { pushes: Push[]; error?: string };
  if (data.error === 'not-found') throw new HttpError(404, 'Publication introuvable');
  if (data.error === 'forbidden') throw new HttpError(403, 'Tu ne peux pas supprimer ça');
  if (data.error) throw new HttpError(400, data.error);
  return data;
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
function decodePhoto(data: unknown): { bytes: Uint8Array; type: string } {
  const m = typeof data === 'string' ? data.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/) : null;
  if (!m) throw new HttpError(400, 'Photo invalide');
  const bin = atob(m[2]);
  if (bin.length > LIMITS.photoBytes) throw new HttpError(413, 'Photo trop lourde');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, type: m[1] };
}

/** Les mentions envoyées par l'app, vérifiées contre la liste des membres. */
async function checkMentions(env: Env, input: unknown): Promise<Mention[]> {
  if (!Array.isArray(input) || !input.length) return [];
  const members = await listAccounts(env);
  const ids = new Set(input.map((m: Mention) => String(m?.id ?? '')));
  return members.filter((a) => ids.has(a.id)).slice(0, 10).map((a) => ({ id: a.id, name: a.name }));
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
    const data = await callClub<{ posts: Post[]; next: string | null; following: string[] }>(env, user, '/feed', {
      filter: url.searchParams.get('filter') ?? 'all',
      before: url.searchParams.get('before') ?? undefined,
    });
    return json({ posts: data.posts.map((p) => view(p, user)), next: data.next, following: data.following });
  }

  if (pathname === '/api/club/posts' && method === 'POST') {
    const b = await readJson<{ text?: string; session?: unknown; photos?: unknown[]; visibility?: Visibility; mentions?: unknown }>(req, 5_000_000);
    const text = str(b.text, LIMITS.text);
    const session = sanitizeSummary(b.session);
    const photosIn = Array.isArray(b.photos) ? b.photos.slice(0, LIMITS.photos) : [];
    if (!text && !session && !photosIn.length) throw new HttpError(400, 'Rien à publier');
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
      visibility: b.visibility === 'followers' || b.visibility === 'private' ? b.visibility : 'all',
      kudos: [],
      comments: 0,
    };
    const data = await callClub<{ post: Post }>(env, user, '/create', { post });
    await later(data.pushes);
    return json({ post: view(data.post, user) });
  }

  const one = pathname.match(/^\/api\/club\/posts\/([a-f0-9]{24})(?:\/(kudos|comments))?$/);
  if (one) {
    const [, id, sub] = one;
    if (!sub && method === 'GET') {
      const data = await callClub<{ post: Post; comments: Comment[] }>(env, user, '/post', { id });
      return json({ post: view(data.post, user), comments: data.comments.map((c) => ({ ...c, mine: c.author === user.id })) });
    }
    if (!sub && method === 'DELETE') {
      const data = await callClub<{ photos: string[] }>(env, user, '/delete', { id });
      await Promise.all(data.photos.map((p) => env.KV.delete(`club:photo:${p}`)));
      return json({ ok: true });
    }
    if (sub === 'kudos' && method === 'POST') {
      const data = await callClub<{ post: Post }>(env, user, '/kudos', { id });
      return json({ post: view(data.post, user) });
    }
    if (sub === 'comments' && method === 'POST') {
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

  const photo = pathname.match(/^\/api\/club\/(photo|avatar)\/([a-f0-9]{24}|[A-Za-z0-9_-]{6,64})$/);
  if (photo && method === 'GET') {
    const key = photo[1] === 'photo' ? `club:photo:${photo[2]}` : `club:avatar:${photo[2]}`;
    const { value, metadata } = await env.KV.getWithMetadata<{ type?: string }>(key, 'arrayBuffer');
    if (!value) throw new HttpError(404, 'Photo introuvable');
    return new Response(value, { headers: { 'content-type': metadata?.type ?? 'image/jpeg', 'cache-control': 'private, max-age=31536000, immutable' } });
  }

  if (pathname === '/api/club/avatar' && method === 'PUT') {
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
    const accounts = await listAccounts(env);
    const data = await callClub<{ following: string[]; rows: { id: string; followers: number; posts: number }[] }>(env, user, '/social', { ids: accounts.map((a) => a.id) });
    const avatars = await Promise.all(accounts.map((a) => userStore(env.KV, a.id).get('avatar')));
    const profiles = await Promise.all(accounts.map((a) => loadJson<{ visible: boolean; data?: Record<string, unknown> }>(env.KV, `u:${a.id}:profile`)));
    const members = accounts.map((a, i) => {
      const row = data.rows.find((r) => r.id === a.id);
      const p = profiles[i];
      return {
        id: a.id,
        name: a.name,
        me: a.id === user.id,
        following: data.following.includes(a.id),
        followers: row?.followers ?? 0,
        posts: row?.posts ?? 0,
        avatar: avatars[i] ?? null,
        ...(p?.visible ? { profile: p.data ?? {} } : {}),
      };
    });
    return json({ members });
  }

  const follow = pathname.match(/^\/api\/club\/follow\/([A-Za-z0-9_-]{6,64})$/);
  if (follow && method === 'POST') {
    if (!(await getAccount(env, follow[1]))) throw new HttpError(404, 'Membre introuvable');
    const data = await callClub<{ following: boolean }>(env, user, '/follow', { target: follow[1] });
    await later(data.pushes);
    return json({ following: data.following });
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

/** Ce que l'app reçoit : la liste des kudos devient un compte, avec « j'ai aimé » et les premiers prénoms. */
function view(p: Post, user: User) {
  const { kudos, ...rest } = p;
  return { ...rest, kudos: kudos.length, kudoed: kudos.includes(user.id), mine: p.author === user.id };
}

/** À la suppression d'un compte : on efface aussi sa trace dans le club. */
export async function forgetMember(env: Env, user: Pick<User, 'id' | 'name' | 'role'>) {
  if (!env.CLUB) return;
  const res = await stub(env).fetch('https://club/forget', { method: 'POST', body: JSON.stringify({ viewer: user.id, viewerName: user.name }) });
  const data = (await res.json()) as { photos?: string[] };
  await Promise.all([...(data.photos ?? []).map((p) => env.KV.delete(`club:photo:${p}`)), env.KV.delete(`club:avatar:${user.id}`)]);
}
