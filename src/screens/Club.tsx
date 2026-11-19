// Le club : le fil des séances des membres, comme sur Strava. Publier sa séance avec des photos,
// identifier quelqu'un avec @, envoyer une étincelle (elle rapporte de l'XP à l'auteur), commenter, suivre, être prévenu.
import { type ChangeEvent, type CSSProperties, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DISCIPLINE_ICON, Icon } from '../components/Icon';
import { Radar } from '../components/Radar';
import { RollingNumber } from '../components/RollingNumber';
import type { GroupScore } from '../lib/strength';
import { ask, errorText, Sheet, toast } from '../components/ui';
import { DEMO } from '../lib/api';
import {
  avatarPath,
  club,
  type ClubComment,
  type BoardRow,
  type ClubPost,
  demoClub,
  imageUrl,
  keptMentions,
  matchMembers,
  type Member,
  type Mention,
  mentionQuery,
  type Notice,
  photoPath,
  type SessionSummary,
  shareableDays,
  splitMentions,
  type Visibility,
  type Challenge,
  type ChallengeState,
  CHALLENGE_DELAYS,
  canRematch,
  isNulos,
  rememberMe,
  timeLeft,
  videoUrl,
  type NewPost,
  type PostVideo,
} from '../lib/club';
import { Field, Toggle } from '../components/form';
import { GAGE_MAX, GRACE_MS, nextBonus, NULOS_HOURS, PLATES, stakeOf } from '../../shared/plates';
import { loadChallenges, setWallet, useWallet } from '../lib/wallet';
import { flameInfo } from '../lib/flames';
import { dayKey, formatShort, mondayOf, weekdayOf } from '../lib/date';
import { boardDays, boardLine, boardRanks, boardVolume } from '../lib/board';
import { prepareImage } from '../lib/image';
import { AvatarCrop } from '../components/AvatarCrop';
import { setMe } from '../lib/me';
import { MusicBar, MusicPicker } from '../components/Music';
import { autoplay, playable, stopIf, stopMusic, type Track } from '../lib/music';
import { activePostId, setSound, useActive, useNear, useSound, useVisibility } from '../lib/feedSound';
import { type PickedVideo, pickVideo, prepareVideo, VIDEO_SECONDS } from '../lib/video';
import { getSession, signedIn } from '../lib/session';
import { getState, setState, useApp } from '../lib/store';
import { moment } from '../lib/moments';
import { CHALLENGE_XP, SPARK_XP } from '../lib/logic';
import { loc, lower, tn, tr } from '../../shared/i18n';

type View = 'feed' | 'following' | 'members';
type Feed = 'all' | 'following';
const feedOf = (v: View): Feed => (v === 'following' ? 'following' : 'all');

/**
 * Ce que le club a montré au dernier passage, pour le compte connecté. En revenant sur l'onglet, le fil, le
 * classement et les défis sont là tout de suite, puis se mettent à jour.
 */
interface Seen {
  owner: string;
  feeds: Partial<Record<Feed, { posts: ClubPost[]; next: string | null }>>;
  members: Member[] | null;
  notices: { list: Notice[]; unread: number } | null;
  board: { week: string; rows: BoardRow[] } | null;
  challenges: ChallengeState | null;
}
let seen: Seen | null = null;
function seenNow(): Seen {
  const owner = DEMO ? 'demo' : (getSession().account?.id ?? '');
  if (seen?.owner !== owner) seen = { owner, feeds: {}, members: null, notices: null, board: null, challenges: null };
  return seen;
}

const hue = (id: string) => {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};

function ago(at: number): string {
  const min = Math.round((Date.now() - at) / 60_000);
  if (min < 1) return tr('à l’instant');
  if (min < 60) return tr('il y a {min} min', { min });
  const h = Math.round(min / 60);
  if (h < 24) return tr('il y a {h} h', { h });
  const d = new Date(at);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (h < 48) return tr('hier à {time}', { time });
  return formatShort(dayKey(d));
}

function useImage(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return setUrl(null);
    let live = true;
    imageUrl(path).then((u) => live && setUrl(u), () => live && setUrl(null));
    return () => {
      live = false;
    };
  }, [path]);
  return url;
}

export function MemberAvatar({ m, size = 40 }: { m: Pick<Member, 'id' | 'name' | 'avatar'>; size?: number }) {
  const url = useImage(avatarPath(m));
  const h = hue(m.id);
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, background: url ? 'var(--surface-3)' : `hsl(${h} 42% 34%)` }} aria-hidden="true">
      {url ? <img src={url} alt="" /> : m.name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

/** « jusqu'à 18:30 », « jusqu'à demain 9:05 ». */
function untilText(at: number): string {
  const d = new Date(at);
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  return dayKey(d) === dayKey() ? tr('jusqu’à {time}', { time }) : tr('jusqu’à demain {time}', { time });
}

/** Le bonnet de Nulos, à côté du nom de qui a raté un défi (24 h, ou jusqu'à son gage fait). */
export function Nulos({ until }: { until?: number }) {
  if (!isNulos(until)) return null;
  return (
    <span className="nulos" title={tr('Défi raté : bonnet de Nulos {until}', { until: untilText(until!) })}>
      <Icon name="dunce" size={13} />
      {tr('Nulos')}
    </span>
  );
}

/* ---------- Écran ---------- */

export function Club({
  openSettings,
  compose,
  onComposed,
  openPost,
  openMember,
}: {
  openSettings: (page?: 'account' | 'profile') => void;
  compose?: string | null;
  onComposed: () => void;
  openPost?: string | null;
  openMember?: string | null;
}) {
  const s = useApp();
  const [view, setView] = useState<View>('feed');
  // En quittant le club, l'extrait en cours s'arrête.
  useEffect(() => stopMusic, []);
  const [memo] = useState(seenNow);
  const monday = mondayOf(dayKey());
  const [posts, setPosts] = useState<ClubPost[] | null>(() => memo.feeds.all?.posts ?? null);
  const [next, setNext] = useState<string | null>(() => memo.feeds.all?.next ?? null);
  // Le fil auquel appartient la liste affichée (elle peut rester celle d'avant le temps du chargement).
  const [shownFeed, setShownFeed] = useState<Feed>('all');
  const [members, setMembers] = useState<Member[]>(() => memo.members ?? []);
  const [board, setBoard] = useState<BoardRow[] | null>(() => (memo.board?.week === monday ? memo.board.rows : null));
  const [challenges, setChallenges] = useState<ChallengeState | null>(() => memo.challenges);
  const ticket = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [composer, setComposer] = useState<string | null>(compose ?? null);
  const [open, setOpen] = useState<string | null>(openPost ?? null);
  const [person, setPerson] = useState<Member | null>(null);
  const memberShown = useRef(false);
  const [notices, setNotices] = useState<{ list: Notice[]; unread: number } | null>(() => memo.notices);
  // Notification « demande d'abonnement » touchée : la liste s'ouvre directement.
  const [showNotices, setShowNotices] = useState(() => new URLSearchParams(location.search).get('requests') === '1');
  const can = DEMO || signedIn();

  useEffect(() => {
    if (compose) setComposer(compose);
  }, [compose]);
  useEffect(() => {
    if (DEMO) demoClub.rename(s.settings.name);
  }, [s.settings.name]);

  const load = useCallback(async () => {
    if (!can) return;
    const turn = ++ticket.current;
    setError(null);
    try {
      const filter = feedOf(view);
      // Le classement et les défis arrivent avec le fil : rien ne vient se glisser au-dessus une fois la page affichée.
      const [f, m, n, b, c] = await Promise.all([
        view === 'members' ? Promise.resolve(null) : club.feed(filter),
        club.members(),
        club.notices(),
        view === 'members' ? Promise.resolve(null) : club.leaderboard(monday).catch(() => null),
        loadChallenges().catch(() => null),
      ]);
      // Une réponse plus ancienne (onglet changé entre-temps) n'écrase pas la plus récente.
      if (turn !== ticket.current) return;
      if (f) {
        setPosts(f.posts);
        setNext(f.next);
        setShownFeed(filter);
      }
      if (b) setBoard(b.rows);
      if (c) setChallenges(c);
      setMembers(m.members);
      if (openMember && !memberShown.current) {
        // Lien de profil : on ouvre la fiche une seule fois, puis l'adresse redevient celle du club.
        memberShown.current = true;
        const target = m.members.find((x) => x.handle === openMember) ?? (await club.member(openMember).then((r) => r.member, () => null));
        if (target) setPerson(target);
        else toast(tr('Aucun membre @{openMember}', { openMember }), true);
        try {
          history.replaceState(null, '', '?tab=club');
        } catch {
          // Aperçu intégré : sans effet.
        }
      }
      setNotices({ list: n.notices, unread: n.unread });
      // Les étincelles reçues deviennent de l'XP.
      const mine = m.members.find((x) => x.me);
      if (mine) {
        rememberMe(mine.id);
        setMe({ id: mine.id, avatar: mine.avatar });
      }
      const before = getState().club?.sparks;
      if (mine && mine.sparks !== (before ?? 0)) {
        setState((d) => void (d.club = { ...d.club, sparks: mine.sparks }));
        const gained = mine.sparks - (before ?? 0);
        if (before !== undefined && gained > 0) moment('spark', tn(gained, '+{n} étincelle', '+{n} étincelles'), tr('Le club salue tes séances : +{n} XP', { n: gained * SPARK_XP }));
      }
    } catch (e) {
      setError(errorText(e));
    }
  }, [view, can, openMember, monday]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const reload = () => void loadChallenges().then(setChallenges, () => undefined);
    window.addEventListener('shred:challenges', reload);
    return () => window.removeEventListener('shred:challenges', reload);
  }, []);

  // Ce qui est à l'écran reste en mémoire pour le prochain passage sur l'onglet.
  useEffect(() => {
    if (posts) memo.feeds[shownFeed] = { posts, next };
    memo.members = members;
    memo.notices = notices;
    if (board) memo.board = { week: monday, rows: board };
    if (challenges) memo.challenges = challenges;
  });

  /** Autre fil : sa dernière liste connue tout de suite, sinon le squelette, jamais celle de l'autre fil. */
  const pick = (v: View) => {
    if (v !== 'members' && feedOf(v) !== shownFeed) {
      const known = memo.feeds[feedOf(v)];
      setPosts(known?.posts ?? null);
      setNext(known?.next ?? null);
      setShownFeed(feedOf(v));
    }
    setView(v);
  };

  const more = async () => {
    if (!next) return;
    try {
      const f = await club.feed(view === 'following' ? 'following' : 'all', next);
      setPosts((p) => [...(p ?? []), ...f.posts]);
      setNext(f.next);
    } catch (e) {
      toast(errorText(e), true);
    }
  };

  const update = (p: ClubPost) => setPosts((list) => list?.map((x) => (x.id === p.id ? p : x)) ?? null);
  const memberOf = (id: string, p?: ClubPost) => members.find((m) => m.id === id) ?? { id, name: p?.authorName ?? '?', handle: p?.authorHandle ?? null, avatar: p?.authorAvatar ?? null };
  /** Fiche d'un membre : depuis mes relations, sinon demandée au serveur (auteur d'une publication du club). */
  const openPerson = async (id: string) => {
    const known = members.find((m) => m.id === id);
    if (known) return setPerson(known);
    try {
      setPerson((await club.member(id)).member);
    } catch (e) {
      toast(errorText(e), true);
    }
  };

  if (!can) {
    return (
      <>
        <header className="topbar">
          <div>
            <div className="date">{tr('Les séances des membres')}</div>
            <h1>{tr('Club')}</h1>
          </div>
        </header>
        <div className="card stack" style={{ gap: 10 }}>
          <div style={{ fontWeight: 800 }}>{tr('Rejoins le club')}</div>
          <p className="small muted" style={{ margin: 0 }}>
            {tr('Le club réunit les membres de ton serveur Shred : vous partagez vos séances, vos photos, vous vous identifiez et vous vous envoyez des étincelles. Il faut un compte pour y entrer.')}
          </p>
          <button className="btn primary" onClick={() => openSettings('account')}>
            {tr('Me connecter')}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="topbar">
        <div>
          <div className="date">{tr('Les séances des membres')}</div>
          <h1>{tr('Club')}</h1>
        </div>
        <PlatesButton />
        <button
          className="icon-btn badge-host"
          onClick={() => {
            setShowNotices(true);
            if (notices?.unread) void club.read().then(() => setNotices((n) => n && { ...n, unread: 0 }));
          }}
          aria-label={tr('Notifications{v}', { v: notices?.unread ? tn(notices.unread, ', {n} non lue', ', {n} non lues') : '' })}
        >
          <Icon name="bell" />
          {notices?.unread ? <span className="badge num">{notices.unread}</span> : null}
        </button>
        <button className="icon-btn primary-icon" onClick={() => setComposer(dayKey())} aria-label={tr('Publier une séance')}>
          <Icon name="plus" />
        </button>
      </header>

      <div className="seg" role="tablist" aria-label={tr('Club')} style={{ marginBottom: 16 }}>
        {(
          [
            ['feed', tr('Tout le club')],
            ['following', tr('Abonnements')],
            ['members', tr('Membres')],
          ] as [View, string][]
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'on' : ''} onClick={() => pick(id)}>
            {label}
          </button>
        ))}
      </div>

      {view !== 'members' && <Leaderboard rows={board} onOpen={(id) => void openPerson(id)} />}
      {view !== 'members' && <ChallengeStrip state={challenges} me={members.find((x) => x.me)?.id ?? null} onUpdate={load} />}

      {error && (
        <div className="card stack" style={{ gap: 8 }}>
          <p className="small" style={{ margin: 0 }}>
            {error}
          </p>
          <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={load}>
            {tr('Réessayer')}
          </button>
        </div>
      )}

      {view === 'members' ? (
        <MemberList members={members} onOpen={setPerson} onChange={setMembers} onAnswered={load} />
      ) : (
        <div className="stack feed">
          {!posts && !error && <FeedSkeleton />}
          {posts && posts.length === 0 && (
            <div className="card empty-feed">
              <div style={{ fontWeight: 800 }}>{view === 'following' ? tr('Personne de suivi pour l’instant') : tr('Le fil est vide')}</div>
              <p className="small muted" style={{ margin: '4px 0 12px' }}>
                {view === 'following' ? tr('Cherche un membre par son @pseudo dans l’onglet Membres, puis abonne-toi pour voir ses séances ici.') : tr('Publie ta première séance : les autres membres la verront ici.')}
              </p>
              <button className="btn primary" onClick={() => (view === 'following' ? setView('members') : setComposer(dayKey()))}>
                {view === 'following' ? tr('Chercher un membre') : tr('Publier une séance')}
              </button>
            </div>
          )}
          {posts?.map((p) => (
            <PostCard key={p.id} post={p} author={memberOf(p.author, p)} members={members} onChange={update} onOpen={() => setOpen(p.id)} onAuthor={() => void openPerson(p.author)} onRemoved={() => setPosts((l) => l?.filter((x) => x.id !== p.id) ?? null)} />
          ))}
          {next && (
            <button className="btn block" onClick={more}>
              {tr('Voir plus')}
            </button>
          )}
        </div>
      )}

      {composer && (
        <Composer
          date={composer}
          members={members}
          onClose={() => {
            setComposer(null);
            onComposed();
          }}
          onPosted={(p) => {
            setPosts((l) => [p, ...(l ?? [])]);
            setView((v) => (v === 'members' ? 'feed' : v));
          }}
        />
      )}
      {open && <PostSheet id={open} members={members} onClose={() => setOpen(null)} onChange={update} />}
      {person && <MemberSheet m={person} onEdit={() => { setPerson(null); openSettings('profile'); }} onClose={() => setPerson(null)} onChange={(m) => setMembers((l) => l.map((x) => (x.id === m.id ? m : x)))} />}
      {showNotices && notices && (
        <NoticesSheet
          onAnswered={(n) => {
            setNotices((x) => x && { ...x, list: x.list.filter((y) => y.id !== n.id) });
            void load();
          }}
          notices={notices.list}
          members={members}
          onClose={() => setShowNotices(false)}
          onOpen={(n) => {
            setShowNotices(false);
            if (n.post) setOpen(n.post);
            else void openPerson(n.actor);
          }}
        />
      )}
    </>
  );
}

function FeedSkeleton() {
  return (
    <>
      {[0, 1].map((i) => (
        <div key={i} className="card post skeleton" aria-hidden="true">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="avatar" />
            <span className="sk-line" style={{ width: '40%' }} />
          </div>
          <span className="sk-line" style={{ width: '70%', height: 22, marginTop: 16 }} />
          <span className="sk-block" />
        </div>
      ))}
    </>
  );
}

/* ---------- Une publication ---------- */

const VIS: Record<Visibility, { icon: string; label: string }> = {
  all: { icon: 'globe', label: tr('Tout le club') },
  followers: { icon: 'users', label: tr('Abonnés') },
  private: { icon: 'lock', label: tr('Moi seul') },
};

function MentionText({ text, mentions }: { text: string; mentions: Mention[] }) {
  return (
    <>
      {splitMentions(text, mentions).map((part, i) =>
        part.mention ? (
          <span key={i} className="mention">
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

export function SummaryCard({ s, compact = false }: { s: SessionSummary; compact?: boolean }) {
  const total = s.profile?.reduce((n, [, sec]) => n + sec, 0) ?? 0;
  return (
    <div className={`post-session ${compact ? 'compact' : ''}`}>
      <div className="post-session-head">
        <h3 className="display">{s.title}</h3>
        <span className="post-sports">
          {(s.sports ?? []).map((d) => (
            <Icon key={d} name={DISCIPLINE_ICON[d] ?? 'pulse'} size={18} />
          ))}
          {s.kind === 'lifting' && <Icon name="dumbbell" size={18} />}
        </span>
      </div>
      {s.stats.length > 0 && (
        <div className="post-stats" style={{ gridTemplateColumns: `repeat(${Math.min(4, s.stats.length)}, 1fr)` }}>
          {s.stats.slice(0, 4).map((x) => (
            <div key={x.label}>
              <span className="small muted">{x.label}</span>
              <b className="num">{x.value}</b>
            </div>
          ))}
        </div>
      )}
      {s.profile && total > 0 && (
        <div className="post-profile" aria-label={tr('Profil d’intensité de la séance')}>
          {s.profile.map(([z, sec], i) => (
            <i key={i} className={`profile-col z${z}`} style={{ flexGrow: sec, height: `${[22, 40, 60, 80, 100][z - 1]}%` }} />
          ))}
        </div>
      )}
      {s.records?.map((r) => (
        <div key={r} className="post-record small">
          <Icon name="trophy" size={15} />{' '}{tr('Record : {r}', { r })}
        </div>
      ))}
    </div>
  );
}

// Lundi à dimanche dans la langue de l’app (le 1er janvier 2024 était un lundi).
const DAY_NAMES = [1, 2, 3, 4, 5, 6, 7].map((d) => new Date(Date.UTC(2024, 0, d)).toLocaleDateString(loc(), { weekday: 'long', timeZone: 'UTC' }));

/** La semaine en sept points, du lundi au dimanche : allumé si une séance a été validée ce jour-là. */
function WeekDots({ days, today }: { days: number; today: number }) {
  const on = boardDays(days);
  const named = DAY_NAMES.filter((_, i) => on[i]);
  return (
    <span className="board-days" role="img" aria-label={named.length ? tr('Séances : {join}', { join: named.join(', ') }) : tr('Pas encore de séance cette semaine')}>
      {on.map((v, i) => (
        <i key={i} className={`${v ? 'on' : ''}${i === today ? ' today' : ''}${i > today ? ' later' : ''}`} />
      ))}
    </span>
  );
}

/** Classement de la semaine entre toi et les personnes que tu suis : séances validées, puis tonnage. */
function Leaderboard({ rows, onOpen }: { rows: BoardRow[] | null; onOpen: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const today = dayKey();
  if (!rows || rows.length < 2) return null;
  // Jours restants jusqu'à dimanche (getDay : dimanche = 0), et la place d'aujourd'hui dans la semaine (lundi = 0).
  const left = (7 - weekdayOf(today)) % 7;
  const todayIndex = (weekdayOf(today) + 6) % 7;
  const ranks = boardRanks(rows);
  return (
    <section className="card board">
      <div className="board-head">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800 }}>{tr('Classement de la semaine')}</div>
          <div className="small muted">{boardLine(rows, left)}</div>
        </div>
        <Icon name="trophy" size={22} />
      </div>
      <ol className="board-list">
        {(all ? rows : rows.slice(0, 3)).map((r, i) => (
          <li key={r.id} className={r.me ? 'me' : ''}>
            <button onClick={() => !r.me && onOpen(r.id)} disabled={r.me} aria-label={tn(r.week, '{ranks}e : {v}, {n} séance', '{ranks}e : {v}, {n} séances', { ranks: ranks[i], v: r.me ? 'toi' : r.name })}>
              <span className={`board-rank r${ranks[i]}`}>{ranks[i]}</span>
              <MemberAvatar m={r} size={36} />
              <span className="board-who">
                <span className="board-name">
                  <span className="title ellipsis">{r.me ? tr('Toi') : r.name}</span>
                  <Nulos until={r.nulos} />
                  {r.streak > 1 && (
                    <span className="board-streak num" title={tr('{streak} jours de série', { streak: r.streak })}>
                      <Icon name="flame" size={12} />
                      {r.streak}
                    </span>
                  )}
                </span>
                <span className="board-sub">
                  {r.days !== undefined ? <WeekDots days={r.days} today={todayIndex} /> : <span className="faint">{r.handle ? `@${r.handle}` : ''}</span>}
                  {r.volume > 0 && <span className="faint num">{boardVolume(r.volume)}</span>}
                </span>
              </span>
              <span className="board-score num">
                <b>{r.week}</b>
                <span>{tn(r.week, 'séance', 'séances')}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      {rows.length > 3 && (
        <button className="link small board-more" onClick={() => setAll((v) => !v)}>
          {all ? tr('Voir le podium') : tr('Voir les {length}', { length: rows.length })}
        </button>
      )}
    </section>
  );
}

const fmtDur = (sec: number) => `0:${String(Math.round(sec)).padStart(2, '0')}`;

/** Bouton son, en bas à droite de la photo ou de la vidéo : coupe ou remet le son de tout le fil. */
function SoundButton({ on, onToggle }: { on: boolean; onToggle: (next: boolean) => void }) {
  return (
    <button
      className="sound-btn"
      onClick={(e) => {
        e.stopPropagation();
        onToggle(!on);
      }}
      aria-label={on ? tr('Couper le son') : tr('Activer le son')}
      aria-pressed={on}
    >
      <Icon name={on ? 'sound' : 'mute'} size={15} />
    </button>
  );
}

/** Vidéo d'une publication : chargée quand elle approche, jouée en boucle quand elle est au centre. */
function PostVideoView({ v, slot, audible, videoRef }: { v: PostVideo; slot: string; audible: boolean; videoRef: { current: HTMLVideoElement | null } }) {
  const active = useActive(slot);
  const near = useNear(slot);
  const poster = useImage(photoPath(v.poster));
  const [src, setSrc] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!near || src) return;
    let live = true;
    videoUrl(v.id).then((u) => live && setSrc(u), () => undefined);
    return () => {
      live = false;
    };
  }, [near, v.id, src]);
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !src) return;
    el.muted = !audible;
    if (active && !paused) {
      // Le téléphone peut refuser le son sans toucher préalable : la vidéo joue alors sans son.
      el.play().catch(() => {
        el.muted = true;
        void el.play().catch(() => undefined);
      });
    } else el.pause();
  }, [active, audible, src, paused, videoRef]);
  const ratio = Math.min(1.91, Math.max(0.8, v.w / Math.max(1, v.h)));
  return (
    <div className="post-video" style={{ aspectRatio: String(ratio) }} onClick={() => setPaused((p) => !p)}>
      {src ? (
        <video ref={videoRef} src={src} poster={poster ?? undefined} playsInline loop muted preload="auto" aria-label={tr('Vidéo de {fmtDur}', { fmtDur: fmtDur(v.dur) })} />
      ) : poster ? (
        <img src={poster} alt="" />
      ) : (
        <span className="sk-block" />
      )}
      {paused && (
        <span className="video-paused" aria-hidden="true">
          <Icon name="play" size={30} />
        </span>
      )}
    </div>
  );
}

/** Photos ou vidéo, avec le bouton son quand la publication a du son (musique, ou vidéo qui garde le sien). */
function PostMedia({ post, slot, onPhoto }: { post: ClubPost; slot: string; onPhoto: (i: number) => void }) {
  const soundOn = useSound();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const music = post.music && playable(post.music) ? post.music : null;
  const hasSound = Boolean(post.video?.sound || music);
  if (!post.video && !post.photos.length) return null;
  const toggle = (next: boolean) => {
    setSound(next);
    // Dans le geste : l'iPhone accepte alors de mettre le son.
    const el = videoRef.current;
    if (el && post.video?.sound) {
      el.muted = !next;
      if (next) void el.play().catch(() => undefined);
    }
    if (music) {
      if (next) void autoplay(music, `post:${post.id}`);
      else stopIf(`post:${post.id}`);
    }
  };
  return (
    <div className="post-media">
      {post.video ? <PostVideoView v={post.video} slot={slot} audible={soundOn && post.video.sound} videoRef={videoRef} /> : <Photos ids={post.photos} onOpen={onPhoto} />}
      {hasSound && <SoundButton on={soundOn} onToggle={toggle} />}
      {post.video && <span className="video-badge small">{fmtDur(post.video.dur)}</span>}
    </div>
  );
}

function Photos({ ids, onOpen }: { ids: string[]; onOpen: (i: number) => void }) {
  if (!ids.length) return null;
  return (
    <div className={`post-photos n${Math.min(ids.length, 4)}`}>
      {ids.slice(0, 4).map((id, i) => (
        <PostPhoto key={id} id={id} onClick={() => onOpen(i)} />
      ))}
    </div>
  );
}

function PostPhoto({ id, onClick }: { id: string; onClick: () => void }) {
  const url = useImage(photoPath(id));
  return (
    <button className="post-photo" onClick={onClick} aria-label={tr('Agrandir la photo')}>
      {url ? <img src={url} alt="" loading="lazy" /> : <span className="sk-block" />}
    </button>
  );
}

/** Modifier le texte de sa publication : même saisie qu'à la publication, @ pour identifier. */
function EditPostSheet({ post, members, onClose, onSaved }: { post: ClubPost; members: Member[]; onClose: () => void; onSaved: (p: ClubPost) => void }) {
  const [text, setText] = useState(post.text);
  const [mentions, setMentions] = useState<Mention[]>(post.mentions);
  const [busy, setBusy] = useState(false);
  const empty = !text.trim() && !post.session && !post.photos.length && !post.video && !post.music;
  const save = async () => {
    if (empty) return toast(tr('Sans photo ni séance, la publication a besoin d’un texte'), true);
    setBusy(true);
    try {
      const clean = text.trim();
      const { post: p } = await club.edit(post.id, clean, keptMentions(clean, mentions));
      onSaved(p);
      toast(p.editedAt !== post.editedAt ? tr('Publication modifiée') : tr('Rien n’a changé'));
      onClose();
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={tr('Modifier la publication')}
      onClose={onClose}
      footer={
        <button className="btn primary block" onClick={save} disabled={busy || empty}>
          {busy ? tr('Enregistrement…') : tr('Enregistrer')}
        </button>
      }
    >
      <div className="stack">
        <MentionInput value={text} onChange={setText} mentions={mentions} onMentions={setMentions} members={members} placeholder={tr('Ton texte. Tape @ pour identifier un membre.')} rows={5} autoFocus />
        <p className="small faint" style={{ margin: 0 }}>
          {tr('Seul le texte change ; « (modifié) » s’affichera à côté. Les personnes que tu ajoutes avec @ sont prévenues.')}
        </p>
      </div>
    </Sheet>
  );
}

function PostCard({
  post,
  author,
  members = [],
  onChange,
  onOpen,
  onAuthor,
  onRemoved,
  detail = false,
}: {
  post: ClubPost;
  author: Pick<Member, 'id' | 'name' | 'avatar'>;
  /** Pour identifier quelqu'un en modifiant le texte. */
  members?: Member[];
  onChange: (p: ClubPost) => void;
  onOpen?: () => void;
  onAuthor?: () => void;
  onRemoved?: () => void;
  detail?: boolean;
}) {
  const [burst, setBurst] = useState(0);
  const [editing, setEditing] = useState(false);
  const [photo, setPhoto] = useState<number | null>(null);
  // Lecture automatique : la publication la plus visible joue sa musique si le son du fil est activé.
  const box = useRef<HTMLElement>(null);
  const slot = detail ? `${post.id}:detail` : post.id;
  useVisibility(box, slot);
  const active = useActive(slot);
  const soundOn = useSound();
  const musicKey = `post:${post.id}`;
  useEffect(() => {
    const t = post.music;
    if (!t || !playable(t)) return;
    if (active && soundOn) void autoplay(t, musicKey);
    // Sortie de l'écran (et pas seulement passée à sa propre fiche ouverte) : sa musique s'arrête.
    else if (!soundOn || activePostId() !== post.id) stopIf(musicKey);
  }, [active, soundOn, post.music, musicKey]);
  const spark = async () => {
    if (post.mine) return;
    // Réponse immédiate à l'écran, corrigée par le serveur ensuite.
    const optimistic = { ...post, sparked: !post.sparked, sparks: post.sparks + (post.sparked ? -1 : 1) };
    onChange(optimistic);
    if (!post.sparked) {
      setBurst((n) => n + 1);
      try {
        navigator.vibrate?.([8, 40, 14]);
      } catch {
        // pas de vibration sur iPhone
      }
    }
    try {
      onChange((await club.spark(post.id)).post);
    } catch (e) {
      onChange(post);
      toast(errorText(e), true);
    }
  };
  const remove = async () => {
    if (!(await ask(tr('Supprimer cette publication ? Les photos et les commentaires partent avec.'), tr('Supprimer'), true))) return;
    try {
      await club.remove(post.id);
      onRemoved?.();
      toast(tr('Publication supprimée'));
    } catch (e) {
      toast(errorText(e), true);
    }
  };
  return (
    <article className="card post" ref={box}>
      <header className="post-head">
        <button className="post-author" onClick={onAuthor} aria-label={tr('Voir le profil de {authorName}', { authorName: post.authorName })}>
          <MemberAvatar m={author} />
          <span style={{ minWidth: 0 }}>
            <b className="post-name">
              <span className="ellipsis">{post.authorName}</span>
              <Nulos until={post.authorNulos} />
            </b>
            <span className="small muted">
              {ago(post.at)}
              {post.visibility !== 'all' && (
                <>
                  {' '}
                  <Icon name={VIS[post.visibility].icon} size={12} /> {lower(VIS[post.visibility].label)}
                </>
              )}
            </span>
          </span>
        </button>
        {post.mine && (
          <>
            <button className="icon-btn" onClick={() => setEditing(true)} aria-label={tr('Modifier la publication')}>
              <Icon name="pencil" size={18} />
            </button>
            <button className="icon-btn" onClick={remove} aria-label={tr('Supprimer la publication')}>
              <Icon name="trash" size={18} />
            </button>
          </>
        )}
      </header>

      {post.session && <SummaryCard s={post.session} />}
      {post.text && (
        <p className="post-text">
          <MentionText text={post.text} mentions={post.mentions} />
          {post.editedAt && <Edited at={post.editedAt} />}
        </p>
      )}
      {!post.text && post.editedAt && (
        <p className="post-text">
          <Edited at={post.editedAt} />
        </p>
      )}
      <PostMedia post={post} slot={slot} onPhoto={setPhoto} />
      {post.music && <MusicBar t={post.music} playKey={musicKey} />}

      <footer className="post-actions">
        <button
          className={`post-action spark-btn ${post.sparked ? 'on' : ''}`}
          onClick={spark}
          disabled={post.mine}
          aria-pressed={post.sparked}
          aria-label={post.mine ? tr('{sparks} étincelles reçues', { sparks: post.sparks }) : post.sparked ? tr('Reprendre ton étincelle') : tr('Envoyer une étincelle')}
        >
          <span className="spark-icon" key={burst}>
            <Icon name="spark" size={20} filled={post.sparked} />
            {burst > 0 && post.sparked && <SparkBurst />}
          </span>
          <RollingNumber value={post.sparks} />
          <span className="small">{tn(post.sparks, 'étincelle', 'étincelles')}</span>
        </button>
        <button className="post-action" onClick={onOpen} disabled={detail} aria-label={tr('Commentaires')}>
          <Icon name="chat" size={19} />
          <RollingNumber value={post.comments} />
          <span className="small">{tn(post.comments, 'commentaire', 'commentaires')}</span>
        </button>
      </footer>

      {editing && <EditPostSheet post={post} members={members} onClose={() => setEditing(false)} onSaved={onChange} />}
      {photo !== null && (
        <Sheet title={tr('Photo {n} sur {length}', { n: photo + 1, length: post.photos.length })} onClose={() => setPhoto(null)}>
          <Lightbox ids={post.photos} index={photo} onIndex={setPhoto} />
        </Sheet>
      )}
    </article>
  );
}

/** La petite mention après un texte réécrit, avec l'heure de la modification au survol. */
function Edited({ at }: { at: number }) {
  return (
    <span className="post-edited" title={tr('Modifié {ago}', { ago: ago(at) })}>
      {' '}{tr('(modifié)')}
    </span>
  );
}

/** Petites étincelles qui jaillissent autour du bouton. */
function SparkBurst() {
  return (
    <span className="spark-burst" aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} style={{ '--a': `${i * 40 + (i % 2) * 12}deg`, '--d': `${18 + (i % 3) * 7}px` } as CSSProperties} />
      ))}
    </span>
  );
}

function Lightbox({ ids, index, onIndex }: { ids: string[]; index: number; onIndex: (i: number) => void }) {
  const url = useImage(photoPath(ids[index]));
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="lightbox">{url ? <img src={url} alt="" /> : <span className="sk-block" />}</div>
      {ids.length > 1 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button className="btn small" disabled={index === 0} onClick={() => onIndex(index - 1)}>
            {tr('Précédente')}
          </button>
          <button className="btn small" disabled={index === ids.length - 1} onClick={() => onIndex(index + 1)}>
            {tr('Suivante')}
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- Saisie avec @mentions ---------- */

function MentionInput({
  value,
  onChange,
  mentions,
  onMentions,
  members,
  placeholder,
  rows = 3,
  autoFocus,
  grow,
}: {
  value: string;
  onChange: (v: string) => void;
  mentions: Mention[];
  onMentions: (m: Mention[]) => void;
  members: Member[];
  placeholder: string;
  rows?: number;
  autoFocus?: boolean;
  /** Hauteur qui suit le texte (une ligne au départ, quatre au plus). */
  grow?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!grow || !el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 132)}px`;
  }, [value, grow]);
  const [caret, setCaret] = useState(0);
  const q = mentionQuery(value, caret);
  const options = q ? matchMembers(members, q.query) : [];
  const pick = (m: Member) => {
    if (!q) return;
    const before = value.slice(0, q.start);
    const after = value.slice(caret);
    const text = `${before}@${m.name} ${after.replace(/^\s+/, '')}`;
    onChange(text);
    onMentions([...mentions.filter((x) => x.id !== m.id), { id: m.id, name: m.name }]);
    const pos = before.length + m.name.length + 2;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };
  return (
    <div className="mention-input">
      <textarea
        ref={ref}
        className={`input${grow ? ' grow' : ''}`}
        rows={rows}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        maxLength={1000}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
        }}
        onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
      />
      {options.length > 0 && (
        <div className="mention-list" role="listbox" aria-label={tr('Identifier un membre')}>
          {options.map((m) => (
            <button key={m.id} type="button" role="option" aria-selected="false" className="mention-option" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(m)}>
              <MemberAvatar m={m} size={26} />
              {m.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Publier ---------- */

function Composer({ date, members, onClose, onPosted }: { date: string; members: Member[]; onClose: () => void; onPosted: (p: ClubPost) => void }) {
  const s = useApp();
  const days = shareableDays(s);
  const [picked, setPicked] = useState<string | null>(days.find((d) => d.date === date)?.date ?? days[0]?.date ?? null);
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<Visibility>('all');
  const [busy, setBusy] = useState(false);
  const [music, setMusic] = useState<Track | null>(null);
  const [picking, setPicking] = useState(false);
  const [video, setVideo] = useState<PickedVideo | null>(null);
  const [videoSound, setVideoSound] = useState(true);
  const [prep, setPrep] = useState<number | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const videoFile = useRef<HTMLInputElement>(null);
  const summary = days.find((d) => d.date === picked)?.summary;

  // La vidéo choisie reste en mémoire le temps de la publication seulement.
  useEffect(
    () => () => {
      if (video) URL.revokeObjectURL(video.url);
    },
    [video],
  );

  const addVideo = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const v = await pickVideo(f);
      setPhotos([]);
      setVideo(v);
      // Avec une musique, c'est elle qu'on entend : le son de la vidéo part coupé (réglable).
      setVideoSound(!music);
    } catch (err) {
      toast(errorText(err), true);
    }
  };

  const add = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])].slice(0, 4 - photos.length);
    e.target.value = '';
    for (const f of files) {
      try {
        const img = await prepareImage(f, 1440, 0.82);
        setPhotos((p) => [...p, `data:image/jpeg;base64,${img.base64}`].slice(0, 4));
      } catch {
        toast(tr('Cette photo n’a pas pu être lue'), true);
      }
    }
  };

  const publish = async () => {
    if (!summary && !text.trim() && !photos.length && !video && !music) return toast(tr('Ajoute une séance, un texte, une photo ou une vidéo'), true);
    // La vidéo se prépare tout de suite, dans le geste : sinon l'iPhone coupe son son pendant la compression.
    const preparing = video ? prepareVideo(video, videoSound, setPrep) : null;
    setBusy(true);
    if (preparing) setPrep(0);
    try {
      let clip: NewPost['video'];
      if (preparing) {
        const v = await preparing;
        setPrep(1);
        const { id } = await club.uploadVideo(v.blob, v.type);
        clip = { id, poster: v.poster, w: v.w, h: v.h, dur: v.dur, sound: v.sound };
      }
      const { post } = await club.create({
        text: text.trim(),
        mentions: keptMentions(text, mentions),
        session: summary,
        photos,
        visibility,
        ...(clip ? { video: clip } : {}),
        ...(music ? { music } : {}),
      });
      stopMusic();
      onPosted(post);
      if (visibility === 'private') toast(tr('Gardé pour toi'));
      else {
        const tagged = keptMentions(text, mentions).map((m) => m.name);
        moment('post', tr('Publié dans le club'), tagged.length ? tn(tagged.length, '{join} va le voir.', '{join} vont le voir.', { join: tagged.join(', ') }) : tr('Les étincelles vont pleuvoir.'));
      }
      onClose();
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(false);
      setPrep(null);
    }
  };

  return (
    <Sheet title={tr('Partager une séance')} onClose={onClose}>
      <div className="stack" style={{ gap: 16 }}>
        {days.length > 0 ? (
          <>
            <div className="chips day-chips" role="group" aria-label={tr('Séance')}>
              {days.map((d) => (
                <button key={d.date} type="button" className={`chip ${picked === d.date ? 'on' : ''}`} onClick={() => setPicked(d.date)}>
                  {d.date === dayKey() ? tr('Aujourd’hui') : formatShort(d.date)}, {d.summary.title}
                </button>
              ))}
              <button type="button" className={`chip ${picked === null ? 'on' : ''}`} onClick={() => setPicked(null)}>
                {tr('Sans séance')}
              </button>
            </div>
            {summary && <SummaryCard s={summary} compact />}
          </>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            {tr('Pas de séance notée ces 7 derniers jours : tu peux quand même publier un mot, une photo ou une vidéo.')}
          </p>
        )}

        <MentionInput value={text} onChange={setText} mentions={mentions} onMentions={setMentions} members={members} placeholder={tr('Raconte ta séance. Tape @ pour identifier un membre.')} rows={4} />

        {video && (
          <div className="compose-video">
            <video src={video.url} muted autoPlay loop playsInline poster={video.poster} />
            <span className="video-badge small">{fmtDur(Math.min(video.dur, VIDEO_SECONDS))}</span>
            <button className="icon-btn" onClick={() => setVideo(null)} aria-label={tr('Retirer la vidéo')}>
              <Icon name="x" size={16} />
            </button>
          </div>
        )}
        {video && (
          <div className="stack" style={{ gap: 6 }}>
            <button type="button" className={`chip sound-chip ${videoSound ? 'on' : ''}`} onClick={() => setVideoSound((v) => !v)} aria-pressed={videoSound}>
              <Icon name={videoSound ? 'sound' : 'mute'} size={15} /> {videoSound ? tr('Son de la vidéo gardé') : tr('Son de la vidéo coupé')}
            </button>
            <p className="small faint" style={{ margin: 0 }}>
              {video.dur > VIDEO_SECONDS + 0.5 ? tr('Seules les 15 premières secondes seront gardées. ') : ''}
              {music && videoSound ? tr('La musique et le son de la vidéo se joueront ensemble.') : music ? tr('On entendra ta musique.') : ''}
            </p>
          </div>
        )}

        <div className="compose-photos">
          {photos.map((p, i) => (
            <div key={i} className="compose-photo">
              <img src={p} alt="" />
              <button className="icon-btn" onClick={() => setPhotos((l) => l.filter((_, j) => j !== i))} aria-label={tr('Retirer la photo')}>
                <Icon name="x" size={16} />
              </button>
            </div>
          ))}
          {photos.length < 4 && !video && (
            <button className="compose-add" onClick={() => file.current?.click()}>
              <Icon name="camera" size={22} />
              <span className="small">{tr('Photo')}</span>
            </button>
          )}
          <input ref={file} type="file" accept="image/*" multiple hidden onChange={add} />
          {!video && !photos.length && (
            <button className="compose-add" onClick={() => videoFile.current?.click()}>
              <Icon name="video" size={22} />
              <span className="small">{tr('Vidéo')}</span>
            </button>
          )}
          <input ref={videoFile} type="file" accept="video/mp4,video/quicktime,video/webm,video/*" hidden onChange={addVideo} />
          {!music && (
            <button className="compose-add" onClick={() => setPicking(true)}>
              <Icon name="music" size={22} />
              <span className="small">{tr('Musique')}</span>
            </button>
          )}
        </div>
        {music && <MusicBar t={music} playKey={`compose:${music.id}`} onRemove={() => setMusic(null)} />}
        {picking && (
          <MusicPicker
            onClose={() => {
              stopMusic();
              setPicking(false);
            }}
            onPick={(t) => {
              stopMusic();
              setMusic(t);
              setPicking(false);
              if (video) setVideoSound(false);
            }}
          />
        )}

        <div className="seg" role="group" aria-label={tr('Qui peut voir')}>
          {(Object.keys(VIS) as Visibility[]).map((v) => (
            <button key={v} type="button" className={visibility === v ? 'on' : ''} onClick={() => setVisibility(v)}>
              <Icon name={VIS[v].icon} size={14} /> {VIS[v].label}
            </button>
          ))}
        </div>
        {summary && s.days[summary.date]?.activities?.some((a) => a.source === 'strava') && (
          <p className="small faint" style={{ margin: 0 }}>
            {tr('Les chiffres de Strava ne sont pas partagés (règle de Strava) : la publication montre ce que tu as noté dans Shred.')}
          </p>
        )}

        <button className="btn primary block" disabled={busy} onClick={publish}>
          {prep !== null && prep < 1
            ? tr('Préparation de la vidéo… {n} %', { n: Math.round(prep * 100) })
            : prep === 1
              ? tr('Envoi de la vidéo…')
              : busy
                ? tr('Publication…')
                : visibility === 'private'
                  ? tr('Garder pour moi')
                  : tr('Publier')}
        </button>
      </div>
    </Sheet>
  );
}

/* ---------- Détail et commentaires ---------- */

function PostSheet({ id, members, onClose, onChange }: { id: string; members: Member[]; onClose: () => void; onChange: (p: ClubPost) => void }) {
  const [data, setData] = useState<{ post: ClubPost; comments: ClubComment[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [busy, setBusy] = useState(false);
  const memberOf = (uid: string, name: string) => members.find((m) => m.id === uid) ?? { id: uid, name, avatar: null };

  useEffect(() => {
    club.post(id).then(setData, (e) => setError(errorText(e)));
  }, [id]);

  const change = (p: ClubPost) => {
    setData((d) => d && { ...d, post: p });
    onChange(p);
  };

  const send = async () => {
    if (!text.trim() || !data) return;
    setBusy(true);
    try {
      const r = await club.comment(id, text.trim(), keptMentions(text, mentions));
      setData({ post: r.post, comments: [...data.comments, r.comment] });
      onChange(r.post);
      setText('');
      setMentions([]);
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: ClubComment) => {
    if (!(await ask(tr('Supprimer ce commentaire ?'), tr('Supprimer'), true))) return;
    try {
      const r = await club.uncomment(id, c.id);
      setData((d) => d && { post: r.post, comments: d.comments.filter((x) => x.id !== c.id) });
      onChange(r.post);
    } catch (e) {
      toast(errorText(e), true);
    }
  };

  return (
    <Sheet
      title={tr('Publication')}
      onClose={onClose}
      footer={
        data && (
          <div className="comment-box">
            <MentionInput value={text} onChange={setText} mentions={mentions} onMentions={setMentions} members={members} placeholder={tr('Écris un commentaire, @ pour identifier')} rows={1} grow />
            <button className="btn primary comment-send" disabled={busy || !text.trim()} onClick={send} aria-label={tr('Envoyer le commentaire')}>
              <Icon name="send" size={18} />
            </button>
          </div>
        )
      }
    >
      {error && <p className="muted">{error}</p>}
      {!data && !error && <div className="spinner" />}
      {data && (
        <div className="stack" style={{ gap: 16 }}>
          <PostCard post={data.post} author={memberOf(data.post.author, data.post.authorName)} members={members} onChange={change} detail onRemoved={onClose} />
          <section className="stack comments" style={{ gap: 12 }}>
            {data.comments.length === 0 && <p className="small muted" style={{ margin: 0 }}>{tr('Pas encore de commentaire. Lance la discussion.')}</p>}
            {data.comments.map((c) => (
              <div key={c.id} className="comment">
                <MemberAvatar m={memberOf(c.author, c.authorName)} size={30} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small">
                    <b>{c.authorName}</b> <span className="faint">{ago(c.at)}</span>
                  </div>
                  <div className="comment-text">
                    <MentionText text={c.text} mentions={c.mentions} />
                  </div>
                </div>
                {(c.mine || data.post.mine) && (
                  <button className="icon-btn" onClick={() => remove(c)} aria-label={tr('Supprimer le commentaire')}>
                    <Icon name="trash" size={16} />
                  </button>
                )}
              </div>
            ))}
          </section>
        </div>
      )}
    </Sheet>
  );
}

/* ---------- Membres ---------- */

function FollowButton({ m, onChange }: { m: Member; onChange: (m: Member) => void }) {
  const [busy, setBusy] = useState(false);
  if (m.me) return <span className="tag">{tr('Toi')}</span>;
  const label = m.following ? tr('Abonné') : m.requested ? tr('Demandé') : m.private ? tr('Demander') : tr('Suivre');
  return (
    <button
      className={`btn small ${m.following || m.requested ? '' : 'primary'}`}
      disabled={busy}
      aria-label={m.following ? tr('Ne plus suivre {name}', { name: m.name }) : m.requested ? tr('Annuler la demande à {name}', { name: m.name }) : `${label} ${m.name}`}
      onClick={async (e) => {
        e.stopPropagation();
        if (m.following && m.private && !(await ask(tr('Ne plus suivre {name} ? Son compte est privé : il faudra refaire une demande.', { name: m.name }), tr('Ne plus suivre')))) return;
        setBusy(true);
        try {
          const r = await club.follow(m.id);
          onChange({ ...m, following: r.following, requested: Boolean(r.requested), followers: m.followers + (r.following ? 1 : m.following ? -1 : 0) });
          if (r.requested) toast(tr('Demande envoyée à {name}', { name: m.name }));
        } catch (err) {
          toast(errorText(err), true);
        } finally {
          setBusy(false);
        }
      }}
    >
      {m.private && !m.following && !m.requested && <Icon name="lock" size={14} />} {label}
    </button>
  );
}

function MemberRow({ m, onOpen, onChange }: { m: Member; onOpen: (m: Member) => void; onChange: (m: Member) => void }) {
  return (
    <div className="row member-row" role="button" tabIndex={0} onClick={() => onOpen(m)} onKeyDown={(e) => e.key === 'Enter' && onOpen(m)}>
      <MemberAvatar m={m} size={44} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="title member-title">
          <span className="ellipsis">{m.name}</span> {m.private && <Icon name="lock" size={13} />}
          <Nulos until={m.nulos} />
        </div>
        {m.handle && (
          <div className="small ellipsis">
            <span className="member-handle">@{m.handle}</span>
            {m.nick && <span className="member-nick muted">, {m.nick}</span>}
          </div>
        )}
        <div className="small muted">
          {m.followsMe && !m.me ? tr('Te suit, ') : ''}
          {tn(m.posts, '{n} publication', '{n} publications')}, {tn(m.followers, '{n} abonné', '{n} abonnés')}
        </div>
      </div>
      <FollowButton m={m} onChange={onChange} />
    </div>
  );
}

/** Demandes d'abonnement reçues (compte privé) : accepter ou refuser. */
function RequestRow({ m, onDone }: { m: Member; onDone: (accepted: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const answer = async (accept: boolean) => {
    setBusy(true);
    try {
      await club.answer(m.id, accept);
      toast(accept ? tr('{name} te suit maintenant', { name: m.name }) : tr('Demande refusée'));
      onDone(accept);
    } catch (e) {
      toast(errorText(e), true);
      setBusy(false);
    }
  };
  return (
    <div className="row member-row">
      <MemberAvatar m={m} size={44} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="title">{m.name}</div>
        {m.handle && <div className="small member-handle ellipsis">@{m.handle}</div>}
      </div>
      <div className="request-actions">
        <button className="btn small primary" disabled={busy} onClick={() => answer(true)}>
          {tr('Accepter')}
        </button>
        <button className="btn small" disabled={busy} onClick={() => answer(false)} aria-label={tr('Refuser la demande de {name}', { name: m.name })}>
          <Icon name="x" size={15} />
        </button>
      </div>
    </div>
  );
}

function MemberList({ members, onOpen, onChange, onAnswered }: { members: Member[]; onOpen: (m: Member) => void; onChange: (l: Member[]) => void; onAnswered: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Member[] | null>(null);
  const [requests, setRequests] = useState<Member[]>([]);
  const query = q.trim().replace(/^@+/, '').toLowerCase();

  useEffect(() => {
    club.requests().then((r) => setRequests(r.members), () => undefined);
  }, []);

  // Recherche par pseudo sur le serveur, après une courte pause dans la frappe.
  useEffect(() => {
    if (query.length < 2) return setResults(null);
    let live = true;
    const t = setTimeout(() => {
      club.search(query).then(
        (r) => live && setResults(r.members),
        (e) => live && (toast(errorText(e), true), setResults([])),
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  const change = (x: Member) => {
    onChange(members.some((y) => y.id === x.id) ? members.map((y) => (y.id === x.id ? x : y)) : [...members, x]);
    setResults((l) => l?.map((y) => (y.id === x.id ? x : y)) ?? null);
  };
  const me = members.find((m) => m.me);
  const following = members.filter((m) => !m.me && (m.following || m.requested));
  const followers = members.filter((m) => !m.me && m.followsMe && !m.following && !m.requested);

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="member-search">
        <Icon name="at" size={17} />
        <input
          className="input"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tr('Chercher un @pseudo')}
          aria-label={tr('Chercher un membre par son pseudo')}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      {results ? (
        results.length ? (
          <div className="group">
            {results.map((m) => (
              <MemberRow key={m.id} m={m} onOpen={onOpen} onChange={change} />
            ))}
          </div>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            {tr('Aucun membre avec un pseudo proche de « {query} ».', { query })}
          </p>
        )
      ) : (
        <>
          {query.length === 1 && <p className="small muted" style={{ margin: 0 }}>{tr('Encore un caractère pour chercher.')}</p>}
          {requests.length > 0 && (
            <section className="stack" style={{ gap: 8 }}>
              <h2 style={{ fontSize: '1rem' }}>{tr('Demandes d’abonnement')}</h2>
              <div className="group">
                {requests.map((m) => (
                  <RequestRow
                    key={m.id}
                    m={m}
                    onDone={() => {
                      setRequests((l) => l.filter((x) => x.id !== m.id));
                      onAnswered();
                    }}
                  />
                ))}
              </div>
            </section>
          )}
          {me && (
            <div className="group">
              <MemberRow m={me} onOpen={onOpen} onChange={change} />
            </div>
          )}
          {following.length > 0 && (
            <section className="stack" style={{ gap: 8 }}>
              <h2 style={{ fontSize: '1rem' }}>{tr('Tes abonnements')}</h2>
              <div className="group">
                {following.map((m) => (
                  <MemberRow key={m.id} m={m} onOpen={onOpen} onChange={change} />
                ))}
              </div>
            </section>
          )}
          {followers.length > 0 && (
            <section className="stack" style={{ gap: 8 }}>
              <h2 style={{ fontSize: '1rem' }}>{tr('Ils te suivent')}</h2>
              <div className="group">
                {followers.map((m) => (
                  <MemberRow key={m.id} m={m} onOpen={onOpen} onChange={change} />
                ))}
              </div>
            </section>
          )}
          {!following.length && !followers.length && (
            <p className="small muted" style={{ margin: 0 }}>
              {tr('La liste des membres n’est pas publique : cherche tes amis par leur @pseudo, ou partage le tien depuis ton profil.')}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function MemberSheet({ m: initial, onClose, onChange, onEdit }: { m: Member; onClose: () => void; onChange: (m: Member) => void; onEdit: () => void }) {
  const [m, setM] = useState(initial);
  const [posts, setPosts] = useState<ClubPost[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  // Compte privé que je ne suis pas : ni séances ni fiche de force, seulement le profil.
  const locked = Boolean(m.private && !m.me && !m.following);
  useEffect(() => {
    if (locked) return setPosts([]);
    club.feed(`user:${m.id}`).then((f) => setPosts(f.posts), () => setPosts([]));
  }, [m.id, locked]);
  const update = (x: Member) => {
    setM(x);
    onChange(x);
  };
  const stats = [
    [m.posts, tn(m.posts, 'publication', 'publications')],
    [m.followers, tn(m.followers, 'abonné', 'abonnés')],
    ...(m.followingCount !== undefined ? [[m.followingCount, tn(m.followingCount, 'abonnement', 'abonnements')]] : []),
    [m.sparks, tn(m.sparks, 'étincelle', 'étincelles')],
    ...(m.followingCount === undefined && m.profile?.streak !== undefined ? [[m.profile.streak, tr('série')]] : []),
  ] as [number, string][];
  const [crop, setCrop] = useState<File | null>(null);
  const [challenge, setChallenge] = useState(false);
  const avatar = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) setCrop(f);
  };
  const upload = async (dataUrl: string) => {
    try {
      const r = await club.avatar(dataUrl);
      update({ ...m, avatar: r.avatar });
      setMe({ id: m.id, avatar: r.avatar });
      setCrop(null);
      toast(tr('Photo de profil mise à jour'));
    } catch (err) {
      toast(errorText(err), true);
    }
  };
  return (
    <Sheet title={m.me ? tr('Mon profil') : m.name} onClose={onClose}>
      <div className="stack" style={{ gap: 18 }}>
        <div className="member-head">
          <button className="member-photo" onClick={() => m.me && file.current?.click()} disabled={!m.me} aria-label={m.me ? tr('Changer ma photo de profil') : undefined}>
            <MemberAvatar m={m} size={72} />
            {m.me && (
              <span className="member-photo-edit">
                <Icon name="camera" size={14} />
              </span>
            )}
          </button>
          <input ref={file} type="file" accept="image/*" hidden onChange={avatar} />
          {crop && <AvatarCrop file={crop} onCancel={() => setCrop(null)} onDone={upload} />}
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="member-sheet-name">
              {m.name} {m.private && <Icon name="lock" size={16} />}
              <Nulos until={m.nulos} />
            </div>
            {m.handle && (
              <div className="small ellipsis">
                <span className="member-handle">@{m.handle}</span>
                {m.nick && <span className="member-nick muted">, {m.nick}</span>}
              </div>
            )}
            {m.profile?.program && <div className="small muted ellipsis">{m.profile.program}</div>}
          </div>
          {m.me ? (
            <button className="btn small" onClick={onEdit}>
              {tr('Modifier')}
            </button>
          ) : (
            <FollowButton m={m} onChange={update} />
          )}
        </div>
        {m.bio && <p className="member-bio small">{m.bio}</p>}
        {!m.me && m.followsMe && (
          <div className="follows-me small">
            <span className="muted">{tr('Te suit')}</span>
            <button
              className="link small"
              onClick={async () => {
                if (!(await ask(tr('Retirer {name} de tes abonnés ? Ça ne lui est pas notifié.', { name: m.name }), tr('Retirer')))) return;
                try {
                  await club.removeFollower(m.id);
                  update({ ...m, followsMe: false });
                  toast(tr('{name} ne te suit plus', { name: m.name }));
                } catch (e) {
                  toast(errorText(e), true);
                }
              }}
            >
              {tr('Retirer cet abonné')}
            </button>
          </div>
        )}
        {locked && (
          <div className="card private-card">
            <Icon name="lock" size={22} />
            <div>
              <div style={{ fontWeight: 800 }}>{tr('Compte privé')}</div>
              <p className="small muted" style={{ margin: 0 }}>
                {m.requested ? tr('Demande envoyée : tu verras ses séances quand {name} l’aura acceptée.', { name: m.name }) : tr('Abonne-toi pour voir ses séances. {name} devra accepter ta demande.', { name: m.name })}
              </p>
            </div>
          </div>
        )}
        {!m.me && !locked && (
          <button className="btn block" onClick={() => setChallenge(true)}>
            <Icon name="bolt" size={17} />{' '}{tr('Défier {name}', { name: m.name })}
          </button>
        )}
        {challenge && <ChallengeSheet m={m} onClose={() => setChallenge(false)} />}
        <div className="member-stats" style={{ gridTemplateColumns: `repeat(${stats.length}, 1fr)` } as CSSProperties}>
          {stats.map(([v, label]) => (
            <div key={label}>
              <b className="display num">
                <RollingNumber value={v} />
              </b>
              <span className="small muted">{label}</span>
            </div>
          ))}
        </div>
        {m.record && (m.record.won > 0 || m.record.lost > 0) && (
          <p className="small muted member-record">
            <Icon name="bolt" size={14} />{' '}{tn(m.record.won, 'Défis : {n} relevé', 'Défis : {n} relevés')}, {tn(m.record.lost, '{n} raté', '{n} ratés')}
          </p>
        )}
        {!locked && m.profile?.radar && m.profile.radar.some((r) => r.score !== null) && (
          <section className="card" style={{ padding: '8px 8px 4px' }}>
            <Radar groups={m.profile.radar.map((r) => ({ ...r, grade: r.grade as GroupScore['grade'], lifts: [] }))} />
          </section>
        )}
        <section className="stack" style={{ gap: 12 }}>
          {!posts && <div className="spinner" />}
          {posts?.length === 0 && !locked && <p className="small muted" style={{ margin: 0 }}>{tr('Aucune publication visible pour l’instant.')}</p>}
          {posts?.map((p) => (
            <PostCard key={p.id} post={p} author={m} onChange={(x) => setPosts((l) => l?.map((y) => (y.id === x.id ? x : y)) ?? null)} onOpen={() => setOpen(p.id)} onRemoved={() => setPosts((l) => l?.filter((x) => x.id !== p.id) ?? null)} />
          ))}
        </section>
      </div>
      {open && <PostSheet id={open} members={[m]} onClose={() => setOpen(null)} onChange={(x) => setPosts((l) => l?.map((y) => (y.id === x.id ? x : y)) ?? null)} />}
    </Sheet>
  );
}

/* ---------- Notifications ---------- */

const NOTICE_TEXT: Record<Notice['type'], (n: Notice) => string> = {
  mention: (n) => tr('{actorName} t’a identifié{v}', { actorName: n.actorName, v: n.text ? tr(' : « {text} »', { text: n.text.slice(0, 70) }) : '' }),
  comment: (n) => tr('{actorName} a commenté ta séance{v}', { actorName: n.actorName, v: n.text ? tr(' : « {text} »', { text: n.text.slice(0, 70) }) : '' }),
  spark: (n) => tr('{actorName} t’a envoyé une étincelle pour {v} (+5 XP)', { actorName: n.actorName, v: n.text ? tr('« {text} »', { text: n.text.slice(0, 50) }) : tr('ta séance') }),
  follow: (n) => tr('{actorName} s’est abonné à tes séances', { actorName: n.actorName }),
  request: (n) => tr('{actorName} demande à suivre tes séances', { actorName: n.actorName }),
  accepted: (n) => tr('{actorName} a accepté ta demande : tu vois ses séances', { actorName: n.actorName }),
  challenge: (n) => tr('{actorName} te lance un défi{v}', { actorName: n.actorName, v: n.text ? tr(' : « {text} »', { text: n.text.slice(0, 70) }) : tr(' : une séance avant la fin du délai') }),
  challengeDone: (n) => tr('{actorName} a relevé ton défi{v}', { actorName: n.actorName, v: n.text ? tr(' « {text} »', { text: n.text.slice(0, 50) }) : '' }),
  challengeFailed: (n) => tr('Défi de {actorName} raté : bonnet de Nulos pour 24 h{v}', { actorName: n.actorName, v: n.text ? tr('. Gage : « {text} »', { text: n.text.slice(0, 60) }) : '' }),
  challengeExpired: (n) => tr('{actorName} n’a pas relevé ton défi : ta mise te revient', { actorName: n.actorName }),
  gageDone: (n) => tr('{actorName} a fait son gage{v}', { actorName: n.actorName, v: n.text ? tr(' : « {text} »', { text: n.text.slice(0, 60) }) : '' }),
  rematch: (n) => tr('{actorName} prend sa revanche : une séance avant la fin du délai', { actorName: n.actorName }),
};

function NoticeAnswer({ n, onAnswered }: { n: Notice; onAnswered: (n: Notice) => void }) {
  const [busy, setBusy] = useState(false);
  const answer = async (accept: boolean) => {
    setBusy(true);
    try {
      await club.answer(n.actor, accept);
      toast(accept ? tr('{actorName} te suit maintenant', { actorName: n.actorName }) : tr('Demande refusée'));
      onAnswered(n);
    } catch (e) {
      toast(errorText(e), true);
      setBusy(false);
    }
  };
  return (
    <div className="request-actions">
      <button className="btn small primary" disabled={busy} onClick={() => answer(true)}>
        {tr('Accepter')}
      </button>
      <button className="btn small" disabled={busy} onClick={() => answer(false)} aria-label={tr('Refuser la demande de {actorName}', { actorName: n.actorName })}>
        <Icon name="x" size={15} />
      </button>
    </div>
  );
}

const NOTICE_ICON: Record<Notice['type'], string> = {
  spark: 'spark',
  follow: 'plus',
  request: 'lock',
  accepted: 'check',
  mention: 'at',
  challenge: 'bolt',
  challengeDone: 'bolt',
  challengeFailed: 'dunce',
  challengeExpired: 'plate',
  gageDone: 'check',
  rematch: 'bolt',
  comment: 'chat',
};

function NoticesSheet({
  notices,
  members,
  onClose,
  onOpen,
  onAnswered,
}: {
  notices: Notice[];
  members: Member[];
  onClose: () => void;
  onOpen: (n: Notice) => void;
  onAnswered: (n: Notice) => void;
}) {
  // Les demandes d'abonnement passent en tête : elles attendent une réponse.
  const sorted = [...notices].sort((a, b) => Number(b.type === 'request') - Number(a.type === 'request') || b.at - a.at);
  return (
    <Sheet title={tr('Notifications')} onClose={onClose}>
      {notices.length === 0 ? (
        <p className="muted">{tr('Rien pour l’instant. Abonnements, demandes, étincelles, commentaires et mentions arrivent ici.')}</p>
      ) : (
        <div className="group">
          {sorted.map((n) => (
            <div key={n.id} className="row settings-row notice-row">
              <button className="notice-main" onClick={() => onOpen(n)}>
                <span className="notice-avatar">
                  <MemberAvatar m={members.find((m) => m.id === n.actor) ?? { id: n.actor, name: n.actorName, avatar: null }} size={38} />
                  <span className={`notice-kind ${n.type}`}>
                    <Icon name={NOTICE_ICON[n.type]} size={11} filled={n.type === 'spark'} />
                  </span>
                </span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small">{NOTICE_TEXT[n.type](n)}</div>
                  <div className="small faint">{ago(n.at)}</div>
                </div>
              </button>
              {n.type === 'request' && <NoticeAnswer n={n} onAnswered={onAnswered} />}
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

/* ---------- Défis ---------- */

const GAGES = [tr('50 burpees filmés'), tr('Payer le café'), tr('2 min de gainage en vidéo'), tr('Selfie en sueur au club')];

/** Les disques : le solde en haut du club, et les règles en un coup d'œil. */
function PlatesButton() {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!wallet) void loadChallenges().catch(() => undefined);
  }, [wallet]);
  return (
    <>
      <button className="plates-pill" onClick={() => setOpen(true)} aria-label={tr('Disques : {n}', { n: wallet?.plates ?? tr('chargement') })}>
        <Icon name="plate" size={17} />
        <span className="num">{wallet ? <RollingNumber value={wallet.plates} /> : '–'}</span>
      </button>
      {open && <PlatesSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function PlatesSheet({ onClose }: { onClose: () => void }) {
  const s = useApp();
  const wallet = useWallet();
  const streak = flameInfo(s, dayKey()).current;
  const next = nextBonus(streak);
  const full = wallet ? wallet.plates >= wallet.cap : false;
  return (
    <Sheet title={tr('Disques')} onClose={onClose}>
      <div className="stack plates-sheet" style={{ gap: 18 }}>
        <div className="plates-total">
          <Icon name="plate" size={30} />
          <b className="display num">{wallet?.plates ?? '–'}</b>
          <span className="small muted">{full ? tr('plein : lance des défis') : tr('sur {cap} au plus', { cap: PLATES.cap })}</span>
        </div>
        <dl className="plates-rules">
          <dt>{tr('Gagner')}</dt>
          <dd>
            {tr('+1 par journée validée, et un bonus à chaque palier de série. Prochain : {days} jours, +{plates}', { days: next.days, plates: next.plates })}
            {next.days > streak ? tn(next.days - streak, ', dans {n} jour', ', dans {n} jours') : ''}.
          </dd>
          <dt>{tr('Miser')}</dt>
          <dd>
            {tr('Un défi coûte {challenge} disque, {stakeOf} avec un gage. Relevé dans les temps : ta mise est pour la personne défiée. Raté : elle te revient.', { challenge: PLATES.challenge, stakeOf: stakeOf(true) })}
          </dd>
          <dt>{tr('Rater')}</dt>
          <dd>
            {tr('Le bonnet de Nulos s’affiche à côté de ton nom pendant {NULOS_HOURS} h, ou jusqu’à ce que tu fasses ton gage. Tu as droit à une revanche gratuite.', { NULOS_HOURS })}
          </dd>
        </dl>
      </div>
    </Sheet>
  );
}

function ChallengeSheet({ m, rematch, onClose }: { m: Pick<Member, 'id' | 'name'>; rematch?: Challenge; onClose: () => void }) {
  const wallet = useWallet();
  const [hours, setHours] = useState(48);
  const [text, setText] = useState('');
  const [withGage, setWithGage] = useState(false);
  const [gage, setGage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!wallet) void loadChallenges().catch(() => undefined);
  }, [wallet]);
  const stake = stakeOf(withGage && Boolean(gage.trim()), Boolean(rematch));
  const short = wallet !== null && wallet.plates < stake;
  const send = async () => {
    setBusy(true);
    try {
      const r = await club.challenge(m.id, hours, text.trim(), rematch ? { rematch: rematch.id } : withGage && gage.trim() ? { gage: gage.trim() } : {});
      setWallet(r.wallet);
      toast(rematch ? tr('Revanche lancée contre {name}', { name: m.name }) : tr('Défi envoyé à {name}', { name: m.name }));
      window.dispatchEvent(new Event('shred:challenges'));
      onClose();
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={rematch ? tr('Revanche contre {name}', { name: m.name }) : tr('Défier {name}', { name: m.name })} onClose={onClose}>
      <div className="stack" style={{ gap: 16 }}>
        <p className="small muted" style={{ margin: 0 }}>
          {rematch
            ? tr('Gratuite. {name} doit valider une séance avant la fin du délai, sinon c’est à son tour de porter le bonnet de Nulos.', { name: m.name })
            : tr('{name} doit valider une séance avant la fin du délai. Relevé : ta mise est pour {name}, avec +{CHALLENGE_XP} XP. Raté : ta mise te revient et {name} porte le bonnet de Nulos {NULOS_HOURS} h.', { name: m.name, CHALLENGE_XP, NULOS_HOURS })}
        </p>
        <Field label={tr('Délai')}>
          <div className="chips" role="group" aria-label={tr('Délai')}>
            {CHALLENGE_DELAYS.map((d) => (
              <button key={d.hours} type="button" className={`chip ${hours === d.hours ? 'on' : ''}`} onClick={() => setHours(d.hours)}>
                {d.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label={tr('Un mot (facultatif)')}>
          <input className="input" value={text} maxLength={140} placeholder={tr('Jambes avant jeudi ?')} onChange={(e) => setText(e.target.value)} />
        </Field>
        {!rematch && (
          <div className="stack" style={{ gap: 10 }}>
            <div className="group">
              <Toggle title={tr('Ajouter un gage')} text={tr('+{gage} disques. À faire s’il rate, le bonnet tombe une fois fait.', { gage: PLATES.gage })} on={withGage} onChange={setWithGage} />
            </div>
            {withGage && (
              <>
                <input className="input" value={gage} maxLength={GAGE_MAX} placeholder={tr('Le gage')} aria-label={tr('Le gage')} onChange={(e) => setGage(e.target.value)} />
                <div className="chips" role="group" aria-label={tr('Idées de gage')}>
                  {GAGES.map((g) => (
                    <button key={g} type="button" className={`chip ${gage === g ? 'on' : ''}`} onClick={() => setGage(g)}>
                      {g}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <div className={`stake-line ${short ? 'short' : ''}`}>
          <Icon name="plate" size={18} />
          <span className="grow">{rematch ? tr('Revanche gratuite') : tn(stake, 'Mise : {n} disque', 'Mise : {n} disques')}</span>
          {wallet && <span className="small muted num">{tr('tu en as {plates}', { plates: wallet.plates })}</span>}
        </div>
        <button className="btn primary block" disabled={busy || short || (withGage && !gage.trim())} onClick={send}>
          <Icon name="bolt" size={18} /> {rematch ? tr('Lancer la revanche') : short ? tr('Pas assez de disques') : tr('Lancer le défi')}
        </button>
        {short && (
          <p className="small muted" style={{ margin: '-6px 0 0' }}>
            {tr('Valide tes journées : +1 disque par jour, un bonus à chaque palier de série.')}
          </p>
        )}
      </div>
    </Sheet>
  );
}

const RECENT = 24 * 3600_000;

/** En haut du fil : les défis en cours, relevés ou ratés ces dernières 24 h, avec le gage et la revanche. */
/** Les défis en cours ou tout juste finis, chargés avec le fil par l'écran du club. */
function ChallengeStrip({ state, me, onUpdate }: { state: ChallengeState | null; me: string | null; onUpdate: () => void }) {
  const [rematch, setRematch] = useState<Challenge | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const now = Date.now();
  const shown = (state?.challenges ?? [])
    .filter(
      (c) =>
        (c.status === 'open' && now <= c.due + GRACE_MS) ||
        (c.status === 'done' && (c.doneAt ?? 0) > now - RECENT) ||
        (c.status === 'failed' && (c.failedAt ?? c.due) > now - RECENT),
    )
    .slice(0, 4);
  if (!me || !shown.length) return null;
  const gageDone = async (c: Challenge) => {
    setBusy(c.id);
    try {
      await club.gageDone(c.id);
      toast(tr('Gage fait : le bonnet tombe'));
      window.dispatchEvent(new Event('shred:challenges'));
      onUpdate();
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="challenges" aria-label={tr('Défis')}>
      {shown.map((c) => {
        const received = c.to === me;
        const other = received ? c.fromName : c.toName;
        const stake = c.stake ?? 0;
        const plates = stake ? tn(stake, '{n} disque', '{n} disques') : '';
        let title: string;
        let sub: string;
        if (c.status === 'open') {
          title = received ? (c.rematch ? tr('{other} prend sa revanche', { other }) : tr('{other} te défie', { other })) : c.rematch ? tr('Revanche contre {other}', { other }) : tr('Défi envoyé à {other}', { other });
          sub = c.text ? tr('« {text} »', { text: c.text }) : tr('Une séance avant la fin du délai');
        } else if (c.status === 'done') {
          title = received ? tr('Défi de {other} relevé', { other }) : tr('{other} a relevé ton défi', { other });
          sub = plates ? (received ? tr('+{plates} pour toi', { plates }) : tr('Ta mise de {plates} est pour {other}', { plates, other })) : tr('Séance validée dans les temps');
        } else {
          title = received ? tr('Défi de {other} raté', { other }) : tr('{other} n’a pas relevé ton défi', { other });
          const until = (c.failedAt ?? c.due) + NULOS_HOURS * 3600_000;
          sub = received
            ? c.gageDone
              ? tr('Gage fait, le bonnet est tombé')
              : tr('Bonnet de Nulos {until}', { until: untilText(until) })
            : plates
              ? tr('Ta mise de {plates} te revient', { plates })
              : tr('Pas de séance dans les temps');
        }
        const revenge = canRematch(c, me, now);
        const owesGage = received && c.status === 'failed' && c.gage && !c.gageDone;
        return (
          <div key={c.id} className={`challenge ${received ? 'in' : 'out'} ${c.status}`}>
            <span className="challenge-icon">
              <Icon name={c.status === 'done' ? 'check' : c.status === 'failed' ? (received ? 'dunce' : 'plate') : 'bolt'} size={16} />
            </span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="small challenge-head">
                <b className="ellipsis">{title}</b>
                {c.status === 'open' && <span className="faint">{timeLeft(c.due, now)}</span>}
              </div>
              <div className="small muted ellipsis">{sub}</div>
              {c.gage && (c.status === 'open' || c.status === 'failed') && (
                <div className="small challenge-gage">
                  {c.status === 'open' ? (received ? tr('Gage si tu rates : ') : tr('Gage : ')) : received ? tr('Ton gage : ') : tr('Son gage : ')}
                  <b>{c.gage}</b>
                  {c.gageDone ? tr(', fait') : ''}
                </div>
              )}
              {c.status === 'open' && plates && <div className="small faint">{tr('Mise : {plates}', { plates })}</div>}
              {(owesGage || revenge) && (
                <div className="challenge-actions">
                  {owesGage && (
                    <button className="btn small" disabled={busy === c.id} onClick={() => gageDone(c)}>
                      <Icon name="check" size={15} />{' '}{tr('Gage fait')}
                    </button>
                  )}
                  {revenge && (
                    <button className="btn small primary" onClick={() => setRematch(c)}>
                      <Icon name="bolt" size={15} />{' '}{tr('Revanche')}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {rematch && <ChallengeSheet m={{ id: rematch.from, name: rematch.fromName }} rematch={rematch} onClose={() => setRematch(null)} />}
    </section>
  );
}
