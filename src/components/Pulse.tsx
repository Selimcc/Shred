// Pulse, la mascotte de Shred : une sphère de verre fumé avec une lumière vivante à l'intérieur.
// La lumière prend la couleur de tes flammes gagnées, les yeux lumineux suivent ta journée.
// Personnage original.
import { type ReactNode, useId } from 'react';
import { TIERS } from '../lib/flames';

export type Mood = 'happy' | 'proud' | 'cheer' | 'sleepy' | 'sad' | 'think';

function Eyes({ mood, glow }: { mood: Mood; glow: string }) {
  const common = { filter: glow };
  if (mood === 'proud' || mood === 'cheer')
    return (
      <g className="pulse-eyes" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" {...common}>
        <path d="M44 58q5-6.5 10 0" />
        <path d="M66 58q5-6.5 10 0" />
      </g>
    );
  if (mood === 'sleepy')
    return (
      <g className="pulse-eyes" fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" opacity="0.8" {...common}>
        <path d="M44 57q5 3.5 10 0" />
        <path d="M66 57q5 3.5 10 0" />
      </g>
    );
  const dx = mood === 'think' ? 4 : 0;
  const dy = mood === 'think' ? -4 : mood === 'sad' ? 4 : 0;
  const h = mood === 'sad' ? 9 : 14;
  return (
    <g className="pulse-eyes blink" fill="#fff" {...common}>
      <rect x={45.5 + dx} y={49 + dy + (14 - h) / 2} width="8" height={h} rx="4" />
      <rect x={66.5 + dx} y={49 + dy + (14 - h) / 2} width="8" height={h} rx="4" />
    </g>
  );
}

export function Pulse({
  mood = 'happy',
  tier = 0,
  size = 120,
  className = '',
}: {
  mood?: Mood;
  tier?: number;
  size?: number;
  className?: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [outer, mid, core] = TIERS[Math.min(tier, TIERS.length - 1)].colors;
  const dim = mood === 'sad' || mood === 'sleepy';
  const u = (k: string) => `url(#${id}${k})`;
  return (
    <div className={`pulse mood-${mood} ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 120 120" width="100%" height="100%">
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

        <circle className="pulse-halo" cx="60" cy="58" r="58" fill={u('halo')} />
        <ellipse cx="60" cy="107" rx="22" ry="3.2" fill="#000" opacity="0.55" filter={u('shadow')} />

        <g className="pulse-body" style={{ filter: dim ? 'saturate(0.4) brightness(0.8)' : undefined }}>
          <circle cx="60" cy="58" r="40" fill={u('glass')} />
          <g clipPath={u('clip')}>
            <circle className="pulse-core" cx="60" cy="66" r="34" fill={u('core')} filter={u('blur')} opacity="0.95" />
          </g>
          <circle cx="60" cy="58" r="39.3" fill="none" stroke={u('rim')} strokeWidth="1.4" />
          {/* Reflet du verre, en croissant sur le haut. */}
          <path d="M31 47c4-14 16-23 29-23s25 9 29 23c-7-8-17-12-29-12s-22 4-29 12Z" fill={u('shine')} opacity="0.7" />
          <Eyes mood={mood} glow={u('glow')} />
        </g>

        {mood === 'sleepy' && (
          <text className="pulse-z" x="94" y="28" fontSize="15" fontWeight="800" fill="var(--ink-3)">
            z
          </text>
        )}
      </svg>
    </div>
  );
}

/** Ce que dit Pulse : une ligne de texte, sans bulle ni encadré. */
export function Bubble({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`pulse-says ${className}`}>{children}</p>;
}
