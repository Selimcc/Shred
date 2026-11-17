// Réglages, Cloudflare : ce que Shred consomme du plan gratuit aujourd'hui, qui écrit le plus, et les 14 derniers jours.
// Visible par l'administrateur seulement.
import { useEffect, useState } from 'react';
import { api, DEMO } from '../lib/api';
import { formatNumber } from '../lib/date';
import { loc, lower, pct, tr } from '../../shared/i18n';

type Mode = 'normal' | 'economy' | 'critical';
interface Row {
  used: number;
  limit: number;
  pct: number;
  projected: number;
}
interface Day {
  day: string;
  mode: Mode;
  requests: Row;
  kvRead: Row;
  kvWrite: Row;
  kvDelete: Row;
  kvList: Row;
  doRequests: Row;
  writes: { name: string; n: number }[];
}
interface Report {
  tracked: boolean;
  mode: Mode;
  limits: Record<string, number>;
  days: Day[];
}

const MODES: Record<Mode, { label: string; text: string }> = {
  normal: { label: tr('Normal'), text: tr('Tout s’enregistre au rythme habituel.') },
  economy: {
    label: tr('Économie'),
    text: tr('Plus de 60 % des écritures du jour : la santé s’enregistre toutes les heures, une sauvegarde par personne toutes les 30 min.'),
  },
  critical: {
    label: tr('Critique'),
    text: tr('Plus de 90 % des écritures du jour : santé toutes les 3 h, sauvegarde toutes les 2 h. Tout reste sur les téléphones en attendant.'),
  },
};

const ROWS: { id: keyof Pick<Day, 'kvWrite' | 'kvRead' | 'requests' | 'doRequests' | 'kvDelete' | 'kvList'>; label: string }[] = [
  { id: 'kvWrite', label: tr('Écritures') },
  { id: 'kvRead', label: tr('Lectures') },
  { id: 'requests', label: tr('Requêtes') },
  { id: 'doRequests', label: tr('Appels aux objets') },
  { id: 'kvDelete', label: tr('Suppressions') },
  { id: 'kvList', label: tr('Listes') },
];

function demoReport(): Report {
  const today = new Date();
  const days: Day[] = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today.getTime() - i * 86400_000).toISOString().slice(0, 10);
    const w = i === 0 ? 312 : Math.round(380 + 160 * Math.sin(i * 1.3));
    const row = (used: number, limit: number): Row => ({ used, limit, pct: used / limit, projected: i === 0 ? Math.round(used * 1.9) : used });
    return {
      day: d,
      mode: 'normal',
      requests: row(w * 9, 100_000),
      kvRead: row(w * 14, 100_000),
      kvWrite: row(w, 1000),
      kvDelete: row(Math.round(w / 40), 1000),
      kvList: row(3, 1000),
      doRequests: row(w * 2, 100_000),
      writes: [
        { name: tr('santé'), n: Math.round(w * 0.46) },
        { name: tr('sauvegarde'), n: Math.round(w * 0.27) },
        { name: tr('état du jour'), n: Math.round(w * 0.14) },
        { name: tr('connexions'), n: Math.round(w * 0.08) },
        { name: tr('profil public'), n: Math.round(w * 0.05) },
      ],
    };
  });
  return { tracked: true, mode: 'normal', limits: { kvWrite: 1000 }, days };
}

const pctText = (p: number) => pct(Math.round(p * 1000) / 10, p < 0.1 ? 1 : 0);
const tone = (p: number) => (p >= 0.9 ? 'bad' : p >= 0.6 ? 'warn' : 'ok');

/** Heure locale de la remise à zéro (00:00 UTC). */
function resetTime(): string {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' });
}

export function UsagePage() {
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const load = () => {
    setError(null);
    if (DEMO) return setR(demoReport());
    api<Report>('/api/admin/usage').then(setR, (e) => setError(String(e?.message ?? e)));
  };
  useEffect(load, []);

  if (error) return <p className="small muted">{error}</p>;
  if (!r) return <div className="spinner" />;
  if (!r.tracked) return <p className="small muted">{tr('Le compteur n’est pas encore déployé sur ce serveur.')}</p>;
  const today = r.days[0];
  if (!today) return <p className="small muted">{tr('Pas encore de chiffres aujourd’hui.')}</p>;
  const history = [...r.days].reverse();
  const max = Math.max(1000, ...history.map((d) => d.kvWrite.used));
  const shown = hover !== null ? history[hover] : null;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className={`usage-mode ${r.mode}`}>
        <b>{tr('Mode {label}', { label: lower(MODES[r.mode].label) })}</b>
        <span className="small">{MODES[r.mode].text}</span>
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <div className="usage-head">
          <h2 style={{ margin: 0 }}>{tr('Aujourd’hui')}</h2>
          <span className="small faint">{tr('Remise à zéro à {resetTime}', { resetTime: resetTime() })}</span>
        </div>
        <div className="group">
          {ROWS.map((x) => {
            const v = today[x.id];
            const proj = v.projected / v.limit;
            return (
              <div key={x.id} className="row usage-row">
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="usage-line">
                    <span className="title">{x.label}</span>
                    <span className="num small">
                      <b>{formatNumber(v.used)}</b> <span className="muted">/ {formatNumber(v.limit)}</span>
                    </span>
                  </div>
                  <div className="usage-bar" role="img" aria-label={tr('{label} : {pctText} de la limite', { label: x.label, pctText: pctText(v.pct) })}>
                    <i className={tone(v.pct)} style={{ width: `${Math.min(100, v.pct * 100)}%` }} />
                    {proj > v.pct && <s style={{ left: `${Math.min(100, proj * 100)}%` }} />}
                  </div>
                  <div className="small faint">
                    {pctText(v.pct)}
                    {v.projected > v.used ? tr(', environ {n} en fin de journée à ce rythme', { n: formatNumber(v.projected) }) : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {today.writes.length > 0 && (
        <section className="stack" style={{ gap: 10 }}>
          <h2 style={{ margin: 0 }}>{tr('Qui écrit le plus aujourd’hui')}</h2>
          <div className="group">
            {today.writes.slice(0, 8).map((w) => (
              <div key={w.name} className="row" style={{ minHeight: 44 }}>
                <span className="grow">{w.name}</span>
                <span className="num small">{formatNumber(w.n)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="stack" style={{ gap: 10 }}>
        <div className="usage-head">
          <h2 style={{ margin: 0 }}>{tr('Écritures, 14 derniers jours')}</h2>
          <span className="small faint">{shown ? `${new Date(`${shown.day}T12:00:00`).toLocaleDateString(loc(), { day: 'numeric', month: 'short' })} : ${formatNumber(shown.kvWrite.used)}` : tr('limite : 1 000 par jour')}</span>
        </div>
        <div className="usage-chart" onPointerLeave={() => setHover(null)}>
          <span className="usage-limit" style={{ bottom: `${(1000 / max) * 100}%` }} aria-hidden="true" />
          {history.map((d, i) => (
            <button
              key={d.day}
              type="button"
              className={`usage-col ${hover === i ? 'on' : ''}`}
              onPointerEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onClick={() => setHover(i)}
              aria-label={tr('{day} : {used} écritures', { day: d.day, used: d.kvWrite.used })}
            >
              <i className={tone(d.kvWrite.pct)} style={{ height: `${Math.max(2, (d.kvWrite.used / max) * 100)}%` }} />
            </button>
          ))}
        </div>
      </section>

      <p className="small faint" style={{ margin: 0 }}>
        {tr('Compté par Shred lui-même, à quelques requêtes près. Les chiffres officiels sont dans le tableau de bord Cloudflare, Workers et Pages, onglet Utilisation. Quand les écritures passent 60 % puis 90 %, tu reçois une notification et l’app ralentit ce qui écrit le plus.')}
      </p>
      <button className="btn" onClick={load}>
        {tr('Actualiser')}
      </button>
    </div>
  );
}
