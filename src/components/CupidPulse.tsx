// Cupidon façon Pulse : la même sphère de verre fumé, la lumière rose à l'intérieur en forme de cœur, les yeux
// lumineux (un œil se ferme pour viser), de vraies ailes à plumes, deux mains de verre qui tiennent un arc doré,
// et un carquois dans le dos. Il tire une flèche qui transperce un cœur, puis s'envole. Dessin original.
import type { ReactNode } from 'react';

export const HEART = 'M12 21s-8.5-5.4-10.6-10.3C-.1 5.8 3.5 1 7.8 1c2 0 3.4 1 4.2 2.4C12.8 2 14.2 1 16.2 1c4.3 0 7.9 4.8 6.4 9.7C20.5 15.6 12 21 12 21Z';

/** Une plume en amande, de la base (0, 0) vers la pointe (len, 0). */
const feather = (len: number, w: number) =>
  `M0 0C${len * 0.28} ${-w} ${len * 0.82} ${-w * 0.95} ${len} 0C${len * 0.84} ${w * 0.62} ${len * 0.3} ${w * 0.75} 0 0Z`;

/** Plumes : [base x, base y, angle, longueur, largeur]. L'aile part de l'épaule (0, 0) vers le haut à gauche. */
const PRIMARIES: [number, number, number, number, number][] = [
  [-24, -27, 158, 44, 7],
  [-29, -31, 170, 50, 7.5],
  [-34, -34, 182, 55, 7.5],
  [-39, -36, 194, 53, 7],
  [-43, -37, 206, 46, 6.5],
];
const SECONDARIES: [number, number, number, number, number][] = [
  [-4, -4, 128, 30, 7.5],
  [-9, -10, 136, 34, 7.5],
  [-14, -16, 144, 37, 7.5],
  [-19, -22, 152, 40, 7.5],
];
const COVERTS: [number, number, number][] = [
  [-6, -9, -38],
  [-12, -16, -42],
  [-18, -22, -40],
  [-24, -27, -30],
  [-31, -31, -18],
  [-38, -33, -8],
  [-10, -3, -48],
  [-17, -9, -46],
  [-24, -15, -40],
];

function Wing({ id }: { id: string }) {
  return (
    <g>
      {PRIMARIES.map(([x, y, a, l, w], i) => (
        <g key={`p${i}`} transform={`translate(${x} ${y}) rotate(${a})`}>
          <path d={feather(l, w)} fill={`url(#${id}feather)`} stroke="#eab3c4" strokeWidth="0.6" />
          <path d={`M1 0L${l * 0.9} 0`} stroke="#f3c6d3" strokeWidth="0.7" />
        </g>
      ))}
      {SECONDARIES.map(([x, y, a, l, w], i) => (
        <g key={`s${i}`} transform={`translate(${x} ${y}) rotate(${a})`}>
          <path d={feather(l, w)} fill={`url(#${id}feather)`} stroke="#eab3c4" strokeWidth="0.6" />
          <path d={`M1 0L${l * 0.88} 0`} stroke="#f3c6d3" strokeWidth="0.7" />
        </g>
      ))}
      {/* Bord d'attaque : l'os de l'aile, couvert de petites plumes arrondies. */}
      <path d="M2 2C-8-6-18-20-27-27C-34-32-41-35-48-37C-40-31-33-27-25-21C-17-14-9-7 2 2Z" fill={`url(#${id}arm)`} />
      {COVERTS.map(([x, y, a], i) => (
        <ellipse
          key={`c${i}`}
          cx={x}
          cy={y}
          rx="7.5"
          ry="4.6"
          transform={`rotate(${a} ${x} ${y})`}
          fill={`url(#${id}covert)`}
          stroke="#f0c2cf"
          strokeWidth="0.5"
        />
      ))}
      <path d="M0-1C-10-9-20-21-30-28" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </g>
  );
}

/** La flèche : fût doré, pointe en cœur brillant, empennage de deux plumes. `x` : l'encoche. */
export function Arrow({ id, x = 0, y = 0, len = 58 }: { id: string; x?: number; y?: number; len?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d={`M3 0H${len - 6}`} stroke="#d9a441" strokeWidth="2.4" strokeLinecap="round" />
      <path d={`M4-0.6H${len - 7}`} stroke="#fff1b8" strokeWidth="0.8" strokeLinecap="round" opacity="0.9" />
      <path d="M0 0l9-5.5q3 3 1 5.5q2 2.5-1 5.5Z" fill="#ffffff" stroke="#f3a5bd" strokeWidth="0.6" />
      <path d="M3 0l6-3.6M3 0l6 3.6M6 0l5-3M6 0l5 3" stroke="#ff8fab" strokeWidth="0.7" />
      <path d={HEART} transform={`translate(${len - 10} -5.6) scale(0.5)`} fill={`url(#${id}heart)`} stroke="#ffd1dc" strokeWidth="1.2" />
      <ellipse cx={len - 5.6} cy="-2.6" rx="1.6" ry="1" fill="#ffffff" opacity="0.8" />
    </g>
  );
}

/** Les dégradés partagés par Cupidon, la flèche et le cœur. */
export function CupidDefs({ id }: { id: string }) {
  return (
    <defs>
      <radialGradient id={`${id}glass`} cx="38%" cy="30%" r="75%">
        <stop offset="0" stopColor="#4a3a44" />
        <stop offset="0.55" stopColor="#21181e" />
        <stop offset="1" stopColor="#0e0a0d" />
      </radialGradient>
      <radialGradient id={`${id}core`} cx="50%" cy="50%" r="50%">
        <stop offset="0" stopColor="#fff0f4" />
        <stop offset="0.5" stopColor="#ff6b95" />
        <stop offset="1" stopColor="#c2185b" stopOpacity="0" />
      </radialGradient>
      <radialGradient id={`${id}halo`} cx="50%" cy="50%" r="50%">
        <stop offset="0.45" stopColor="#ff5c8a" stopOpacity="0.4" />
        <stop offset="1" stopColor="#ff5c8a" stopOpacity="0" />
      </radialGradient>
      <linearGradient id={`${id}rim`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity="0.3" />
        <stop offset="0.5" stopColor="#fff" stopOpacity="0.05" />
        <stop offset="1" stopColor="#ff8fab" stopOpacity="0.8" />
      </linearGradient>
      <linearGradient id={`${id}shine`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity="0.6" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      <linearGradient id={`${id}feather`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="0.65" stopColor="#fff4f7" />
        <stop offset="1" stopColor="#ffc9d8" />
      </linearGradient>
      <linearGradient id={`${id}covert`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="1" stopColor="#ffe6ee" />
      </linearGradient>
      <linearGradient id={`${id}arm`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="1" stopColor="#ffd9e4" />
      </linearGradient>
      <linearGradient id={`${id}gold`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff1b8" />
        <stop offset="0.5" stopColor="#f2c14e" />
        <stop offset="1" stopColor="#b9861f" />
      </linearGradient>
      <linearGradient id={`${id}shaft`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#d9a441" />
        <stop offset="1" stopColor="#fff0b3" />
      </linearGradient>
      <radialGradient id={`${id}heart`} cx="40%" cy="30%" r="80%">
        <stop offset="0" stopColor="#ffb3c7" />
        <stop offset="0.5" stopColor="#ff3d6e" />
        <stop offset="1" stopColor="#b3134a" />
      </radialGradient>
      <linearGradient id={`${id}leather`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#6e2f3c" />
        <stop offset="0.5" stopColor="#9c4757" />
        <stop offset="1" stopColor="#5a2431" />
      </linearGradient>
      <filter id={`${id}blur`} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" />
      </filter>
      <filter id={`${id}soft`} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.6" />
      </filter>
      <filter id={`${id}glow`} x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="1.5" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <clipPath id={`${id}clip`}>
        <circle cx="96" cy="84" r="38" />
      </clipPath>
    </defs>
  );
}

/** Une main de verre, petite sphère avec un reflet et un peu de lumière rose. */
function Hand({ id, x, y }: { id: string; x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r="7" fill={`url(#${id}glass)`} />
      <circle r="5" cy="1.5" fill="#ff5c8a" opacity="0.35" filter={`url(#${id}blur)`} />
      <circle r="6.6" fill="none" stroke={`url(#${id}rim)`} strokeWidth="0.9" />
      <path d="M-4.5-2.5c1.2-2.8 3.4-4 5.8-3.6" stroke="#fff" strokeOpacity="0.6" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </g>
  );
}

/** Un calque de Cupidon : tous partagent le même viewBox, superposés exactement (voir .cupid-l). */
function L({ cls, children }: { cls?: string; children: ReactNode }) {
  return (
    <svg className={`cupid-l${cls ? ` ${cls}` : ''}`} viewBox="-36 -4 276 169" aria-hidden="true">
      {children}
    </svg>
  );
}

/**
 * Cupidon en calques : ce qui bouge (battement des ailes, lumière, yeux, corde, flèche encochée, paillettes)
 * anime un calque entier ; le verre et ses flous ne sont dessinés qu'une fois.
 */
export function CupidPulse({ id }: { id: string }) {
  const u = (k: string) => `url(#${id}${k})`;
  return (
    <>
      <L cls="cupid-halo">
        <CupidDefs id={id} />
        <circle cx="96" cy="84" r="60" fill={u('halo')} />
      </L>

      {/* Ailes derrière la sphère : la droite est le miroir de la gauche ; chacune bat autour de l'épaule. */}
      <L cls="cupid-wing l">
        <g transform="translate(68 72) rotate(22)">
          <Wing id={id} />
        </g>
      </L>
      <L cls="cupid-wing r">
        <g transform="translate(124 72) scale(-1 1) rotate(22)">
          <Wing id={id} />
        </g>
      </L>

      <L>
        {/* Carquois dans le dos, deux flèches qui dépassent. */}
        <g transform="rotate(-32 70 56)">
          <path d="M64 20h4v18h-4z" fill={u('shaft')} />
          <path d={HEART} transform="translate(60.5 12) scale(0.45)" fill={u('heart')} />
          <path d="M72 16h4v22h-4z" fill={u('shaft')} />
          <path d={HEART} transform="translate(68.5 8) scale(0.45)" fill={u('heart')} />
          <rect x="58" y="34" width="24" height="44" rx="7" fill={u('leather')} />
          <rect x="58" y="38" width="24" height="3.4" fill={u('gold')} />
          <rect x="58" y="70" width="24" height="3.4" fill={u('gold')} />
          <path d={HEART} transform="translate(65.6 50) scale(0.37)" fill="#ffd1dc" opacity="0.85" />
        </g>
        {/* La sphère, comme Pulse : verre fumé. */}
        <circle cx="96" cy="84" r="38" fill={u('glass')} />
      </L>
      {/* La lumière en cœur, à l'intérieur, qui respire. */}
      <L cls="cupid-core">
        <g clipPath={u('clip')}>
          <circle cx="96" cy="92" r="32" fill={u('core')} filter={u('blur')} opacity="0.85" />
          <path d={HEART} transform="translate(77.5 78) scale(1.55)" fill={u('core')} filter={u('soft')} />
        </g>
      </L>
      <L>
        <circle cx="96" cy="84" r="37.3" fill="none" stroke={u('rim')} strokeWidth="1.4" />
        <path d="M68 73c4-13 15-21 28-21s24 8 28 21c-7-7-16-11-28-11s-21 4-28 11Z" fill={u('shine')} opacity="0.7" />
        <ellipse cx="80" cy="96" rx="6" ry="3.2" fill="#ff8fab" opacity="0.45" filter={u('blur')} />
        <ellipse cx="112" cy="96" rx="6" ry="3.2" fill="#ff8fab" opacity="0.45" filter={u('blur')} />
        <path d="M92 99q4 3 8 0" stroke="#ffd1dc" strokeOpacity="0.8" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </L>

      {/* Yeux : ouverts, un œil fermé pour viser, puis contents après le tir. */}
      <L cls="cupid-eyes open">
        <g filter={u('glow')} fill="#ffffff">
          <rect x="81.5" y="75" width="8" height="14" rx="4" />
          <rect x="102.5" y="75" width="8" height="14" rx="4" />
        </g>
      </L>
      <L cls="cupid-eyes aim">
        <g filter={u('glow')}>
          <path d="M80.5 83q5 3 10 0" stroke="#ffffff" strokeWidth="3.4" fill="none" strokeLinecap="round" />
          <rect x="102.5" y="74" width="8" height="15" rx="4" fill="#ffffff" />
        </g>
      </L>
      <L cls="cupid-eyes happy">
        <g filter={u('glow')} stroke="#ffffff" strokeWidth="3.6" fill="none" strokeLinecap="round">
          <path d="M80.5 84q5-6.5 10 0" />
          <path d="M101.5 84q5-6.5 10 0" />
        </g>
      </L>

      {/* L'arc doré, à double courbure. */}
      <L>
        <path d="M184 84C192 72 194 52 186 40C183 35 179 33 175 32" stroke="#8a5a17" strokeWidth="5.4" fill="none" strokeLinecap="round" />
        <path d="M184 84C192 96 194 116 186 128C183 133 179 135 175 136" stroke="#8a5a17" strokeWidth="5.4" fill="none" strokeLinecap="round" />
        <path d="M184 84C192 72 194 52 186 40C183 35 179 33 175 32" stroke={u('gold')} strokeWidth="3.6" fill="none" strokeLinecap="round" />
        <path d="M184 84C192 96 194 116 186 128C183 133 179 135 175 136" stroke={u('gold')} strokeWidth="3.6" fill="none" strokeLinecap="round" />
        <path d="M188 66C190 58 189 50 185 43" stroke="#fff6cc" strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.8" />
        <circle cx="175" cy="32" r="2.3" fill="#fff1b8" />
        <circle cx="175" cy="136" r="2.3" fill="#fff1b8" />
      </L>
      {/* La corde, au repos ou tendue. */}
      <L cls="cupid-string rest">
        <path d="M175 32L168 84L175 136" stroke="#fff6e8" strokeWidth="0.9" fill="none" />
      </L>
      <L cls="cupid-string drawn">
        <path d="M175 32L148 84L175 136" stroke="#fff6e8" strokeWidth="0.9" fill="none" />
      </L>
      {/* La flèche encochée et la main qui tire la corde ; l'autre main tient l'arc. */}
      <L cls="cupid-held">
        <Arrow id={id} x={168} y={84} len={58} />
        <Hand id={id} x={166} y={84} />
      </L>
      <L>
        <Hand id={id} x={187} y={84} />
      </L>

      {/* Paillettes autour de lui, deux par deux. */}
      {[0, 1].map((k) => (
        <L key={k} cls={`cupid-twinkle t${k}`}>
          {(
            [
              [30, 40],
              [150, 18],
              [40, 128],
              [214, 150],
            ] as const
          )
            .filter((_, i) => i % 2 === k)
            .map(([x, y]) => (
              <path key={x} d={`M${x} ${y - 4}l1.2 2.8 2.8 1.2-2.8 1.2-1.2 2.8-1.2-2.8-2.8-1.2 2.8-1.2Z`} fill="#ffe3ec" />
            ))}
        </L>
      ))}
    </>
  );
}

/** Le cœur visé : brillant, avec un reflet et un liseré clair. */
export function TargetHeart({ id }: { id: string }) {
  return (
    <svg viewBox="-2 -2 28 26" aria-hidden="true">
      <path d={HEART} fill={`url(#${id}heart)`} stroke="#ffd1dc" strokeWidth="0.9" />
      <path d="M5.2 6.2q1.4-3 4.6-3" stroke="#fff" strokeOpacity="0.75" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <ellipse cx="16.6" cy="5.4" rx="1.4" ry="0.9" fill="#fff" opacity="0.55" />
    </svg>
  );
}
