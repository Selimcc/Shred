import { activeSeason } from '../lib/season';
import { useEffect, useRef, useState } from 'react';
import { athleteSummary, WEIGHT_GOALS } from '../../shared/athlete';
import { ConnectorCard } from '../components/Connector';
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
import { useConnector } from '../lib/connector';
import { signedIn } from '../lib/session';
import { list, tn, tr } from '../../shared/i18n';

const SUGGESTIONS = [
  tr('Je n’ai que 45 minutes aujourd’hui, adapte ma séance'),
  tr('Une machine est prise, par quoi remplacer ?'),
  tr('Que manger ce soir avec ce qu’il me reste ?'),
  tr('Fais le bilan de ma semaine'),
  tr('Comment rattraper mon point faible ?'),
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
  const profile = [p.name, p.age ? tr('{age} ans', { age: p.age }) : '', p.height ? `${p.height} cm` : ''].filter(Boolean).join(', ');
  if (profile) lines.push(tr('Profil : {profile}', { profile }));
  lines.push(tr('Date : {date}, {toTimeString}', { date: formatLong(today), toTimeString: new Date().toTimeString().slice(0, 5) }));
  lines.push(
    tr('Séance du jour : {name} ({focus}), {done}/{total} séries, {v}', { name: session.name, focus: session.focus, done: prog.done, total: prog.total, v: day.mainDone ? tr('terminée') : tr('pas terminée') }),
  );
  const done = session.exercises
    .filter((e) => day.sets[e.key]?.some((l) => l.done))
    .map((e) => `- ${tr('{name} : {detail}', { name: e.name, detail: formatSets(day.sets[e.key].filter((l) => l.done)) })}`);
  if (done.length) lines.push(tr('Séries faites aujourd\'hui :\n{join}', { join: done.join('\n') }));
  lines.push(
    tr('Nutrition aujourd\'hui : {kcal}/{kcal2} kcal, {protein}/{protein2} g protéines, {carbs}/{carbs2} g glucides, {fat}/{fat2} g lipides ({mealsCount}/4 repas notés)', { kcal: t.kcal, kcal2: tg.kcal, protein: t.protein, protein2: tg.protein, carbs: t.carbs, carbs2: tg.carbs, fat: t.fat, fat2: tg.fat, mealsCount: mealsCount(day) }),
  );
  if (day.meals.length) lines.push(tr('Repas notés : {join}', { join: day.meals.map((m) => `${m.label} (${m.kcal} kcal)`).join(' ; ') }));
  const habits = s.habits.filter((h) => day.habits[h.id]).map((h) => h.name);
  lines.push(tr('Habitudes cochées : {v}', { v: habits.length ? list(habits) : tr('aucune') }));
  const h = s.health[today];
  if (h) {
    lines.push(
      tr('Activité (Apple Santé) : {n} pas, {n2} kcal actives, {n3} kcal au repos{v}', { n: h.steps ?? '?', n2: h.active ?? '?', n3: h.resting ?? '?', v: h.gymIn ? `${tr(', arrivé à la salle à {time}', { time: timeOf(h.gymIn) })}${h.gymOut ? tr(', reparti à {time}', { time: timeOf(h.gymOut) }) : ''}` : '' }),
    );
  }
  lines.push(tr('Série : {current} jours (record {best}), {freezes}', { current: st.current, best: st.best, freezes: tn(st.freezes, '{n} gel disponible', '{n} gels disponibles') }));
  lines.push(profileSummary(s, today));

  const lastWeight = Object.entries(s.body.weight).sort(([a], [b]) => b.localeCompare(a))[0];
  if (lastWeight) {
    const wc = weeklyChange(s, today);
    lines.push(
      tr('Poids : dernière pesée {n} kg le {lastWeight}{v}', { n: formatNumber(lastWeight[1], 1), lastWeight: lastWeight[0], v: wc !== null ? tr(', variation moyenne sur 7 j : {change} kg', { change: `${wc > 0 ? '+' : ''}${formatNumber(wc, 2)}` }) : '' }),
    );
  }
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, -i - 1)).map((d) => {
    const dl = s.days[d];
    const name = sessionFor(s, d).name;
    return `${d} ${name} ${dl?.mainDone ? tr('faite') : tr('non faite')}${dayValidated(s, d) ? tr(', journée validée') : ''}`;
  });
  lines.push(tr('7 derniers jours :\n{join}', { join: week.join('\n') }));
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
  // Shred branché sur Claude : la question suffit, Claude va chercher lui-même dans l'historique.
  const connected = (useConnector()?.clients.length ?? 0) > 0;

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
    if (viaApp && connected) {
      await openInClaude(tr('{q}\n\nUtilise mes données Shred pour répondre.', { q }));
      return;
    }
    if (viaApp) {
      const how = await openInClaude(claudePrompt(getState(), today, q, hits));
      if (how === 'copied') toast(tr('Question et contexte copiés : colle-les dans Claude.'));
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
          notes: [st.settings.coachNotes, athleteSummary(st.settings.athlete, st.settings.gym), tr('Objectif : {label}.', { label: WEIGHT_GOALS[st.settings.weightGoal].label })].filter(Boolean).join('\n'),
          name: st.settings.name || undefined,
          memory: hits.length ? memoryText(hits) : undefined,
          season: activeSeason(st, today) ?? undefined,
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
        {tr('← Aujourd’hui')}
      </button>
      <header className="topbar coach-head" style={{ justifyContent: 'flex-start' }}>
        <Pulse mood="think" tier={flameInfo(s, today).tier} size={56} />
        <div style={{ flex: 1 }}>
          <h1>{tr('Pulse, ton coach')}</h1>
          <div className="date">{viaApp ? (connected ? tr('Je t’ouvre Claude, qui lit ton historique Shred') : tr('Je t’ouvre Claude avec ton contexte, sans frais')) : tr('Je connais ton programme et ta journée')}</div>
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
            {tr('Effacer')}
          </button>
        )}
      </header>

      <div style={{ flex: 1 }}>
        {viaApp && (
          <p className="muted" style={{ marginTop: 0 }}>
            {connected
              ? tr('Écris ta question : elle s’ouvre dans Claude, qui va chercher dans Shred ce qu’il lui faut (séances, records, repas, poids). Tu continues la conversation là-bas.')
              : tr('Écris ta question : l’app l’envoie dans Claude avec ta journée et les extraits de ton historique qui y répondent (séances, records, repas, poids). Tu continues la conversation là-bas, avec ton compte Claude.')}
          </p>
        )}
        {!viaApp && messages.length === 0 && (
          <p className="muted" style={{ marginTop: 0 }}>
            {tr('Pose une question sur ta séance, tes repas ou ta progression. Il voit tes séries, tes calories et ta série du jour.')}
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
                  {tr('D’après : {join}', { join: m.sources.join(', ') })}
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
            placeholder={viaApp ? tr('Ta question pour Pulse') : tr('Écris à Pulse')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
            aria-label={tr('Message au coach')}
          />
          <button className="btn primary" style={{ width: 48, padding: 0 }} disabled={!text.trim() || busy} aria-label={tr('Envoyer')}>
            <Icon name="send" size={20} />
          </button>
        </form>
      </div>
      {viaApp && <div style={{ marginTop: 22 }}>{signedIn() ? <ConnectorCard /> : <DossierCard today={today} />}</div>}
    </div>
  );
}
