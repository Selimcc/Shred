// Musique d'une publication : la barre de lecture (pochette, titre, bouton lecture avec anneau d'avancement)
// et le choix d'un morceau dans le composeur.
import { useEffect, useRef, useState } from 'react';
import { errorText, Sheet } from './ui';
import { Icon } from './Icon';
import { isSoundCloud, liveProgress, playable, searchMusic, seek, soundcloudTrack, SOURCE_NAME, stopIf, stopMusic, toggle, type Track, usePlayer, warm } from '../lib/music';

function Artwork({ t, size }: { t: Track; size: number }) {
  return t.artwork ? (
    <img className="music-art" src={t.artwork} alt="" width={size} height={size} loading="lazy" />
  ) : (
    <span className="music-art music-art-empty" style={{ width: size, height: size }}>
      <Icon name="music" size={size * 0.45} />
    </span>
  );
}

/** Triangle et barres dessinés à la main : centrés à l'œil (le triangle est décalé vers la droite). */
function Glyph({ playing }: { playing: boolean }) {
  return (
    <svg className="music-glyph" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      {playing ? (
        <>
          <rect x="6" y="5" width="4.2" height="14" rx="1.4" />
          <rect x="13.8" y="5" width="4.2" height="14" rx="1.4" />
        </>
      ) : (
        <path d="M8.5 5.6v12.8a1.2 1.2 0 0 0 1.8 1l10.1-6.4a1.2 1.2 0 0 0 0-2L10.3 4.6a1.2 1.2 0 0 0-1.8 1Z" />
      )}
    </svg>
  );
}

function RoundButton({
  playing,
  loading = false,
  progress = 0,
  label,
  onClick,
  onPress,
}: {
  playing: boolean;
  loading?: boolean;
  progress?: number;
  label: string;
  onClick: () => void;
  onPress?: () => void;
}) {
  const r = 21;
  const c = 2 * Math.PI * r;
  return (
    <button
      type="button"
      className={`music-play ${playing ? 'on' : ''} ${loading ? 'loading' : ''}`}
      onClick={onClick}
      onPointerDown={onPress}
      onPointerEnter={onPress}
      aria-label={label}
      aria-pressed={playing}
      aria-busy={loading}
    >
      <svg className="music-ring" width="46" height="46" viewBox="0 0 46 46" aria-hidden="true">
        <circle cx="23" cy="23" r={r} className="music-ring-bg" />
        <circle cx="23" cy="23" r={r} className="music-ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - progress)} />
      </svg>
      <span className="music-disc">
        <Glyph playing={playing} />
      </span>
    </button>
  );
}

function PlayButton({ t, playKey }: { t: Track; playKey: string }) {
  const { playing, loading, progress } = usePlayer(playKey);
  if (!playable(t)) return null;
  return (
    <RoundButton
      playing={playing}
      loading={loading}
      progress={progress}
      label={playing ? 'Pause' : `Écouter ${t.title}`}
      onClick={() => toggle(t, playKey)}
      onPress={() => warm(t)}
    />
  );
}

/** Petit égaliseur qui danse pendant la lecture. */
function Eq({ on }: { on: boolean }) {
  return on ? (
    <span className="music-eq" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  ) : null;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Barre pour avancer ou reculer dans l'extrait, avec le temps écoulé et la durée. */
/**
 * Barre de lecture : un trait fin qui avance en continu (lu à chaque image, pas par à-coups), sans pastille au
 * repos. Le doigt posé, elle s'épaissit, la pastille apparaît et le temps suit le doigt ; relâché, on y saute.
 */
function Scrubber({ playKey, progress, duration, title }: { playKey: string; progress: number; duration: number; title: string }) {
  const track = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [shown, setShown] = useState(progress);
  const dragRef = useRef<number | null>(null);

  // Animation continue : la barre suit le son image par image.
  useEffect(() => {
    let raf = 0;
    let last = -1;
    const tick = () => {
      const r = dragRef.current ?? liveProgress(playKey) ?? 0;
      if (fill.current) fill.current.style.transform = `scaleX(${r})`;
      if (knob.current) knob.current.style.left = `${r * 100}%`;
      const sec = Math.floor(r * duration);
      if (sec !== last) {
        last = sec;
        setShown(r);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playKey, duration]);

  const ratioAt = (x: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (x - r.left) / r.width));
  };
  const move = (r: number) => {
    dragRef.current = r;
    setDrag(r);
  };
  const end = (commit: boolean) => {
    if (commit && dragRef.current !== null) seek(playKey, dragRef.current);
    dragRef.current = null;
    setDrag(null);
  };
  const r = drag ?? shown;

  return (
    <div className={`music-scrub ${drag !== null ? 'dragging' : ''}`}>
      <div
        ref={track}
        className="scrub-hit"
        role="slider"
        tabIndex={0}
        aria-label={`Position dans ${title}`}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(r * duration)}
        aria-valuetext={`${clock(r * duration)} sur ${clock(duration)}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          move(ratioAt(e.clientX));
        }}
        onPointerMove={(e) => dragRef.current !== null && move(ratioAt(e.clientX))}
        onPointerUp={() => end(true)}
        onPointerCancel={() => end(false)}
        onKeyDown={(e) => {
          const step = e.key === 'ArrowRight' ? 5 : e.key === 'ArrowLeft' ? -5 : 0;
          if (!step) return;
          e.preventDefault();
          seek(playKey, Math.max(0, Math.min(1, (liveProgress(playKey) ?? 0) + step / duration)));
        }}
      >
        <div className="scrub-track">
          <div ref={fill} className="scrub-fill" style={{ transform: `scaleX(${progress})` }} />
        </div>
        <div ref={knob} className="scrub-knob" style={{ left: `${progress * 100}%` }} />
      </div>
      <div className="scrub-times small num">
        <span>{clock(r * duration)}</span>
        <span>-{clock(Math.max(0, duration - r * duration))}</span>
      </div>
    </div>
  );
}

/** Lecteur de SoundCloud (morceau entier), chargé seulement quand on le demande. */
function SoundCloudPlayer({ t }: { t: Track }) {
  const src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(t.link)}&color=%23ffb547&auto_play=true&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=false`;
  return <iframe className="sc-player" title={`${t.title} sur SoundCloud`} src={src} allow="autoplay; encrypted-media" loading="lazy" />;
}

/** Dans une publication. */
export function MusicBar({ t, playKey, onRemove }: { t: Track; playKey: string; onRemove?: () => void }) {
  const [sc, setSc] = useState(false);
  const source = t.source ?? 'apple';
  const { playing, loading, progress, duration } = usePlayer(playKey);
  const box = useRef<HTMLDivElement>(null);
  // Publication visible : on prépare déjà l'adresse de l'extrait. Elle disparaît : sa musique s'arrête.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') return () => stopIf(playKey);
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && warm(t, 'url'), { rootMargin: '200px' });
    io.observe(el);
    return () => {
      io.disconnect();
      stopIf(playKey);
    };
  }, [t.id, playKey]);
  return (
    <div className="music-wrap" ref={box}>
      <div className="music-bar">
        <Artwork t={t} size={40} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="music-title small">
            <Eq on={playing || sc} />
            <span className="ellipsis">{t.title}</span>
          </div>
          <div className="small muted ellipsis">
            {t.artist}
            {!onRemove && (
              <>
                {', '}
                <a className="music-link" href={t.link} target="_blank" rel="noopener noreferrer" aria-label={`Ouvrir ${t.title} dans ${SOURCE_NAME[source]}`}>
                  {SOURCE_NAME[source]}
                </a>
              </>
            )}
          </div>
        </div>
        {source === 'soundcloud' ? (
          <RoundButton
            playing={sc}
            label={sc ? 'Fermer le lecteur SoundCloud' : `Écouter ${t.title} sur SoundCloud`}
            onClick={() => {
              stopMusic();
              setSc((v) => !v);
            }}
          />
        ) : (
          <PlayButton t={t} playKey={playKey} />
        )}
        {onRemove && (
          <button type="button" className="icon-btn" onClick={onRemove} aria-label="Retirer la musique">
            <Icon name="x" size={16} />
          </button>
        )}
      </div>
      {playing && !loading && <Scrubber playKey={playKey} progress={progress} duration={duration} title={t.title} />}
      {sc && <SoundCloudPlayer t={t} />}
    </div>
  );
}

/** Choisir un morceau : recherche au fil de la frappe, écoute avant de choisir. */
const searchCache = new Map<string, Track[]>();

/** Lignes fantômes pendant la recherche : la place des résultats est déjà là. */
function Ghosts({ n = 5 }: { n?: number }) {
  return (
    <div className="music-list" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="music-item ghost">
          <span className="music-art skeleton" style={{ width: 48, height: 48 }} />
          <div className="grow" style={{ display: 'grid', gap: 7 }}>
            <span className="skeleton line" style={{ width: `${62 - i * 7}%` }} />
            <span className="skeleton line short" style={{ width: `${38 + (i % 3) * 8}%` }} />
          </div>
          <span className="skeleton disc" />
        </div>
      ))}
    </div>
  );
}

/** Choisir un morceau : recherche au fil de la frappe, écoute avant de choisir. */
export function MusicPicker({ onPick, onClose }: { onPick: (t: Track) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<Track[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setList([]);
      setBusy(false);
      return;
    }
    const key = term.toLowerCase();
    const hit = searchCache.get(key);
    if (hit) {
      setList(hit);
      setBusy(false);
      setError(null);
      return;
    }
    setBusy(true);
    const id = ++seq.current;
    const t = setTimeout(() => {
      (isSoundCloud(term) ? soundcloudTrack(term).then((x) => [x]) : searchMusic(term)).then(
        (r) => {
          searchCache.set(key, r);
          if (id !== seq.current) return;
          setList(r);
          setError(null);
          setBusy(false);
          // Les trois premiers extraits se chargent déjà : un toucher et ça joue.
          r.slice(0, 3).forEach((x) => warm(x));
        },
        (e) => {
          if (id !== seq.current) return;
          setList([]);
          setError(errorText(e));
          setBusy(false);
        },
      );
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  const close = () => {
    stopMusic();
    onClose();
  };

  return (
    <Sheet title="Ajouter une musique" onClose={close}>
      <div className="stack" style={{ gap: 12 }}>
        <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Titre, artiste ou lien SoundCloud" aria-label="Chercher une musique" />
        {error && (
          <p className="small" style={{ margin: 0, color: 'var(--red)' }}>
            {error}
          </p>
        )}
        {busy && list.length === 0 && <Ghosts />}
        {!busy && q.trim().length >= 2 && list.length === 0 && !error && <p className="small muted">Rien trouvé pour « {q.trim()} ».</p>}
        {list.length > 0 && (
          <div className={`music-list ${busy ? 'stale' : ''}`}>
            {list.map((t) => (
              <div key={`${t.source}:${t.id}`} className="music-item">
                <button
                  type="button"
                  className="music-pick"
                  onClick={() => {
                    stopMusic();
                    onPick(t);
                  }}
                >
                  <Artwork t={t} size={48} />
                  <div className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
                    <div className="ellipsis" style={{ fontWeight: 700 }}>
                      {t.title}
                    </div>
                    <div className="small muted ellipsis">
                      {t.artist}
                      <span className="faint">, {SOURCE_NAME[t.source ?? 'apple']}</span>
                    </div>
                  </div>
                </button>
                <PlayButton t={t} playKey={`pick:${t.source}:${t.id}`} />
              </div>
            ))}
          </div>
        )}
        <p className="small faint" style={{ margin: 0 }}>
          Extraits de 30 secondes d’Apple Music et de Deezer. Pour un morceau entier, colle un lien SoundCloud.
        </p>
      </div>
    </Sheet>
  );
}
