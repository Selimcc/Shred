// Pulse, la mascotte de Shred : un petit disque de musculation avec une tête. Sa couleur suit tes flammes
// gagnées, ses yeux suivent ta journée. Aux fêtes, Pulse se déguise : citrouille à Halloween, bonnet à Noël,
// chapeau pointu au Nouvel an, yeux en cœur à la Saint-Valentin, oreilles de lapin à Pâques. Personnage original.
//
// Dessiné à plat, en calques SVG superposés (même viewBox) : le disque et son costume, puis les yeux. Ce qui
// bouge (respiration, clignement, saut) anime un calque entier en transform, sans rien redessiner.
import { type ReactNode, useId } from 'react';
import { TIERS } from '../lib/flames';
import { SEASON_LIGHT, type SeasonId, useSeason } from '../lib/season';

export type Mood = 'happy' | 'proud' | 'cheer' | 'sleepy' | 'sad' | 'think';

/** Les yeux clignent (gélules ouvertes) ; contents ou endormis, ils restent tels quels. */
const blinks = (mood: Mood) => mood !== 'proud' && mood !== 'cheer' && mood !== 'sleepy';

/** L'encre des yeux : sombre sur un disque clair. */
const EYE = '#1a1512';

function Eyes({ mood }: { mood: Mood }) {
  if (mood === 'proud' || mood === 'cheer')
    return (
      <g fill="none" stroke={EYE} strokeWidth="4" strokeLinecap="round">
        <path d="M44 58q5-6.5 10 0" />
        <path d="M66 58q5-6.5 10 0" />
      </g>
    );
  if (mood === 'sleepy')
    return (
      <g fill="none" stroke={EYE} strokeWidth="3.6" strokeLinecap="round" opacity="0.8">
        <path d="M44 57q5 3.5 10 0" />
        <path d="M66 57q5 3.5 10 0" />
      </g>
    );
  const dx = mood === 'think' ? 4 : 0;
  const dy = mood === 'think' ? -4 : mood === 'sad' ? 4 : 0;
  const h = mood === 'sad' ? 9 : 14;
  return (
    <g fill={EYE}>
      <rect x={45.5 + dx} y={49 + dy + (14 - h) / 2} width="8" height={h} rx="4" />
      <rect x={66.5 + dx} y={49 + dy + (14 - h) / 2} width="8" height={h} rx="4" />
    </g>
  );
}

/** Les yeux en cœur de la Saint-Valentin. */
const heart = (cx: number, cy: number, r: number) =>
  `M${cx} ${cy + r * 0.9}C${cx - r * 1.25} ${cy + r * 0.05} ${cx - r * 1.05} ${cy - r * 1.05} ${cx} ${cy - r * 0.42}C${cx + r * 1.05} ${cy - r * 1.05} ${cx + r * 1.25} ${cy + r * 0.05} ${cx} ${cy + r * 0.9}Z`;

/** Citrouille d'Halloween : écorce orange à côtes, yeux et bouche taillés où la lumière passe. */
function Pumpkin({ mood }: { mood: Mood }) {
  const sleepy = mood === 'sleepy';
  const sad = mood === 'sad';
  return (
    <g>
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

function SeasonOver({ season }: { season: SeasonId }) {
  if (season === 'noel')
    return (
      <g className="pulse-hat" transform="rotate(-9 60 30)">
        <path d="M33 29C35 13 50 3 67 4c13 1 24 8 30 19l-6 3c-4-6-10-10-16-11 4 4 6 9 6 14z" fill="#d23a2e" />
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
        <path d="M48 25 61 2l13 23c-8 3-18 3-26 0Z" fill="#f2bd2c" />
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
  const [outer, mid] = (season && SEASON_LIGHT[season]) || TIERS[Math.min(tier, TIERS.length - 1)].colors;
  const pumpkin = season === 'halloween';
  const loveEyes = season === 'saint-valentin' && mood !== 'sleepy' && mood !== 'sad';
  const dim = mood === 'sad' || mood === 'sleepy';
  const u = (k: string) => `url(#${id}${k})`;
  const VB = '0 0 120 120';
  // Le disque : la couleur vive de la flamme, son bord et sa collerette un ton plus sombre.
  const plate = pumpkin ? '#e8701a' : mid;
  const edge = pumpkin ? '#9a3a08' : outer;
  return (
    <div className={`pulse mood-${mood} ${season ? `pulse-${season}` : ''} ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg className="pulse-l" viewBox={VB}>
        <defs>
          <clipPath id={`${id}clip`}>
            <circle cx="60" cy="58" r="40" />
          </clipPath>
        </defs>
        <ellipse cx="60" cy="106" rx="20" ry="3" fill="#000" opacity="0.35" />
      </svg>

      <div className="pulse-body" style={{ filter: dim ? 'saturate(0.45) brightness(0.85)' : undefined }}>
        {season === 'paques' && (
          <svg className="pulse-l pulse-ears" viewBox={VB}>
            <Ears />
          </svg>
        )}
        <svg className="pulse-l" viewBox={VB}>
          <circle cx="60" cy="58" r="40" fill={plate} />
          {pumpkin ? (
            <g clipPath={u('clip')} fill="none" stroke="#5a1f03" strokeOpacity="0.42" strokeWidth="1.6">
              <ellipse cx="60" cy="58" rx="13" ry="40" />
              <ellipse cx="60" cy="58" rx="27" ry="40" />
              <path d="M60 18v80" />
            </g>
          ) : (
            <>
              {/* Le bord du disque et sa collerette : ce qui en fait un disque, pas une balle. */}
              <circle cx="60" cy="58" r="37.5" fill="none" stroke={edge} strokeWidth="5" />
              <circle cx="60" cy="58" r="27" fill="none" stroke={edge} strokeOpacity="0.45" strokeWidth="2" />
              <circle cx="60" cy="58" r="40" fill="none" stroke="#1a1512" strokeOpacity="0.35" strokeWidth="1" />
            </>
          )}
          {pumpkin && (
            <>
              <path d="M57 20c-1-6 1-10 5-13l4 2.5c-3 2-4 5-3.5 10.5z" fill="#4d6b24" />
              <path d="M64 10c4-3 9-2 11 1" fill="none" stroke="#6f9632" strokeWidth="1.6" strokeLinecap="round" />
            </>
          )}
          {season && <SeasonOver season={season} />}
        </svg>
        {pumpkin ? (
          <svg className="pulse-l pulse-carve" viewBox={VB}>
            <Pumpkin mood={mood} />
          </svg>
        ) : (
          <svg className={`pulse-l pulse-eyes${!loveEyes && blinks(mood) ? ' blink' : ''}`} viewBox={VB}>
            {loveEyes ? (
              <g fill="#7a0d2e">
                <path d={heart(50, 55, 7)} />
                <path d={heart(70, 55, 7)} />
              </g>
            ) : (
              <Eyes mood={mood} />
            )}
          </svg>
        )}
        {season === 'saint-valentin' && (
          <svg className="pulse-l pulse-heart" viewBox={VB}>
            <path d={heart(99, 20, 7)} fill="#e8384f" stroke="#ffd1dc" strokeWidth="1" />
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
