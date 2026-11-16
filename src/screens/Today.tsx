import { type CSSProperties, useState } from 'react';
import { Bubble, type Mood, Pulse } from '../components/Pulse';
import { Flame } from '../components/Flame';
import { Icon } from '../components/Icon';
import { toast } from '../components/ui';
import { logBody, parseDecimal, toggleHabit } from '../lib/actions';
import { formatLong, formatNumber, WEEKDAY_LETTERS, weekdayOf } from '../lib/date';
import { flameInfo } from '../lib/flames';
import { lastWeekMonday, reportPending } from '../lib/report';
import { planSummary } from '../../shared/plans';
import { ReportSheet } from '../components/ReportSheet';
import { gymDuration, runShortcut, timeOf } from '../lib/health';
import {
  dayStatus,
  mealsCount,
  ruleOf,
  HALF_SESSION,
  workoutOk,
  sessionFor,
  setProgress,
  streakInfo,
  totals,
  weekKeys,
} from '../lib/logic';
import { type AppState, readDay, useApp } from '../lib/store';
import type { Tab } from '../App';



/** Ce que Pulse dit, et le bouton principal : une seule chose à faire maintenant. */
function nextStep(s: AppState, today: string): { mood: Mood; text: string; cta?: { label: string; tab: Tab } } {
  const day = readDay(s, today);
  const session = sessionFor(s, today);
  const prog = setProgress(session, day);
  const st = streakInfo(s, today);
  const rule = ruleOf(s);
  const meals = mealsCount(day);
  const hour = new Date().getHours();
  const name = s.settings.name ? ` ${s.settings.name}` : '';
  const sessionLeft = !day.mainDone && session.type !== 'rest' && !workoutOk(s, today, rule);
  const half = Math.ceil(prog.total * HALF_SESSION);
  const mealsLeft = Math.max(0, rule.minMeals - meals);

  if (st.todayValidated) {
    return { mood: 'proud', text: `Journée validée${name} ! ${st.current} jour${st.current > 1 ? 's' : ''} de série. Je brille grâce à toi, reviens demain.`, cta: { label: 'Voir ma progression', tab: 'progress' } };
  }
  if (hour < 7 && !prog.done && !meals) {
    return { mood: 'sleepy', text: `Il est tôt… Aujourd’hui : ${session.name}. Je t’attends quand tu es prêt.` };
  }
  if (hour >= 20 && st.banked > 0) {
    const what = [sessionLeft ? 'ta séance' : '', mealsLeft ? `${mealsLeft} repas` : ''].filter(Boolean).join(' et ');
    return {
      mood: 'sad',
      text: `Ta série de ${st.banked} jour${st.banked > 1 ? 's' : ''} est en danger ! Il te manque ${what || 'peu de chose'} avant minuit.`,
      cta: sessionLeft ? { label: 'Faire ma séance', tab: 'workout' } : { label: 'Noter un repas', tab: 'food' },
    };
  }
  if (sessionLeft) {
    if (prog.done > 0) {
      const left = Math.max(1, half - prog.done);
      const why = rule.level === 'half' ? ` Encore ${left} série${left > 1 ? 's' : ''} et ta flamme du jour est assurée.` : ' On termine ?';
      return { mood: 'cheer', text: `Tu es lancé : ${prog.done} séries sur ${prog.total}.${why}`, cta: { label: 'Continuer la séance', tab: 'workout' } };
    }
    const detail = session.lifting ? `${session.exercises.length} exercices, environ ${session.duration}` : session.focus;
    return { mood: 'happy', text: `Salut${name} ! Aujourd’hui c’est ${session.name} : ${detail}.`, cta: { label: `Commencer ${session.name}`, tab: 'workout' } };
  }
  if (mealsLeft > 0) {
    return {
      mood: 'happy',
      text:
        session.type === 'rest'
          ? `Jour de repos. Note ${mealsLeft} repas et ta journée est validée.`
          : `Côté sport c’est bon, bravo ! Note encore ${mealsLeft} repas pour valider ta journée.`,
      cta: { label: 'Noter un repas', tab: 'food' },
    };
  }
  return { mood: 'happy', text: 'Tout est presque bon pour aujourd’hui.', cta: { label: 'Voir ma séance', tab: 'workout' } };
}

export function Today({ today, go, openSettings }: { today: string; go: (t: Tab) => void; openSettings: () => void }) {
  const s = useApp();
  const day = readDay(s, today);
  const session = sessionFor(s, today);
  const st = streakInfo(s, today);
  const flames = flameInfo(s, today);
  const [report, setReport] = useState<string | null>(null);
  const planLine = planSummary(s.program, today);
  const prog = setProgress(session, day);
  const t = totals(day);
  const meals = mealsCount(day);
  const mod = s.settings.modules;
  const rule = ruleOf(s);
  const step = nextStep(s, today);
  const habitsDone = s.habits.filter((h) => day.habits[h.id]).length;

  const remaining = Math.max(0, s.settings.targets.kcal - t.kcal);
  const tier = flames.tierInfo.colors[1];

  return (
    <>
      <header className="home-top">
        <div className="who">
          <div className="date">{formatLong(today)}</div>
          <h1>{s.settings.name ? `Salut ${s.settings.name}` : 'Salut'}</h1>
        </div>
        <span className="stat-pill flame" title={`Jours de série, ${flames.tierInfo.name}`} aria-label={`${st.current} jours de série`}>
          <Flame tier={flames.tier} size={18} animated={st.todayValidated} />
          {st.current}
        </span>
        {st.freezes > 0 && (
          <span className="stat-pill ice" title="Gels de série" aria-label={`${st.freezes} gels`}>
            <Icon name="snow" size={16} />
            {st.freezes}
          </span>
        )}
        <button className="icon-btn" onClick={openSettings} aria-label="Réglages">
          <Icon name="gear" size={20} />
        </button>
      </header>

      <section className="today-hero" style={{ '--tier': tier } as CSSProperties}>
        <button className="hero-coach" onClick={() => go('coach')} aria-label="Parler à Pulse, ton coach">
          <Pulse mood={step.mood} tier={flames.tier} size={60} />
          <Bubble key={step.text}>{step.text}</Bubble>
        </button>
        <h2 className="hero-title display">{session.name}</h2>
        <p className="hero-focus">{session.focus}</p>
        {session.type !== 'rest' && (
          <div className="hero-stats">
            {session.lifting && (
              <div>
                <b>{session.exercises.length}</b>
                <span>exercices</span>
              </div>
            )}
            <div>
              <b>{session.duration.replace(/\s*min/, '')}</b>
              <span>{/min/.test(session.duration) ? 'minutes' : 'durée'}</span>
            </div>
            {session.lifting && (
              <div>
                <b>
                  {day.mainDone ? prog.total : prog.done}/{prog.total}
                </b>
                <span>séries</span>
              </div>
            )}
          </div>
        )}
        {session.type === 'rest' && <div style={{ height: 18 }} />}
        {!day.mainDone && prog.done > 0 && prog.total > 0 && (
          <div className="hero-progress">
            <span className="meter">
              <i style={{ width: `${Math.round((prog.done / prog.total) * 100)}%` }} />
            </span>
          </div>
        )}
        {step.cta && (
          <button className="btn primary block" onClick={() => go(step.cta!.tab)}>
            {step.cta.label}
          </button>
        )}
      </section>

      <Week state={s} today={today} />
      {planLine && <p className="small muted plan-line">{planLine}</p>}

      {reportPending(s, today) && (
        <button className="card report-banner" onClick={() => setReport(lastWeekMonday(today))}>
          <Icon name="chart" size={22} />
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontWeight: 650 }}>Ton bilan de la semaine est prêt</span>
            <span className="small muted">Ce qui a marché, et ce qu’on ajuste.</span>
          </span>
          <Icon name="chevron" size={18} />
        </button>
      )}
      {report && <ReportSheet monday={report} onClose={() => setReport(null)} openCoach={() => go('coach')} />}

      {mod.nutrition && (
        <section className="section">
          <div className="section-head">
            <h2>Nutrition</h2>
            <button className="link small" onClick={() => go('food')}>
              Noter un repas
            </button>
          </div>
          <button className="group" style={{ display: 'block', width: '100%', textAlign: 'left', color: 'inherit', font: 'inherit', padding: 0 }} onClick={() => go('food')}>
            <div className="macro-grid">
              <div className="macro">
                <b>
                  {formatNumber(remaining)}
                  <small>kcal</small>
                </b>
                <span>restantes sur {formatNumber(s.settings.targets.kcal)}</span>
                <span className="meter" style={{ margin: 0 }}>
                  <i style={{ width: `${Math.min(100, Math.round((t.kcal / s.settings.targets.kcal) * 100))}%`, background: 'var(--amber)' }} />
                </span>
              </div>
              <div className="macro">
                <b>
                  {formatNumber(t.protein)}
                  <small>g</small>
                </b>
                <span>protéines sur {s.settings.targets.protein} g</span>
                <span className="meter" style={{ margin: 0 }}>
                  <i style={{ width: `${Math.min(100, Math.round((t.protein / s.settings.targets.protein) * 100))}%`, background: 'var(--glacier)' }} />
                </span>
              </div>
            </div>
          </button>
          <p className="small muted" style={{ margin: '10px 2px 0' }}>
            {meals} repas noté{meals > 1 ? 's' : ''}
            {rule.minMeals > 0 ? `, ${Math.max(rule.minMeals, meals)} pour valider la journée` : ''}.
          </p>
        </section>
      )}

      {mod.habits && s.habits.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Habitudes</h2>
            <span className="small muted num">
              {habitsDone}/{s.habits.length}
            </span>
          </div>
          <div className="chips">
            {s.habits.map((h) => {
              const on = !!day.habits[h.id];
              return (
                <button key={h.id} className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggleHabit(today, h.id)}>
                  <Icon name={on ? 'check' : h.icon} size={16} />
                  {h.name}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {(mod.health || mod.gym) && (
        <section className="section" style={{ marginTop: 22 }}>
          <Activity today={today} openSettings={openSettings} />
        </section>
      )}

      {mod.weight && s.body.weight[today] === undefined && <WeighIn today={today} value={s.body.weight[today]} />}

      <button className="card ask-pulse" onClick={() => go('coach')}>
        <Pulse mood="think" tier={flames.tier} size={40} />
        <span style={{ flex: 1 }}>
          <span style={{ display: 'block', fontWeight: 650 }}>Une question pour Pulse ?</span>
          <span className="small muted">Séance, repas, progression : demande.</span>
        </span>
        <Icon name="chevron" size={18} />
      </button>
    </>
  );
}

function Week({ state, today }: { state: AppState; today: string }) {
  return (
    <div className="week" aria-label="Ta semaine">
      {weekKeys(today).map((key) => {
        const status = dayStatus(state, key, today);
        const icon =
          status === 'validated' ? (
            <Icon name="flame" size={20} filled />
          ) : status === 'frozen' ? (
            <Icon name="snow" size={18} />
          ) : status === 'missed' ? (
            <Icon name="x" size={16} />
          ) : status === 'today' ? (
            <Icon name="flame" size={20} />
          ) : null;
        return (
          <div key={key} className={`day d-${status}`} title={sessionFor(state, key).name}>
            <span className="dot">{icon}</span>
            {WEEKDAY_LETTERS[weekdayOf(key)]}
          </div>
        );
      })}
    </div>
  );
}

function WeighIn({ today, value }: { today: string; value?: number }) {
  const [draft, setDraft] = useState('');
  const save = () => {
    const kg = parseDecimal(draft);
    if (kg === undefined || kg < 30 || kg > 250) return toast('Entre un poids valide, par exemple 74,6', true);
    logBody('weight', today, kg);
    setDraft('');
    toast('Pesée enregistrée, +5 XP');
  };
  return (
    <section className="section">
      <div className="section-head">
        <h2>Pesée du matin</h2>
        {value !== undefined && (
          <span className="tag up num">
            <Icon name="check" size={14} /> {formatNumber(value, 1)} kg
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <input
          className="input num"
          inputMode="decimal"
          placeholder={value !== undefined ? formatNumber(value, 1) : 'kg, à jeun'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          aria-label="Poids du jour en kg"
          id="weigh-in"
        />
        <button className="btn primary" onClick={save} disabled={!draft.trim()}>
          OK
        </button>
      </div>
    </section>
  );
}

function Activity({ today, openSettings }: { today: string; openSettings: () => void }) {
  const s = useApp();
  const h = s.health[today];
  const linked = Object.keys(s.health).length > 0;
  if (!linked) {
    return (
      <button className="link small" style={{ marginTop: 12 }} onClick={openSettings}>
        Relier Apple Santé pour compter tes pas et tes calories automatiquement
      </button>
    );
  }
  const duration = gymDuration(h);
  // Plus de deux heures sans nouvelles de Santé : un bouton relance le raccourci.
  const stale = s.settings.modules.health && /iPhone|iPad/.test(navigator.userAgent) && (!h?.at || Date.now() - new Date(h.at).getTime() > 2 * 3600_000);
  const parts: string[] = [];
  if (h?.steps !== undefined) parts.push(`${formatNumber(h.steps)} pas`);
  if (h?.active !== undefined) parts.push(`${formatNumber(h.active)} kcal brûlées en activité`);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 12 }}>
      {h?.gymIn && (
        <span className="tag flame">
          <Icon name="dumbbell" size={14} />
          {duration ? `Salle : ${duration}` : `À la salle depuis ${timeOf(h.gymIn)}`}
        </span>
      )}
      <span className="small muted">
        {parts.length ? `${parts.join(', ')}.` : 'Pas encore de données Santé aujourd’hui.'}
        {h?.at ? ` Synchro à ${timeOf(h.at)}.` : ''}
      </span>
      {stale && (
        <button className="link small" onClick={runShortcut}>
          Synchroniser
        </button>
      )}
    </div>
  );
}
