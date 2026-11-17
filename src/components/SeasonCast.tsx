// La troupe des fêtes, de la famille de Pulse : la même sphère de verre fumé avec une lumière vivante dedans,
// les mêmes yeux lumineux, des mains de verre. Pulse joue chaque rôle dans son costume de saison : père Noël
// dans son traîneau tiré par deux rennes de verre, citrouille-sorcière sur son balai avec son chat, fêtard du
// Nouvel an avec sa langue de belle-mère et son cierge magique, lapin de Pâques avec son panier ; un poussin
// sort de l'œuf qu'il dépose. Dessins originaux.
//
// Chaque personnage est fait de calques SVG superposés (même viewBox, même boîte) : le corps, immobile, porte
// les flous et les dégradés ; les parties qui bougent (main, cape, queue, yeux, oreilles) sont des calques à
// part que le CSS anime en transform / opacity. Le navigateur déplace ces calques sans redessiner le verre.
import type { CSSProperties, ReactNode } from 'react';

const css = (o: Record<string, string | number>) => o as CSSProperties;

/** Un calque du personnage. `pivot` : le point (dans le viewBox) autour duquel il tourne. */
function Lay({ vb, cls, pivot, children }: { vb: [number, number]; cls: string; pivot?: [number, number]; children: ReactNode }) {
  const style = pivot ? { transformOrigin: `${((pivot[0] / vb[0]) * 100).toFixed(2)}% ${((pivot[1] / vb[1]) * 100).toFixed(2)}%` } : undefined;
  return (
    <svg className={`lay ${cls}`} viewBox={`0 0 ${vb[0]} ${vb[1]}`} style={style} aria-hidden="true">
      {children}
    </svg>
  );
}

/** Place un dessin fait dans le repère de Pulse (centre 60, 58 ; rayon 40) au point (x, y), au rayon r. */
const at = (x: number, y: number, r: number) => `translate(${x} ${y}) scale(${r / 40}) translate(-60 -58)`;

type Three = readonly [string, string, string];

/** Dégradés d'une sphère : verre (reflet, milieu, bord), lumière (bord, milieu, cœur), liseré. */
function GlassDefs({ id, glass = ['#3a3f48', '#1b1e24', '#0c0d10'], light }: { id: string; glass?: Three; light: Three }) {
  const [edge, mid, core] = light;
  return (
    <>
      <radialGradient id={`${id}glass`} cx="38%" cy="30%" r="75%">
        <stop offset="0" stopColor={glass[0]} />
        <stop offset="0.55" stopColor={glass[1]} />
        <stop offset="1" stopColor={glass[2]} />
      </radialGradient>
      <radialGradient id={`${id}core`} cx="50%" cy="55%" r="50%">
        <stop offset="0" stopColor={core} />
        <stop offset="0.45" stopColor={mid} />
        <stop offset="1" stopColor={edge} stopOpacity="0" />
      </radialGradient>
      <radialGradient id={`${id}halo`} cx="50%" cy="50%" r="50%">
        <stop offset="0.5" stopColor={mid} stopOpacity="0.32" />
        <stop offset="1" stopColor={mid} stopOpacity="0" />
      </radialGradient>
      <linearGradient id={`${id}rim`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity="0.3" />
        <stop offset="0.5" stopColor="#fff" stopOpacity="0.05" />
        <stop offset="1" stopColor={core} stopOpacity="0.8" />
      </linearGradient>
      <linearGradient id={`${id}shine`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity="0.6" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      <clipPath id={`${id}clip`}>
        <circle cx="60" cy="58" r="40" />
      </clipPath>
    </>
  );
}

/** Flous partagés par toute la troupe. */
function Filters({ id }: { id: string }) {
  return (
    <>
      <filter id={`${id}blur`} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="5" />
      </filter>
      <filter id={`${id}soft`} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="2" />
      </filter>
      <filter id={`${id}glow`} x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="1.6" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </>
  );
}

/** La sphère de verre, dans le repère de Pulse. `lit` : la lumière intérieure (absente pour la citrouille). */
function Ball({ id, halo = true, fill }: { id: string; halo?: boolean; fill?: string }) {
  const u = (k: string) => `url(#${id}${k})`;
  return (
    <>
      {halo && <circle cx="60" cy="58" r="58" fill={u('halo')} />}
      <circle cx="60" cy="58" r="40" fill={fill ?? u('glass')} />
      {!fill && (
        <g clipPath={u('clip')}>
          <circle cx="60" cy="68" r="34" fill={u('core')} filter={`url(#${id}blur)`} opacity="0.95" />
        </g>
      )}
      <circle cx="60" cy="58" r="39.3" fill="none" stroke={u('rim')} strokeWidth="1.4" />
      <path d="M31 47c4-14 16-23 29-23s25 9 29 23c-7-8-17-12-29-12s-22 4-29 12Z" fill={u('shine')} opacity={fill ? 0.35 : 0.7} />
    </>
  );
}

/** Une main de verre : petite sphère, reflet, un peu de la lumière de son personnage. */
function Hand({ id, x, y, r = 7, tint }: { id: string; x: number; y: number; r?: number; tint: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r * 1.7} fill={tint} opacity="0.16" filter={`url(#${id}soft)`} />
      <circle r={r} fill={`url(#${id}glass)`} />
      <circle r={r * 0.7} cy={r * 0.18} fill={tint} opacity="0.75" filter={`url(#${id}soft)`} />
      <circle r={r * 0.94} fill="none" stroke={`url(#${id}rim)`} strokeWidth="1.1" />
      <path d={`M${-r * 0.64} ${-r * 0.36}c${r * 0.17}-${r * 0.4} ${r * 0.49}-${r * 0.57} ${r * 0.83}-${r * 0.51}`} stroke="#fff" strokeOpacity="0.6" strokeWidth="1.1" fill="none" strokeLinecap="round" />
    </g>
  );
}

/** Yeux de Pulse : ouverts (deux gélules), contents (deux arcs). `dx`, `dy` : le regard. */
function EyesOpen({ dx = 0, dy = 0, h = 14 }: { dx?: number; dy?: number; h?: number }) {
  return (
    <g fill="#fff">
      <rect x={45.5 + dx} y={49 + dy + (14 - h) / 2} width="8" height={h} rx="4" />
      <rect x={66.5 + dx} y={49 + dy + (14 - h) / 2} width="8" height={h} rx="4" />
    </g>
  );
}
function EyesHappy({ dx = 0, dy = 0 }: { dx?: number; dy?: number }) {
  return (
    <g fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round">
      <path d={`M${44 + dx} ${58 + dy}q5-6.5 10 0`} />
      <path d={`M${66 + dx} ${58 + dy}q5-6.5 10 0`} />
    </g>
  );
}

/** Une traînée d'étincelles sur deux calques qui scintillent en alternance (opacité du calque entier). */
function Trail({ vb, n, at: place, colors }: { vb: [number, number]; n: number; at: (i: number) => { x: number; y: number; star: boolean; s: number }; colors: [string, string] }) {
  return (
    <>
      {[0, 1].map((half) => (
        <Lay key={half} vb={vb} cls={`trail t${half}`}>
          {Array.from({ length: n }, (_, i) => i)
            .filter((i) => i % 2 === half)
            .map((i) => {
              const p = place(i);
              return <path key={i} d={p.star ? star(p.x, p.y, p.s) : `M${p.x} ${p.y}m-${p.s / 2} 0a${p.s / 2} ${p.s / 2} 0 1 0 ${p.s} 0a${p.s / 2} ${p.s / 2} 0 1 0-${p.s} 0`} fill={colors[half]} />;
            })}
        </Lay>
      ))}
    </>
  );
}

/** Petite étoile à quatre branches, pour les traînées et les paillettes. */
const star = (x: number, y: number, s: number) =>
  `M${x} ${y - s}l${s * 0.28} ${s * 0.72} ${s * 0.72} ${s * 0.28}-${s * 0.72} ${s * 0.28}-${s * 0.28} ${s * 0.72}-${s * 0.28}-${s * 0.72}-${s * 0.72}-${s * 0.28} ${s * 0.72}-${s * 0.28}Z`;

/* ==========================================================================
   Noël : Pulse en père Noël, dans son traîneau, tiré par deux rennes de verre.
   ========================================================================== */

const SV: [number, number] = [340, 160];

function Reindeer({ id, lead }: { id: string; lead?: boolean }) {
  // Dessiné dans le repère de Pulse, de trois quarts vers la gauche (le sens du vol).
  return (
    <>
      {/* Bois dorés, ramifiés. */}
      <g stroke="#c98f52" strokeWidth="4.2" strokeLinecap="round" fill="none">
        <path d="M44 22C41 11 36 5 28 1M38 11c-6-.4-10-3-13-7M42 15c4-6 8-9 12-12" />
        <path d="M74 22c2-11 6-17 13-21M80 10c6 0 10-3 13-7M76 15c-4-6-7-10-10-13" />
      </g>
      <g stroke="#f0c48c" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.8">
        <path d="M43 19C40 11 36 6 30 3M75 19c2-8 6-13 11-16" />
      </g>
      {/* Oreilles. */}
      <ellipse cx="24" cy="40" rx="9" ry="4.6" transform="rotate(-28 24 40)" fill="#7a5236" />
      <ellipse cx="96" cy="40" rx="9" ry="4.6" transform="rotate(28 96 40)" fill="#7a5236" />
      <Ball id={id} />
      {/* Joues et regard tourné vers la gauche. */}
      <ellipse cx="38" cy="70" rx="7" ry="3.6" fill="#ff8f6b" opacity="0.4" filter={`url(#${id}blur)`} />
      <g filter={`url(#${id}glow)`}>
        <EyesOpen dx={-7} dy={-2} h={13} />
      </g>
      {/* Le museau, et le nez rouge du renne de tête. */}
      <ellipse cx="34" cy="74" rx="15" ry="11" fill="#8a6142" opacity="0.92" />
      <ellipse cx="31" cy="70" rx="7" ry="3" fill="#fff" opacity="0.18" />
      {lead ? (
        <>
          <circle cx="22" cy="72" r="7.4" fill="url(#scNoseRed)" />
          <ellipse cx="19.6" cy="69.4" rx="2.4" ry="1.6" fill="#fff" opacity="0.8" />
        </>
      ) : (
        <>
          <circle cx="22" cy="72" r="6.2" fill="#2b1a10" />
          <ellipse cx="20" cy="70" rx="2" ry="1.3" fill="#fff" opacity="0.5" />
        </>
      )}
      {/* Collier doré et grelot. */}
      <path d="M26 86c20 12 48 12 68 0" stroke="#d62839" strokeWidth="7" fill="none" strokeLinecap="round" />
      <path d="M26 86c20 12 48 12 68 0" stroke="#ffd166" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeDasharray="1 6" />
      <circle cx="60" cy="98" r="6" fill="url(#scGold)" />
      <path d="M56 99h8" stroke="#8a5a17" strokeWidth="1.4" strokeLinecap="round" />
    </>
  );
}

export function SleighCast() {
  const id = 'scN';
  return (
    <div className="actor sleigh2">
      <Trail vb={SV} n={10} colors={['#ffffff', '#ffd166']} at={(i) => ({ x: 318 + i * 7, y: 110 - (i % 4) * 6.5, star: i % 3 === 0, s: i % 3 === 0 ? 4.5 - i * 0.2 : 4 - i * 0.15 })} />
      {/* Les rênes, un peu lâches. */}
      <Lay vb={SV} cls="reins">
        <path d="M60 108c14 9 32 9 48 2M124 114c20 10 42 10 64-6" stroke="#ffd166" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      </Lay>
      <Lay vb={SV} cls="deer a" pivot={[46, 80]}>
        <defs>
          <GlassDefs id={`${id}d`} glass={['#5a4232', '#2c1f16', '#130c08']} light={['#a8572a', '#ffb35c', '#fff1d6']} />
          <radialGradient id="scNoseRed" cx="35%" cy="30%" r="70%">
            <stop offset="0" stopColor="#ffb3a8" />
            <stop offset="0.5" stopColor="#ff3b3b" />
            <stop offset="1" stopColor="#b3121f" />
          </radialGradient>
          <linearGradient id="scGold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff1b8" />
            <stop offset="0.5" stopColor="#f2c14e" />
            <stop offset="1" stopColor="#b9861f" />
          </linearGradient>
          <Filters id={`${id}d`} />
        </defs>
        <g transform={at(46, 80, 20)}>
          <Reindeer id={`${id}d`} lead />
        </g>
      </Lay>
      <Lay vb={SV} cls="deer nose" pivot={[46, 80]}>
        <g transform={at(46, 80, 20)}>
          <circle cx="22" cy="72" r="13" fill="#ff3b3b" opacity="0.45" filter={`url(#${id}dblur)`} />
        </g>
      </Lay>
      <Lay vb={SV} cls="deer b" pivot={[112, 86]}>
        <g transform={at(112, 86, 20)}>
          <Reindeer id={`${id}d`} />
        </g>
      </Lay>
      <Lay vb={SV} cls="body">
        <defs>
          <GlassDefs id={id} glass={['#5c3036', '#2a1418', '#12080a']} light={['#c2410c', '#ffb35c', '#fff6e8']} />
          <Filters id={id} />
          <linearGradient id={`${id}red`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff5f6f" />
            <stop offset="0.55" stopColor="#d62839" />
            <stop offset="1" stopColor="#8f1022" />
          </linearGradient>
          <linearGradient id={`${id}hat`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff4d5e" />
            <stop offset="1" stopColor="#a8102a" />
          </linearGradient>
          <linearGradient id={`${id}fur`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#d3e2ec" />
          </linearGradient>
          <linearGradient id={`${id}sack`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#9a5a3c" />
            <stop offset="1" stopColor="#4d2418" />
          </linearGradient>
        </defs>
        {/* La hotte de cadeaux, à l'arrière. */}
        <rect x="270" y="30" width="18" height="16" rx="2" fill="#3cb371" />
        <path d="M279 30v16M270 38h18" stroke="#ffd166" strokeWidth="2.2" />
        <rect x="290" y="22" width="16" height="22" rx="2" fill="#9fd4ff" />
        <path d="M298 22v22M290 33h16" stroke="#e8384f" strokeWidth="2.2" />
        <path d="M296 22q-6-7-2-9t4 7q2-9 6-7t-6 9" fill="none" stroke="#e8384f" strokeWidth="1.6" />
        <path d="M262 88C252 64 260 40 284 38c18-2 30 12 28 32-1 8-4 14-8 18Z" fill={`url(#${id}sack)`} />
        <path d="M270 52c8 4 22 4 32-2" stroke="#e5b443" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M268 70q10 6 20 2" stroke="#ffffff" strokeOpacity="0.12" strokeWidth="3" fill="none" strokeLinecap="round" />

        {/* Pulse en père Noël. */}
        <g transform={at(226, 70, 31)}>
          <Ball id={id} />
          <ellipse cx="36" cy="62" rx="7" ry="4" fill="#ff8fab" opacity="0.5" filter={`url(#${id}blur)`} />
          <ellipse cx="84" cy="62" rx="7" ry="4" fill="#ff8fab" opacity="0.5" filter={`url(#${id}blur)`} />
          {/* Barbe en nuage, moustache. */}
          <path
            d="M22 62c-2 16 6 31 18 37 4 6 12 8 20 6 8 2 16 0 20-6 12-6 20-21 18-37-6 9-16 13-24 9-6 6-20 6-28 0-8 4-18 0-24-9Z"
            fill={`url(#${id}fur)`}
          />
          <path d="M40 84q4 8 2 14M56 88q2 8 0 14M72 86q-2 8 1 13M84 78q0 8-4 12" stroke="#c4d6e2" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <path d="M60 68c-6-7-17-5-22 2 7-2 14 0 22 4 8-4 15-6 22-4-5-7-16-9-22-2Z" fill="#ffffff" />
          <circle cx="60" cy="66" r="4.4" fill="#ffb3a8" />
          {/* Bonnet, bordure de fourrure, pompon qui flotte derrière. */}
          <path d="M28 30C30 13 46 2 64 3c14 1 26 9 33 21l-7 4c-4-7-11-12-18-13 4 5 6 10 6 16Z" fill={`url(#${id}hat)`} />
          <path d="M66 14c6 1 12 5 18 10" stroke="#ffffff" strokeOpacity="0.2" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <rect x="24" y="25" width="70" height="12" rx="6" fill={`url(#${id}fur)`} />
          <path d="M30 29h4M40 32h4M50 28h4M60 31h4M70 28h4M80 31h4" stroke="#c4d6e2" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="100" cy="27" r="7" fill={`url(#${id}fur)`} />
          <circle cx="98" cy="25" r="2.6" fill="#fff" />
        </g>
        {/* Le traîneau : caisse rouge à filet d'or, volute à l'avant, patins dorés. */}
        <path d="M170 98c-2-12 8-16 18-12h112c12 0 18-8 18-20h8c4 28-10 58-42 58h-88c-18 0-30-10-26-26Z" fill={`url(#${id}red)`} />
        <path d="M188 88h112c10 0 16-6 17-15" stroke="#ffd166" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M218 104c10-10 26-10 30 0s-10 14-16 8 2-10 6-6" stroke="#ffd166" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M262 104c10-10 26-10 30 0" stroke="#ffd166" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.7" />
        <path d="M170 98c-9-6-9-19 1-21 8-1 10 8 4 10" stroke="#ffd166" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        <path d="M206 124v16M280 124v16" stroke="#e5b443" strokeWidth="3" />
        <path d="M176 140h124c18 0 26-10 24-20M176 140c-16 0-22-12-14-18 6-4 12 2 8 6" stroke="#e5b443" strokeWidth="3.4" fill="none" strokeLinecap="round" />
        <path d="M180 138h118" stroke="#fff6cc" strokeWidth="1" opacity="0.7" />
        {/* La main qui tient les rênes. */}
        <Hand id={id} x={192} y={104} tint="#ffb35c" />
      </Lay>
      <Lay vb={SV} cls="eyes open" pivot={[224, 64]}>
        <g transform={at(226, 70, 31)} filter={`url(#${id}glow)`}>
          <EyesOpen dx={-3} dy={-6} h={13} />
        </g>
      </Lay>
      <Lay vb={SV} cls="eyes happy">
        <g transform={at(226, 70, 31)} filter={`url(#${id}glow)`}>
          <EyesHappy dx={-3} dy={-8} />
        </g>
      </Lay>
      {/* La main qui salue, autour de l'épaule. */}
      <Lay vb={SV} cls="wave" pivot={[206, 72]}>
        <path d="M193 54c-3 4-2 9 2 11" stroke="#f4f8fb" strokeWidth="4.6" fill="none" strokeLinecap="round" />
        <Hand id={id} x={186} y={48} r={7.5} tint="#ffb35c" />
      </Lay>
      <b className="scene-say sleigh-say">Ho ho ho !</b>
    </div>
  );
}

/** Le cadeau lâché du traîneau : il tombe, rebondit au-dessus des onglets, et laisse quelques étincelles. */
export function GiftDrop() {
  return (
    <>
      <div className="gift-drop" aria-hidden="true">
        <svg viewBox="0 0 48 48">
          <rect x="6" y="18" width="36" height="26" rx="3" fill="#e8384f" />
          <rect x="4" y="12" width="40" height="10" rx="3" fill="#ff5f6f" />
          <path d="M24 12v32M4 17h40" stroke="#ffd166" strokeWidth="4" />
          <path d="M24 12c-6-10-16-8-12-2 2 3 8 3 12 2Zm0 0c6-10 16-8 12-2-2 3-8 3-12 2Z" fill="#ffd166" stroke="#e5b443" strokeWidth="1" />
          <path d="M9 24h6" stroke="#fff" strokeOpacity="0.35" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <div className="gift-sparks" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <i key={i} style={css({ '--a': `${i * 24 - 84}deg` })} />
        ))}
      </div>
    </>
  );
}

/* ==========================================================================
   Halloween : Pulse-citrouille en sorcière, sur son balai, avec son chat.
   ========================================================================== */

const WV: [number, number] = [290, 170];

export function WitchCast() {
  const id = 'scH';
  const cat = 'scHc';
  return (
    <div className="actor witch2">
      <Trail vb={WV} n={11} colors={['#ff8a1f', '#8be36b']} at={(i) => ({ x: 282 + i * 6, y: 105 + (i % 2 ? 7 : -6), star: i % 3 === 1, s: i % 3 === 1 ? 5 - i * 0.25 : 4.4 - i * 0.2 })} />
      {/* La cape, qui claque au vent derrière la sorcière. */}
      <Lay vb={WV} cls="cape" pivot={[124, 92]}>
        <defs>
          <linearGradient id={`${id}cape`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#4a2470" />
            <stop offset="1" stopColor="#1e0d33" />
          </linearGradient>
        </defs>
        <path d="M120 76c24-6 60 4 84-6-6 16 0 30 16 42-32 4-64-2-94-8Z" fill={`url(#${id}cape)`} />
        <path d="M150 84c16 2 32 0 46-4" stroke="#7e4bb3" strokeOpacity="0.5" strokeWidth="2" fill="none" strokeLinecap="round" />
      </Lay>
      <Lay vb={WV} cls="body">
        <defs>
          <GlassDefs id={id} glass={['#3c2a3e', '#1e1220', '#0d070e']} light={['#c2410c', '#ff8a1f', '#ffe08a']} />
          <GlassDefs id={cat} glass={['#2e2e38', '#121218', '#050507']} light={['#4b2a7a', '#9b6bff', '#e3d3ff']} />
          <Filters id={id} />
          <Filters id={cat} />
          <radialGradient id={`${id}pumpkin`} cx="38%" cy="30%" r="78%">
            <stop offset="0" stopColor="#ffad4d" />
            <stop offset="0.55" stopColor="#e2620c" />
            <stop offset="1" stopColor="#6e2604" />
          </radialGradient>
          <linearGradient id={`${id}hat`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3d2160" />
            <stop offset="1" stopColor="#120a1d" />
          </linearGradient>
          <linearGradient id={`${id}straw`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#f2cf6b" />
            <stop offset="1" stopColor="#a8741f" />
          </linearGradient>
          <linearGradient id={`${id}wood`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#a8743c" />
            <stop offset="1" stopColor="#5e3618" />
          </linearGradient>
        </defs>
        {/* Le balai. */}
        <path d="M14 122 220 104" stroke={`url(#${id}wood)`} strokeWidth="5.5" strokeLinecap="round" />
        <path d="M20 120 214 103" stroke="#d9a466" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
        <path d="M218 96c24-6 46-12 64-20-8 20-6 40 6 56-24-8-46-14-70-18Z" fill={`url(#${id}straw)`} />
        <path d="M222 100l54-16M222 106l60-4M222 112l56 12M226 104l40-10" stroke="#8a5e18" strokeWidth="1" opacity="0.8" />
        <rect x="210" y="94" width="12" height="20" rx="3" fill="#7e2a8a" transform="rotate(-5 216 104)" />
        <path d="M211 99l10-1M211 109l11-1" stroke="#ffd166" strokeWidth="1.2" />

        {/* Le chat de verre, assis au bout du balai. */}
        <g transform={at(190, 86, 13)}>
          <path d="M28 34 32 4l20 18ZM92 34 88 4 68 22Z" fill="#141419" />
          <path d="M33 26 35 12l9 9ZM87 26l-2-14-9 9Z" fill="#ff8fab" opacity="0.5" />
          <Ball id={cat} />
          <g stroke="#cfc6e8" strokeWidth="1.4" strokeLinecap="round" opacity="0.7">
            <path d="M40 70 18 66M40 74 18 76M80 70l22-4M80 74l22 2" />
          </g>
          <path d="M56 66h8l-4 5Z" fill="#ff8fab" />
        </g>

        {/* Pulse en citrouille : écorce à côtes, puis le chapeau. */}
        <g transform={at(114, 74, 34)}>
          <circle cx="60" cy="58" r="56" fill="#ff8a1f" opacity="0.14" filter={`url(#${id}blur)`} />
          <circle cx="60" cy="58" r="40" fill={`url(#${id}pumpkin)`} />
          <g clipPath={`url(#${id}clip)`} fill="none" stroke="#5a1f03" strokeOpacity="0.42" strokeWidth="1.6">
            <ellipse cx="60" cy="58" rx="13" ry="40" />
            <ellipse cx="60" cy="58" rx="27" ry="40" />
            <path d="M60 18v80" />
          </g>
          <circle cx="60" cy="58" r="39.3" fill="none" stroke={`url(#${id}rim)`} strokeWidth="1.4" />
          <path d="M31 47c4-14 16-23 29-23s25 9 29 23c-7-8-17-12-29-12s-22 4-29 12Z" fill={`url(#${id}shine)`} opacity="0.35" />
          {/* Chapeau pointu, pointe pliée vers l'arrière, ruban et boucle dorée. */}
          <ellipse cx="60" cy="24" rx="48" ry="9" fill="#170c24" />
          <ellipse cx="60" cy="22.5" rx="46" ry="7.5" fill={`url(#${id}hat)`} />
          <path d="M34 22C40 4 48-16 60-30c6-8 18-10 26-4-8 0-14 6-16 14-2 12 4 28 16 42Z" fill={`url(#${id}hat)`} />
          <path d="M60-22c-6 10-10 24-12 40" stroke="#6b3f9a" strokeOpacity="0.55" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M36 18c16 5 32 5 48 0l-2-9c-14 5-30 5-44 0Z" fill="#ff8a1f" />
          <rect x="54" y="9.5" width="11" height="10" rx="1.5" fill="none" stroke="#ffd166" strokeWidth="2" />
          <path d={star(90, -32, 6)} fill="#ffd166" />
        </g>
        {/* Les mains de verre sur le manche. */}
        <Hand id={id} x={82} y={115.5} tint="#ff8a1f" />
        <Hand id={id} x={150} y={109.5} tint="#ff8a1f" />
      </Lay>
      {/* Le visage taillé, où passe la lumière qui vacille. */}
      <Lay vb={WV} cls="carve">
        <g transform={at(114, 74, 34)} filter={`url(#${id}glow)`}>
          <path d="M42 57l6.5-12 6.5 12z" fill="#ffd27a" />
          <path d="M65 57l6.5-12 6.5 12z" fill="#ffd27a" />
          <path d="M38 65q22 24 44 0l-4.5 4-4-4.6-5 5.6-5.5-5.2-5.5 5.2-5-5.6-4 4.6z" fill="#ffc14d" />
        </g>
      </Lay>
      <Lay vb={WV} cls="cat-eyes" pivot={[190, 85]}>
        <g transform={at(190, 86, 13)} filter={`url(#${cat}glow)`}>
          <ellipse cx="48" cy="54" rx="6" ry="8.5" fill="#ffd166" />
          <ellipse cx="72" cy="54" rx="6" ry="8.5" fill="#ffd166" />
          <ellipse cx="48" cy="54" rx="1.8" ry="6.5" fill="#1a1205" />
          <ellipse cx="72" cy="54" rx="1.8" ry="6.5" fill="#1a1205" />
        </g>
      </Lay>
      <Lay vb={WV} cls="tail" pivot={[202, 100]}>
        <path d="M202 100c18-2 28-16 20-30-4-6-12-5-10 2" stroke="#101015" strokeWidth="4.6" fill="none" strokeLinecap="round" />
      </Lay>
      <b className="scene-say witch-say">Hé hé hé !</b>
    </div>
  );
}

/* ==========================================================================
   Nouvel an : Pulse au chapeau pointu, langue de belle-mère et cierge magique.
   ========================================================================== */

const PV: [number, number] = [260, 210];

export function PartyCast() {
  const id = 'scY';
  const P = at(130, 128, 46);
  return (
    <div className="actor party">
      <Lay vb={PV} cls="body">
        <defs>
          <GlassDefs id={id} light={['#a8740d', '#ffd166', '#fff6d6']} />
          <Filters id={id} />
          <linearGradient id={`${id}gold`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff0b3" />
            <stop offset="1" stopColor="#e0a92e" />
          </linearGradient>
          <clipPath id={`${id}cone`}>
            <path d="M42 27 61-16l19 43c-12 4-26 4-38 0Z" />
          </clipPath>
        </defs>
        <g transform={P}>
          <Ball id={id} />
          <ellipse cx="36" cy="70" rx="7" ry="4" fill="#ffb3a8" opacity="0.5" filter={`url(#${id}blur)`} />
          <ellipse cx="84" cy="70" rx="7" ry="4" fill="#ffb3a8" opacity="0.5" filter={`url(#${id}blur)`} />
          {/* Chapeau pointu à rayures, élastique, pompon. */}
          <g transform="rotate(10 61 26)">
            <path d="M42 27 61-16l19 43c-12 4-26 4-38 0Z" fill={`url(#${id}gold)`} />
            <g clipPath={`url(#${id}cone)`} stroke="#7e5bff" strokeWidth="5">
              <path d="M30 20 92 2M30 34 92 16M30 6l62-18" />
            </g>
            <g clipPath={`url(#${id}cone)`} stroke="#ff6b8b" strokeWidth="2.4">
              <path d="M30 27 92 9M30 13l62-18" />
            </g>
            <path d="M44 27c10 3 24 3 34 0" stroke="#fff" strokeOpacity="0.4" strokeWidth="1.4" fill="none" />
            <g fill="#fff3c4">
              <circle cx="61" cy="-17" r="5" />
              <circle cx="56" cy="-20" r="3.4" />
              <circle cx="66" cy="-21" r="3.6" />
              <circle cx="61" cy="-24" r="3.2" />
            </g>
          </g>
        </g>
        {/* La main droite qui fête. */}
        <Hand id={id} x={196} y={162} r={8.5} tint="#ffd166" />
      </Lay>
      <Lay vb={PV} cls="eyes open">
        <g transform={P} filter={`url(#${id}glow)`}>
          <EyesOpen dy={-2} />
        </g>
      </Lay>
      <Lay vb={PV} cls="eyes happy">
        <g transform={P} filter={`url(#${id}glow)`}>
          <EyesHappy dy={-3} />
        </g>
      </Lay>
      {/* La langue de belle-mère : roulée, puis déroulée quand Pulse souffle. */}
      <Lay vb={PV} cls="horn coil" pivot={[132, 150]}>
        <path d="M128 150c8 2 14 0 16-6 2-7-3-12-9-11-5 1-7 6-4 9 2 2 5 1 5-1" stroke="#ff6b8b" strokeWidth="5" fill="none" strokeLinecap="round" />
        <path d="M128 150c8 2 14 0 16-6 2-7-3-12-9-11" stroke="#ffd166" strokeWidth="1.6" fill="none" strokeDasharray="3 4" strokeLinecap="round" />
        <rect x="120" y="145" width="11" height="9" rx="2.5" fill="#7e5bff" />
      </Lay>
      <Lay vb={PV} cls="horn blow" pivot={[124, 150]}>
        <path d="M124 150c30-2 58-8 86-22" stroke="#ff6b8b" strokeWidth="6.4" fill="none" strokeLinecap="round" />
        <path d="M128 149c28-2 56-8 82-21" stroke="#ffd166" strokeWidth="2" fill="none" strokeDasharray="5 6" strokeLinecap="round" />
        <path d="M210 128l14-9M211 130l16-2M211 132l13 7" stroke="#c9a7ff" strokeWidth="2.2" strokeLinecap="round" />
        <rect x="118" y="145" width="11" height="9" rx="2.5" fill="#7e5bff" />
      </Lay>
      {/* Le cierge magique, dans la main gauche : il crépite tout le temps. */}
      <Lay vb={PV} cls="sparkler" pivot={[66, 166]}>
        <path d="M66 166 46 102" stroke="#9aa3ad" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="45" cy="99" r="11" fill="#ffd166" opacity="0.35" filter={`url(#${id}blur)`} />
        <circle cx="45" cy="99" r="3.6" fill="#fffbe6" />
        <Hand id={id} x={66} y={166} r={8.5} tint="#ffd166" />
      </Lay>
      <Lay vb={PV} cls="sparkler sparks s0" pivot={[66, 166]}>
        <path d="M45 91v-8M53 99h8M45 107v6M37 99h-8M51 93l6-6M51 105l5 5M39 93l-5-6M39 105l-6 5" stroke="#fff3c4" strokeWidth="1.4" strokeLinecap="round" />
      </Lay>
      <Lay vb={PV} cls="sparkler sparks s1" pivot={[66, 166]}>
        <path d="M49 89l3-7M55 96l7-3M50 108l3 6M36 104l-6 3M38 90l-3-6M56 102l6 2" stroke="#ffd166" strokeWidth="1.2" strokeLinecap="round" />
      </Lay>
      <b className="scene-say party-say">Pouêt !</b>
    </div>
  );
}

/* ==========================================================================
   Pâques : Pulse en lapin, panier au bras ; un poussin sort de l'œuf déposé.
   ========================================================================== */

const BV: [number, number] = [210, 200];

export function BunnyCast() {
  const id = 'scP';
  const B = at(96, 128, 40);
  return (
    <div className="actor bunny2">
      <div className="hop">
        {/* Les oreilles, qui suivent chaque bond avec un temps de retard. */}
        <Lay vb={BV} cls="ear l" pivot={[86, 94]}>
          <defs>
            <linearGradient id={`${id}ear`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="1" stopColor="#d8d0c6" />
            </linearGradient>
          </defs>
          <path d="M76 94C68 70 66 40 74 22c4-8 14-8 16 2 4 20 2 48-4 72Z" fill={`url(#${id}ear)`} />
          <path d="M79 86c-5-18-6-40-1-54 2-5 7-5 8 1 2 16 1 36-2 53Z" fill="#ffb3c7" />
          <path d="M78 30c-2 10-2 24 0 36" stroke="#fff" strokeOpacity="0.6" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </Lay>
        <Lay vb={BV} cls="ear r" pivot={[108, 94]}>
          <path d="M104 94c4-22 12-40 26-50 8-6 18-2 14 8-6 12-16 28-30 46Z" fill={`url(#${id}ear)`} />
          <path d="M108 86c5-16 12-30 22-37 4-3 9-1 7 3-5 10-14 22-25 35Z" fill="#ffb3c7" />
        </Lay>
        <Lay vb={BV} cls="body">
          <defs>
            <GlassDefs id={id} light={['#d9a400', '#ffe066', '#fffbe6']} />
            <Filters id={id} />
            <linearGradient id={`${id}wick`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#e2b26a" />
              <stop offset="1" stopColor="#9a6a2c" />
            </linearGradient>
          </defs>
          {/* Queue en pompon, à l'arrière. */}
          <g fill="#f4f1ec">
            <circle cx="50" cy="150" r="10" />
            <circle cx="44" cy="142" r="7" />
            <circle cx="46" cy="157" r="6.5" />
            <circle cx="40" cy="150" r="6" fill="#ffffff" />
          </g>
          <g transform={B}>
            <Ball id={id} />
            <ellipse cx="38" cy="70" rx="7" ry="4" fill="#ff8fab" opacity="0.55" filter={`url(#${id}blur)`} />
            <ellipse cx="86" cy="70" rx="7" ry="4" fill="#ff8fab" opacity="0.55" filter={`url(#${id}blur)`} />
            {/* Truffe, bouche, moustaches. */}
            <path d="M58 66c3-2 9-2 11 0-1 3-3 5-5.5 5S59 69 58 66Z" fill="#ff8fa3" />
            <path d="M63.5 71v3c-2 3-6 3-7 0M63.5 74c2 3 6 3 7 0" stroke="#ffd6e2" strokeWidth="1.6" fill="none" strokeLinecap="round" />
            <g stroke="#f4f1ec" strokeOpacity="0.75" strokeWidth="1.3" strokeLinecap="round">
              <path d="M52 68 34 64M52 71l-18 2M76 68l18-4M76 71l18 2" />
            </g>
          </g>
          {/* Le panier, tenu devant. */}
          <ellipse cx="160" cy="150" rx="11" ry="13" fill="#b8f2c8" />
          <ellipse cx="174" cy="148" rx="10" ry="12.5" fill="#ffb3c7" />
          <path d="M152 146c4 2 12 2 16 0M166 144c4 2 12 2 16 0" stroke="#fff1b0" strokeWidth="2" fill="none" />
          <path d="M146 140c2-26 42-26 44 0" stroke={`url(#${id}wick)`} strokeWidth="3.4" fill="none" strokeLinecap="round" />
          <path d="M144 150h48l-5 24c-1 4-4 6-8 6h-22c-4 0-7-2-8-6Z" fill={`url(#${id}wick)`} />
          <path d="M146 158h44M148 166h40M150 174h36M158 152v26M168 152v28M178 152v26" stroke="#7a4f1e" strokeWidth="1" opacity="0.55" />
          <path d="M143 151h50" stroke="#f0c98a" strokeWidth="3" strokeLinecap="round" />
          <Hand id={id} x={150} y={146} r={7.5} tint="#ffe066" />
        </Lay>
        <Lay vb={BV} cls="eyes open" pivot={[100, 123]}>
          <g transform={B} filter={`url(#${id}glow)`}>
            <EyesOpen dx={4} dy={-3} h={13} />
          </g>
        </Lay>
        <Lay vb={BV} cls="eyes happy">
          <g transform={B} filter={`url(#${id}glow)`}>
            <EyesHappy dx={4} dy={-4} />
          </g>
        </Lay>
      </div>
    </div>
  );
}

/** L'œuf peint, qui se dandine, se fend, et laisse sortir un poussin de verre. */
export function EggCast() {
  const id = 'scE';
  const EV: [number, number] = [80, 96];
  // Ligne de la fêlure : les deux moitiés sont le même œuf, coupé le long de ce zigzag.
  const zig = 'M6 50 14 43l7 8 7-9 7 8 7-8 7 9 7-8 7 8 7-7';
  const egg = (
    <>
      <ellipse cx="40" cy="58" rx="27" ry="33" fill={`url(#${id}shell)`} />
      <path d="M14 58c8-6 16 6 26 0s18 6 26 0" stroke="#fff1b0" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M16 72c8 5 16 5 24 0s16-5 24 0" stroke="#7fe0a8" strokeWidth="3.4" fill="none" strokeLinecap="round" />
      <circle cx="28" cy="40" r="3" fill="#ffb3c7" />
      <circle cx="46" cy="34" r="2.4" fill="#fff" />
      <circle cx="54" cy="44" r="2.6" fill="#ffb3c7" />
      <circle cx="40" cy="83" r="2.6" fill="#fff" />
      <ellipse cx="27" cy="50" rx="4" ry="9" fill="#fff" opacity="0.3" />
    </>
  );
  return (
    <div className="actor egg2">
      <Lay vb={EV} cls="chick">
        <defs>
          <GlassDefs id={`${id}c`} glass={['#fff4b8', '#ffd84d', '#d99a00']} light={['#ffb000', '#ffe680', '#ffffff']} />
          <Filters id={`${id}c`} />
        </defs>
        <g transform={at(40, 46, 17)}>
          <Ball id={`${id}c`} halo={false} />
          <path d="M18 70c-8-2-12 6-6 10M102 70c8-2 12 6 6 10" stroke="#ffcf3a" strokeWidth="6" fill="none" strokeLinecap="round" />
          <g fill="#2a1d05">
            <rect x="44" y="46" width="8" height="12" rx="4" />
            <rect x="68" y="46" width="8" height="12" rx="4" />
          </g>
          <circle cx="47" cy="49" r="1.6" fill="#fff" />
          <circle cx="71" cy="49" r="1.6" fill="#fff" />
          <path d="M52 64h16l-8 10Z" fill="#ff8a1f" />
          <path d="M52 64h16l-8 4Z" fill="#ffb35c" />
          <ellipse cx="36" cy="68" rx="6" ry="3.4" fill="#ff9a76" opacity="0.6" />
          <ellipse cx="84" cy="68" rx="6" ry="3.4" fill="#ff9a76" opacity="0.6" />
        </g>
      </Lay>
      <Lay vb={EV} cls="shell-bottom">
        <defs>
          <radialGradient id={`${id}shell`} cx="38%" cy="32%" r="80%">
            <stop offset="0" stopColor="#efe4ff" />
            <stop offset="0.5" stopColor="#c7aaff" />
            <stop offset="1" stopColor="#8d6be8" />
          </radialGradient>
          <clipPath id={`${id}lo`}>
            <path d={`${zig}V100H0V50Z`} />
          </clipPath>
          <clipPath id={`${id}hi`}>
            <path d={`${zig}V0H0V50Z`} />
          </clipPath>
          <clipPath id={`${id}egg`}>
            <ellipse cx="40" cy="58" rx="27" ry="33" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${id}lo)`}>{egg}</g>
      </Lay>
      <Lay vb={EV} cls="shell-top" pivot={[40, 46]}>
        <g clipPath={`url(#${id}hi)`}>{egg}</g>
      </Lay>
      <Lay vb={EV} cls="crack">
        <path d={zig} stroke="#5b3fa8" strokeWidth="1.8" fill="none" strokeLinejoin="round" clipPath={`url(#${id}egg)`} />
      </Lay>
      <b className="scene-say egg-say">Piou !</b>
    </div>
  );
}
