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

function RoundButton({ playing, progress = 0, label, onClick }: { playing: boolean; progress?: number; label: string; onClick: () => void }) {
  const r = 21;
  const c = 2 * Math.PI * r;
  return (
    <button type="button" className={`music-play ${playing ? 'on' : ''}`} onClick={onClick} aria-label={label} aria-pressed={playing}>
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
  const { playing, progress } = usePlayer(playKey);
  if (!playable(t)) return null;
  return <RoundButton playing={playing} progress={progress} label={playing ? 'Pause' : `Écouter ${t.title}`} onClick={() => toggle(t, playKey)} />;
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

/** Lecteur de SoundCloud (morceau entier), chargé seulement quand on le demande. */
function SoundCloudPlayer({ t }: { t: Track }) {
  const src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(t.link)}&color=%23ffb547&auto_play=true&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=false`;
  return <iframe className="sc-player" title={`${t.title} sur SoundCloud`} src={src} allow="autoplay; encrypted-media" loading="lazy" />;
}

/** Dans une publication. */
export function MusicBar({ t, playKey, onRemove }: { t: Track; playKey: string; onRemove?: () => void }) {
  const [sc, setSc] = useState(false);
  const source = t.source ?? 'apple';
  const { playing } = usePlayer(playKey);
  return (
    <div className="music-wrap">
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
