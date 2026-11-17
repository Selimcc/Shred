// Le décor d'ambiance des fêtes, derrière le contenu : chauves-souris et toile d'araignée, neige et guirlande,
// feux d'artifice, cœurs, pétales. Rien de cliquable, tout en CSS ; figé si l'utilisateur réduit les animations.
import type { CSSProperties } from 'react';
import type { SeasonId } from '../lib/season';

/** Pseudo-hasard stable : le décor ne saute pas d'un rendu à l'autre. */
const rnd = (i: number, salt: number) => {
  const x = Math.sin(i * 91.7 + salt * 47.3) * 24634.6345;
  return x - Math.floor(x);
};
const css = (o: Record<string, string | number | undefined>) => o as CSSProperties;

function Bat() {
  return (
    <svg viewBox="0 0 64 28" aria-hidden="true">
      <path
        className="bat-wings"
        d="M32 9c-2 0-3 1.5-3.5 3C25 7 18 4 9 5c4 2 6 5 6 8-3-1.5-7-1.5-10 .5 4 .5 7 3 8 6 4-3 10-4 15-1.5 1 2 2.5 3 4 3s3-1 4-3c5-2.5 11-1.5 15 1.5 1-3 4-5.5 8-6-3-2-7-2-10-.5 0-3 2-6 6-8-9-1-16 2-19.5 7C35 10.5 34 9 32 9Z"
      />
      <circle cx="30.5" cy="12" r="0.9" className="bat-eye" />
      <circle cx="33.5" cy="12" r="0.9" className="bat-eye" />
    </svg>
  );
}

function Halloween() {
  return (
    <>
      <div className="sl-moon" />
      <svg className="sl-web" viewBox="0 0 140 140" aria-hidden="true">
        <g fill="none" stroke="currentColor" strokeWidth="0.8">
          {[0, 18, 36, 54, 72, 90].map((a) => (
            <path key={a} d={`M0 0 L${Math.round(140 * Math.cos((a * Math.PI) / 180))} ${Math.round(140 * Math.sin((a * Math.PI) / 180))}`} />
          ))}
          {[26, 50, 76, 104].map((r) => (
            <path
              key={r}
              d={`M${r} 0 Q${r * 0.78} ${r * 0.2} ${r * 0.95} ${r * 0.31} Q${r * 0.7} ${r * 0.45} ${r * 0.81} ${r * 0.59} Q${r * 0.55} ${r * 0.62} ${r * 0.59} ${r * 0.81} Q${r * 0.4} ${r * 0.72} ${r * 0.31} ${r * 0.95} Q${r * 0.18} ${r * 0.78} 0 ${r}`}
            />
          ))}
        </g>
      </svg>
      <div className="sl-spider">
        <i />
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none">
            <path d="M8 10 3 6M8 12H2M8 14l-5 4M16 10l5-4M16 12h6M16 14l5 4" />
          </g>
          <ellipse cx="12" cy="12.5" rx="4.5" ry="5" fill="currentColor" />
          <circle cx="10.6" cy="11" r="0.9" fill="#ff8a1f" />
          <circle cx="13.4" cy="11" r="0.9" fill="#ff8a1f" />
        </svg>
      </div>
      <div className="sl-fog a" />
      <div className="sl-fog b" />
    </>
  );
}

function Snow({ n, front }: { n: number; front?: boolean }) {
  return (
    <div className={`sl-snow ${front ? 'front' : ''}`}>
      {Array.from({ length: n }, (_, j) => {
        // Les flocons de devant ne doublent pas ceux de derrière.
        const i = front ? j + 100 : j;
        const size = front ? 2 + rnd(i, 9) * 2 : 2 + rnd(i, 3) * 4;
        return (
          <i
            key={j}
            style={css({
              left: `${rnd(i, 4) * 100}%`,
              width: size,
              height: size,
              opacity: front ? 0.5 : 0.35 + rnd(i, 5) * 0.5,
              animationDuration: `${(front ? 7 : 10) + rnd(i, 6) * 9}s`,
              animationDelay: `${-rnd(i, 7) * 18}s`,
              '--sway': `${Math.round((rnd(i, 8) - 0.5) * 70)}px`,
              '--y': Math.round(rnd(i, 10) * 90),
              filter: size > 4.5 ? 'blur(1px)' : undefined,
            })}
          />
        );
      })}
    </div>
  );
}

function Garland() {
  // Un feston de fil avec quatre ampoules, répété sur toute la largeur ; deux calques de lueurs alternent.
  const bulbs = [
    [24, 13, '#ff4d5e'],
    [52, 21, '#ffd166'],
    [80, 21, '#4fd18b'],
    [108, 13, '#9fd4ff'],
  ] as const;
  const wire = `<path d='M0 3 Q65 30 130 3' fill='none' stroke='%23324238' stroke-width='1.6'/>`;
  const bulb = (x: number, y: number, c: string) =>
    `<rect x='${x - 1.6}' y='${y - 2}' width='3.2' height='3' rx='0.8' fill='%23526158'/><ellipse cx='${x}' cy='${y + 4.2}' rx='2.9' ry='4.2' fill='${c.replace('#', '%23')}'/>`;
  const glow = (pick: number[]) =>
    `<filter id='b'><feGaussianBlur stdDeviation='3'/></filter>` +
    bulbs
      .filter((_, i) => pick.includes(i))
      .map(([x, y, c]) => `<circle cx='${x}' cy='${y + 4}' r='7' fill='${c.replace('#', '%23')}' filter='url(%23b)'/>`)
      .join('');
  const svg = (body: string) => `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='130' height='40' viewBox='0 0 130 40'>${body}</svg>")`;
  return (
    <div className="sl-garland" aria-hidden="true">
      <div className="g-glow a" style={{ backgroundImage: svg(glow([0, 2])) }} />
      <div className="g-glow b" style={{ backgroundImage: svg(glow([1, 3])) }} />
      <div className="g-wire" style={{ backgroundImage: svg(wire + bulbs.map(([x, y, c]) => bulb(x, y, c)).join('')) }} />
    </div>
  );
}

function Fireworks() {
  const spots = [
    [18, 9, '#ffd166', 0],
    [78, 6, '#c9a7ff', 2.3],
    [56, 16, '#fff3c4', 4.1],
  ] as const;
  return (
    <>
      {spots.map(([x, y, c, d], k) => (
        <div key={k} className="sl-burst" style={css({ left: `${x}%`, top: `${y}%`, color: c, animationDelay: `${d}s` })}>
          {Array.from({ length: 14 }, (_, i) => (
            <i key={i} style={css({ '--a': `${(i * 360) / 14}deg`, animationDelay: `${d}s` })} />
          ))}
        </div>
      ))}
      <Rising n={16} kind="spark" />
    </>
  );
}

function Rising({ n, kind }: { n: number; kind: 'spark' | 'heart' }) {
  return (
    <div className={`sl-rise ${kind}`}>
      {Array.from({ length: n }, (_, i) => (
        <i
          key={i}
          style={css({
            left: `${4 + rnd(i, 11) * 92}%`,
            animationDuration: `${(kind === 'heart' ? 13 : 9) + rnd(i, 12) * 9}s`,
            animationDelay: `${-rnd(i, 13) * 20}s`,
            '--sway': `${Math.round((rnd(i, 14) - 0.5) * 80)}px`,
            '--s': (0.6 + rnd(i, 15) * 0.8).toFixed(2),
            color: kind === 'heart' ? ['#ff4d7d', '#ff8fab', '#ffc2d1'][i % 3] : ['#ffd166', '#fff3c4', '#e8c07a'][i % 3],
          })}
        >
          {kind === 'heart' && (
            <svg viewBox="0 0 24 22" aria-hidden="true">
              <path
                d="M12 21s-8.5-5.4-10.6-10.3C-.1 5.8 3.5 1 7.8 1c2 0 3.4 1 4.2 2.4C12.8 2 14.2 1 16.2 1c4.3 0 7.9 4.8 6.4 9.7C20.5 15.6 12 21 12 21Z"
                fill="currentColor"
              />
            </svg>
          )}
        </i>
      ))}
    </div>
  );
}

function Petals() {
  return (
    <div className="sl-petals">
      {Array.from({ length: 18 }, (_, i) => (
        <i
          key={i}
          style={css({
            left: `${rnd(i, 21) * 100}%`,
            background: ['#ffc2d1', '#fff1b0', '#d8c8ff', '#c8f2d6'][i % 4],
            animationDuration: `${12 + rnd(i, 22) * 10}s`,
            animationDelay: `${-rnd(i, 23) * 22}s`,
            '--sway': `${Math.round((rnd(i, 24) - 0.5) * 120)}px`,
            '--spin': `${Math.round(180 + rnd(i, 25) * 540)}deg`,
            '--y': Math.round(rnd(i, 26) * 90),
          })}
        />
      ))}
    </div>
  );
}

/** Deux chauves-souris traversent l'écran de temps en temps, devant le contenu (rien de cliquable). */
function Bats() {
  return (
    <div className="season-front" aria-hidden="true">
      {[0, 1].map((i) => (
        <div key={i} className="sl-bat" style={css({ top: `${22 + i * 30 + rnd(i, 1) * 10}%`, animationDelay: `${4 + i * 13}s`, '--s': 0.75 + i * 0.25 })}>
          <Bat />
        </div>
      ))}
    </div>
  );
}

export function SeasonLayer({ season }: { season: SeasonId | null }) {
  if (!season) return null;
  return (
    <>
      <div className={`season-layer sl-${season}`} aria-hidden="true">
        {season === 'halloween' && <Halloween />}
        {season === 'noel' && <Snow n={52} />}
        {season === 'nouvel-an' && <Fireworks />}
        {season === 'saint-valentin' && <Rising n={14} kind="heart" />}
        {season === 'paques' && <Petals />}
      </div>
      {season === 'noel' && <Garland />}
      {season === 'halloween' && <Bats />}
      {season === 'noel' && (
        <div className="season-front" aria-hidden="true">
          <Snow n={12} front />
        </div>
      )}
    </>
  );
}
