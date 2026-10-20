import { GRADES, type GroupScore } from '../lib/strength';

/** Fiche de force : un axe par groupe musculaire, anneaux E (centre) à A (bord). */
export function Radar({ groups, weakestId }: { groups: GroupScore[]; weakestId?: string }) {
  const W = 340;
  const H = 350;
  const cx = W / 2;
  const cy = 172;
  const R = 104;
  const n = groups.length;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, r: number) => [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))] as const;
  const hex = (r: number) =>
    Array.from({ length: n }, (_, i) => pt(i, r))
      .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`)
      .join('') + 'Z';

  const points = groups.map((g, i) => pt(i, ((g.score ?? 0) / 5) * R));
  const shape = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('') + 'Z';
  const anyData = groups.some((g) => g.score !== null);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: 380, display: 'block', margin: '0 auto' }} role="img" aria-label="Fiche de force par groupe musculaire">
      <title>Fiche de force par groupe musculaire</title>
      {[1, 2, 3, 4, 5].map((k) => (
        <path key={k} d={hex((k / 5) * R)} fill={k === 5 ? 'var(--surface-2)' : 'none'} fillOpacity={k === 5 ? 0.5 : 0} stroke="var(--line)" strokeWidth="1" />
      ))}
      {groups.map((_, i) => {
        const [x, y] = pt(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--line)" strokeWidth="1" />;
      })}
      {GRADES.map((g, k) => (
        <text key={g} x={cx + 5} y={cy - ((k + 1) / 5) * R + 4} fontSize="9" fontWeight="700" fill="var(--ink-3)">
          {g}
        </text>
      ))}
      {anyData && (
        <path d={shape} fill="var(--blue)" fillOpacity="0.28" stroke="var(--blue)" strokeWidth="2" strokeLinejoin="round" />
      )}
      {anyData &&
        points.map(([x, y], i) =>
          groups[i].score !== null ? (
            <circle key={i} cx={x} cy={y} r="4.5" fill="var(--blue)" stroke="var(--bg)" strokeWidth="2" />
          ) : null,
        )}
      {groups.map((g, i) => {
        const [x, y] = pt(i, R + 34);
        const top = Math.sin(angle(i)) < -0.1;
        const weak = g.id === weakestId;
        const fill = weak ? 'var(--red)' : g.grade === 'A' ? 'var(--gold)' : g.grade === 'B' ? 'var(--blue)' : 'var(--surface-2)';
        const ink = weak || g.grade === 'B' ? '#ffffff' : g.grade === 'A' ? '#2a1d00' : 'var(--ink)';
        return (
          <g key={g.id}>
            <rect x={x - 16} y={y - 14} width="32" height="28" rx="8" fill={fill} />
            <text x={x} y={y + 6} textAnchor="middle" fontSize="17" fontWeight="900" fill={ink} style={{ fontStretch: '125%' }}>
              {g.grade ?? '?'}
            </text>
            <text
              x={x}
              y={top ? y - 21 : y + 31}
              textAnchor="middle"
              fontSize="12"
              fontWeight="700"
              fill={weak ? 'var(--red)' : 'var(--ink-2)'}
            >
              {g.short}
            </text>
            <title>{`${g.name} : ${g.grade ?? 'pas encore de données'}`}</title>
          </g>
        );
      })}
    </svg>
  );
}
