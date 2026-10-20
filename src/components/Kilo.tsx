// Kilo, la mascotte de Shred : un kettlebell avec un bandeau de sport. Personnage original.
import type { ReactNode } from 'react';

const BODY = '#4f7cff';
const DEEP = '#2e54cc';
const INK = '#0b1020';

export function Kilo({
  size = 130,
  wave = true,
  happy = true,
  className = '',
  children,
}: {
  size?: number;
  /** Agite le bras gauche. */
  wave?: boolean;
  /** Bouche ouverte, sourire large. */
  happy?: boolean;
  className?: string;
  /** Ce que Kilo tient au-dessus de sa main droite (la flamme). */
  children?: ReactNode;
}) {
  return (
    <div className={`kilo ${className}`} style={{ width: size, height: size * 1.23 }}>
      <svg viewBox="0 0 140 172" width="100%" height="100%" aria-hidden="true">
        <defs>
          <radialGradient id="kilo-body" cx="38%" cy="32%" r="75%">
            <stop offset="0" stopColor="#8fb0ff" />
            <stop offset="0.45" stopColor={BODY} />
            <stop offset="1" stopColor={DEEP} />
          </radialGradient>
        </defs>
        <ellipse cx="70" cy="164" rx="36" ry="6" fill="#000" opacity="0.22" />
        <g className="kilo-bob">
          <ellipse cx="52" cy="154" rx="14" ry="8" fill="#1b2a55" />
          <ellipse cx="88" cy="154" rx="14" ry="8" fill="#1b2a55" />
          <path d="M40 70C40 22 100 22 100 70" fill="none" stroke={DEEP} strokeWidth="17" strokeLinecap="round" />
          <path d="M45 62C47 34 93 34 95 62" fill="none" stroke="#7d9dff" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
          <g className={wave ? 'kilo-arm-l wave' : 'kilo-arm-l'}>
            <path d="M28 104Q12 96 14 80" fill="none" stroke={DEEP} strokeWidth="10" strokeLinecap="round" />
            <circle cx="14" cy="78" r="7" fill={BODY} />
          </g>
          <g className="kilo-arm-r">
            <path d="M112 102Q130 88 124 66" fill="none" stroke={DEEP} strokeWidth="10" strokeLinecap="round" />
            <circle cx="124" cy="63" r="7" fill={BODY} />
          </g>
          <circle cx="70" cy="104" r="48" fill="url(#kilo-body)" />
          <path d="M26 86Q70 64 114 86" fill="none" stroke="#ff5468" strokeWidth="8" strokeLinecap="round" />
          <path d="M108 84l10 -6M110 90l11 -2" stroke="#ff5468" strokeWidth="4" strokeLinecap="round" />
          <g className="kilo-eyes">
            <ellipse cx="55" cy="101" rx="8" ry="10" fill="#fff" />
            <ellipse cx="85" cy="101" rx="8" ry="10" fill="#fff" />
            <circle cx="57" cy="103" r="4.6" fill={INK} />
            <circle cx="87" cy="103" r="4.6" fill={INK} />
            <circle cx="58.6" cy="101" r="1.6" fill="#fff" />
            <circle cx="88.6" cy="101" r="1.6" fill="#fff" />
          </g>
          <circle cx="44" cy="118" r="6" fill="#ff8fa3" opacity="0.55" />
          <circle cx="96" cy="118" r="6" fill="#ff8fa3" opacity="0.55" />
          {happy ? (
            <path d="M59 117Q70 131 81 117Z" fill={INK} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
          ) : (
            <path d="M61 118Q70 125 79 118" fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
          )}
          <text x="70" y="143" textAnchor="middle" fontSize="11" fontWeight="900" fill="#fff" opacity="0.35" style={{ fontStretch: '125%' }}>
            KG
          </text>
        </g>
      </svg>
      {children && <div className="kilo-hold">{children}</div>}
    </div>
  );
}
