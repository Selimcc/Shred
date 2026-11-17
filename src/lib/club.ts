// Le club côté app : fil, publication d'une séance (photos, @mentions, visibilité), étincelles, commentaires,
// membres et notifications. En mode démo, tout tourne en mémoire avec des membres fictifs.
import type { Track } from './music';
import { DISCIPLINE_NAMES, exerciseName } from '../../shared/catalog';
import { disciplinesOf, fmtClock, repSeconds, sessionBlocks } from '../../shared/effort';
import { api, DEMO } from './api';
import { addDays, dayKey, formatNumber } from './date';
import { fmtKg, sessionFor } from './logic';
import { authToken } from './session';
import { authHeaders } from './api';
import type { AppState } from './store';
import { addPlates, claimPlates, GRACE_MS, NULOS_HOURS, OPEN_MAX, PLATES, stakeOf, type Wallet } from '../../shared/plates';
import { dayTraining, liftSeries, totalMinutes } from './training';
import { tr } from '../../shared/i18n';

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

export type Visibility = 'all' | 'followers' | 'private';

export interface Mention {
  id: string;
  name: string;
}

export interface SessionSummary {
  title: string;
  kind: 'lifting' | 'cardio' | 'rest';
  sports?: string[];
  stats: { label: string; value: string }[];
  profile?: [number, number][];
  records?: string[];
  date: string;
}

export interface ClubPost {
  id: string;
  author: string;
  authorName: string;
  /** Pseudo et photo de l'auteur, pour les auteurs hors de tes relations. */
  authorHandle?: string | null;
  authorAvatar?: string | null;
  /** L'auteur porte le bonnet de Nulos jusqu'à cette heure. */
  authorNulos?: number;
  at: number;
  text: string;
  mentions: Mention[];
  session?: SessionSummary;
  photos: string[];
  /** Courte vidéo : fichier sur le serveur, image d'aperçu, format, durée, son gardé ou coupé. */
  video?: PostVideo;
  music?: Track;
  visibility: Visibility;
  /** Étincelles reçues, et la mienne. */
  sparks: number;
  sparked: boolean;
  mine: boolean;
  comments: number;
  /** Texte modifié par son auteur après publication : « (modifié) » s'affiche. */
  editedAt?: number;
}

export interface ClubComment {
  id: string;
  post: string;
  author: string;
  authorName: string;
  at: number;
  text: string;
  mentions: Mention[];
  mine: boolean;
}

export interface Member {
  id: string;
  name: string;
  /** @pseudo unique, sans le @. */
  handle?: string | null;
  /** Surnom et bio, facultatifs. */
  nick?: string;
  bio?: string;
  me: boolean;
  following: boolean;
  /** Demande d'abonnement envoyée, en attente (compte privé). */
  requested?: boolean;
  /** Cette personne me suit. */
  followsMe?: boolean;
  /** Compte privé : ses séances ne se montrent qu'à ses abonnés acceptés. */
  private?: boolean;
  followingCount?: number;
  followers: number;
  posts: number;
  /** Étincelles reçues au total. */
  sparks: number;
  avatar: string | null;
  /** Fin du bonnet de Nulos (défi raté dans les dernières 24 h). */
  nulos?: number;
  /** Défis relevés et ratés. */
  record?: { won: number; lost: number };
  profile?: { streak?: number; best?: number; flames?: number; tier?: number; level?: number; program?: string; radar?: { id: string; name: string; short: string; grade: string | null; score: number | null }[] };
}

/**
 * Défi entre membres : une séance à valider avant l'échéance. Relevé, la mise est pour toi ; raté, elle revient à
 * son auteur et tu portes le bonnet de Nulos 24 h (avec le gage, s'il y en a un). Une revanche est possible.
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
  stake?: number;
  gage?: string;
  rematch?: string;
  status: 'open' | 'done' | 'failed';
  doneAt?: number;
  failedAt?: number;
  gageDone?: number;
  revenge?: string;
}

/** Ce que l'app sait de son porte-monnaie. */
export interface WalletView {
  plates: number;
  cap: number;
}

export interface ChallengeState {
  challenges: Challenge[];
  wallet: WalletView;
  /** Fin de mon bonnet de Nulos, 0 sinon. */
  nulos: number;
  record: { won: number; lost: number };
}

/** Le bonnet de Nulos est-il encore porté ? */
export const isNulos = (until?: number, now = Date.now()) => Boolean(until && until > now);

/** La revanche est encore possible sur ce défi raté (par la personne qui l'a raté). */
export const canRematch = (c: Challenge, me: string | null, now = Date.now()) =>
  c.status === 'failed' && c.to === me && !c.revenge && (c.failedAt ?? c.due) + NULOS_HOURS * 3600_000 > now;

export const CHALLENGE_DELAYS: { hours: number; label: string }[] = [
  { hours: 24, label: '24 h' },
  { hours: 48, label: '48 h' },
  { hours: 168, label: tr('7 jours') },
];

/** « il reste 5 h », « il reste 2 j » : ce qu'il reste avant l'échéance. */
export function timeLeft(due: number, now = Date.now()): string {
  const h = Math.max(0, (due - now) / 3600_000);
  if (h < 1) return tr('il reste {max} min', { max: Math.max(1, Math.round(h * 60)) });
  if (h < 36) return tr('il reste {n} h', { n: Math.round(h) });
  return tr('il reste {n} j', { n: Math.round(h / 24) });
}

export interface Notice {
  id: string;
  type: 'mention' | 'comment' | 'spark' | 'follow' | 'request' | 'accepted' | 'challenge' | 'challengeDone' | 'challengeFailed' | 'challengeExpired' | 'gageDone' | 'rematch';
  actor: string;
  actorName: string;
  post?: string;
  text?: string;
  at: number;
}

export interface BoardRow {
  id: string;
  name: string;
  handle: string | null;
  avatar: string | null;
  me: boolean;
  week: number;
  volume: number;
  streak: number;
  nulos?: number;
  /** Jours de la semaine avec une séance (bit 0 = lundi) ; absent si l'app de la personne est trop ancienne. */
  days?: number;
}

export interface PostVideo {
  id: string;
  poster: string;
  w: number;
  h: number;
  dur: number;
  sound: boolean;
}

export interface NewPost {
  text: string;
  mentions: Mention[];
  session?: SessionSummary;
  photos: string[];
  /** Vidéo déjà envoyée (club.uploadVideo) et son aperçu en image. */
  video?: { id: string; poster: string; w: number; h: number; dur: number; sound: boolean };
  music?: Track;
  visibility: Visibility;
}

/* ---------- Résumé d'une séance, à partir de ce qui a été noté dans Shred ---------- */

const fmtVolume = (kg: number) => (kg >= 1000 ? `${formatNumber(kg / 1000, 1)} t` : `${formatNumber(Math.round(kg))} kg`);

/** Profil compact : blocs consécutifs de même zone fusionnés, 90 au plus. */
function compactProfile(blocks: { zone: number; sec: number }[]): [number, number][] {
  const out: [number, number][] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (last && last[0] === b.zone && blocks.length > 80) last[1] += b.sec;
    else out.push([b.zone, Math.round(b.sec)]);
  }
  return out.slice(0, 90);
}

/**
 * Ce qu'on publie d'une journée : la séance faite, ses chiffres et ses records.
 * Jamais de chiffres venus de Strava (règle de Strava) : seulement ce que tu as noté dans Shred.
 */
export function sessionSummary(s: AppState, date: string): SessionSummary | null {
  const day = s.days[date];
  if (!day) return null;
  const session = sessionFor(s, date);
  const doneOf = (key: string) => day.sets[key]?.filter((l) => l.done) ?? [];
  const started = session.exercises.some((x) => doneOf(x.key).length > 0);
  if (!started && !day.mainDone) return null;
  const fromStrava = new Set((day.activities ?? []).filter((a) => a.source === 'strava').flatMap((a) => a.linked ?? []));

  if (session.type === 'lifting') {
    let sets = 0;
    let volume = 0;
    let exercises = 0;
    for (const ex of session.exercises) {
      const done = doneOf(ex.key);
      if (done.length) exercises++;
      sets += done.length;
      for (const l of done) if (l.w && l.r) volume += l.w * l.r;
    }
    const minutes = Math.round(dayTraining(s, date).min.lift);
    const records = session.exercises
      .map((ex) => {
        const p = liftSeries(s, ex.key, date, 0).find((x) => x.date === date && x.pr);
        return p ? `${exerciseName(ex.key, s.customExercises).replace(/ \(.*\)$/, '')} ${fmtKg(p.w)} × ${p.r}` : null;
      })
      .filter((x): x is string => Boolean(x))
      .slice(0, 3);
    return {
      title: session.name,
      kind: 'lifting',
      // Une séance validée sans séries notées : juste son nom, pas de « 0 série ».
      stats: [
        ...(sets > 0 ? [{ label: tr('Séries'), value: String(sets) }] : []),
        ...(volume > 0 ? [{ label: tr('Volume'), value: fmtVolume(volume) }] : []),
        ...(exercises > 0 ? [{ label: tr('Exercices'), value: String(exercises) }] : []),
        ...(minutes >= 5 ? [{ label: tr('Durée'), value: fmtClock(minutes * 60) }] : []),
      ],
      ...(records.length ? { records } : {}),
      date,
    };
  }

  const blocks = sessionBlocks(session.exercises);
  const sports = disciplinesOf(session.exercises).filter((d) => d !== 'walk');
  // Ce qui a été fait : la durée notée, sinon celle des répétitions cochées (avec leurs récupérations).
  let km = 0;
  let sec = 0;
  let hard = 0;
  for (const ex of session.exercises) {
    if (!ex.discipline || !ex.zone) continue;
    const done = doneOf(ex.key);
    if (!done.length) continue;
    const rep = repSeconds(ex);
    const own = fromStrava.has(ex.key) ? 0 : done.reduce((n, l) => n + (l.min ? l.min * 60 : rep), 0);
    const t = (fromStrava.has(ex.key) ? done.length * rep : own) + Math.max(0, done.length - 1) * ex.rest;
    sec += t;
    if (ex.zone >= 4) hard += done.length * rep;
    if (!fromStrava.has(ex.key)) for (const l of done) if (l.km) km += l.km;
  }
  const swimOnly = sports.length === 1 && sports[0] === 'swim';
  return {
    title: session.name,
    kind: session.type === 'rest' ? 'rest' : 'cardio',
    ...(sports.length ? { sports } : {}),
    stats: [
      ...(sec >= 60 ? [{ label: tr('Durée'), value: fmtClock(sec) }] : []),
      ...(km > 0 ? [{ label: tr('Distance'), value: swimOnly ? `${formatNumber(Math.round(km * 1000))} m` : `${formatNumber(km, 1)} km` }] : []),
      ...(hard >= 60 ? [{ label: tr('Intense'), value: fmtClock(hard) }] : []),
      ...(sports.length > 1 ? [{ label: tr('Sports'), value: sports.map((d) => DISCIPLINE_NAMES[d]).join(' + ') }] : []),
    ],
    ...(blocks.length ? { profile: compactProfile(blocks) } : {}),
    date,
  };
}

/** Les journées récentes qu'on peut publier, de la plus récente à la plus ancienne. */
export function shareableDays(s: AppState, today = dayKey(), days = 7): { date: string; summary: SessionSummary }[] {
  const out: { date: string; summary: SessionSummary }[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(today, -i);
    const summary = sessionSummary(s, date);
    if (summary) out.push({ date, summary });
  }
  return out;
}

/** Total d'entraînement d'une journée, pour le résumé d'une publication sans séance du programme. */
export const dayMinutes = (s: AppState, date: string) => Math.round(totalMinutes(dayTraining(s, date)));

/* ---------- Photos (servies avec la session : on passe par un blob) ---------- */

const blobs = new Map<string, Promise<string>>();

export function imageUrl(path: string): Promise<string> {
  if (DEMO) return Promise.resolve(demo.images.get(path) ?? '');
  let p = blobs.get(path);
  if (!p) {
    p = fetch(BASE + path, { headers: authHeaders(authToken(), false) })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => URL.createObjectURL(b));
    p.catch(() => blobs.delete(path));
    blobs.set(path, p);
  }
  return p;
}

export const photoPath = (id: string) => `/api/club/photo/${id}`;

/** Vidéos : chargées entières (6 Mo au plus) puis lues sur place ; on n'en garde que 4 en mémoire. */
const videoBlobs = new Map<string, Promise<string>>();
export function videoUrl(id: string): Promise<string> {
  const hit = videoBlobs.get(id);
  if (hit) {
    videoBlobs.delete(id);
    videoBlobs.set(id, hit);
    return hit;
  }
  const p = fetch(`${BASE}/api/club/video/${id}`, { headers: authHeaders(authToken(), false) })
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
    .then((b) => URL.createObjectURL(b));
  p.catch(() => videoBlobs.delete(id));
  videoBlobs.set(id, p);
  while (videoBlobs.size > 4) {
    const [oldId, old] = videoBlobs.entries().next().value as [string, Promise<string>];
    videoBlobs.delete(oldId);
    void old.then((u) => setTimeout(() => URL.revokeObjectURL(u), 5000), () => undefined);
  }
  return p;
}

async function uploadVideo(blob: Blob, type: string): Promise<{ id: string }> {
  const r = await fetch(`${BASE}/api/club/videos`, { method: 'POST', headers: { ...authHeaders(authToken(), false), 'content-type': type }, body: blob });
  const data = (await r.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!r.ok || !data.id) throw new Error(data.error ?? tr('La vidéo n’a pas pu être envoyée'));
  return { id: data.id };
}
export const avatarPath = (m: Pick<Member, 'id' | 'avatar'>) => (m.avatar ? `/api/club/avatar/${m.id}?v=${m.avatar}` : null);

/* ---------- API ---------- */

export const club = {
  feed: (filter: string, before?: string | null) =>
    DEMO ? demo.feed(filter) : api<{ posts: ClubPost[]; next: string | null }>(`/api/club/feed?filter=${encodeURIComponent(filter)}${before ? `&before=${encodeURIComponent(before)}` : ''}`),
  post: (id: string) => (DEMO ? demo.post(id) : api<{ post: ClubPost; comments: ClubComment[] }>(`/api/club/posts/${id}`)),
  create: (p: NewPost) => (DEMO ? demo.create(p) : api<{ post: ClubPost }>('/api/club/posts', { body: p })),
  uploadVideo: (blob: Blob, type: string) => (DEMO ? Promise.reject(new Error(tr('Pas de vidéo dans la démo'))) : uploadVideo(blob, type)),
  remove: (id: string) => (DEMO ? demo.remove(id) : api(`/api/club/posts/${id}`, { method: 'DELETE' })),
  edit: (id: string, text: string, mentions: Mention[]) =>
    DEMO ? demo.edit(id, text, mentions) : api<{ post: ClubPost }>(`/api/club/posts/${id}`, { method: 'PUT', body: { text, mentions } }),
  spark: (id: string) => (DEMO ? demo.spark(id) : api<{ post: ClubPost }>(`/api/club/posts/${id}/spark`, { body: {} })),
  comment: (id: string, text: string, mentions: Mention[]) =>
    DEMO ? demo.comment(id, text) : api<{ comment: ClubComment; post: ClubPost }>(`/api/club/posts/${id}/comments`, { body: { text, mentions } }),
  uncomment: (id: string, comment: string) => (DEMO ? demo.uncomment(id, comment) : api<{ post: ClubPost }>(`/api/club/posts/${id}/comments/${comment}`, { method: 'DELETE' })),
  /** Mes relations : moi, mes abonnements, mes abonnés, les demandes en cours. */
  members: () => (DEMO ? demo.members() : api<{ members: Member[]; requests?: number }>('/api/club/members')),
  /** Recherche par @pseudo (2 caractères minimum). */
  search: (q: string) => (DEMO ? demo.search(q) : api<{ members: Member[] }>(`/api/club/search?q=${encodeURIComponent(q)}`)),
  /** Un membre par son pseudo ou son identifiant. */
  member: (key: string) => (DEMO ? demo.member(key) : api<{ member: Member }>(`/api/club/member/${encodeURIComponent(key)}`)),
  follow: (id: string) => (DEMO ? demo.follow(id) : api<{ following: boolean; requested?: boolean }>(`/api/club/follow/${id}`, { body: {} })),
  /** Classement de la semaine : toi et les personnes que tu suis. */
  leaderboard: (week: string) => (DEMO ? demo.leaderboard(week) : api<{ week: string; rows: BoardRow[] }>(`/api/club/leaderboard?week=${week}`)),
  requests: () => (DEMO ? Promise.resolve({ members: [] as Member[] }) : api<{ members: Member[] }>('/api/club/requests')),
  answer: (id: string, accept: boolean) => (DEMO ? Promise.resolve({ ok: true, accepted: accept }) : api<{ ok: boolean; accepted: boolean }>(`/api/club/requests/${id}`, { body: { accept } })),
  removeFollower: (id: string) => (DEMO ? Promise.resolve({ ok: true }) : api<{ ok: boolean }>(`/api/club/followers/${id}`, { method: 'DELETE' })),
  privacy: (on: boolean) => (DEMO ? Promise.resolve({ private: on }) : api<{ private: boolean }>('/api/club/privacy', { method: 'PUT', body: { private: on } })),
  notices: () => (DEMO ? demo.notices() : api<{ notices: Notice[]; unread: number; readAt: number }>('/api/club/notifications')),
  read: () => (DEMO ? demo.read() : api('/api/club/notifications/read', { body: {} })),
  avatar: (photo: string | null) => (DEMO ? demo.setAvatar(photo) : api<{ avatar: string | null }>('/api/club/avatar', { method: 'PUT', body: { photo } })),
  /** Défi (avec un gage facultatif), ou revanche sur un défi raté. */
  challenge: (to: string, hours: number, text: string, opts: { gage?: string; rematch?: string } = {}) =>
    DEMO ? demo.challenge(to, hours, text, opts) : api<{ challenge: Challenge; wallet: WalletView }>('/api/club/challenges', { body: { to, hours, text, ...opts } }),
  challenges: () => (DEMO ? demo.challenges() : api<ChallengeState>('/api/club/challenges')),
  challengeDone: (id: string, at?: number) =>
    DEMO ? demo.challengeDone(id) : api<{ challenge: Challenge; already: boolean; wallet?: WalletView }>(`/api/club/challenges/${id}/done`, { body: at ? { at } : {} }),
  gageDone: (id: string) => (DEMO ? demo.gageDone(id) : api<{ challenge: Challenge; already: boolean; nulos: number }>(`/api/club/challenges/${id}/gage`, { body: {} })),
  /** Une journée validée de plus : le serveur ajoute les disques (une fois par jour). */
  claimPlates: (day: string, streak: number) =>
    DEMO ? demo.claim(day, streak) : api<{ wallet: WalletView; gained: number; bonus: number }>('/api/club/wallet', { body: { day, streak } }),
};

/**
 * Séance validée : chaque défi reçu encore ouvert est relevé. Renvoie le nombre de défis relevés
 * (le serveur ne compte un défi qu'une fois, même si deux téléphones l'envoient).
 */
export async function completeChallenges(s: Pick<AppState, 'days'>): Promise<Challenge[]> {
  if (!myId) myId = (await club.members()).members.find((m) => m.me)?.id ?? null;
  const { challenges } = await club.challenges();
  const now = Date.now();
  const open = challenges.filter((c) => c.status === 'open' && c.to === myId && now <= c.due + GRACE_MS);
  const done: Challenge[] = [];
  for (const c of open) {
    // Une séance validée pendant le délai, même hors ligne : l'heure notée par l'app fait foi (demi-heure de grâce).
    const at = validatedBetween(s, c.at, Math.min(c.due, now));
    if (at === null) continue;
    const r = await club.challengeDone(c.id, at).catch(() => null);
    if (r && !r.already) done.push(r.challenge);
  }
  return done;
}

/** L'heure de la première séance validée entre deux instants, ou null. */
export function validatedBetween(s: Pick<AppState, 'days'>, from: number, to: number): number | null {
  let best: number | null = null;
  for (const d of Object.values(s.days)) if (d.mainDone && d.mainDoneAt && d.mainDoneAt >= from && d.mainDoneAt <= to && (best === null || d.mainDoneAt < best)) best = d.mainDoneAt;
  return best;
}

let myId: string | null = null;
/** Mon identifiant dans le club, appris en lisant la liste des membres. */
export function rememberMe(id: string) {
  myId = id;
}

/* ---------- Mentions ---------- */

const fold = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Le mot « @…» en cours de frappe juste avant le curseur, s'il y en a un. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const m = text.slice(0, caret).match(/(^|\s)@([\p{L}\p{N}_-]{0,20})$/u);
  return m ? { start: caret - m[2].length - 1, query: m[2] } : null;
}

export function matchMembers(members: Member[], query: string): Member[] {
  const q = fold(query);
  return members.filter((m) => !m.me && [m.name, m.handle, m.nick].some((x) => x && fold(x).startsWith(q))).slice(0, 5);
}

/** Les mentions encore présentes dans le texte au moment d'envoyer. */
export const keptMentions = (text: string, mentions: Mention[]) => mentions.filter((m, i) => text.includes(`@${m.name}`) && mentions.findIndex((x) => x.id === m.id) === i);

/** Découpe un texte en morceaux, les mentions à part pour les mettre en valeur. */
export function splitMentions(text: string, mentions: Mention[]): { text: string; mention?: Mention }[] {
  if (!mentions.length) return [{ text }];
  const names = [...mentions].sort((a, b) => b.name.length - a.name.length).map((m) => m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`@(${names.join('|')})`, 'g');
  const out: { text: string; mention?: Mention }[] = [];
  let i = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > i) out.push({ text: text.slice(i, m.index) });
    out.push({ text: m[0], mention: mentions.find((x) => x.name === m[1]) });
    i = m.index! + m[0].length;
  }
  if (i < text.length) out.push({ text: text.slice(i) });
  return out;
}

/* ---------- Démo : un petit club fictif, en mémoire ---------- */

const demo = (() => {
  const H = 3600_000;
  const now = Date.now();
  const me = 'demo';
  const members: Member[] = [
    { id: me, name: tr('Toi'), handle: 'toi', me: true, following: false, followers: 3, posts: 0, sparks: 0, avatar: null },
    { id: 'm-camille', name: tr('Camille'), handle: 'camille.run', nick: tr('La fusée'), bio: tr('Semi en 1 h 38 visé en mars. Fractionné le mardi, sortie longue le dimanche.'), me: false, following: true, followers: 4, posts: 12, sparks: 61, avatar: null, profile: { streak: 41, best: 41, tier: 3, level: 9, program: tr('Semi-marathon du 22 mars') } },
    { id: 'm-yanis', name: tr('Yanis'), handle: 'yanis_ppl', bio: tr('PPL 6 jours. Objectif 140 kg au squat avant l’été.'), me: false, following: true, followers: 3, posts: 9, sparks: 44, avatar: null, profile: { streak: 17, best: 29, tier: 2, level: 7, program: tr('PPL + Upper/Lower') } },
    { id: 'm-ines', name: tr('Inès'), handle: 'ines.swim', nick: tr('Nemo'), me: false, following: false, followers: 2, posts: 6, sparks: 23, avatar: null, profile: { streak: 8, best: 22, tier: 1, level: 5, program: tr('Bloc natation') } },
    { id: 'm-leo', name: tr('Léo'), handle: 'leo.velo', me: false, following: false, followers: 2, posts: 7, sparks: 19, avatar: null, profile: { streak: 3, best: 14, tier: 1, level: 4, program: tr('Cyclosportive 160 km') } },
  ];
  const intervals: [number, number][] = [[1, 900], [2, 300], ...Array.from({ length: 6 }, (_, i) => (i < 5 ? [[5, 230], [1, 90]] : [[5, 230]])).flat() as [number, number][], [1, 600]];
  const swimSet: [number, number][] = [[1, 420], [2, 280], ...Array.from({ length: 10 }, () => [[4, 108], [1, 15]]).flat() as [number, number][], [1, 280]];
  const ride: [number, number][] = [[1, 900], [2, 3600], [3, 900], [2, 1800], [3, 600], [2, 1500], [1, 300]];
  type Stored = Omit<ClubPost, 'sparks' | 'sparked' | 'mine'> & { sparksBy: string[] };
  const posts: Stored[] = [
    {
      id: 'p-camille', author: 'm-camille', authorName: tr('Camille'), at: now - 2 * H, visibility: 'all', photos: [], comments: 2,
      text: tr('6 × 800 sous la pluie, toutes au même chrono. La prépa semi avance.'),
      mentions: [],
      session: { title: tr('Fractionné'), kind: 'cardio', sports: ['run'], date: dayKey(), stats: [{ label: tr('Durée'), value: '52 min' }, { label: tr('Distance'), value: '9,4 km' }, { label: tr('Intense'), value: '23 min' }], profile: intervals },
      sparksBy: ['m-yanis', 'm-ines', 'm-leo'],
    },
    {
      id: 'p-yanis', author: 'm-yanis', authorName: tr('Yanis'), at: now - 5 * H, visibility: 'all', photos: [], comments: 0,
      text: tr('Record au développé couché ! Merci @Toi pour la parade.'),
      mentions: [{ id: me, name: tr('Toi') }],
      session: { title: tr('Push'), kind: 'lifting', date: dayKey(), stats: [{ label: tr('Séries'), value: '18' }, { label: tr('Volume'), value: '7,4 t' }, { label: tr('Exercices'), value: '6' }, { label: tr('Durée'), value: '1 h 05' }], records: [tr('Développé couché 92,5 kg × 5')] },
      sparksBy: ['m-camille', 'm-ines', 'm-leo', 'm-x1', 'm-x2'],
    },
    {
      id: 'p-ines', author: 'm-ines', authorName: tr('Inès'), at: now - 26 * H, visibility: 'all', photos: [], comments: 1,
      text: tr('Premier 10 × 100 sous 1:50. Les éducatifs paient.'),
      mentions: [],
      session: { title: tr('Natation seuil'), kind: 'cardio', sports: ['swim'], date: addDays(dayKey(), -1), stats: [{ label: tr('Durée'), value: '48 min' }, { label: tr('Distance'), value: '2 400 m' }, { label: tr('Intense'), value: '18 min' }], profile: swimSet },
      sparksBy: ['m-camille', 'm-yanis'],
    },
    {
      id: 'p-leo', author: 'm-leo', authorName: tr('Léo'), at: now - 50 * H, visibility: 'all', photos: [], comments: 0,
      text: tr('Sortie longue, quatre côtes et le vent de face au retour.'),
      mentions: [],
      session: { title: tr('Sortie longue vélo'), kind: 'cardio', sports: ['bike'], date: addDays(dayKey(), -2), stats: [{ label: tr('Durée'), value: '2 h 40' }, { label: tr('Distance'), value: '78,3 km' }], profile: ride },
      sparksBy: ['m-camille'],
    },
  ];
  const comments: ClubComment[] = [
    { id: 'c1', post: 'p-camille', author: 'm-yanis', authorName: tr('Yanis'), at: now - 1.6 * H, text: tr('Régulière comme une horloge.'), mentions: [], mine: false },
    { id: 'c2', post: 'p-camille', author: 'm-ines', authorName: tr('Inès'), at: now - 1.2 * H, text: tr('Le semi en moins de 1 h 45, ça se rapproche !'), mentions: [], mine: false },
    { id: 'c3', post: 'p-ines', author: 'm-camille', authorName: tr('Camille'), at: now - 20 * H, text: tr('Énorme progrès en un mois.'), mentions: [], mine: false },
  ];
  const notices: Notice[] = [
    { id: 'n1', type: 'mention', actor: 'm-yanis', actorName: tr('Yanis'), post: 'p-yanis', text: tr('Record au développé couché ! Merci @Toi pour la parade.'), at: now - 5 * H },
    { id: 'n2', type: 'follow', actor: 'm-camille', actorName: tr('Camille'), at: now - 30 * H },
  ];
  let readAt = now - 40 * H;
  const challenges: Challenge[] = [
    { id: 'c-camille', from: 'm-camille', fromName: tr('Camille'), to: me, toName: tr('Toi'), at: now - 3 * H, due: now + 21 * H, text: tr('Une séance jambes avant demain soir ?'), stake: 3, gage: tr('50 burpees filmés'), status: 'open' },
    { id: 'c-leo', from: 'm-leo', fromName: tr('Léo'), to: me, toName: tr('Toi'), at: now - 27 * H, due: now - 3 * H, stake: 3, gage: tr('Payer le café'), status: 'failed', failedAt: now - 3 * H },
    { id: 'c-yanis', from: me, fromName: tr('Toi'), to: 'm-yanis', toName: tr('Yanis'), at: now - 30 * H, due: now - 6 * H, stake: 1, status: 'failed', failedAt: now - 6 * H },
  ];
  // Yanis a raté son défi il y a 6 h : il porte le bonnet de Nulos jusqu'à demain.
  members.find((m) => m.id === 'm-yanis')!.nulos = now + 18 * H;
  members.find((m) => m.id === 'm-yanis')!.record = { won: 4, lost: 1 };
  members.find((m) => m.id === 'm-camille')!.record = { won: 7, lost: 0 };
  let wallet: Wallet = { bal: 7, day: addDays(dayKey(), -1), streak: 22 };
  // Et toi, tu as raté celui de Léo : bonnet jusqu'à demain, ou jusqu'au gage.
  let nulos = now + 21 * H;
  members[0].nulos = nulos;
  const record = { won: 3, lost: 1 };
  const purse = (w: Wallet): WalletView => ({ plates: w.bal, cap: PLATES.cap });
  const images = new Map<string, string>();
  const view = (p: Stored): ClubPost => {
    const { sparksBy, ...rest } = p;
    const nul = members.find((m) => m.id === p.author)?.nulos;
    return { ...rest, sparks: sparksBy.length, sparked: sparksBy.includes(me), mine: p.author === me, ...(nul && nul > Date.now() ? { authorNulos: nul } : {}) };
  };
  const find = (id: string) => {
    const p = posts.find((x) => x.id === id);
    if (!p) throw new Error(tr('Publication introuvable'));
    return p;
  };
  const wait = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 220));
  const following = () => members.filter((m) => m.following).map((m) => m.id);
  return {
    images,
    feed: (filter: string) => {
      const only = filter.startsWith('user:') ? filter.slice(5) : null;
      const list = posts
        .filter((p) => (only ? p.author === only : filter === 'following' ? p.author === me || following().includes(p.author) : true))
        .sort((a, b) => b.at - a.at)
        .map(view);
      return wait({ posts: list, next: null });
    },
    post: (id: string) => wait({ post: view(find(id)), comments: comments.filter((c) => c.post === id) }),
    create: (n: NewPost) => {
      const photos = n.photos.map((data, i) => {
        const id = `demo-photo-${Date.now()}-${i}`;
        images.set(photoPath(id), data);
        return id;
      });
      const p: Stored = { id: `p-${Date.now()}`, author: me, authorName: members[0].name, at: Date.now(), text: n.text, mentions: n.mentions, session: n.session, photos, ...(n.music ? { music: n.music } : {}), visibility: n.visibility, comments: 0, sparksBy: [] };
      posts.unshift(p);
      members[0].posts++;
      // Les copains réagissent vite, c'est une démo.
      setTimeout(() => {
        p.sparksBy.push('m-camille', 'm-yanis');
        members[0].sparks += 2;
        notices.unshift({ id: `n-${Date.now()}`, type: 'spark', actor: 'm-camille', actorName: tr('Camille'), post: p.id, text: n.session?.title ?? n.text.slice(0, 80), at: Date.now() });
      }, 4000);
      return wait({ post: view(p) });
    },
    remove: (id: string) => {
      posts.splice(posts.indexOf(find(id)), 1);
      return wait({ ok: true });
    },
    edit: (id: string, text: string, mentions: Mention[]) => {
      const p = find(id);
      if (text !== p.text) {
        p.text = text;
        p.mentions = mentions;
        p.editedAt = Date.now();
      }
      return wait({ post: view(p) });
    },
    spark: (id: string) => {
      const p = find(id);
      p.sparksBy = p.sparksBy.includes(me) ? p.sparksBy.filter((x) => x !== me) : [...p.sparksBy, me];
      return wait({ post: view(p) });
    },
    comment: (id: string, text: string) => {
      const p = find(id);
      const c: ClubComment = { id: `c-${Date.now()}`, post: id, author: me, authorName: members[0].name, at: Date.now(), text, mentions: [], mine: true };
      comments.push(c);
      p.comments++;
      return wait({ comment: c, post: view(p) });
    },
    uncomment: (id: string, cid: string) => {
      const p = find(id);
      const i = comments.findIndex((c) => c.id === cid);
      if (i >= 0) comments.splice(i, 1);
      p.comments = Math.max(0, p.comments - 1);
      return wait({ post: view(p) });
    },
    members: () => wait({ members: members.map((m) => ({ ...m })), requests: 0 }),
    leaderboard: (week: string) =>
      wait({
        week,
        rows: [
          { id: 'm-yanis', name: tr('Yanis'), handle: 'yanis_ppl', avatar: null, me: false, week: 5, volume: 38_400, streak: 31, days: 0b0011111, nulos: members.find((m) => m.id === 'm-yanis')?.nulos },
          { id: me, name: tr('Toi'), handle: 'toi', avatar: null, me: true, week: 4, volume: 29_800, streak: 23, days: 0b0011011, nulos: members[0].nulos },
          { id: 'm-camille', name: tr('Camille'), handle: 'camille.run', avatar: null, me: false, week: 4, volume: 6_200, streak: 12, days: 0b0010111 },
          { id: 'm-ines', name: tr('Inès'), handle: 'ines.swim', avatar: null, me: false, week: 2, volume: 0, streak: 5, days: 0b0000101 },
        ] as BoardRow[],
      }),
    search: (q: string) => wait({ members: members.filter((m) => m.handle?.startsWith(q.replace(/^@/, '').toLowerCase())).map((m) => ({ ...m })) }),
    member: (key: string) => {
      const m = members.find((x) => x.handle === key || x.id === key);
      return m ? wait({ member: { ...m } }) : Promise.reject(new Error(tr('Membre introuvable')));
    },
    follow: (id: string) => {
      const m = members.find((x) => x.id === id)!;
      m.following = !m.following;
      m.followers += m.following ? 1 : -1;
      return wait({ following: m.following, requested: false });
    },
    notices: () => wait({ notices: [...notices], unread: notices.filter((n) => n.at > readAt).length, readAt }),
    read: () => {
      readAt = Date.now();
      return wait({ ok: true });
    },
    setAvatar: (photo: string | null) => {
      const v = photo ? String(Date.now()) : null;
      members[0].avatar = v;
      if (photo && v) images.set(`/api/club/avatar/${me}?v=${v}`, photo);
      return wait({ avatar: v });
    },
    rename: (name: string) => {
      members[0].name = name || tr('Toi');
    },
    challenge: (to: string, hours: number, text: string, opts: { gage?: string; rematch?: string } = {}) => {
      const m = members.find((x) => x.id === to)!;
      const open = challenges.filter((x) => x.from === me && x.status === 'open');
      if (open.some((x) => x.to === to)) return Promise.reject(new Error(tr('Un défi est déjà en cours avec cette personne : attends qu’il se termine')));
      if (open.length >= OPEN_MAX) return Promise.reject(new Error(tr('Déjà {OPEN_MAX} défis lancés en cours : attends qu’ils se terminent', { OPEN_MAX })));
      const stake = stakeOf(Boolean(opts.gage), Boolean(opts.rematch));
      if (wallet.bal < stake) return Promise.reject(new Error(tr('Pas assez de disques : valide tes journées pour en gagner')));
      wallet = addPlates(wallet, -stake);
      const c: Challenge = { id: `c-${Date.now()}`, from: me, fromName: members[0].name, to, toName: m.name, at: Date.now(), due: Date.now() + hours * H, status: 'open', stake, ...(text ? { text } : {}), ...(opts.gage && !opts.rematch ? { gage: opts.gage } : {}), ...(opts.rematch ? { rematch: opts.rematch } : {}) };
      if (opts.rematch) {
        const origin = challenges.find((x) => x.id === opts.rematch);
        if (origin) origin.revenge = c.id;
      }
      challenges.unshift(c);
      return wait({ challenge: c, wallet: purse(wallet) });
    },
    challenges: () => wait({ challenges: challenges.map((c) => ({ ...c })), wallet: purse(wallet), nulos: nulos > Date.now() ? nulos : 0, record: { ...record } }),
    challengeDone: (id: string) => {
      const c = challenges.find((x) => x.id === id)!;
      const already = c.status === 'done';
      if (!already) {
        c.status = 'done';
        c.doneAt = Date.now();
        wallet = addPlates(wallet, c.stake ?? 0);
        record.won++;
      }
      return wait({ challenge: { ...c }, already, wallet: purse(wallet) });
    },
    gageDone: (id: string) => {
      const c = challenges.find((x) => x.id === id)!;
      const already = Boolean(c.gageDone);
      c.gageDone ??= Date.now();
      nulos = 0;
      members[0].nulos = undefined;
      return wait({ challenge: { ...c }, already, nulos });
    },
    claim: (day: string, streak: number) => {
      const r = claimPlates(wallet, day, streak);
      wallet = r.wallet;
      return wait({ wallet: purse(wallet), gained: r.gained, bonus: r.bonus });
    },
  };
})();

export const demoClub = demo;
