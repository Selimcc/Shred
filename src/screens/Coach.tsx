import { useEffect, useRef, useState } from 'react';
import { athleteSummary, WEIGHT_GOALS } from '../../shared/athlete';
import { DossierCard } from '../components/Dossier';
import { Pulse } from '../components/Pulse';
import { flameInfo } from '../lib/flames';
import { Icon } from '../components/Icon';
import { errorText, toast } from '../components/ui';
import { claudePrompt, openInClaude, programText } from '../lib/ai';
import { api } from '../lib/api';
import { addDays, formatLong, formatNumber } from '../lib/date';
import {
  formatSets,
  dayValidated,
  mealsCount,
  sessionFor,
  setProgress,
  streakInfo,
  totals,
  weeklyChange,
} from '../lib/logic';
import { type AppState, getState, readDay, setState, useApp } from '../lib/store';
import { profileSummary } from '../lib/strength';
import { timeOf } from '../lib/health';
import { localRetriever, memoryText } from '../lib/knowledge';

const SUGGESTIONS = [
  'Je n’ai que 45 minutes aujourd’hui, adapte ma séance',
  'Une machine est prise, par quoi remplacer ?',
  'Que manger ce soir avec ce qu’il me reste ?',
  'Fais le bilan de ma semaine',
  'Comment rattraper mon point faible ?',
];

export function buildContext(s: AppState, today: string): string {
  const day = readDay(s, today);
  const session = sessionFor(s, today);
  const prog = setProgress(session, day);
  const t = totals(day);
  const st = streakInfo(s, today);
  const tg = s.settings.targets;
  const lines: string[] = [];
  const p = s.settings;
  const profile = [p.name, p.age ? `${p.age} ans` : '', p.height ? `${p.height} cm` : ''].filter(Boolean).join(', ');
  if (profile) lines.push(`Profil : ${profile}`);
  lines.push(`Date : ${formatLong(today)}, ${new Date().toTimeString().slice(0, 5)}`);
  lines.push(
    `Séance du jour : ${session.name} (${session.focus}), ${prog.done}/${prog.total} séries, ${day.mainDone ? 'terminée' : 'pas terminée'}`,
  );
  const done = session.exercises
    .filter((e) => day.sets[e.key]?.some((l) => l.done))
    .map((e) => `- ${e.name} : ${formatSets(day.sets[e.key].filter((l) => l.done))}`);
  if (done.length) lines.push(`Séries faites aujourd'hui :\n${done.join('\n')}`);
  lines.push(
    `Nutrition aujourd'hui : ${t.kcal}/${tg.kcal} kcal, ${t.protein}/${tg.protein} g protéines, ${t.carbs}/${tg.carbs} g glucides, ${t.fat}/${tg.fat} g lipides (${mealsCount(day)}/4 repas notés)`,
  );
  if (day.meals.length) lines.push(`Repas notés : ${day.meals.map((m) => `${m.label} (${m.kcal} kcal)`).join(' ; ')}`);
  const habits = s.habits.filter((h) => day.habits[h.id]).map((h) => h.name);
  lines.push(`Habitudes cochées : ${habits.length ? habits.join(', ') : 'aucune'}`);
  const h = s.health[today];
  if (h) {
    lines.push(
      `Activité (Apple Santé) : ${h.steps ?? '?'} pas, ${h.active ?? '?'} kcal actives, ${h.resting ?? '?'} kcal au repos${h.gymIn ? `, arrivé à la salle à ${timeOf(h.gymIn)}${h.gymOut ? `, reparti à ${timeOf(h.gymOut)}` : ''}` : ''}`,
    );
  }
  lines.push(`Série : ${st.current} jours (record ${st.best}), ${st.freezes} gel(s) disponibles`);
  lines.push(profileSummary(s, today));

  const lastWeight = Object.entries(s.body.weight).sort(([a], [b]) => b.localeCompare(a))[0];
  if (lastWeight) {
    const wc = weeklyChange(s, today);
    lines.push(
      `Poids : dernière pesée ${formatNumber(lastWeight[1], 1)} kg le ${lastWeight[0]}${wc !== null ? `, variation moyenne sur 7 j : ${wc > 0 ? '+' : ''}${formatNumber(wc, 2)} kg` : ''}`,
    );
  }
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, -i - 1)).map((d) => {
    const dl = s.days[d];
    const name = sessionFor(s, d).name;
    return `${d} ${name} ${dl?.mainDone ? 'faite' : 'non faite'}${dayValidated(s, d) ? ', journée validée' : ''}`;
  });
  lines.push(`7 derniers jours :\n${week.join('\n')}`);
  return lines.join('\n');
}

export function Coach({ today, onBack }: { today: string; onBack: () => void }) {
  const s = useApp();
  const [text, setText] = useState(() => getState().ui.coachDraft ?? '');
  useEffect(() => {
    // Question préparée ailleurs (bilan, proposition de plat) : on la reprend une seule fois.
    if (getState().ui.coachDraft) setState((d) => void delete d.ui.coachDraft);
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const endRef = useRef<HTMLDivElement>(null);
  const messages = s.coach;
  const viaApp = s.settings.ai === 'claude';

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, busy]);

  const send = async (content: string) => {
    const q = content.trim();
    if (!q || busy) return;
    setText('');
    setError(undefined);
    // Recherche locale dans l'historique : seuls les extraits utiles partent avec la question.
    const hits = localRetriever(getState(), today).searchSync(q, { k: viaApp ? 6 : 8, budget: viaApp ? 3000 : 4500 });
    if (viaApp) {
      const how = await openInClaude(claudePrompt(getState(), today, q, hits));
      if (how === 'copied') toast('Question et contexte copiés : colle-les dans Claude.');
      return;
    }
    setState((d) => {
      d.coach.push({ role: 'user', content: q, at: Date.now() });
      d.coach = d.coach.slice(-60);
    });
    setBusy(true);
    try {
      const st = getState();
      const { reply } = await api<{ reply: string }>('/api/coach', {
        body: {
          messages: st.coach.slice(-16).map(({ role, content }) => ({ role, content })),
          context: buildContext(st, today),
          program: programText(st),
          notes: [st.settings.coachNotes, athleteSummary(st.settings.athlete, st.settings.gym), `Objectif : ${WEIGHT_GOALS[st.settings.weightGoal].label}.`].filter(Boolean).join('\n'),
          name: st.settings.name || undefined,
          memory: hits.length ? memoryText(hits) : undefined,
        },
      });
      setState((d) => {
        d.coach.push({ role: 'assistant', content: reply, at: Date.now(), sources: hits.map((h) => h.doc.title).slice(0, 5) });
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: viaApp ? undefined : 'calc(100dvh - var(--tabbar) - 120px)' }}>
      <button className="link small" style={{ marginBottom: 14, alignSelf: 'flex-start', color: 'var(--ink-2)' }} onClick={onBack}>
        ← Aujourd’hui
      </button>
      <header className="topbar coach-head" style={{ justifyContent: 'flex-start' }}>
        <Pulse mood="think" tier={flameInfo(s, today).tier} size={56} />
        <div style={{ flex: 1 }}>
          <h1>Pulse, ton coach</h1>
          <div className="date">{viaApp ? 'Je t’ouvre Claude avec ton contexte, sans frais' : 'Je connais ton programme et ta journée'}</div>
        </div>
        {!viaApp && messages.length > 0 && (
          <button
            className="btn small"
            onClick={() =>
              setState((d) => {
                d.coach = [];
              })
            }
          >
            Effacer
          </button>
        )}
      </header>

      <div style={{ flex: 1 }}>
        {viaApp && (
          <p className="muted" style={{ marginTop: 0 }}>
            Écris ta question : l’app l’envoie dans Claude avec ta journée et les extraits de ton historique qui y répondent (séances, records,
            repas, poids). Tu continues la conversation là-bas, avec ton compte Claude.
          </p>
        )}
        {!viaApp && messages.length === 0 && (
          <p className="muted" style={{ marginTop: 0 }}>
            Pose une question sur ta séance, tes repas ou ta progression. Il voit tes séries, tes calories et ta série du
            jour.
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!viaApp && messages.map((m, i) => (
            <div
              key={i}
              style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '86%',
                padding: '10px 14px',
                borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                background: m.role === 'user' ? 'var(--ink)' : 'var(--surface)',
                color: m.role === 'user' ? 'var(--on-accent)' : 'var(--ink)',
                                whiteSpace: 'pre-wrap',
                lineHeight: 1.45,
              }}
            >
              {m.content}
              {m.sources && m.sources.length > 0 && (
                <div className="small faint" style={{ marginTop: 6, fontSize: '0.74rem' }}>
                  D’après : {m.sources.join(', ')}
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div style={{ alignSelf: 'flex-start', padding: '12px 14px', background: 'var(--surface)', borderRadius: 16 }}>
              <div className="spinner" />
            </div>
          )}
          {error && (
            <p className="small" style={{ color: 'var(--red)', margin: 0 }}>
              {error}
            </p>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div
        style={{
          // Conversation intégrée : la saisie reste en bas. Mode app Claude : rien à faire défiler dessous.
          position: viaApp ? 'static' : 'sticky',
          bottom: 'calc(var(--tabbar) + env(safe-area-inset-bottom) + 18px)',
          paddingTop: 12,
          background: viaApp ? 'none' : 'linear-gradient(to bottom, transparent, var(--bg) 30%)',
        }}
      >
        {(viaApp || messages.length === 0) && (
          <div className="chips" style={{ marginBottom: 10 }}>
            {SUGGESTIONS.map((q) => (
              <button key={q} className="chip" style={{ textAlign: 'left' }} onClick={() => send(q)}>
                {q}
              </button>
            ))}
          </div>
        )}
        <form
          style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <textarea
            className="input"
            rows={1}
            style={{ resize: 'none', maxHeight: 120 }}
            placeholder={viaApp ? 'Ta question pour Pulse' : 'Écris à Pulse'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
            aria-label="Message au coach"
          />
          <button className="btn primary" style={{ width: 48, padding: 0 }} disabled={!text.trim() || busy} aria-label="Envoyer">
            <Icon name="send" size={20} />
          </button>
        </form>
      </div>
      {viaApp && (
        <div style={{ marginTop: 22 }}>
          <DossierCard today={today} />
        </div>
      )}
    </div>
  );
}
