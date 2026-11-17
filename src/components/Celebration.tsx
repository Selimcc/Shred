// La fête de fin de journée : Pulse et le compteur de série, et un mot de Pulse la première fois et à chaque palier.
import { type CSSProperties, useEffect } from 'react';
import { celebrationFor, flameInfo, ladder, TIERS } from '../lib/flames';
import { SEASON_PALETTE, useSeason } from '../lib/season';
import { setState, useApp } from '../lib/store';
import { Bubble, Pulse } from './Pulse';
import { tn, tr } from '../../shared/i18n';

/** Pseudo-hasard stable : la même fête se rejoue à l'identique. */
const rand = (i: number, salt: number) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

function Embers({ colors }: { colors: readonly string[] }) {
  return (
    <div className="embers" aria-hidden="true">
      {Array.from({ length: 14 }, (_, i) => (
        <span
          key={i}
          style={
            {
              left: `${20 + rand(i, 1) * 60}%`,
              background: colors[i % 3],
              color: colors[i % 3],
              animationDelay: `${(rand(i, 2) * 2.4).toFixed(2)}s`,
              animationDuration: `${(1.8 + rand(i, 3) * 1.6).toFixed(2)}s`,
              '--drift': `${Math.round((rand(i, 4) - 0.5) * 60)}px`,
              width: `${3 + Math.round(rand(i, 5) * 4)}px`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

function Confetti() {
  const season = useSeason();
  const palette = season ? SEASON_PALETTE[season] : ['#ff7a1f', '#ffc83d', '#4f7cff', '#2fd27c', '#ff5468', '#7fd3ff', '#cf6bff'];
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 42 }, (_, i) => (
        <i
          key={i}
          style={
            {
              left: `${rand(i, 6) * 100}%`,
              background: palette[i % palette.length],
              animationDelay: `${(1.7 + rand(i, 7) * 0.9).toFixed(2)}s`,
              animationDuration: `${(2.2 + rand(i, 8) * 1.8).toFixed(2)}s`,
              '--spin': `${Math.round(360 + rand(i, 9) * 720)}deg`,
              '--sway': `${Math.round((rand(i, 10) - 0.5) * 120)}px`,
              width: `${6 + Math.round(rand(i, 11) * 6)}px`,
              height: `${10 + Math.round(rand(i, 12) * 8)}px`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** Le chiffre de la série passe de l'ancienne valeur à la nouvelle. */
function CountFlip({ from, to, delay }: { from: number; to: number; delay: number }) {
  return (
    <div className="count-flip display num" style={{ '--flip-delay': `${delay}s` } as CSSProperties} aria-label={tn(to, '{n} jour', '{n} jours')}>
      <span className="old">{from}</span>
      <span className="new">{to}</span>
    </div>
  );
}

export function Celebration({ today }: { today: string }) {
  const s = useApp();
  const c = celebrationFor(s, today);
  const f = flameInfo(s, today);
  const withKilo = !!c && c.kind !== 'daily';

  useEffect(() => {
    if (!c) return;
    try {
      navigator.vibrate?.([30, 60, 90]);
    } catch {
      // Pas de vibration sur iPhone : sans importance.
    }
  }, [c?.kind]);

  if (!c) return null;

  const tier = c.kind === 'milestone' ? c.tier : f.tier;
  const t = TIERS[tier];
  const steps = ladder(f.goal, f.current);
  const next = steps.find((n) => n > f.current) ?? f.current + 1;
  const pct = Math.min(100, Math.round((f.current / next) * 100));

  let title: string;
  let text: string;
  let bubble = '';
  if (c.kind === 'first') {
    title = tr('Ta première flamme');
    text = tr('Journée validée : ta série démarre. Tiens {goal} jours pour gagner ta première vraie flamme.', { goal: f.goal });
    bubble = tr('Salut, moi c’est Pulse ! Je brille avec ta série : plus tu tiens, plus je change de couleur.');
  } else if (c.kind === 'milestone') {
    title = tr('{days} jours : {name}', { days: c.days, name: t.name });
    text = tr('Tu as tenu {days} jours d’affilée. Prochaine flamme à {next} jours.', { days: c.days, next });
    bubble = tr('{days} jours, respect ! Regarde, j’ai changé de couleur.', { days: c.days });
  } else {
    title = tn(f.current, 'Série relancée', 'jours de série');
    text =
      f.current >= 7 && f.current % 7 === 0
        ? tr('Une semaine de plus : tu gagnes un gel pour protéger ta série.')
        : tn(next - f.current, '+50 XP. Plus que {max} jour avant ta prochaine flamme.', '+50 XP. Plus que {max} jours avant ta prochaine flamme.', { max: Math.max(0, next - f.current) });
  }

  const delay = 0.15;
  const close = () =>
    setState((d) => {
      d.ui.celebrated = today;
      d.ui.metKilo = true;
    });

  return (
    <div
      className={`celebrate kind-${c.kind}`}
      role="dialog"
      aria-label={title}
      style={{ '--tier-a': t.colors[0], '--tier-b': t.colors[1], '--hero-delay': `${delay}s` } as CSSProperties}
    >
      {c.kind === 'milestone' && <Confetti />}
      <div className="celebrate-body">
        <div className="flame-stage">
          <Embers colors={t.colors} />
          <div className="hero-flame">
            <Pulse mood="cheer" tier={tier} size={140} />
          </div>
        </div>
        {withKilo && <Bubble className="celebrate-bubble">{bubble}</Bubble>}
        {c.kind === 'daily' && f.current > 1 ? (
          <CountFlip from={f.current - 1} to={f.current} delay={delay + 0.35} />
        ) : (
          <div className="count-flip display num" style={{ '--flip-delay': `${delay + 0.35}s` } as CSSProperties}>
            <span className="new solo">{c.kind === 'first' ? 1 : f.current}</span>
          </div>
        )}
        <h1 className="celebrate-title">{title}</h1>
        <p className="muted celebrate-text">{text}</p>
        <div className="celebrate-progress">
          <div className="bar">
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="small muted num">
            {tr('Prochaine flamme : {next} jours ({current}/{next})', { next, current: f.current })}
          </div>
        </div>
        <button className="btn fire celebrate-btn" style={{ minWidth: 220 }} onClick={close}>
          {tr('Continuer')}
        </button>
      </div>

    </div>
  );
}
