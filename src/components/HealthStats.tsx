// Les chiffres d'Apple Santé sur 7 jours : sommeil, pas, minutes d'exercice, cœur au repos, VFC.
import { addDays, formatNumber, WEEKDAY_LETTERS, weekdayOf } from '../lib/date';
import type { AppState, HealthDay } from '../lib/store';

type Key = 'sleepMin' | 'steps' | 'exerciseMin' | 'restingHr' | 'hrv' | 'distanceKm';

interface Metric {
  key: Key;
  name: string;
  unit: string;
  color: string;
  /** Ligne de repère (objectif), dans l'unité stockée. */
  goal?: number;
  format: (v: number) => string;
  /** Plus haut = mieux ? (pour la phrase de tendance) */
  higherIsBetter: boolean;
}

const sleep = (min: number) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')}`;

const METRICS: Metric[] = [
  { key: 'sleepMin', name: 'Sommeil', unit: '', color: 'var(--glacier)', goal: 7.5 * 60, format: sleep, higherIsBetter: true },
  { key: 'steps', name: 'Pas', unit: 'pas', color: 'var(--amber)', goal: 8000, format: (v) => formatNumber(v), higherIsBetter: true },
  { key: 'exerciseMin', name: 'Exercice', unit: 'min', color: 'var(--mint)', goal: 30, format: (v) => `${Math.round(v)}`, higherIsBetter: true },
  { key: 'distanceKm', name: 'Distance', unit: 'km', color: 'var(--ink-2)', format: (v) => formatNumber(v, 1), higherIsBetter: true },
  { key: 'restingHr', name: 'Cœur au repos', unit: 'bpm', color: 'var(--rose)', format: (v) => `${Math.round(v)}`, higherIsBetter: false },
  { key: 'hrv', name: 'VFC', unit: 'ms', color: 'var(--purple)', format: (v) => `${Math.round(v)}`, higherIsBetter: true },
];

function avg(v: number[]): number | null {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function MiniBars({ days, values, color, goal }: { days: string[]; values: (number | undefined)[]; color: string; goal?: number }) {
  const max = Math.max(goal ?? 0, ...values.map((v) => v ?? 0)) || 1;
  return (
    <div className="mini-bars" aria-hidden="true">
      {goal && <i className="mini-goal" style={{ bottom: `${(goal / max) * 100}%` }} />}
      {values.map((v, i) => (
        <span key={days[i]} className="mini-col">
          <b style={{ height: `${v ? Math.max(4, (v / max) * 100) : 0}%`, background: v ? color : 'transparent', opacity: i === values.length - 1 ? 1 : 0.55 }} />
          <em>{WEEKDAY_LETTERS[weekdayOf(days[i])]}</em>
        </span>
      ))}
    </div>
  );
}

export function HealthStats({ s, today }: { s: AppState; today: string }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const prev = Array.from({ length: 7 }, (_, i) => addDays(today, i - 13));
  const get = (d: string, k: Key) => (s.health[d] as HealthDay | undefined)?.[k];
  const shown = METRICS.filter((m) => days.some((d) => get(d, m.key) !== undefined));
  if (!shown.length) return null;
  return (
    <div className="health-grid">
      {shown.map((m) => {
        const values = days.map((d) => get(d, m.key));
        const latest = [...values].reverse().find((v) => v !== undefined);
        const now = avg(values.filter((v): v is number => v !== undefined));
        const before = avg(prev.map((d) => get(d, m.key)).filter((v): v is number => v !== undefined));
        const delta = now !== null && before !== null && before > 0 ? (now - before) / before : null;
        const trend =
          delta === null || Math.abs(delta) < 0.05
            ? 'stable sur 2 semaines'
            : `${delta > 0 ? 'en hausse' : 'en baisse'} (${delta > 0 ? '+' : ''}${Math.round(delta * 100)} %)`;
        const good = delta === null || Math.abs(delta) < 0.05 ? null : (delta > 0) === m.higherIsBetter;
        return (
          <div key={m.key} className="card health-card">
            <div className="small muted">{m.name}</div>
            <div className="health-value">
              {latest !== undefined ? m.format(latest) : '–'}
              {m.unit && <small>{m.unit}</small>}
            </div>
            <MiniBars days={days} values={values} color={m.color} goal={m.goal} />
            <div className={`small ${good === null ? 'faint' : good ? 'trend-good' : 'trend-bad'}`}>
              {now !== null ? `Moy. ${m.format(now)}${m.unit ? ` ${m.unit}` : ''}, ${trend}` : 'Pas assez de données'}
            </div>
          </div>
        );
      })}
    </div>
  );
}
