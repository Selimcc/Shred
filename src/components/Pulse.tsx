// Pulse, la mascotte de Shred : une sphère de verre fumé avec une lumière vivante à l'intérieur.
// La lumière prend la couleur de tes flammes gagnées, les yeux lumineux suivent ta journée.
// Aux fêtes, Pulse se déguise : citrouille à Halloween, bonnet à Noël, chapeau pointu au Nouvel an,
// yeux en cœur à la Saint-Valentin, oreilles de lapin à Pâques. Personnage original.
//
// Dessiné en calques SVG superposés (même viewBox) : le verre, la lumière, le reflet et le costume, les yeux.
// Ce qui bouge en continu (respiration, halo, lumière, clignement) anime un calque entier en transform /
// opacity : le navigateur le déplace sans redessiner le verre et ses flous à chaque image.
import { type ReactNode, useId } from 'react';
import { TIERS } from '../lib/flames';
import { SEASON_LIGHT, type SeasonId, useSeason } from '../lib/season';

export type Mood = 'happy' | 'proud' | 'cheer' | 'sleepy' | 'sad' | 'think';

/** Les yeux clignent (gélules ouvertes) ; contents ou endormis, ils restent tels quels. */
const blinks = (mood: Mood) => mood !== 'proud' && mood !== 'cheer' && mood !== 'sleepy';

function Eyes({ mood, glow }: { mood: Mood; glow: string }) {
  const common = { filter: glow };
  if (mood === 'proud' || mood === 'cheer')
    return (
      <g fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" {...common}>
        <path d="M44 58q5-6.5 10 0" />
        <path d="M66 58q5-6.5 10 0" />
      </g>
    );
  if (mood === 'sleepy')
    return (
      <g fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" opacity="0.8" {...common}>
        <path d="M44 57q5 3.5 10 0" />
        <path d="M66 57q5 3.5 10 0" />
      </g>
    );
  const dx = mood === 'think' ? 4 : 0;
  const dy = mood === 'think' ? -4 : mood === 'sad' ? 4 : 0;
  const h = mood === 'sad' ? 9 : 14;
  return (
    <g fill="#fff" {...common}>
      <rect x={45.5 + dx} y={49 + dy + (14 - h) / 2} width="8" height={h} rx="4" />
      <rect x={66.5 + dx} y={49 + dy + (14 - h) / 2} width="8" height={h} rx="4" />
    </g>
  );
}

/** Les yeux en cœur de la Saint-Valentin. */
const heart = (cx: number, cy: number, r: number) =>
  `M${cx} ${cy + r * 0.9}C${cx - r * 1.25} ${cy + r * 0.05} ${cx - r * 1.05} ${cy - r * 1.05} ${cx} ${cy - r * 0.42}C${cx + r * 1.05} ${cy - r * 1.05} ${cx + r * 1.25} ${cy + r * 0.05} ${cx} ${cy + r * 0.9}Z`;

/** Citrouille d'Halloween : écorce orange à côtes, yeux et bouche taillés où la lumière passe. */
function Pumpkin({ mood, glow }: { mood: Mood; glow: string }) {
  const sleepy = mood === 'sleepy';
  const sad = mood === 'sad';
  return (
    <g filter={glow}>
      {sleepy ? (
        <g fill="none" stroke="#ffd27a" strokeWidth="3.6" strokeLinecap="round">
          <path d="M44 55h11M65 55h11" />
        </g>
      ) : (
        <g fill="#ffd27a">
          <path d={sad ? 'M43 52l12-4 0 9z' : 'M43 57l6.5-11 6.5 11z'} />
          <path d={sad ? 'M77 52l-12-4 0 9z' : 'M64 57l6.5-11 6.5 11z'} />
        </g>
      )}
      <path
        fill="#ffc14d"
        d={
          sad
            ? 'M44 76q16-9 32 0l-4 2-4-3-4 3-4-3-4 3-4-3-4 3z'
            : 'M39 65q21 22 42 0l-4.5 4-4-4.5-5 5.5-5.5-5 -5.5 5-5-5.5-4 4.5z'
        }
      />
    </g>
  );
}

function SeasonOver({ season, id }: { season: SeasonId; id: string }) {
  if (season === 'noel')
    return (
      <g className="pulse-hat" transform="rotate(-9 60 30)">
        <path d="M33 29C35 13 50 3 67 4c13 1 24 8 30 19l-6 3c-4-6-10-10-16-11 4 4 6 9 6 14z" fill={`url(#${id}red)`} />
        <path d="M70 16c5 1 11 4 16 9" stroke="#ffffff" strokeOpacity="0.18" strokeWidth="2" fill="none" strokeLinecap="round" />
        <rect x="29" y="24.5" width="62" height="11" rx="5.5" fill="#f4f7fa" />
        <rect x="29" y="31" width="62" height="4.5" rx="2.25" fill="#d5e3ec" />
        <circle cx="96" cy="25" r="6" fill="#f4f7fa" />
        <circle cx="94.5" cy="23.4" r="2.2" fill="#ffffff" />
      </g>
    );
  if (season === 'nouvel-an')
    return (
      <g className="pulse-hat" transform="rotate(14 62 24) translate(62 24) scale(1.35) translate(-62 -24)">
        <path d="M48 25 61 2l13 23c-8 3-18 3-26 0Z" fill={`url(#${id}gold)`} />
        <path d="M52.5 17.5 66 12M50.5 22 70 14.5M57 8.5l7-2.5" stroke="#7e5bff" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M61 -3l1.6 3.4 3.7.4-2.8 2.5.8 3.6L61 5.1 57.7 7l.8-3.6-2.8-2.5 3.7-.4Z" fill="#fff3c4" />
      </g>
    );
  return null;
}

/** Oreilles de lapin de Pâques, derrière la sphère. */
function Ears() {
  return (
    <g>
      <g transform="rotate(-16 45 26)">
        <ellipse cx="45" cy="13" rx="7.5" ry="16" fill="#eef1f4" />
        <ellipse cx="45" cy="14" rx="3.6" ry="11.5" fill="#ffb3c7" />
      </g>
      <g transform="rotate(16 75 26)">
        <ellipse cx="75" cy="13" rx="7.5" ry="16" fill="#eef1f4" />
        <ellipse cx="75" cy="14" rx="3.6" ry="11.5" fill="#ffb3c7" />
      </g>
    </g>
  );
}

export function Pulse({
  mood = 'happy',
  tier = 0,
  size = 120,
  className = '',
  season: forced,
}: {
  mood?: Mood;
  tier?: number;
  size?: number;
  className?: string;
  /** Un déguisement précis (aperçu dans les réglages) ; par défaut celui de la saison affichée. */
  season?: SeasonId | null;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const auto = useSeason();
  const season = forced === undefined ? auto : forced;
  const [outer, mid, core] = (season && SEASON_LIGHT[season]) || TIERS[Math.min(tier, TIERS.length - 1)].colors;
  const pumpkin = season === 'halloween';
  const loveEyes = season === 'saint-valentin' && mood !== 'sleepy' && mood !== 'sad';
  const dim = mood === 'sad' || mood === 'sleepy';
  const u = (k: string) => `url(#${id}${k})`;
  const VB = '0 0 120 120';
  return (
    <div className={`pulse mood-${mood} ${season ? `pulse-${season}` : ''} ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      {/* Halo qui respire, avec toutes les définitions partagées par les calques. */}
      <svg className="pulse-l pulse-halo" viewBox={VB}>
        <defs>
          {/* Verre fumé : clair en haut à gauche, sombre sur les bords. */}
          <radialGradient id={`${id}glass`} cx="38%" cy="30%" r="75%">
            <stop offset="0" stopColor="#3a3f48" />
            <stop offset="0.55" stopColor="#1b1e24" />
            <stop offset="1" stopColor="#0c0d10" />
          </radialGradient>
          {/* La lumière intérieure. */}
          <radialGradient id={`${id}core`} cx="50%" cy="55%" r="50%">
            <stop offset="0" stopColor={core} />
            <stop offset="0.45" stopColor={mid} />
            <stop offset="1" stopColor={outer} stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}halo`} cx="50%" cy="50%" r="50%">
            <stop offset="0.5" stopColor={mid} stopOpacity="0.35" />
            <stop offset="1" stopColor={mid} stopOpacity="0" />
          </radialGradient>
          {/* Écorce de citrouille. */}
          <radialGradient id={`${id}pumpkin`} cx="38%" cy="30%" r="78%">
            <stop offset="0" stopColor="#ff9d3f" />
            <stop offset="0.55" stopColor="#e2620c" />
            <stop offset="1" stopColor="#6e2604" />
          </radialGradient>
          <linearGradient id={`${id}red`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff4d5e" />
            <stop offset="1" stopColor="#b3122a" />
          </linearGradient>
          <linearGradient id={`${id}gold`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff0b3" />
            <stop offset="1" stopColor="#e0a92e" />
          </linearGradient>
          <linearGradient id={`${id}shine`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${id}rim`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.04" />
            <stop offset="1" stopColor={core} stopOpacity="0.75" />
          </linearGradient>
          <clipPath id={`${id}clip`}>
            <circle cx="60" cy="58" r="40" />
          </clipPath>
          <filter id={`${id}blur`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
          <filter id={`${id}glow`} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="1.6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id={`${id}shadow`} x="-50%" y="-200%" width="200%" height="500%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <circle cx="60" cy="58" r="58" fill={u('halo')} />
      </svg>
      <svg className="pulse-l" viewBox={VB}>
        <ellipse cx="60" cy="107" rx="22" ry="3.2" fill="#000" opacity="0.55" filter={u('shadow')} />
      </svg>

      <div className="pulse-body" style={{ filter: dim ? 'saturate(0.4) brightness(0.8)' : undefined }}>
        {season === 'paques' && (
          <svg className="pulse-l pulse-ears" viewBox={VB}>
            <Ears />
          </svg>
        )}
        <svg className="pulse-l" viewBox={VB}>
          <circle cx="60" cy="58" r="40" fill={u(pumpkin ? 'pumpkin' : 'glass')} />
          {pumpkin && (
            <g clipPath={u('clip')} fill="none" stroke="#5a1f03" strokeOpacity="0.42" strokeWidth="1.6">
              <ellipse cx="60" cy="58" rx="13" ry="40" />
              <ellipse cx="60" cy="58" rx="27" ry="40" />
              <path d="M60 18v80" />
            </g>
          )}
        </svg>
        {!pumpkin && (
          <svg className="pulse-l pulse-core" viewBox={VB}>
            <g clipPath={u('clip')}>
              <circle cx="60" cy="66" r="34" fill={u('core')} filter={u('blur')} opacity="0.95" />
            </g>
          </svg>
        )}
        <svg className="pulse-l" viewBox={VB}>
          <circle cx="60" cy="58" r="39.3" fill="none" stroke={u('rim')} strokeWidth="1.4" />
          {/* Reflet du verre, en croissant sur le haut. */}
          <path d="M31 47c4-14 16-23 29-23s25 9 29 23c-7-8-17-12-29-12s-22 4-29 12Z" fill={u('shine')} opacity={pumpkin ? 0.35 : 0.7} />
          {pumpkin && (
            <>
              <path d="M57 20c-1-6 1-10 5-13l4 2.5c-3 2-4 5-3.5 10.5z" fill="#4d6b24" />
              <path d="M64 10c4-3 9-2 11 1" fill="none" stroke="#6f9632" strokeWidth="1.6" strokeLinecap="round" />
            </>
          )}
          {season && <SeasonOver season={season} id={id} />}
        </svg>
        {pumpkin ? (
          <svg className="pulse-l pulse-carve" viewBox={VB}>
            <Pumpkin mood={mood} glow={u('glow')} />
          </svg>
        ) : (
          <svg className={`pulse-l pulse-eyes${!loveEyes && blinks(mood) ? ' blink' : ''}`} viewBox={VB}>
            {loveEyes ? (
              <g fill="#fff" filter={u('glow')}>
                <path d={heart(50, 55, 7)} />
                <path d={heart(70, 55, 7)} />
              </g>
            ) : (
              <Eyes mood={mood} glow={u('glow')} />
            )}
          </svg>
        )}
        {season === 'saint-valentin' && (
          <svg className="pulse-l pulse-heart" viewBox={VB}>
            <path d={heart(99, 20, 7)} fill="#ff4d7d" stroke="#ffc2d1" strokeWidth="1" />
          </svg>
        )}
      </div>

      {mood === 'sleepy' && (
        <svg className="pulse-l pulse-z" viewBox={VB}>
          <text x={season === 'noel' || season === 'nouvel-an' ? 14 : 94} y="28" fontSize="15" fontWeight="800" fill="var(--ink-3)">
            z
          </text>
        </svg>
      )}
    </div>
  );
}

/** Ce que dit Pulse : une ligne de texte, sans bulle ni encadré. */
export function Bubble({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`pulse-says ${className}`}>{children}</p>;
}
