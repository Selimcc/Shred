import { useState } from 'react';
import { addDays, formatNumber, formatShort, WEEKDAY_LETTERS, weekdayOf } from '../lib/date';
import { STEP_GOAL } from '../lib/health';
import type { HealthDay } from '../lib/store';
import { tr } from '../../shared/i18n';

/** Pas des 14 derniers jours : barre orange quand l'objectif de 8 000 est atteint. */
export function StepsChart({ health, today }: { health: Record<string, HealthDay>; today: string }) {
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const values = days.map((d) => health[d]?.steps);
  const [sel, setSel] = useState(days.length - 1);
  const W = 340;
  const H = 150;
  const pad = { l: 4, r: 4, t: 14, b: 22 };
  const top = Math.max(STEP_GOAL * 1.25, ...values.map((v) => v ?? 0));
  const slot = (W - pad.l - pad.r) / days.length;
  const barW = Math.min(16, slot - 6);
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const goalY = y(STEP_GOAL);
  const selected = values[sel];

  return (
    <div>
      <div className="small" style={{ minHeight: 20, marginBottom: 4 }}>
        <strong className="num">{selected !== undefined ? tr('{n} pas', { n: formatNumber(selected) }) : tr('Pas de données')}</strong>
        <span className="muted">{' '}{tr('le {date}', { date: formatShort(days[sel]) })}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={tr('Pas des 14 derniers jours')} style={{ display: 'block', touchAction: 'pan-y' }}>
        <line x1={pad.l} x2={W - pad.r} y1={goalY} y2={goalY} stroke="var(--ink-3)" strokeWidth="1" />
        <text x={W - pad.r} y={goalY - 4} textAnchor="end" fontSize="10" fill="var(--ink-3)">
          8 000
        </text>
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--line)" strokeWidth="1" />
        {days.map((d, i) => {
          const v = values[i];
          const cx = pad.l + slot * i + slot / 2;
          const h = v ? Math.max(4, H - pad.b - y(v)) : 0;
          const reached = (v ?? 0) >= STEP_GOAL;
          return (
            <g key={d} onPointerEnter={() => setSel(i)} onPointerDown={() => setSel(i)} style={{ cursor: 'pointer' }}>
              <rect x={cx - slot / 2} y={pad.t} width={slot} height={H - pad.t} fill="transparent" />
              {v ? (
                <path
                  d={`M${cx - barW / 2},${H - pad.b} v${-(h - 4)} q0,-4 4,-4 h${barW - 8} q4,0 4,4 v${h - 4} Z`}
                  fill={reached ? 'var(--flame)' : 'var(--ink-3)'}
                  opacity={i === sel ? 1 : 0.8}
                />
              ) : null}
              <text
                x={cx}
                y={H - 6}
                textAnchor="middle"
                fontSize="10"
                fontWeight={i === sel ? 800 : 500}
                fill={i === sel ? 'var(--ink)' : 'var(--ink-3)'}
              >
                {WEEKDAY_LETTERS[weekdayOf(d)]}
              </text>
              <title>{tr('{name} : {detail}', { name: formatShort(d), detail: v !== undefined ? tr('{n} pas', { n: formatNumber(v) }) : tr('pas de données') })}</title>
            </g>
          );
        })}
      </svg>
      <div className="small muted" style={{ display: 'flex', gap: 14, marginTop: 6 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <i style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--flame)', display: 'inline-block' }} />
          {tr('Objectif atteint')}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <i style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--ink-3)', display: 'inline-block' }} />
          {tr('En dessous')}
        </span>
      </div>
    </div>
  );
}
