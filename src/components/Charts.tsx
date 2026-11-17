// Graphiques des stats : charge d'entraînement par semaine, progression des charges, mini-courbes.
// Marques fines, une seule échelle, grille discrète, et une infobulle au survol ou au toucher.
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatNumber, formatShort } from '../lib/date';
import { type Bucket, BUCKET_NAMES, BUCKETS, totalMinutes, type WeekTraining, type LiftPoint } from '../lib/training';
import { tn, tr } from '../../shared/i18n';

/* ---------- Petits outils ---------- */

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Un chiffre qui monte jusqu'à sa valeur à l'affichage (sauf si l'animation est coupée). */
export function useCountUp(value: number, ms = 700): number {
  const [shown, setShown] = useState(() => (reduced() ? value : 0));
  const from = useRef(reduced() ? value : 0);
  useEffect(() => {
    if (reduced()) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(a + (value - a) * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(320);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Graduations rondes jusqu'au maximum. */
function niceTicks(max: number, count = 3): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.01; v += step) out.push(Math.round(v * 100) / 100);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

/** Graduations en heures rondes (30 min, 1 h, 2 h, 5 h…), 4 au plus. */
function hourTicks(maxMin: number): number[] {
  const step = [30, 60, 120, 180, 300, 600].find((st) => maxMin / st <= 4) ?? 600;
  const out: number[] = [];
  for (let v = 0; v < maxMin + step; v += step) out.push(v);
  return out;
}

const shortDate = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;

export const fmtHours = (min: number) => {
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
};

const BUCKET_VAR: Record<Bucket, string> = { swim: 'var(--d-swim)', run: 'var(--d-run)', bike: 'var(--d-bike)', lift: 'var(--d-lift)', other: 'var(--d-other)' };
/** Ordre fixe de l'empilement, du bas vers le haut (le même que celui de la palette validée). */
const STACK: Bucket[] = ['swim', 'run', 'bike', 'lift', 'other'];

export function Swatch({ color }: { color: string }) {
  return <i className="swatch" style={{ background: color }} aria-hidden="true" />;
}

function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  // On garde l'infobulle dans le cadre du graphique.
  const left = Math.max(0, Math.min(width - 168, x - 84));
  return (
    <div className="chart-tip" style={{ left }} role="status">
      {children}
    </div>
  );
}

/* ---------- Charge d'entraînement par semaine ---------- */

/** Minutes par semaine, empilées par sport. La semaine en cours est la dernière colonne. */
export function WeekLoadChart({ weeks }: { weeks: WeekTraining[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const present = STACK.filter((b) => weeks.some((w) => w.min[b] >= 1));
  const totals = weeks.map(totalMinutes);
  const ticks = hourTicks(Math.max(60, ...totals));
  const top = ticks[ticks.length - 1];
  const H = 150;
  const axisW = 34;
  const plotW = Math.max(100, width - axisW);
  const band = plotW / weeks.length;
  const barW = Math.min(24, band * 0.56);
  const h = (v: number) => (v / top) * H;

  return (
    <div className="chart" ref={ref}>
      {present.length > 1 && (
        <div className="chart-legend small muted">
          {present.map((b) => (
            <span key={b}>
              <Swatch color={BUCKET_VAR[b]} />
              {BUCKET_NAMES[b]}
            </span>
          ))}
        </div>
      )}
      <div className="chart-plot" style={{ height: H + 22 }} onPointerLeave={() => setHover(null)}>
        <svg width={width} height={H + 22} role="img" aria-label={tr('Minutes d’entraînement par semaine')}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={axisW} x2={width} y1={H - h(t) + 0.5} y2={H - h(t) + 0.5} className="grid" />
              <text x={axisW - 6} y={H - h(t) + 4} textAnchor="end" className="tick">
                {t === 0 ? '0' : t % 60 ? `${Math.floor(t / 60)}h30` : `${t / 60} h`}
              </text>
            </g>
          ))}
          {weeks.map((w, i) => {
            const cx = axisW + band * i + band / 2;
            let y = H;
            const segs = STACK.filter((b) => w.min[b] >= 1);
            const current = i === weeks.length - 1;
            return (
              <g key={w.monday} className={hover !== null && hover !== i ? 'dim' : ''}>
                {segs.map((b, j) => {
                  const hh = Math.max(2, h(w.min[b]));
                  const gap = j > 0 ? 2 : 0;
                  y -= hh;
                  const last = j === segs.length - 1;
                  const r = last ? Math.min(4, hh / 2) : 0;
                  const d = `M${cx - barW / 2},${y + hh - gap} V${y + r} ${r ? `Q${cx - barW / 2},${y} ${cx - barW / 2 + r},${y}` : ''} H${cx + barW / 2 - r} ${r ? `Q${cx + barW / 2},${y} ${cx + barW / 2},${y + r}` : ''} V${y + hh - gap} Z`;
                  return <path key={b} d={d} fill={BUCKET_VAR[b]} />;
                })}
                {current && totals[i] > 0 && (
                  <text x={cx} y={H - h(totals[i]) - 6} textAnchor="middle" className="value">
                    {fmtHours(totals[i])}
                  </text>
                )}
                {(weeks.length - 1 - i) % 2 === 0 && (
                  <text x={cx} y={H + 16} textAnchor="middle" className={`tick ${current ? 'strong' : ''}`}>
                    {current ? tr('Cette sem.') : shortDate(w.monday)}
                  </text>
                )}
                <rect x={cx - band / 2} y={0} width={band} height={H + 22} fill="transparent" onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} />
              </g>
            );
          })}
        </svg>
        {hover !== null && (
          <Tooltip x={axisW + band * hover + band / 2} width={width}>
            <b>{hover === weeks.length - 1 ? tr('Cette semaine') : tr('Semaine du {date}', { date: formatShort(weeks[hover].monday) })}</b>
            <div className="num">
              {tn(weeks[hover].sessions, '{fmtHours}, {n} séance', '{fmtHours}, {n} séances', { fmtHours: fmtHours(totals[hover]) })}
              {weeks[hover].planned ? tr(' sur {planned}', { planned: weeks[hover].planned }) : ''}
            </div>
            {STACK.filter((b) => weeks[hover].min[b] >= 1).map((b) => (
              <div key={b} className="tip-row">
                <Swatch color={BUCKET_VAR[b]} />
                <span className="grow">{BUCKET_NAMES[b]}</span>
                <span className="num">{fmtHours(weeks[hover].min[b])}</span>
              </div>
            ))}
          </Tooltip>
        )}
      </div>
    </div>
  );
}

/* ---------- Mini-courbe ---------- */

export function Sparkline({ values, color, height = 34, label }: { values: number[]; color: string; height?: number; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const max = Math.max(...values, 0.0001);
  const pad = 6;
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const pts = values.map((v, i) => [pad + step * i, height - pad - (v / max) * (height - pad * 2)] as const);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const end = pts[pts.length - 1];
  return (
    <div ref={ref} className="sparkline" aria-label={label} role="img">
      <svg width={width} height={height}>
        <path d={`${d} L${end[0]},${height} L${pad},${height} Z`} fill={color} opacity={0.1} />
        <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={end[0]} cy={end[1]} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />
      </svg>
    </div>
  );
}

/* ---------- Progression d'un exercice ---------- */

/** 1RM estimé séance après séance. Les records sont marqués d'un point, le dernier chiffre est écrit au bout. */
export function LiftChart({ points, color = 'var(--d-lift)' }: { points: LiftPoint[]; color?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return null;
  const H = 150;
  const axisW = 34;
  const right = 46;
  const t0 = Date.parse(points[0].date);
  const t1 = Date.parse(points[points.length - 1].date);
  const span = Math.max(1, t1 - t0);
  const vals = points.map((p) => p.e1rm);
  const lo = Math.floor((Math.min(...vals) * 0.94) / 5) * 5;
  const hiRaw = Math.max(...vals) * 1.03;
  const ticks = niceTicks(hiRaw - lo, 3).map((t) => t + lo);
  const hi = ticks[ticks.length - 1];
  const x = (d: string) => axisW + ((Date.parse(d) - t0) / span) * (width - axisW - right);
  const y = (v: number) => 8 + (1 - (v - lo) / (hi - lo)) * (H - 16);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.e1rm).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const near = (px: number) => points.reduce((best, p, i) => (Math.abs(x(p.date) - px) < Math.abs(x(points[best].date) - px) ? i : best), 0);

  return (
    <div className="chart" ref={ref}>
      <div
        className="chart-plot"
        style={{ height: H + 22 }}
        onPointerMove={(e) => setHover(near(e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left))}
        onPointerDown={(e) => setHover(near(e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left))}
        onPointerLeave={() => setHover(null)}
      >
        <svg width={width} height={H + 22} role="img" aria-label={tr('1RM estimé : de {n} à {n2} kg', { n: formatNumber(points[0].e1rm, 1), n2: formatNumber(last.e1rm, 1) })}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={axisW} x2={width - right + 8} y1={y(t) + 0.5} y2={y(t) + 0.5} className="grid" />
              <text x={axisW - 6} y={y(t) + 4} textAnchor="end" className="tick">
                {formatNumber(t)}
              </text>
            </g>
          ))}
          <path d={`${d} L${x(last.date)},${H - 8} L${x(points[0].date)},${H - 8} Z`} fill={color} opacity={0.1} />
          <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p, i) =>
            p.pr || i === points.length - 1 ? <circle key={p.date} cx={x(p.date)} cy={y(p.e1rm)} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} /> : null,
          )}
          <text x={x(last.date) + 8} y={y(last.e1rm) + 4} className="value">
            {tr('{n} kg', { n: formatNumber(last.e1rm, 0) })}
          </text>
          <text x={axisW} y={H + 16} className="tick">
            {formatShort(points[0].date)}
          </text>
          <text x={width - right + 8} y={H + 16} textAnchor="end" className="tick">
            {formatShort(last.date)}
          </text>
          {hover !== null && (
            <g>
              <line x1={x(points[hover].date)} x2={x(points[hover].date)} y1={4} y2={H - 8} className="crosshair" />
              <circle cx={x(points[hover].date)} cy={y(points[hover].e1rm)} r={5} fill={color} stroke="var(--surface)" strokeWidth={2} />
            </g>
          )}
        </svg>
        {hover !== null && (
          <Tooltip x={x(points[hover].date)} width={width}>
            <b>{formatShort(points[hover].date)}</b>
            <div className="num">
              {tr('{n} kg × {r}', { n: formatNumber(points[hover].w, 1), r: points[hover].r })}
            </div>
            <div className="muted num">{tr('1RM estimé {n} kg', { n: formatNumber(points[hover].e1rm, 1) })}</div>
            {points[hover].pr && <div className="tip-pr">{tr('Record')}</div>}
          </Tooltip>
        )}
      </div>
    </div>
  );
}

export { BUCKET_VAR, STACK, BUCKETS };
