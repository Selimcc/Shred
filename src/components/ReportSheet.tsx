// Le bilan de la semaine : chiffres clés, records, conseils applicables en un tap, envoi par mail.
import { useEffect, useState } from 'react';
import { applyAdvice } from '../lib/coaching';
import { api, DEMO, type Health } from '../lib/api';
import { openInClaude } from '../lib/ai';
import { dayKey, formatNumber, formatShort } from '../lib/date';
import { lastWeekMonday, reportHtml, reportText, weeklyReport } from '../lib/report';
import { signedIn } from '../lib/session';
import { getState, setState, useApp } from '../lib/store';
import { Icon } from './Icon';
import { errorText, Sheet, toast } from './ui';

const TONE = { good: 'var(--green)', warn: 'var(--gold)', info: 'var(--blue)' } as const;

export async function mailReport(monday: string) {
  const s = getState();
  const r = weeklyReport(s, monday);
  await api('/api/report/email', {
    body: {
      week: monday,
      subject: `Ton bilan Shred : semaine du ${formatShort(monday)}`,
      html: reportHtml(s, r, location.origin),
      text: reportText(s, r),
    },
  });
  setState((d) => void (d.ui.reportMailed = monday));
}

export function ReportSheet({ monday, onClose, openCoach }: { monday: string; onClose: () => void; openCoach: () => void }) {
  const s = useApp();
  const r = weeklyReport(s, monday);
  const [done, setDone] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [mailOk, setMailOk] = useState<boolean | null>(null);

  useEffect(() => {
    if (monday === lastWeekMonday(dayKey()) && s.ui.reportSeen !== monday) setState((d) => void (d.ui.reportSeen = monday));
  }, [monday]);
  useEffect(() => {
    if (DEMO || !signedIn()) return setMailOk(false);
    api<Health>('/api/health').then((h) => setMailOk(Boolean(h.email)), () => setMailOk(false));
  }, []);

  const stats: [string, string][] = [
    [`${r.sessions.done}/${r.sessions.planned}`, 'séances'],
    r.training.minutes >= 30
      ? [r.training.minutes >= 60 ? `${Math.floor(r.training.minutes / 60)}h${String(r.training.minutes % 60).padStart(2, '0')}` : `${r.training.minutes}′`, 'd’entraînement']
      : [`${r.validated}/${r.days}`, 'jours validés'],
    [String(r.streak), 'série'],
  ];

  const ask = async () => {
    const prompt = `Voici mon bilan de la semaine dans Shred. Analyse-le en 5 lignes : ce qui va, ce qui coince, et 2 ou 3 ajustements concrets pour la semaine prochaine (séances, exercices, calories).\n\n${reportText(getState(), r)}`;
    if (s.settings.ai === 'api') {
      setState((d) => void (d.ui.coachDraft = prompt));
      onClose();
      openCoach();
    } else {
      const how = await openInClaude(prompt);
      if (how === 'copied') toast('Bilan copié : colle-le dans Claude');
    }
  };

  return (
    <Sheet title={`Semaine du ${formatShort(r.monday)}`} onClose={onClose}>
      <div className="stack" style={{ gap: 18 }}>
        <p style={{ margin: 0, fontWeight: 700 }}>{r.headline}</p>
        {r.training.km.length > 0 && (
          <p className="small muted" style={{ margin: '-8px 0 0' }}>
            {r.training.km.map((x) => `${x.name} : ${x.km.toLocaleString('fr-FR')} km`).join(', ')}.
          </p>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {stats.map(([v, label]) => (
            <div key={label} className="card" style={{ padding: '12px 8px', textAlign: 'center', background: 'var(--surface-2)' }}>
              <div className="display num" style={{ fontSize: '1.5rem' }}>
                {v}
              </div>
              <div className="small muted">{label}</div>
            </div>
          ))}
        </div>

        <div className="group">
          {r.nutrition.kcal !== null && (
            <div className="row">
              <div className="grow">
                <div className="title">Nutrition</div>
                <div className="small muted">
                  {formatNumber(r.nutrition.kcal)} kcal et {r.nutrition.protein} g de protéines par jour, sur {r.nutrition.days} jours notés. Objectif{' '}
                  {formatNumber(r.nutrition.target.kcal)} kcal, {r.nutrition.target.protein} g.
                </div>
              </div>
            </div>
          )}
          {r.weight.avg !== null && (
            <div className="row">
              <div className="grow">
                <div className="title">Poids</div>
                <div className="small muted">
                  {formatNumber(r.weight.avg, 1)} kg en moyenne
                  {r.weight.change !== null ? `, ${r.weight.change > 0 ? '+' : ''}${formatNumber(r.weight.change, 2)} kg sur la semaine` : ''}. Cible :{' '}
                  {formatNumber(r.weight.goal.min, 1)} à {formatNumber(r.weight.goal.max, 1)} kg.
                </div>
              </div>
            </div>
          )}
          {r.steps !== null && (
            <div className="row">
              <div className="grow">
                <div className="title">Pas</div>
                <div className="small muted">{formatNumber(r.steps)} par jour en moyenne.</div>
              </div>
            </div>
          )}
          {r.prs.length > 0 && (
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                <div className="title">Records</div>
                {r.prs.map((x) => (
                  <div key={x.name} className="small muted">
                    {x.name} : {x.text}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {r.advice.length > 0 && (
          <section className="stack">
            <h2>Pour la semaine qui vient</h2>
            {r.advice.map((a) => (
              <div key={a.id} className="card stack" style={{ gap: 6, borderLeft: `4px solid ${TONE[a.tone]}` }}>
                <div style={{ fontWeight: 800 }}>{a.title}</div>
                <div className="small muted">{a.text}</div>
                {a.action && (
                  <button
                    className="btn small"
                    style={{ alignSelf: 'flex-start' }}
                    disabled={done.includes(a.id)}
                    onClick={() => {
                      const msg = applyAdvice(a);
                      if (msg) toast(msg);
                      setDone([...done, a.id]);
                    }}
                  >
                    {done.includes(a.id) ? 'Fait' : a.action.kind === 'kcal' ? `Appliquer ${a.action.delta > 0 ? '+' : ''}${a.action.delta} kcal` : a.action.kind === 'swap' ? 'Remplacer' : 'Ajouter'}
                  </button>
                )}
              </div>
            ))}
          </section>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {s.settings.ai !== 'off' && (
            <button className="btn" style={{ flex: 1 }} onClick={ask}>
              <Icon name="chat" size={16} /> Avis du coach
            </button>
          )}
          <button
            className="btn"
            style={{ flex: 1 }}
            disabled={busy || mailOk === false}
            onClick={async () => {
              setBusy(true);
              try {
                await mailReport(monday);
                toast('Bilan envoyé sur ton mail');
              } catch (e) {
                toast(errorText(e), true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Icon name="send" size={16} /> Par mail
          </button>
        </div>
        {mailOk === false && !DEMO && (
          <p className="small faint" style={{ margin: 0 }}>
            L’envoi par mail n’est pas encore configuré sur le serveur (voir le guide, section Bilan par mail).
          </p>
        )}
      </div>
    </Sheet>
  );
}
