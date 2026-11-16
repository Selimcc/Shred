// Musique d'une publication : la barre de lecture (pochette, titre, bouton lecture avec anneau d'avancement)
// et le choix d'un morceau dans le composeur.
import { useEffect, useState } from 'react';
import { errorText, Sheet } from './ui';
import { Icon } from './Icon';
import { isSoundCloud, playable, searchMusic, soundcloudTrack, SOURCE_NAME, stopMusic, toggle, type Track, usePlayer } from '../lib/music';

function Artwork({ t, size }: { t: Track; size: number }) {
  return t.artwork ? (
    <img className="music-art" src={t.artwork} alt="" width={size} height={size} loading="lazy" />
  ) : (
    <span className="music-art music-art-empty" style={{ width: size, height: size }}>
      <Icon name="music" size={size * 0.45} />
    </span>
  );
}

function PlayButton({ t, playKey }: { t: Track; playKey: string }) {
  const { playing, progress } = usePlayer(playKey);
  if (!playable(t)) return null;
  const r = 17;
  const c = 2 * Math.PI * r;
  return (
    <button type="button" className={`music-play ${playing ? 'on' : ''}`} onClick={() => toggle(t, playKey)} aria-label={playing ? 'Pause' : `Écouter ${t.title}`}>
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r={r} className="music-ring-bg" />
        <circle cx="20" cy="20" r={r} className="music-ring" strokeDasharray={c} strokeDashoffset={c * (1 - progress)} />
      </svg>
      <Icon name={playing ? 'pause' : 'play'} size={15} filled />
    </button>
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
  return (
    <div className="music-wrap">
      <div className="music-bar">
        <Artwork t={t} size={40} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="small ellipsis" style={{ fontWeight: 700 }}>
            {t.title}
          </div>
          <div className="small muted ellipsis">{t.artist}</div>
        </div>
        {source === 'soundcloud' ? (
          <button
            type="button"
            className={`music-play ${sc ? 'on' : ''}`}
            onClick={() => {
              stopMusic();
              setSc((v) => !v);
            }}
            aria-label={sc ? 'Fermer le lecteur SoundCloud' : `Écouter ${t.title} sur SoundCloud`}
          >
            <Icon name={sc ? 'x' : 'play'} size={15} filled={!sc} />
          </button>
        ) : (
          <PlayButton t={t} playKey={playKey} />
        )}
        {onRemove ? (
          <button type="button" className="icon-btn" onClick={onRemove} aria-label="Retirer la musique">
            <Icon name="x" size={16} />
          </button>
        ) : (
          <a className="music-link small" href={t.link} target="_blank" rel="noopener noreferrer" aria-label={`Ouvrir ${t.title} dans ${SOURCE_NAME[source]}`}>
            {SOURCE_NAME[source]}
          </a>
        )}
      </div>
      {sc && <SoundCloudPlayer t={t} />}
    </div>
  );
}

/** Choisir un morceau : recherche au fil de la frappe, écoute avant de choisir. */
export function MusicPicker({ onPick, onClose }: { onPick: (t: Track) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<Track[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setList([]);
    setBusy(true);
    const t = setTimeout(() => {
      (isSoundCloud(term) ? soundcloudTrack(term).then((x) => [x]) : searchMusic(term)).then(
        (r) => {
          setList(r);
          setError(null);
          setBusy(false);
        },
        (e) => {
          setList([]);
          setError(errorText(e));
          setBusy(false);
        },
      );
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <Sheet title="Ajouter une musique" onClose={onClose}>
      <div className="stack" style={{ gap: 12 }}>
        <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Titre, artiste ou lien SoundCloud" aria-label="Chercher une musique" />
        {error && (
          <p className="small" style={{ margin: 0, color: 'var(--red)' }}>
            {error}
          </p>
        )}
        {busy && list.length === 0 && <p className="small muted">Recherche…</p>}
        {!busy && q.trim().length >= 2 && list.length === 0 && !error && <p className="small muted">Rien trouvé pour « {q.trim()} ».</p>}
        <div className="music-list">
          {list.map((t) => (
            <div key={t.id} className="music-item">
              <button type="button" className="music-pick" onClick={() => onPick(t)}>
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
              <PlayButton t={t} playKey={`pick:${t.id}`} />
            </div>
          ))}
        </div>
        <p className="small faint" style={{ margin: 0 }}>
          Extraits de 30 secondes d’Apple Music et de Deezer. Pour un morceau entier, colle un lien SoundCloud.
        </p>
      </div>
    </Sheet>
  );
}
