// Pulse fête tes réussites. Séance validée : il bondit au centre de l'écran, onde de lumière et étincelles.
// Record, habitudes, pas, publication, étincelles reçues : il surgit en haut de l'écran le temps d'un clin d'œil.
// Si la grande fête de fin de journée s'affiche au même moment, c'est elle qui passe.
import { type CSSProperties, useEffect, useState } from 'react';
import { dayKey } from '../lib/date';
import { celebrationFor, flameInfo } from '../lib/flames';
import { type Moment, onMoment } from '../lib/moments';
import { getState, useApp } from '../lib/store';
import { TIERS } from '../lib/flames';
import { Pulse } from './Pulse';

const BIG: Moment['kind'][] = ['session'];
const DURATION = { big: 3400, small: 2700 };

function Sparks({ n = 14, colors }: { n?: number; colors: readonly string[] }) {
  return (
    <span className="moment-sparks" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <i
          key={i}
          style={
            {
              '--a': `${(360 / n) * i + (i % 2 ? 9 : -9)}deg`,
              '--d': `${78 + (i % 4) * 16}px`,
              '--delay': `${0.32 + (i % 3) * 0.05}s`,
              background: colors[i % colors.length],
              color: colors[i % colors.length],
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}

export function PulseMoment() {
  const s = useApp();
  const [queue, setQueue] = useState<Moment[]>([]);
  const current = queue[0];
  const tier = flameInfo(s, dayKey()).tier;
  const colors = TIERS[Math.min(tier, TIERS.length - 1)].colors;

  useEffect(
    () =>
      onMoment((m) => {
        // La fête de fin de journée prend le dessus sur la séance validée.
        if (m.kind === 'session' && celebrationFor(getState(), dayKey())) return;
        setQueue((q) => (q.some((x) => x.kind === m.kind && x.title === m.title) ? q : [...q, m].slice(-3)));
        try {
          navigator.vibrate?.(BIG.includes(m.kind) ? [20, 60, 40] : 12);
        } catch {
          // pas de vibration sur iPhone
        }
      }),
    [],
  );

  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), BIG.includes(current.kind) ? DURATION.big : DURATION.small);
    return () => clearTimeout(t);
  }, [current?.id]);

  if (!current) return null;
  const close = () => setQueue((q) => q.slice(1));
  const style = { '--m-a': colors[0], '--m-b': colors[1], '--m-c': colors[2] } as CSSProperties;

  if (BIG.includes(current.kind)) {
    return (
      <div key={current.id} className="moment-big" role="status" aria-live="polite" onClick={close} style={style}>
        <div className="moment-stage">
          <span className="moment-ring" aria-hidden="true" />
          <span className="moment-ring two" aria-hidden="true" />
          <Sparks colors={colors} />
          <div className="moment-pulse">
            <Pulse mood="cheer" tier={tier} size={150} />
          </div>
        </div>
        <h2 className="moment-title display">{current.title}</h2>
        {current.text && <p className="moment-text">{current.text}</p>}
        <span className="moment-hint small">Touche pour continuer</span>
      </div>
    );
  }

  return (
    <div key={current.id} className={`moment-small kind-${current.kind}`} role="status" aria-live="polite" onClick={close} style={style}>
      <span className="moment-mini">
        <Sparks n={8} colors={colors} />
        <Pulse mood="cheer" tier={tier} size={46} />
      </span>
      <span className="grow" style={{ minWidth: 0 }}>
        <b className="moment-small-title">{current.title}</b>
        {current.text && <span className="moment-small-text">{current.text}</span>}
      </span>
    </div>
  );
}
