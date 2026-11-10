// La fête de fin de journée : flamme animée, et Kilo qui apporte la flamme la première fois et à chaque palier.
import { type CSSProperties, useEffect } from 'react';
import { celebrationFor, flameInfo, ladder, TIERS } from '../lib/flames';
import { setState, useApp } from '../lib/store';
import { Braise, Bubble } from './Braise';

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
  const palette = ['#ff7a1f', '#ffc83d', '#4f7cff', '#2fd27c', '#ff5468', '#7fd3ff', '#cf6bff'];
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
    <div className="count-flip display num" style={{ '--flip-delay': `${delay}s` } as CSSProperties} aria-label={`${to} jours`}>
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
    title = 'Ta première flamme';
    text = `Journée validée : ta série démarre. Tiens ${f.goal} jours pour gagner ta première vraie flamme.`;
    bubble = 'Salut, moi c’est Braise ! Je suis ta série : plus tu tiens, plus je grandis.';
  } else if (c.kind === 'milestone') {
    title = `${c.days} jours : ${t.name}`;
    text = `Tu as tenu ${c.days} jours d’affilée. Prochaine flamme à ${next} jours.`;
    bubble = `${c.days} jours, respect ! Regarde, j’ai changé de couleur.`;
  } else {
    title = f.current === 1 ? 'Série relancée' : 'jours de série';
    text =
      f.current >= 7 && f.current % 7 === 0
        ? 'Une semaine de plus : tu gagnes un gel pour protéger ta série.'
        : `+50 XP. Plus que ${Math.max(0, next - f.current)} jour${next - f.current > 1 ? 's' : ''} avant ta prochaine flamme.`;
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
            <Braise mood="cheer" tier={tier} size={140} />
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
            Prochaine flamme : {next} jours ({f.current}/{next})
          </div>
        </div>
        <button className="btn fire celebrate-btn" style={{ minWidth: 220 }} onClick={close}>
          Continuer
        </button>
      </div>

    </div>
  );
}
