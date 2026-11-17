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
import { loc, tr } from '../../shared/i18n';

const TONE = { good: 'var(--green)', warn: 'var(--gold)', info: 'var(--blue)' } as const;

export async function mailReport(monday: string) {
  const s = getState();
  const r = weeklyReport(s, monday);
  await api('/api/report/email', {
    body: {
      week: monday,
      subject: tr('Ton bilan Shred : semaine du {date}', { date: formatShort(monday) }),
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
    [`${r.sessions.done}/${r.sessions.planned}`, tr('séances')],
    r.training.minutes >= 30
      ? [r.training.minutes >= 60 ? `${Math.floor(r.training.minutes / 60)}h${String(r.training.minutes % 60).padStart(2, '0')}` : `${r.training.minutes}′`, tr('d’entraînement')]
      : [`${r.validated}/${r.days}`, tr('jours validés')],
    [String(r.streak), tr('série')],
  ];

  const ask = async () => {
    const prompt = tr('Voici mon bilan de la semaine dans Shred. Analyse-le en 5 lignes : ce qui va, ce qui coince, et 2 ou 3 ajustements concrets pour la semaine prochaine (séances, exercices, calories).\n\n{reportText}', { reportText: reportText(getState(), r) });
    if (s.settings.ai === 'api') {
      setState((d) => void (d.ui.coachDraft = prompt));
      onClose();
      openCoach();
    } else {
      const how = await openInClaude(prompt);
      if (how === 'copied') toast(tr('Bilan copié : colle-le dans Claude'));
    }
  };

  return (
    <Sheet title={tr('Semaine du {date}', { date: formatShort(r.monday) })} onClose={onClose}>
      <div className="stack" style={{ gap: 18 }}>
        <p style={{ margin: 0, fontWeight: 700 }}>{r.headline}</p>
        {r.training.km.length > 0 && (
          <p className="small muted" style={{ margin: '-8px 0 0' }}>
            {r.training.km.map((x) => tr('{name} : {km} km', { name: x.name, km: x.km.toLocaleString(loc()) })).join(', ')}.
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
                <div className="title">{tr('Nutrition')}</div>
                <div className="small muted">
                  {tr('{n} kcal et {protein} g de protéines par jour, sur {days} jours notés. Objectif {n2} kcal, {protein2} g.', { n: formatNumber(r.nutrition.kcal), protein: r.nutrition.protein, days: r.nutrition.days, n2: formatNumber(r.nutrition.target.kcal), protein2: r.nutrition.target.protein })}
                </div>
              </div>
            </div>
          )}
          {r.weight.avg !== null && (
            <div className="row">
              <div className="grow">
                <div className="title">{tr('Poids')}</div>
                <div className="small muted">
                  {tr('{n} kg en moyenne', { n: formatNumber(r.weight.avg, 1) })}
                  {r.weight.change !== null ? tr(', {v}{n} kg sur la semaine', { v: r.weight.change > 0 ? '+' : '', n: formatNumber(r.weight.change, 2) }) : ''}{tr('. Cible : {n} à {n2} kg.', { n: formatNumber(r.weight.goal.min, 1), n2: formatNumber(r.weight.goal.max, 1) })}
                </div>
              </div>
            </div>
          )}
          {r.steps !== null && (
            <div className="row">
              <div className="grow">
                <div className="title">{tr('Pas')}</div>
                <div className="small muted">{tr('{n} par jour en moyenne.', { n: formatNumber(r.steps) })}</div>
              </div>
            </div>
          )}
          {r.prs.length > 0 && (
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                <div className="title">{tr('Records')}</div>
                {r.prs.map((x) => (
                  <div key={x.name} className="small muted">
                    {tr('{name} : {detail}', { name: x.name, detail: x.text })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {r.advice.length > 0 && (
          <section className="stack">
            <h2>{tr('Pour la semaine qui vient')}</h2>
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
                    {done.includes(a.id) ? tr('Fait') : a.action.kind === 'kcal' ? tr('Appliquer {v}{delta} kcal', { v: a.action.delta > 0 ? '+' : '', delta: a.action.delta }) : a.action.kind === 'swap' ? tr('Remplacer') : tr('Ajouter')}
                  </button>
                )}
              </div>
            ))}
          </section>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {s.settings.ai !== 'off' && (
            <button className="btn" style={{ flex: 1 }} onClick={ask}>
              <Icon name="chat" size={16} />{' '}{tr('Avis du coach')}
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
                toast(tr('Bilan envoyé sur ton mail'));
              } catch (e) {
                toast(errorText(e), true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Icon name="send" size={16} />{' '}{tr('Par mail')}
          </button>
        </div>
        {mailOk === false && !DEMO && (
          <p className="small faint" style={{ margin: 0 }}>
            {tr('L’envoi par mail n’est pas encore configuré sur le serveur (voir le guide, section Bilan par mail).')}
          </p>
        )}
      </div>
    </Sheet>
  );
}
