import { useMemo, useRef, useState } from 'react';
import { formatNumber, formatShort } from '../lib/date';

interface Point {
  date: string;
  kg?: number;
  avg?: number;
}

/** Pesées quotidiennes (points discrets) et moyenne glissante sur 7 jours (ligne). */
export function WeightChart({ data }: { data: Point[] }) {
  const W = 340;
  const H = 180;
  const pad = { l: 34, r: 10, t: 12, b: 24 };
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const values = data.flatMap((p) => [p.kg, p.avg]).filter((v): v is number => v !== undefined);
  const scale = useMemo(() => {
    if (!values.length) return null;
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    if (hi - lo < 2) {
      const mid = (hi + lo) / 2;
      lo = mid - 1;
      hi = mid + 1;
    }
    const step = hi - lo > 6 ? 2 : hi - lo > 3 ? 1 : 0.5;
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const ticks: number[] = [];
    for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 10) / 10);
    return { lo, hi, ticks };
  }, [values.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!scale) {
    return <div className="empty small">Tes pesées apparaîtront ici. Pèse-toi chaque matin à jeun.</div>;
  }

  const x = (i: number) => pad.l + (i / Math.max(1, data.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - scale.lo) / (scale.hi - scale.lo)) * (H - pad.t - pad.b);

  const segments: string[] = [];
  let current = '';
  data.forEach((p, i) => {
    if (p.avg === undefined) {
      if (current) segments.push(current);
      current = '';
      return;
    }
    current += `${current ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.avg).toFixed(1)}`;
  });
  if (current) segments.push(current);

  const labelEvery = Math.ceil(data.length / 4);
  const onMove = (e: React.PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };
  const h = hover !== null ? data[hover] : null;
  const lastAvgIndex = data.map((p) => p.avg !== undefined).lastIndexOf(true);

  return (
    <div style={{ position: 'relative' }}>
      <div className="small muted" style={{ display: 'flex', gap: 16, marginBottom: 6 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <svg width="16" height="8" aria-hidden>
            <line x1="1" y1="4" x2="15" y2="4" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Moyenne 7 jours
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <svg width="10" height="10" aria-hidden>
            <circle cx="5" cy="5" r="4" fill="var(--ink-3)" />
          </svg>
          Pesée du jour
        </span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Évolution du poids sur 8 semaines"
        style={{ touchAction: 'pan-y', display: 'block' }}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {scale.ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--ink-3)">
              {formatNumber(t, t % 1 ? 1 : 0)}
            </text>
          </g>
        ))}
        {data.map((p, i) =>
          i % labelEvery === 0 || i === data.length - 1 ? (
            <text key={p.date} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'} fontSize="10" fill="var(--ink-3)">
              {formatShort(p.date)}
            </text>
          ) : null,
        )}
        {segments.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {data.map((p, i) =>
          p.kg !== undefined ? (
            <circle key={p.date} cx={x(i)} cy={y(p.kg)} r="4" fill="var(--ink-3)" stroke="var(--surface)" strokeWidth="2" />
          ) : null,
        )}
        {lastAvgIndex >= 0 && hover === null && (
          <text
            x={x(lastAvgIndex) - 4}
            y={y(data[lastAvgIndex].avg!) - 9}
            textAnchor="end"
            fontSize="11"
            fontWeight="700"
            fill="var(--ink)"
          >
            {formatNumber(data[lastAvgIndex].avg!, 1)} kg
          </text>
        )}
        {h && hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--ink-3)" strokeWidth="1" />
        )}
        {h?.avg !== undefined && hover !== null && (
          <circle cx={x(hover)} cy={y(h.avg)} r="5" fill="var(--blue)" stroke="var(--surface)" strokeWidth="2" />
        )}
      </svg>
      {h && hover !== null && (
        <div
          className="small"
          style={{
            position: 'absolute',
            top: 26,
            left: `${(x(hover) / W) * 100}%`,
            transform: `translateX(${hover > data.length / 2 ? 'calc(-100% - 8px)' : '8px'})`,
            background: 'var(--ink)',
            color: 'var(--bg)',
            padding: '6px 10px',
            borderRadius: 8,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          <strong>{formatShort(h.date)}</strong>
          <div className="num">Pesée : {h.kg !== undefined ? `${formatNumber(h.kg, 1)} kg` : 'aucune'}</div>
          {h.avg !== undefined && <div className="num">Moyenne : {formatNumber(h.avg, 1)} kg</div>}
        </div>
      )}
    </div>
  );
}
