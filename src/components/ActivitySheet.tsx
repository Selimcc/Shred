// Noter une activité à la main : un jour de Push, une sortie natation ; un jour de repos, un match de foot.
// Elle compte dans les stats et, si on le demande, tient lieu de séance du jour (flamme comprise).
import { useState } from 'react';
import { DISCIPLINE_NAMES } from '../../shared/catalog';
import { addActivity, MANUAL_SPORTS, type ManualSport, removeActivity } from '../lib/activities';
import { parseDecimal } from '../lib/actions';
import { formatNumber, formatShort } from '../lib/date';
import { sessionFor } from '../lib/logic';
import { type Activity, readDay, useApp } from '../lib/store';
import { BUCKET_NAMES } from '../lib/training';
import { Toggle } from './form';
import { DISCIPLINE_ICON, Icon } from './Icon';
import { ask, Sheet, toast } from './ui';
import { tr } from '../../shared/i18n';

export const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}` : `${Math.round(m)} min`);

const SPORT_NAME = (s: ManualSport) => (s === 'lift' ? BUCKET_NAMES.lift : s === 'other' ? tr('Autre') : DISCIPLINE_NAMES[s]);
const SPORT_ICON = (s: string) => DISCIPLINE_ICON[s] ?? (s === 'lift' ? 'dumbbell' : 'spark');
/** Les sports où une distance a du sens. */
const WITH_KM: ManualSport[] = ['run', 'bike', 'swim', 'walk', 'row'];
const OTHER_IDEAS = [tr('Foot'), tr('Basket'), tr('Tennis'), tr('Padel'), tr('Escalade'), tr('Yoga'), tr('Randonnée'), tr('Danse')];
const EFFORTS: [1 | 2 | 3, string][] = [
  [1, tr('Facile')],
  [2, tr('Modérée')],
  [3, tr('Difficile')],
];

export function ActivitySheet({ date, countDefault, onClose }: { date: string; countDefault: boolean; onClose: () => void }) {
  const s = useApp();
  const day = readDay(s, date);
  const session = sessionFor(s, date);
  const canCount = session.type !== 'rest' && !day.mainDone;
  const [sport, setSport] = useState<ManualSport>('run');
  const [name, setName] = useState('');
  const [min, setMin] = useState('45');
  const [km, setKm] = useState('');
  const [effort, setEffort] = useState<1 | 2 | 3>(2);
  const [counts, setCounts] = useState(countDefault);
  const minutes = parseDecimal(min) ?? 0;
  const distance = parseDecimal(km);
  const ok = minutes >= 1 && minutes <= 600 && (sport !== 'other' || name.trim().length > 0) && (distance === undefined || (distance > 0 && distance <= 400));

  const save = () => {
    if (!ok) return;
    const r = addActivity(date, { sport, name: sport === 'other' ? name : SPORT_NAME(sport), min: minutes, km: WITH_KM.includes(sport) ? distance : undefined, effort }, canCount && counts);
    toast(r.validated ? tr('Activité ajoutée, séance du jour validée') : tr('Activité ajoutée'));
    onClose();
  };

  return (
    <Sheet title={tr('Ajouter une activité')} onClose={onClose}>
      <div className="stack" style={{ gap: 16 }}>
        <div className="chips" role="group" aria-label={tr('Sport')}>
          {MANUAL_SPORTS.map((x) => (
            <button key={x} type="button" className={`chip ${sport === x ? 'on' : ''}`} aria-pressed={sport === x} onClick={() => setSport(x)}>
              <Icon name={SPORT_ICON(x)} size={16} />
              {SPORT_NAME(x)}
            </button>
          ))}
        </div>
        {sport === 'other' && (
          <div className="stack" style={{ gap: 8 }}>
            <label className="field">
              <span>{tr('Quel sport ?')}</span>
              <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={tr('Foot, escalade, yoga…')} />
            </label>
            <div className="chips" style={{ gap: 6 }}>
              {OTHER_IDEAS.map((idea) => (
                <button key={idea} type="button" className={`chip small ${name === idea ? 'on' : ''}`} onClick={() => setName(idea)}>
                  {idea}
                </button>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: WITH_KM.includes(sport) ? '1fr 1fr' : '1fr', gap: 10 }}>
          <label className="field">
            <span>{tr('Durée (min)')}</span>
            <input className="input num" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} />
          </label>
          {WITH_KM.includes(sport) && (
            <label className="field">
              <span>{tr('Distance (km)')}</span>
              <input className="input num" inputMode="decimal" value={km} placeholder={tr('facultatif')} onChange={(e) => setKm(e.target.value)} />
            </label>
          )}
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <div className="small muted">{tr('Intensité')}</div>
          <div className="seg" role="group" aria-label={tr('Intensité')}>
            {EFFORTS.map(([v, label]) => (
              <button key={v} type="button" className={effort === v ? 'on' : ''} onClick={() => setEffort(v)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {canCount && (
          <div className="group">
            <Toggle
              title={tr('Compter comme ma séance du jour')}
              text={tr('Ta séance {name} est validée, flamme du jour comprise.', { name: session.name })}
              on={counts}
              onChange={setCounts}
            />
          </div>
        )}
        <button type="button" className="btn primary block" disabled={!ok} onClick={save}>
          {tr('Ajouter')}
        </button>
      </div>
    </Sheet>
  );
}

/** Une activité dans une liste : sport, durée, distance ; supprimable si elle a été notée à la main. */
export function ActivityRow({ a, date, validated }: { a: Activity; date?: string; validated?: boolean }) {
  const effort = a.effort ? EFFORTS.find(([v]) => v === a.effort)?.[1] : undefined;
  return (
    <div className="row" style={{ minHeight: 56 }}>
      <span className="settings-icon">
        <Icon name={SPORT_ICON(a.sport)} size={18} />
      </span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="title ellipsis">{a.name}</div>
        <div className="small muted num">
          {[date ? '' : formatShort(a.start.slice(0, 10)), a.km ? `${formatNumber(a.km, 1)} km` : '', fmtMin(a.min), a.hr ? `${a.hr} bpm` : '', effort ?? ''].filter(Boolean).join(', ')}
        </div>
        {validated || a.linked?.length ? (
          <span className="tag up" style={{ marginTop: 6 }}>
            {tr('Séance validée')}
          </span>
        ) : null}
      </div>
      {date && a.source === 'manual' && (
        <button
          type="button"
          className="icon-btn"
          style={{ boxShadow: 'none', background: 'transparent' }}
          aria-label={tr('Supprimer {label}', { label: a.name })}
          onClick={async () => {
            if (validated && !(await ask(tr('Supprimer cette activité ? La séance du jour ne sera plus validée.'), tr('Supprimer')))) return;
            removeActivity(date, a.id);
          }}
        >
          <Icon name="trash" size={18} />
        </button>
      )}
    </div>
  );
}
