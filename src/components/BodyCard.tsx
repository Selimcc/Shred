// Ton corps estimé, en 3D : la silhouette suit ta masse grasse (tour de taille, poids) et tes muscles (tes charges),
// et se compare à il y a quelques semaines. Une estimation, dite comme telle, avec ce qu'il faut pour l'affiner.
import { lazy, Suspense, useMemo, useState } from 'react';
import type { Part } from '../lib/body3d/figure';
import { bodyTimeline, definitionOf, type BodyEstimate, shapeOf } from '../lib/bodyComp';
import { formatNumber } from '../lib/date';
import { REGION_NAMES, type Region } from '../lib/readiness';
import { useApp } from '../lib/store';
import { GROUPS, strengthProfile } from '../lib/strength';
import { webgl2 } from './Recovery';
import { tr } from '../../shared/i18n';

const Body3D = lazy(() => import('./Body3D'));

/** Argile claire, séparations brun foncé : on regarde la forme, pas des couleurs. */
const CLAY = '#b8aa9c';
const CLAY_LINE = '#3b2f27';

/** Le groupe de la fiche de force de chaque muscle du corps 3D. */
const GROUP_OF: Partial<Record<Part, string>> = {
  chest: 'chest',
  delts: 'shoulders',
  reardelts: 'shoulders',
  biceps: 'arms',
  triceps: 'arms',
  forearms: 'arms',
  lats: 'back',
  traps: 'back',
  lowerback: 'back',
  neck: 'back',
  quads: 'quads',
  glutes: 'hamstrings',
  hamstrings: 'hamstrings',
};

const signed = (n: number, digits = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatNumber(Math.abs(n), digits)}`;

export function BodyCard({ today, openProfile }: { today: string; openProfile: () => void }) {
  const s = useApp();
  const tl = useMemo(() => bodyTimeline(s, today), [s, today]);
  const [when, setWhen] = useState<'then' | 'now'>('now');
  const [flat, setFlat] = useState(() => !webgl2());

  if (!tl) {
    return (
      <section className="section">
        <div className="section-head">
          <h2>{tr('Ton corps estimé')}</h2>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          {tr('Pèse-toi pour voir ton corps estimé en 3D : il suit ton poids, ton tour de taille et tes charges.')}
        </p>
      </section>
    );
  }

  const e = when === 'then' && tl.then ? tl.then : tl.now;
  return (
    <section className="section">
      <div className="section-head">
        <h2>{tr('Ton corps estimé')}</h2>
        <span className="small muted">{tr('Estimation')}</span>
      </div>
      <div className="card body-card">
        {!flat && <EstimatedBody e={e} today={today} onFail={() => setFlat(true)} />}
        {tl.then && (
          <div className="seg" role="tablist" aria-label={tr('Quand')}>
            {(
              [
                ['then', tr('Il y a {n} semaines', { n: tl.weeks })],
                ['now', tr('Aujourd’hui')],
              ] as const
            ).map(([id, text]) => (
              <button key={id} role="tab" aria-selected={when === id} className={when === id ? 'on' : ''} onClick={() => setWhen(id)}>
                {text}
              </button>
            ))}
          </div>
        )}
        <div className="body-stats">
          <div>
            <b className="num">{tr('≈ {n} %', { n: formatNumber(e.fat, 0) })}</b>
            <span className="small muted">{tr('masse grasse')}</span>
          </div>
          <div>
            <b className="num">{tr('≈ {n} kg', { n: formatNumber(e.leanKg, 0) })}</b>
            <span className="small muted">{tr('masse maigre')}</span>
          </div>
          <div>
            <b className="num">{tr('{n} kg', { n: formatNumber(e.weight, 1) })}</b>
            <span className="small muted">{tr('poids')}</span>
          </div>
        </div>
        {tl.then && (
          <p className="small" style={{ margin: 0 }}>
            {tr('En {n} semaines : {fat} kg de gras, {lean} kg de masse maigre.', {
              n: tl.weeks,
              fat: signed(tl.now.fatKg - tl.then.fatKg),
              lean: signed(tl.now.leanKg - tl.then.leanKg),
            })}
          </p>
        )}
        <p className="small faint" style={{ margin: 0 }}>
          {methodText(tl.now, Boolean(tl.then))}{' '}
          {!tl.now.heightKnown && (
            <button className="link" onClick={openProfile}>
              {tr('Ajouter ma taille')}
            </button>
          )}
        </p>
      </div>
    </section>
  );
}

function methodText(e: BodyEstimate, compared: boolean): string {
  const fat =
    e.method === 'waist'
      ? tr('Masse grasse calculée avec ton tour de taille et ta taille (formule RFM, à environ 4 points près).')
      : e.method === 'declared'
        ? tr('Masse grasse : celle de ton profil. Note ton tour de taille pour un calcul plus juste.')
        : tr(
            'Sans tour de taille, la masse grasse vient de ton IMC corrigé par tes charges : c’est approximatif. Mesure ton tour de taille au nombril pour l’affiner.',
          );
  const muscles = e.rated ? tr('Muscles d’après tes charges des 8 dernières semaines.') : tr('Muscles d’après ton niveau déclaré, en attendant tes charges.');
  return [fat, muscles, compared ? tr('L’évolution suit ton poids et tes charges.') : ''].filter(Boolean).join(' ');
}

function EstimatedBody({ e, today, onFail }: { e: BodyEstimate; today: string; onFail: () => void }) {
  const s = useApp();
  const groups = useMemo(() => strengthProfile(s, e.date < today ? e.date : today).groups, [s, e.date, today]);
  const colors = { skin: CLAY, other: CLAY } as Record<Part, string>;
  for (const r of Object.keys(REGION_NAMES) as Region[]) colors[r] = CLAY;
  const labelOf = (p: Part): string | null => {
    if (p === 'abs' || p === 'obliques')
      return tr('Abdos : ils se voient sous {n} % de masse grasse environ (toi : {fat} %)', { n: e.sex === 'female' ? 18 : 12, fat: formatNumber(e.fat, 0) });
    if (p === 'calves') return tr('Mollets : ils suivent tes jambes');
    const g = groups.find((x) => x.id === GROUP_OF[p]);
    if (!g) return null;
    const name = GROUPS.find((x) => x.id === g.id)?.name ?? g.name;
    return g.grade ? tr('{name} : niveau {grade}', { name, grade: g.grade }) : tr('{name} : pas encore de charge notée', { name });
  };
  return (
    <Suspense fallback={<div className="body3d" aria-hidden="true" />}>
      <Body3D
        colors={colors}
        labelOf={labelOf}
        onFail={onFail}
        shape={shapeOf(e)}
        lines={definitionOf(e)}
        line={CLAY_LINE}
        label={tr('Ton corps estimé en 3D, environ {n} % de masse grasse. Glisse pour faire tourner, touche un muscle pour voir son niveau.', {
          n: formatNumber(e.fat, 0),
        })}
      />
    </Suspense>
  );
}
