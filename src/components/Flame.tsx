import { useId } from 'react';
import { TIERS } from '../lib/flames';

const OUTER =
  'M50 2C60 22 88 38 88 72C88 98 70 118 50 118C30 118 12 100 12 76C12 58 22 46 30 36C32 48 38 56 44 58C40 40 42 20 50 2Z';
const MID = 'M50 34C58 50 74 60 74 82C74 100 63 112 50 112C37 112 26 101 26 86C26 74 33 66 38 60C40 70 44 74 48 75C46 62 46 48 50 34Z';
const CORE = 'M50 66C56 76 64 82 64 94C64 104 58 110 50 110C42 110 36 104 36 95C36 86 44 80 50 66Z';

/** Flamme en trois couches qui vacillent chacune à leur rythme. Sa couleur suit les flammes gagnées. */
export function Flame({ tier = 0, size = 64, animated = true, className = '' }: { tier?: number; size?: number; animated?: boolean; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const t = TIERS[Math.min(tier, TIERS.length - 1)];
  const [outer, mid, core] = t.colors;
  const legend = tier >= TIERS.length - 1;
  return (
    <svg
      className={`flame-svg ${animated ? 'flame-live' : ''} ${legend ? 'flame-legend' : ''} ${className}`}
      width={size}
      height={size * 1.2}
      viewBox="0 0 100 120"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`${id}g`} cx="50%" cy="72%" r="50%">
          <stop offset="0" stopColor={mid} stopOpacity="0.6" />
          <stop offset="1" stopColor={mid} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}o`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={outer} />
          <stop offset="1" stopColor={mid} />
        </linearGradient>
        <linearGradient id={`${id}m`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={mid} />
          <stop offset="1" stopColor={core} />
        </linearGradient>
      </defs>
      <ellipse className="flame-glow" cx="50" cy="84" rx="50" ry="38" fill={`url(#${id}g)`} />
      <g className="flame-l1">
        <path d={OUTER} fill={`url(#${id}o)`} />
      </g>
      <g className="flame-l2">
        <path d={MID} fill={`url(#${id}m)`} />
      </g>
      <g className="flame-l3">
        <path d={CORE} fill={core} />
      </g>
    </svg>
  );
}
