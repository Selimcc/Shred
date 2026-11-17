// La scène de la fête, qui passe de temps en temps devant l'écran : Cupidon tire sa flèche dans un cœur, le
// traîneau du père Noël traverse le ciel, une sorcière passe sur son balai avec son chat, une fusée éclate en
// bouquet avec l'année, un lapin dépose un œuf. Dessins originaux, rien de cliquable, rien si les animations
// sont réduites. Elle se joue peu après l'ouverture, puis toutes les quelques minutes, ou à la demande
// (événement « shred:season-scene », envoyé par la page des réglages).
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import type { SeasonId } from '../lib/season';

/** Durée de chaque scène, en ms (les @keyframes du CSS sont réglées sur la même durée). */
export const SCENE_MS: Record<SeasonId, number> = {
  halloween: 6500,
  noel: 7000,
  'nouvel-an': 5600,
  'saint-valentin': 6200,
  paques: 6500,
};
const EVERY_MS = 3 * 60_000;

const css = (o: Record<string, string | number>) => o as CSSProperties;
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Rejouer la scène tout de suite (aperçu dans les réglages). */
export function playSeasonScene() {
  window.dispatchEvent(new Event('shred:season-scene'));
}

const smallHeart = 'M12 21s-8.5-5.4-10.6-10.3C-.1 5.8 3.5 1 7.8 1c2 0 3.4 1 4.2 2.4C12.8 2 14.2 1 16.2 1c4.3 0 7.9 4.8 6.4 9.7C20.5 15.6 12 21 12 21Z';

function Cupid() {
  return (
    <>
      <div className="cupid">
        <div className="cupid-bob">
          <svg viewBox="0 0 140 120" aria-hidden="true">
            <g className="cupid-wing back">
              <path d="M50 58C38 34 16 28 6 38c8 1 13 5 13 9-8 0-13 6-11 12 8-3 15-1 19 3-4 4-2 10 4 12 8-6 14-11 19-16Z" fill="#ffe3ea" />
            </g>
            <path d="M47 77q-8 6-9 17" stroke="#ffd2bd" strokeWidth="9" strokeLinecap="round" />
            <path d="M66 80q8 6 6 16" stroke="#ffd2bd" strokeWidth="9" strokeLinecap="round" />
            <ellipse cx="57" cy="70" rx="16" ry="17" fill="#ffd9c6" />
            <path d="M42 74q15 16 30 0l-1 9q-14 12-28 0Z" fill="#ff8fab" />
            <path d="M44 62q14-8 26 4" stroke="#ff4d7d" strokeWidth="3" fill="none" strokeLinecap="round" />
            <g className="cupid-wing front">
              <path d="M54 56C46 30 26 20 14 26c8 3 12 8 11 12-8-2-14 3-13 9 8-1 14 2 17 7-5 3-4 9 2 12 9-4 16-8 21-12Z" fill="#ffffff" />
              <path d="M30 34q8 4 12 14M24 46q8 2 12 9" stroke="#ffc2d1" strokeWidth="1.4" fill="none" strokeLinecap="round" />
            </g>
            <circle cx="61" cy="38" r="17" fill="#ffe2d1" />
            <g fill="#ffcf6b">
              <circle cx="47" cy="30" r="6" />
              <circle cx="53" cy="23.5" r="6.5" />
              <circle cx="61.5" cy="21" r="6.5" />
              <circle cx="70" cy="23.5" r="6" />
              <circle cx="76" cy="30" r="5" />
              <circle cx="45" cy="38" r="4.2" />
            </g>
            <circle cx="53" cy="45" r="3.2" fill="#ff9eb5" opacity="0.75" />
            <circle cx="71" cy="44" r="3" fill="#ff9eb5" opacity="0.75" />
            <g stroke="#5a3a2e" strokeWidth="1.8" fill="none" strokeLinecap="round">
              <path d="M52 38q3-3 6 0" />
              <path d="M65 37.5q3-3 6 0" />
            </g>
            <path d="M58 47q4 4 8 0" stroke="#c0566e" strokeWidth="1.8" fill="none" strokeLinecap="round" />
            {/* L'arc, la corde au repos ou tendue, la flèche encochée. */}
            <path d="M100 26Q120 58 100 90" fill="none" stroke="#c98b2e" strokeWidth="3.6" strokeLinecap="round" />
            <path className="cupid-string rest" d="M100 26V90" stroke="#fff6e8" strokeWidth="1.1" />
            <path className="cupid-string drawn" d="M100 26 74 58l26 32" stroke="#fff6e8" strokeWidth="1.1" fill="none" />
            <path d="M68 62 100 58" stroke="#ffd9c6" strokeWidth="7" strokeLinecap="round" />
            <g className="cupid-held">
              <path d="M86 58h40" stroke="#8a5a2b" strokeWidth="2.4" />
              <path d="M86 58l-6-4.5M86 58l-6 4.5M90 58l-6-4.5M90 58l-6 4.5" stroke="#ff8fab" strokeWidth="1.6" strokeLinecap="round" />
              <path d={smallHeart} transform="translate(122 52.5) scale(0.5)" fill="#ff4d7d" />
              <path d="M68 64 86 58" stroke="#ffd2bd" strokeWidth="6.5" strokeLinecap="round" />
            </g>
          </svg>
        </div>
      </div>
      <div className="cupid-arrow">
        <svg viewBox="0 0 100 12" aria-hidden="true">
          <path d="M4 6h88" stroke="#8a5a2b" strokeWidth="2.4" />
          <path d="M4 6-2 1.5M4 6l-6 4.5M8 6 2 1.5M8 6l-6 4.5" stroke="#ff8fab" strokeWidth="1.6" strokeLinecap="round" />
          <path d={smallHeart} transform="translate(88 0.5) scale(0.5)" fill="#ff4d7d" />
        </svg>
      </div>
      <div className="cupid-target">
        <svg viewBox="0 0 24 22" aria-hidden="true">
          <path d={smallHeart} fill="#ff4d7d" stroke="#ffc2d1" strokeWidth="1" />
          <path d="M6 7q2-3 5-3" stroke="#fff" strokeOpacity="0.6" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </div>
      <div className="cupid-burst">
        {Array.from({ length: 10 }, (_, i) => (
          <i key={i} style={css({ '--a': `${i * 36}deg`, color: ['#ff4d7d', '#ff8fab', '#ffc2d1'][i % 3] })}>
            <svg viewBox="0 0 24 22" aria-hidden="true">
              <path d={smallHeart} fill="currentColor" />
            </svg>
          </i>
        ))}
      </div>
    </>
  );
}

function Reindeer({ x, lead }: { x: number; lead?: boolean }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <g className="leg back">
        <path d="M44 54l12 10" stroke="#6b4428" strokeWidth="3" strokeLinecap="round" />
      </g>
      <g className="leg front">
        <path d="M16 54 4 62" stroke="#6b4428" strokeWidth="3" strokeLinecap="round" />
      </g>
      <ellipse cx="30" cy="50" rx="19" ry="9" fill="#8b5a3c" />
      <path d="M48 47q6-2 7 3" stroke="#f3e6d8" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M16 47 9 33" stroke="#8b5a3c" strokeWidth="8" strokeLinecap="round" />
      <ellipse cx="6" cy="30" rx="8" ry="5.5" fill="#8b5a3c" />
      <g stroke="#d9b98c" strokeWidth="1.8" fill="none" strokeLinecap="round">
        <path d="M8 26 11 15M10 20 6 16M11 15l4-3M10 18l5 1" />
        <path d="M4 26 3 17M3 21 0 18M3 17l-1-4" />
      </g>
      <circle cx="3" cy="28.5" r="1.1" fill="#1c120b" />
      <circle cx="-2" cy="31" r={lead ? 3 : 2} fill={lead ? '#ff3b3b' : '#2a1b12'} className={lead ? 'rudolph' : undefined} />
      <g className="leg front b">
        <path d="M20 55 9 64" stroke="#8b5a3c" strokeWidth="3" strokeLinecap="round" />
      </g>
      <g className="leg back b">
        <path d="M40 55l14 7" stroke="#8b5a3c" strokeWidth="3" strokeLinecap="round" />
      </g>
    </g>
  );
}

function Sleigh() {
  return (
    <div className="sleigh">
      <svg viewBox="-10 -14 320 96" aria-hidden="true">
        {/* Traînée d'étoiles derrière le traîneau. */}
        <g className="sleigh-trail">
          {Array.from({ length: 9 }, (_, i) => (
            <circle
              key={i}
              cx={262 + i * 6}
              cy={58 - (i % 3) * 5}
              r={2.4 - i * 0.22}
              fill={i % 2 ? '#ffd166' : '#ffffff'}
              style={css({ animationDelay: `${i * 0.12}s` })}
            />
          ))}
        </g>
        <path d="M58 49 150 58M140 52l10 6" stroke="#ffd166" strokeWidth="1.3" fill="none" />
        <Reindeer x={20} lead />
        <Reindeer x={86} />
        <path d="M232 36q8-16 22-8l-4 18z" fill="#3a6b3f" />
        <rect x="226" y="26" width="10" height="10" rx="1.5" fill="#ffd166" />
        <rect x="238" y="22" width="9" height="9" rx="1.5" fill="#9fd4ff" />
        <circle cx="198" cy="40" r="13" fill="#d62839" />
        <rect x="185" y="41" width="26" height="4" fill="#1c120b" />
        <circle cx="200" cy="22" r="8" fill="#ffd9c4" />
        <path d="M192 23q8 14 16 0q-1 9-8 10q-7-1-8-10Z" fill="#ffffff" />
        <path d="M192 18q8-14 18-4l3 6-21-2Z" fill="#d62839" />
        <circle cx="214" cy="20" r="3" fill="#ffffff" />
        <path d="M192 18h18" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
        <g className="santa-wave">
          <path d="M188 36q-9-6-10-16" stroke="#d62839" strokeWidth="5" fill="none" strokeLinecap="round" />
          <circle cx="178" cy="18" r="3.4" fill="#ffffff" />
        </g>
        <path d="M150 50h74q12 0 13-14l1-6h7v8q0 24-24 24h-66q-8 0-7-8z" fill="#d62839" />
        <path d="M156 54h66" stroke="#ffd166" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M146 72h88q12 0 14-10M150 72q-12 0-12-9q0-6 6-6" stroke="#ffd166" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <path d="M168 62v10M214 62v10" stroke="#ffd166" strokeWidth="2" />
        <text className="scene-says" x="172" y="2" fontSize="13" fontWeight="800" fill="#ffffff">
          Ho ho ho !
        </text>
      </svg>
    </div>
  );
}

function Witch() {
  return (
    <div className="witch">
      <svg viewBox="-6 -24 190 116" aria-hidden="true">
        <g className="witch-trail">
          {Array.from({ length: 8 }, (_, i) => (
            <circle
              key={i}
              cx={170 + i * 6}
              cy={50 + (i % 2 ? 4 : -3)}
              r={2.6 - i * 0.25}
              fill={i % 2 ? '#8be36b' : '#ff8a1f'}
              style={css({ animationDelay: `${i * 0.1}s` })}
            />
          ))}
        </g>
        <g fill="#140b1c">
          <path d="M18 60 142 50" stroke="#6b4a2a" strokeWidth="3.4" strokeLinecap="round" />
          <path d="M140 47l30-10q-6 14 2 26l-32-9z" fill="#c9a24a" />
          <path d="M146 49l20-7M146 53l22 0M146 56l20 6" stroke="#8a6a2a" strokeWidth="1" />
          {/* La cape qui flotte derrière. */}
          <path className="witch-cape" d="M72 26q22 6 52 2q-14 12 0 26q-28-2-46 4z" fill="#45226a" />
          <path d="M64 30q8-6 18 0l6 28q-14 4-28-2z" fill="#2c1745" />
          <path d="M62 56q-8 10-2 22l6-2q-2-8 4-16z" fill="#2c1745" />
          <path d="M58 76h-10q-2 3 2 4h10z" />
          <path d="M74 13q8 4 6 16l-6-2z" fill="#ff8a1f" />
          <circle cx="70" cy="20" r="8.5" fill="#9fd67a" />
          <path d="M62 20l-7 4 7 1z" fill="#9fd67a" />
          <path d="M65 24q3 2 6 0" stroke="#2c1745" strokeWidth="1.2" fill="none" strokeLinecap="round" />
          <path d="M54 12q16-6 32 0q-16 4-32 0z" fill="#2c1745" />
          <path d="M60 11q6-22 14-26q6-2 10 4l-6 2q-4 6-4 20z" fill="#2c1745" />
          <path d="M61 9q7 2 13 0l-.6-3.4q-6 1.6-11.6 0z" fill="#ff8a1f" />
          <path d="M72 30q-8 10-16 16l3 4q10-6 17-16z" fill="#2c1745" />
          <circle cx="57" cy="47" r="2.6" fill="#9fd67a" />
          {/* Le chat, assis au bout du balai. */}
          <g transform="translate(118 30)">
            <path d="M4 20q0-10 8-12q8 2 8 12z" />
            <circle cx="12" cy="6" r="5.5" />
            <path d="M7.5 3 8 -3l3 4zM16.5 3 16 -3l-3 4z" />
            <path className="cat-tail" d="M20 18q10-2 8-12" stroke="#140b1c" strokeWidth="2.2" fill="none" strokeLinecap="round" />
            <circle cx="10" cy="6" r="1" fill="#ffd166" />
            <circle cx="14" cy="6" r="1" fill="#ffd166" />
          </g>
        </g>
        <circle cx="67" cy="18.5" r="1.2" fill="#140b1c" />
        <text className="scene-says" x="22" y="-6" fontSize="13" fontWeight="800" fill="#ff8a1f">
          Hé hé hé !
        </text>
      </svg>
    </div>
  );
}

function NewYear({ today }: { today: string }) {
  // En janvier, l'année qui commence ; sinon (fin décembre, ou aperçu hors saison), celle qui arrive.
  const year = today.slice(5, 7) === '01' ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) + 1;
  const rings = [
    { n: 22, r: 128, colors: ['#ffd166', '#fff3c4'] },
    { n: 16, r: 86, colors: ['#c9a7ff', '#ff6b8b'] },
    { n: 10, r: 46, colors: ['#ffffff', '#ffe08a'] },
  ];
  return (
    <>
      <div className="ny-rocket" />
      <div className="ny-burst">
        {rings.flatMap((ring, k) =>
          Array.from({ length: ring.n }, (_, i) => (
            <i key={`${k}-${i}`} style={css({ '--a': `${(i * 360) / ring.n + k * 7}deg`, '--r': `${ring.r}px`, color: ring.colors[i % 2] })} />
          )),
        )}
      </div>
      <div className="ny-year">
        <span className="small">{today.slice(5, 7) === '12' ? 'Bientôt' : 'Bonne année'}</span>
        <b>{year}</b>
      </div>
    </>
  );
}

function Bunny() {
  return (
    <>
      <div className="bunny">
        <div className="bunny-hop">
          <svg viewBox="0 0 110 92" aria-hidden="true">
            <g className="bunny-ears">
              <ellipse cx="70" cy="18" rx="6.5" ry="19" fill="#f4f1ec" transform="rotate(-24 70 34)" />
              <ellipse cx="70" cy="19" rx="3" ry="13" fill="#ffb3c7" transform="rotate(-24 70 34)" />
              <ellipse cx="82" cy="16" rx="6.5" ry="19" fill="#ebe6df" transform="rotate(-8 82 34)" />
              <ellipse cx="82" cy="17" rx="3" ry="13" fill="#ffb3c7" transform="rotate(-8 82 34)" />
            </g>
            <ellipse cx="48" cy="62" rx="27" ry="20" fill="#f4f1ec" />
            <circle cx="38" cy="66" r="15" fill="#ebe6df" />
            <circle cx="21" cy="56" r="7.5" fill="#ffffff" />
            <circle cx="79" cy="44" r="15" fill="#f4f1ec" />
            <ellipse cx="74" cy="78" rx="7" ry="4" fill="#ebe6df" />
            <ellipse cx="44" cy="81" rx="10" ry="4" fill="#ebe6df" />
            <circle cx="85" cy="41" r="2.3" fill="#2b2420" />
            <circle cx="85.8" cy="40.2" r="0.7" fill="#ffffff" />
            <circle cx="93" cy="47" r="2.2" fill="#ff8fa3" />
            <circle cx="84" cy="50" r="3" fill="#ffb3c7" opacity="0.6" />
            <path d="M93 49l10-1M93 50l9 3" stroke="#c9c2b8" strokeWidth="0.8" />
          </svg>
        </div>
      </div>
      <div className="easter-egg">
        <svg viewBox="0 0 40 50" aria-hidden="true">
          <ellipse cx="20" cy="27" rx="16" ry="21" fill="#cdb4ff" />
          <path d="M4.5 22l5 5 5-5 5 5 5-5 5 5 5-5" stroke="#fff1b0" strokeWidth="2.6" fill="none" strokeLinejoin="round" />
          <path d="M5 34q15 6 30 0" stroke="#7fe0a8" strokeWidth="3" fill="none" />
          <circle cx="13" cy="13" r="2" fill="#ffb3c7" />
          <circle cx="25" cy="10" r="1.8" fill="#ffffff" />
          <circle cx="28" cy="42" r="2" fill="#ffb3c7" />
          <ellipse cx="13" cy="20" rx="3" ry="6" fill="#ffffff" opacity="0.35" />
        </svg>
      </div>
    </>
  );
}

export function SeasonScene({ season, today }: { season: SeasonId | null; today: string }) {
  const [run, setRun] = useState(0);
  const [on, setOn] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    if (!season) return;
    let stop = 0;
    const play = () => {
      // Une scène à la fois : un deuxième appel pendant qu'elle joue ne la relance pas.
      if (busy.current || reduced() || document.visibilityState !== 'visible') return;
      busy.current = true;
      setRun((r) => r + 1);
      setOn(true);
      stop = window.setTimeout(() => {
        busy.current = false;
        setOn(false);
      }, SCENE_MS[season] + 200);
    };
    const first = window.setTimeout(play, 1800);
    const every = window.setInterval(play, EVERY_MS);
    window.addEventListener('shred:season-scene', play);
    return () => {
      clearTimeout(first);
      clearTimeout(stop);
      clearInterval(every);
      window.removeEventListener('shred:season-scene', play);
      busy.current = false;
      setOn(false);
    };
  }, [season]);

  if (!season || !on) return null;
  return (
    <div key={run} className={`season-scene scene-${season}`} aria-hidden="true">
      {season === 'saint-valentin' && <Cupid />}
      {season === 'noel' && <Sleigh />}
      {season === 'halloween' && <Witch />}
      {season === 'nouvel-an' && <NewYear today={today} />}
      {season === 'paques' && <Bunny />}
    </div>
  );
}
