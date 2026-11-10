// Braise, la mascotte de Shred : une petite flamme vivante. Elle EST ta série : sa couleur suit tes flammes
// gagnées, elle grandit avec les jours, et son humeur suit ta journée. Personnage original.
import { useId } from 'react';
import { TIERS } from '../lib/flames';

export type Mood = 'happy' | 'proud' | 'cheer' | 'sleepy' | 'sad' | 'think';

const BODY =
  'M60 6C70 26 98 42 98 82C98 112 80 132 60 132C40 132 22 114 22 86C22 66 32 54 40 44C42 56 47 63 53 65C49 46 51 26 60 6Z';
const BELLY = 'M60 70C72 80 82 90 82 104C82 118 72 126 60 126C48 126 38 118 38 105C38 92 50 84 60 70Z';

export function Braise({
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
  return (
    <div className={`braise mood-${mood} ${className}`} style={{ width: size, height: size * 1.15 }}>
      <svg viewBox="0 0 120 138" width="100%" height="100%" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}b`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor={outer} />
            <stop offset="1" stopColor={mid} />
          </linearGradient>
          <radialGradient id={`${id}g`} cx="50%" cy="70%" r="55%">
            <stop offset="0" stopColor={mid} stopOpacity="0.45" />
            <stop offset="1" stopColor={mid} stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse className="braise-glow" cx="60" cy="96" rx="58" ry="42" fill={`url(#${id}g)`} />
        <ellipse cx="60" cy="134" rx="26" ry="4" fill="#000" opacity="0.12" />
        <g className="braise-body" style={{ filter: dim ? 'saturate(0.55)' : undefined }}>
          <path d={BODY} fill={`url(#${id}b)`} />
          <path d={BELLY} fill={core} opacity="0.9" />
          {/* Bras */}
          <g className="braise-arm-l">
            <path d="M28 92Q14 86 12 72" fill="none" stroke={outer} strokeWidth="7" strokeLinecap="round" />
          </g>
          <g className="braise-arm-r">
            <path d="M92 92Q106 86 108 72" fill="none" stroke={outer} strokeWidth="7" strokeLinecap="round" />
          </g>
          {/* Visage */}
          <g className="braise-face">
            {mood === 'sleepy' ? (
              <>
                <path d="M42 86q6 4 12 0" stroke="#3a1a08" strokeWidth="3.5" fill="none" strokeLinecap="round" />
                <path d="M66 86q6 4 12 0" stroke="#3a1a08" strokeWidth="3.5" fill="none" strokeLinecap="round" />
              </>
            ) : mood === 'proud' || mood === 'cheer' ? (
              <>
                <path d="M41 88q7 -8 14 0" stroke="#3a1a08" strokeWidth="4" fill="none" strokeLinecap="round" />
                <path d="M65 88q7 -8 14 0" stroke="#3a1a08" strokeWidth="4" fill="none" strokeLinecap="round" />
              </>
            ) : (
              <g className="braise-eyes">
                <ellipse cx="48" cy="86" rx="6.5" ry="8" fill="#fff" />
                <ellipse cx="72" cy="86" rx="6.5" ry="8" fill="#fff" />
                <circle cx={mood === 'think' ? 50 : 49} cy={mood === 'think' ? 83 : 88} r="4" fill="#2a1206" />
                <circle cx={mood === 'think' ? 74 : 73} cy={mood === 'think' ? 83 : 88} r="4" fill="#2a1206" />
                <circle cx="50.5" cy="85.5" r="1.4" fill="#fff" />
                <circle cx="74.5" cy="85.5" r="1.4" fill="#fff" />
              </g>
            )}
            <circle cx="38" cy="98" r="5" fill="#ff5d7a" opacity="0.4" />
            <circle cx="82" cy="98" r="5" fill="#ff5d7a" opacity="0.4" />
            {mood === 'sad' ? (
              <path d="M52 106q8 -6 16 0" stroke="#3a1a08" strokeWidth="3.5" fill="none" strokeLinecap="round" />
            ) : mood === 'sleepy' ? (
              <ellipse cx="60" cy="104" rx="4" ry="3" fill="#3a1a08" />
            ) : mood === 'think' ? (
              <path d="M54 104h12" stroke="#3a1a08" strokeWidth="3.5" strokeLinecap="round" />
            ) : (
              <path d="M50 100q10 12 20 0Z" fill="#3a1a08" stroke="#3a1a08" strokeWidth="2" strokeLinejoin="round" />
            )}
            {mood === 'sad' && <path className="braise-tear" d="M41 94q-3 6 0 8q3 -2 0 -8Z" fill="#7fd3ff" />}
          </g>
        </g>
        {mood === 'sleepy' && (
          <text className="braise-z" x="96" y="40" fontSize="16" fontWeight="900" fill="#8a93ab">
            z
          </text>
        )}
      </svg>
    </div>
  );
}

/** Bulle de dialogue de Braise. */
export function Bubble({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`braise-bubble ${className}`}>{children}</div>;
}
