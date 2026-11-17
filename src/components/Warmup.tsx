// L'échauffement sur l'écran de séance : la liste des mouvements, à lancer en mode séance, à cocher ou à passer.
// Une fois fait ou passé, il se replie en une ligne.
import { useState } from 'react';
import { fmtDose, type Warmup } from '../../shared/warmup';
import { fmtKg } from '../lib/logic';
import { setWarmup } from '../lib/workoutActions';
import { Icon } from './Icon';
import { tr } from '../../shared/i18n';

export function WarmupCard({
  today,
  warm,
  status,
  started,
  onLaunch,
}: {
  today: string;
  warm: Warmup;
  status?: 'done' | 'skipped';
  /** Séance déjà commencée : l'échauffement se fait discret. */
  started: boolean;
  onLaunch: () => void;
}) {
  const [open, setOpen] = useState(false);
  if ((status || started) && !open) {
    return (
      <div className={`warmup-mini ${status ?? ''}`}>
        <Icon name={status === 'done' ? 'check' : 'warmup'} size={17} />
        <span className="grow small">
          {status === 'done' ? tr('Échauffement fait') : status === 'skipped' ? tr('Échauffement passé') : tr('Échauffement, {min} min', { min: warm.min })}
        </span>
        <button className="link small" onClick={() => setOpen(true)}>
          {status === 'done' ? tr('Revoir') : tr('Voir')}
        </button>
      </div>
    );
  }
  return (
    <section className="card warmup-card" aria-label={tr('Échauffement')}>
      <div className="warmup-head">
        <span className="warmup-icon" aria-hidden="true">
          <Icon name="warmup" size={20} />
        </span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="warmup-title">
            {tr('Échauffement')}{' '}<span className="num muted">{tr('{min} min', { min: warm.min })}</span>
          </div>
          <div className="small muted">{warm.focus}</div>
        </div>
        {status !== 'skipped' && !open && (
          <button className="link small" onClick={() => setWarmup(today, 'skipped')}>
            {tr('Passer')}
          </button>
        )}
        {open && (
          <button className="link small" onClick={() => setOpen(false)}>
            {tr('Replier')}
          </button>
        )}
      </div>
      <ol className="warmup-list">
        {warm.moves.map((m) => (
          <li key={m.key}>
            <span className="grow">{m.name}</span>
            <span className="dose small muted num">{fmtDose(m)}</span>
          </li>
        ))}
        {warm.ramp && (
          <li className="warmup-ramp">
            <span className="grow">{tr('Séries d’approche : {name}', { name: warm.ramp.name })}</span>
            <span className="warmup-sets num">
              {warm.ramp.sets.map((x, i) => (
                <span key={i}>
                  {fmtKg(x.w)} × {x.r}
                </span>
              ))}
            </span>
          </li>
        )}
      </ol>
      {warm.then && <p className="small muted warmup-then">{warm.then}</p>}
      <div className="warmup-actions">
        <button className="btn primary" onClick={onLaunch}>
          <Icon name="play" size={16} filled />{' '}{tr('Lancer')}
        </button>
        {status === 'done' ? (
          <button className="btn" onClick={() => setWarmup(today, undefined)}>
            {tr('Pas encore fait')}
          </button>
        ) : (
          <button
            className="btn"
            onClick={() => {
              setWarmup(today, 'done');
              setOpen(false);
            }}
          >
            <Icon name="check" size={16} />{' '}{tr('C’est fait')}
          </button>
        )}
      </div>
    </section>
  );
}
