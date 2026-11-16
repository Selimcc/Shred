// Réglages, Cloudflare : ce que Shred consomme du plan gratuit aujourd'hui, qui écrit le plus, et les 14 derniers jours.
// Visible par l'administrateur seulement.
import { useEffect, useState } from 'react';
import { api, DEMO } from '../lib/api';
import { formatNumber } from '../lib/date';

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
  normal: { label: 'Normal', text: 'Tout s’enregistre au rythme habituel.' },
  economy: {
    label: 'Économie',
    text: 'Plus de 60 % des écritures du jour : la santé s’enregistre toutes les heures, une sauvegarde par personne toutes les 30 min.',
  },
  critical: {
    label: 'Critique',
    text: 'Plus de 90 % des écritures du jour : santé toutes les 3 h, sauvegarde toutes les 2 h. Tout reste sur les téléphones en attendant.',
  },
};

const ROWS: { id: keyof Pick<Day, 'kvWrite' | 'kvRead' | 'requests' | 'doRequests' | 'kvDelete' | 'kvList'>; label: string }[] = [
  { id: 'kvWrite', label: 'Écritures' },
  { id: 'kvRead', label: 'Lectures' },
  { id: 'requests', label: 'Requêtes' },
  { id: 'doRequests', label: 'Appels aux objets' },
  { id: 'kvDelete', label: 'Suppressions' },
  { id: 'kvList', label: 'Listes' },
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
        { name: 'santé', n: Math.round(w * 0.46) },
        { name: 'sauvegarde', n: Math.round(w * 0.27) },
        { name: 'état du jour', n: Math.round(w * 0.14) },
        { name: 'connexions', n: Math.round(w * 0.08) },
        { name: 'profil public', n: Math.round(w * 0.05) },
      ],
    };
  });
  return { tracked: true, mode: 'normal', limits: { kvWrite: 1000 }, days };
}

const pctText = (p: number) => `${formatNumber(Math.round(p * 1000) / 10, p < 0.1 ? 1 : 0)} %`;
const tone = (p: number) => (p >= 0.9 ? 'bad' : p >= 0.6 ? 'warn' : 'ok');

/** Heure locale de la remise à zéro (00:00 UTC). */
function resetTime(): string {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
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
  if (!r.tracked) return <p className="small muted">Le compteur n’est pas encore déployé sur ce serveur.</p>;
  const today = r.days[0];
  if (!today) return <p className="small muted">Pas encore de chiffres aujourd’hui.</p>;
  const history = [...r.days].reverse();
  const max = Math.max(1000, ...history.map((d) => d.kvWrite.used));
  const shown = hover !== null ? history[hover] : null;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className={`usage-mode ${r.mode}`}>
        <b>Mode {MODES[r.mode].label.toLowerCase()}</b>
        <span className="small">{MODES[r.mode].text}</span>
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <div className="usage-head">
          <h2 style={{ margin: 0 }}>Aujourd’hui</h2>
          <span className="small faint">Remise à zéro à {resetTime()}</span>
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
                  <div className="usage-bar" role="img" aria-label={`${x.label} : ${pctText(v.pct)} de la limite`}>
                    <i className={tone(v.pct)} style={{ width: `${Math.min(100, v.pct * 100)}%` }} />
                    {proj > v.pct && <s style={{ left: `${Math.min(100, proj * 100)}%` }} />}
                  </div>
                  <div className="small faint">
                    {pctText(v.pct)}
                    {v.projected > v.used ? `, environ ${formatNumber(v.projected)} en fin de journée à ce rythme` : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {today.writes.length > 0 && (
        <section className="stack" style={{ gap: 10 }}>
          <h2 style={{ margin: 0 }}>Qui écrit le plus aujourd’hui</h2>
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
          <h2 style={{ margin: 0 }}>Écritures, 14 derniers jours</h2>
          <span className="small faint">{shown ? `${new Date(`${shown.day}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} : ${formatNumber(shown.kvWrite.used)}` : 'limite : 1 000 par jour'}</span>
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
              aria-label={`${d.day} : ${d.kvWrite.used} écritures`}
            >
              <i className={tone(d.kvWrite.pct)} style={{ height: `${Math.max(2, (d.kvWrite.used / max) * 100)}%` }} />
            </button>
          ))}
        </div>
      </section>

      <p className="small faint" style={{ margin: 0 }}>
        Compté par Shred lui-même, à quelques requêtes près. Les chiffres officiels sont dans le tableau de bord Cloudflare, Workers et Pages, onglet
        Utilisation. Quand les écritures passent 60 % puis 90 %, tu reçois une notification et l’app ralentit ce qui écrit le plus.
      </p>
      <button className="btn" onClick={load}>
        Actualiser
      </button>
    </div>
  );
}
