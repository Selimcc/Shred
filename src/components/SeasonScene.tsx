// La scène de la fête, jouée devant l'écran quelques secondes par la troupe de Pulse : Cupidon tire sa flèche
// dans un cœur ; le traîneau du père Noël traverse le ciel et lâche un cadeau ; la citrouille-sorcière passe
// sur son balai avec son chat ; Pulse fête le Nouvel an sous les feux d'artifice ; le lapin dépose un œuf d'où
// sort un poussin. Rien de cliquable, rien si les animations sont réduites.
//
// Quand : une fois par jour, sur l'écran Aujourd'hui, une fois l'écran posé (jamais par-dessus une feuille,
// une séance ou une fête de fin de journée). Ensuite seulement à la demande : le bouton de la fête en haut
// d'Aujourd'hui, la page des thèmes, le labo des admins (événement « shred:season-scene »).
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { reducedMotion } from '../lib/motion';
import { SEASONS, type SeasonId } from '../lib/season';
import { Arrow, CupidPulse, HEART, TargetHeart } from './CupidPulse';
import { BunnyCast, EggCast, GiftDrop, PartyCast, SleighCast, WitchCast } from './SeasonCast';

/** Durée de chaque scène, en ms (l'animation principale de chaque scène, dans le CSS, dure autant). */
export const SCENE_MS: Record<SeasonId, number> = {
  halloween: 7000,
  noel: 8000,
  'nouvel-an': 7200,
  'saint-valentin': 6200,
  paques: 7600,
};

const css = (o: Record<string, string | number>) => o as CSSProperties;

/** Rejouer la scène tout de suite (bouton de la fête, page des thèmes, labo des admins). */
export function playSeasonScene() {
  window.dispatchEvent(new Event('shred:season-scene'));
}

/* ---------- Une fois par jour ---------- */

const SEEN_KEY = 'shred:scene';

/** La scène du jour reste à jouer tant qu'elle n'a pas été vue pour cette fête, ce jour-là. */
export function sceneDue(seen: string | null, season: SeasonId, day: string): boolean {
  return seen !== `${season}:${day}`;
}
function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}
function markSeen(season: SeasonId, day: string) {
  try {
    localStorage.setItem(SEEN_KEY, `${season}:${day}`);
  } catch {
    // Stockage indisponible (navigation privée) : la scène pourra revenir, sans gravité.
  }
}

/** Quelque chose occupe l'écran : on attend que ce soit fini. */
function screenBusy(): boolean {
  if (document.visibilityState !== 'visible') return true;
  if (document.documentElement.dataset.overlay !== undefined) return true;
  return !!document.querySelector('.celebrate, .moment-big, .update-screen, .focus, .recap');
}

/* ---------- Les scènes ---------- */

function Cupid() {
  // Les dégradés de la flèche et du cœur sont ceux définis dans le dessin de Cupidon (même document).
  const id = 'cupid';
  return (
    <>
      <div className="cupid">
        <div className="cupid-bob">
          <CupidPulse id={id} />
        </div>
      </div>
      <div className="cupid-arrow">
        <svg viewBox="-2 -8 92 16" aria-hidden="true">
          <path d="M-14 0H6" stroke="#ff8fab" strokeOpacity="0.5" strokeWidth="3" strokeLinecap="round" className="arrow-trail" />
          <Arrow id={id} len={88} />
        </svg>
      </div>
      <div className="cupid-target">
        <TargetHeart id={id} />
      </div>
      <div className="cupid-burst">
        {Array.from({ length: 12 }, (_, i) => (
          <i key={i} style={css({ '--a': `${i * 30}deg`, color: ['#ff4d7d', '#ff8fab', '#ffd1dc'][i % 3], '--s': i % 2 ? 0.7 : 1 })}>
            <svg viewBox="0 0 24 22" aria-hidden="true">
              <path d={HEART} fill="currentColor" />
            </svg>
          </i>
        ))}
      </div>
    </>
  );
}

function Noel() {
  return (
    <>
      <SleighCast />
      <GiftDrop />
    </>
  );
}

/** Un bouquet : une fusée monte, éclate, les étincelles retombent en scintillant. */
function Firework({ k, n, colors }: { k: number; n: number; colors: string[] }) {
  return (
    <>
      <div className={`ny-shell s${k}`} />
      <div className={`ny-burst2 b${k}`}>
        <b className="flash" />
        {Array.from({ length: n }, (_, i) => (
          <i
            key={i}
            style={css({
              '--a': `${((i * 360) / n + k * 11).toFixed(1)}deg`,
              '--r': `${(k === 3 ? 138 : 90) * (i % 3 === 0 ? 0.6 : 1)}px`,
              color: colors[i % colors.length],
            })}
          />
        ))}
      </div>
    </>
  );
}

function NewYear({ today }: { today: string }) {
  // En janvier, l'année qui commence ; sinon (fin décembre, ou aperçu hors saison), celle qui arrive.
  const january = today.slice(5, 7) === '01';
  const year = Number(today.slice(0, 4)) + (january ? 0 : 1);
  const confetti = ['#ffd166', '#fff3c4', '#c9a7ff', '#ff6b8b', '#6fdcb0', '#ffffff'];
  return (
    <>
      <div className="ny-dim" />
      <Firework k={1} n={18} colors={['#c9a7ff', '#ffffff', '#ff6b8b']} />
      <Firework k={2} n={18} colors={['#6fdcb0', '#fff3c4', '#ffd166']} />
      <Firework k={3} n={30} colors={['#ffd166', '#fff3c4', '#ffffff', '#ffe08a']} />
      <div className="ny-year2">
        <span>{today.slice(5, 7) === '12' ? 'Bientôt' : 'Bonne année'}</span>
        <b>{year}</b>
      </div>
      <div className="ny-confetti">
        {Array.from({ length: 28 }, (_, i) => (
          <i
            key={i}
            style={css({
              left: `${((i * 37) % 100) + 0.5}%`,
              background: confetti[i % confetti.length],
              animationDelay: `${(4.1 + ((i * 7) % 11) * 0.06).toFixed(2)}s`,
              '--x': `${((i * 53) % 60) - 30}px`,
              '--spin': `${360 + ((i * 97) % 540)}deg`,
              '--w': `${5 + (i % 3) * 2}px`,
            })}
          />
        ))}
      </div>
      <PartyCast />
    </>
  );
}

function Paques() {
  return (
    <>
      <EggCast />
      <BunnyCast />
    </>
  );
}

export function SeasonScene({ season, today, day, auto }: { season: SeasonId | null; today: string; day: string; auto: boolean }) {
  const [run, setRun] = useState(0);
  const [on, setOn] = useState(false);
  const busy = useRef(false);
  const stop = useRef(0);

  /** Lance la scène (et la compte comme vue aujourd'hui, même rejouée à la main). */
  const play = useCallback(() => {
    // Une scène à la fois : un deuxième appel pendant qu'elle joue ne la relance pas.
    if (!season || busy.current || reducedMotion() || document.visibilityState !== 'visible') return;
    busy.current = true;
    markSeen(season, day);
    setRun((r) => r + 1);
    setOn(true);
    stop.current = window.setTimeout(() => {
      busy.current = false;
      setOn(false);
    }, SCENE_MS[season] + 250);
  }, [season, day]);

  useEffect(() => {
    const onAsk = () => play();
    window.addEventListener('shred:season-scene', onAsk);
    return () => window.removeEventListener('shred:season-scene', onAsk);
  }, [play]);

  // La fête change (ou s'arrête) : la scène en cours s'en va.
  useEffect(
    () => () => {
      clearTimeout(stop.current);
      busy.current = false;
      setOn(false);
    },
    [season],
  );

  // Une fois par jour, sur Aujourd'hui, quand l'écran est posé et libre.
  useEffect(() => {
    if (!season || !auto || reducedMotion() || !sceneDue(readSeen(), season, day)) return;
    let t = window.setTimeout(function tick() {
      if (screenBusy()) {
        t = window.setTimeout(tick, 2000);
        return;
      }
      play();
    }, 1600);
    return () => clearTimeout(t);
  }, [season, auto, day, play]);

  if (!season || !on) return null;
  return (
    <div key={run} className={`season-scene scene-${season}`} aria-hidden="true">
      {season === 'saint-valentin' && <Cupid />}
      {season === 'noel' && <Noel />}
      {season === 'halloween' && <WitchCast />}
      {season === 'nouvel-an' && <NewYear today={today} />}
      {season === 'paques' && <Paques />}
    </div>
  );
}

/* ---------- Le bouton de la fête, en haut d'Aujourd'hui ---------- */

function Glyph({ season }: { season: SeasonId }) {
  switch (season) {
    case 'halloween':
      return (
        <>
          <path d="M12 6.5c-1-2 0-3.6 1.6-4.2" stroke="#6f9632" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <ellipse cx="12" cy="14" rx="8.6" ry="7.4" fill="#ff8a1f" />
          <path d="M12 6.8c-3 2-3 12.4 0 14.4M12 6.8c3 2 3 12.4 0 14.4" stroke="#b34a06" strokeWidth="1.1" fill="none" />
          <path d="M7.8 13l1.6-2.4 1.6 2.4zM13 13l1.6-2.4 1.6 2.4zM8.4 16.2q3.6 2.6 7.2 0" fill="#ffe08a" stroke="#ffe08a" strokeWidth="0.8" strokeLinejoin="round" />
        </>
      );
    case 'noel':
      return (
        <>
          <path d="M12 2.5v3" stroke="#e5b443" strokeWidth="1.6" strokeLinecap="round" />
          <rect x="9.6" y="4.6" width="4.8" height="3" rx="0.8" fill="#e5b443" />
          <circle cx="12" cy="14.4" r="7.6" fill="#e8384f" />
          <path d="M4.8 12.6c4.6 2.2 9.8 2.2 14.4 0M5.4 17.2c4.2 1.8 9 1.8 13.2 0" stroke="#ffd166" strokeWidth="1.2" fill="none" />
          <ellipse cx="9.4" cy="11.2" rx="2" ry="1.3" fill="#fff" opacity="0.65" />
        </>
      );
    case 'nouvel-an':
      return (
        <g stroke="#ffd166" strokeWidth="1.7" strokeLinecap="round">
          <path d="M12 3v3.2M12 17.8V21M3 12h3.2M17.8 12H21M5.6 5.6l2.3 2.3M16.1 16.1l2.3 2.3M18.4 5.6l-2.3 2.3M7.9 16.1l-2.3 2.3" />
          <circle cx="12" cy="12" r="2.4" fill="#fff3c4" stroke="none" />
        </g>
      );
    case 'saint-valentin':
      return <path d="M12 20.4s-7.6-4.8-9.5-9.2C1.1 6.8 4.3 2.6 8.2 2.6c1.8 0 3 .9 3.8 2.1.8-1.2 2-2.1 3.8-2.1 3.9 0 7.1 4.2 5.7 8.6-1.9 4.4-9.5 9.2-9.5 9.2Z" fill="#ff4d7d" />;
    case 'paques':
      return (
        <>
          <ellipse cx="12" cy="13" rx="7.4" ry="9.2" fill="#cdb4ff" />
          <path d="M4.8 12l2.4 2.2 2.4-2.2 2.4 2.2 2.4-2.2 2.4 2.2 2.4-2.2" stroke="#fff1b0" strokeWidth="1.6" fill="none" strokeLinejoin="round" />
          <path d="M5.6 17.2c4.2 2 8.6 2 12.8 0" stroke="#7fe0a8" strokeWidth="1.6" fill="none" />
          <ellipse cx="9.2" cy="8.6" rx="1.4" ry="2.4" fill="#fff" opacity="0.5" />
        </>
      );
  }
}

/** Rejouer la scène de la fête : une pastille à côté de la date, l'emblème et le nom de la fête. */
export function SeasonReplay({ season }: { season: SeasonId }) {
  return (
    <button type="button" className={`season-replay sr-${season}`} onClick={playSeasonScene} aria-label={`Revoir l’animation : ${SEASONS[season].name}`}>
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <Glyph season={season} />
      </svg>
      {SEASONS[season].name}
    </button>
  );
}
