// Profil d'une séance d'endurance : chaque bloc est une colonne, sa largeur est sa durée, sa hauteur
// et sa teinte disent l'intensité (zones 1 à 5). Les blocs faits s'allument au fil de la séance.
import { useState } from 'react';
import { catalogEntry, exerciseName } from '../../shared/catalog';
import { type Block, blocksSeconds, fmtClock, hardSeconds, sessionBlocks, ZONE_NAMES } from '../../shared/effort';
import type { Exercise } from '../../shared/types';
import { lower, tr } from '../../shared/i18n';

const HEIGHT = { 1: 22, 2: 40, 3: 60, 4: 80, 5: 100 } as const;

function blockLabel(b: Block, ex: Exercise | undefined): string {
  if (b.rest) return tr('Récupération, {fmtSec}', { fmtSec: fmtSec(b.sec) });
  const name = ex?.name ?? (catalogEntry(b.key) ? exerciseName(b.key) : undefined) ?? (b.key === 'run-warmup' ? tr('Échauffement') : tr('Retour au calme'));
  const reps = ex && ex.sets > 1 ? ` ${b.rep + 1}/${ex.sets}` : '';
  return tr('{name} : {detail}', { name: `${name}${reps}`, detail: `${ex?.reps ?? fmtSec(b.sec)}${ex?.target ? `, ${ex.target}` : ''}` });
}

function fmtSec(sec: number): string {
  if (sec < 90) return `${Math.round(sec)} s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m >= 60 ? fmtClock(sec) : s ? `${m} min ${String(s).padStart(2, '0')}` : `${m} min`;
}

export function hasProfile(exercises: Exercise[]): boolean {
  return sessionBlocks(exercises).length > 0;
}

/**
 * @param done répétitions faites par exercice (clé → nombre), pour allumer les blocs déjà faits.
 * @param compact version courte, sans légende (accueil, aperçu du programme).
 */
export function SessionProfile({ exercises, done, compact = false }: { exercises: Exercise[]; done?: Record<string, number>; compact?: boolean }) {
  const blocks = sessionBlocks(exercises);
  const [hover, setHover] = useState<number | null>(null);
  if (!blocks.length) return null;
  const total = blocksSeconds(blocks);
  const hard = hardSeconds(blocks);
  const isDone = (b: Block) => {
    if (!done || b.ex < 0) return false;
    const ex = exercises[b.ex];
    return (done[ex.key] ?? 0) > b.rep;
  };
  const anyDone = done && blocks.some(isDone);
  const shown = hover !== null ? blocks[hover] : null;
  const elapsed = hover !== null ? blocks.slice(0, hover).reduce((n, b) => n + b.sec, 0) : 0;
  const ticks = compact ? [] : tickMarks(total);

  return (
    <figure className={`profile ${compact ? 'compact' : ''}`} aria-label={tr('Profil de la séance : {time}, dont {time2} en zone 4 et 5', { time: fmtClock(total), time2: fmtClock(hard) })}>
      {!compact && (
        <figcaption className="profile-head">
          <span className="profile-readout" aria-live="polite">
            {shown ? (
              <>
                <b>{blockLabel(shown, exercises[shown.ex])}</b>
                <span className="faint num">
                  {' '}{tr('de {fmtSec} à {fmtSec2}, zone {zone} {ZONE_NAMES}', { fmtSec: fmtSec(elapsed), fmtSec2: fmtSec(elapsed + shown.sec), zone: shown.zone, ZONE_NAMES: lower(ZONE_NAMES[shown.zone]) })}
                </span>
              </>
            ) : (
              <>
                <b className="num">{fmtClock(total)}</b>
                <span className="muted">{hard >= 60 ? tr(', dont {time} en zone 4 et 5', { time: fmtClock(hard) }) : tr(', tout en aisance')}</span>
              </>
            )}
          </span>
        </figcaption>
      )}
      <div className="profile-plot" onPointerLeave={() => setHover(null)}>
        {!compact &&
          [20, 40, 60, 80].map((y) => <i key={y} className="profile-grid" style={{ bottom: `${y}%` }} aria-hidden="true" />)}
        {blocks.map((b, i) => (
          <span
            key={i}
            className={`profile-col z${b.zone}${b.rest ? ' is-rest' : ''}${anyDone && !isDone(b) && !b.rest ? ' is-todo' : ''}${hover === i ? ' is-hot' : ''}`}
            style={{ flexGrow: b.sec, height: `${HEIGHT[b.zone]}%` }}
            onPointerEnter={() => setHover(i)}
            onPointerDown={() => setHover(i)}
            title={compact ? blockLabel(b, exercises[b.ex]) : undefined}
          />
        ))}
      </div>
      {!compact && (
        <div className="profile-axis small faint num" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ left: `${(t / total) * 100}%` }}>
              {t === 0 ? '0' : fmtClock(t).replace(' min', '′')}
            </span>
          ))}
        </div>
      )}
      {!compact && (
        <div className="profile-legend small muted" aria-hidden="true">
          <span>{tr('Intensité')}</span>
          {([1, 2, 3, 4, 5] as const).map((z) => (
            <span key={z} className="profile-key">
              <i className={`z${z}`} style={{ height: `${4 + z * 2}px` }} />Z{z}
            </span>
          ))}
        </div>
      )}
    </figure>
  );
}

/** Graduations rondes : toutes les 10, 15, 30 ou 60 minutes selon la durée. */
function tickMarks(total: number): number[] {
  const min = total / 60;
  const step = (min <= 40 ? 10 : min <= 75 ? 15 : min <= 150 ? 30 : 60) * 60;
  const out: number[] = [];
  for (let t = 0; t <= total - step * 0.4; t += step) out.push(t);
  return out;
}
