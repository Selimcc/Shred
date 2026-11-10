import { useState } from 'react';
import { Braise, Bubble, type Mood } from '../components/Braise';
import { Flame } from '../components/Flame';
import { Icon } from '../components/Icon';
import { toast } from '../components/ui';
import { logBody, parseDecimal, toggleHabit } from '../lib/actions';
import { formatNumber, WEEKDAY_LETTERS, weekdayOf } from '../lib/date';
import { flameInfo } from '../lib/flames';
import { lastWeekMonday, reportPending } from '../lib/report';
import { planSummary } from '../../shared/plans';
import { ReportSheet } from '../components/ReportSheet';
import { gymDuration, runShortcut, timeOf } from '../lib/health';
import {
  dayStatus,
  mealsCount,
  type Rule,
  ruleOf,
  sessionFor,
  setProgress,
  streakInfo,
  totals,
  weekKeys,
} from '../lib/logic';
import { type AppState, readDay, useApp } from '../lib/store';
import type { Tab } from '../App';



function ruleText(rule: Rule): string {
  const parts: string[] = [];
  if (rule.workout) parts.push('la séance');
  if (rule.minMeals > 0) parts.push(`au moins ${rule.minMeals} repas`);
  return parts.join(' et ');
}

/** Ce que Braise dit, et le bouton principal : une seule chose à faire maintenant. */
function nextStep(s: AppState, today: string): { mood: Mood; text: string; cta?: { label: string; tab: Tab } } {
  const day = readDay(s, today);
  const session = sessionFor(s, today);
  const prog = setProgress(session, day);
  const st = streakInfo(s, today);
  const rule = ruleOf(s);
  const meals = mealsCount(day);
  const hour = new Date().getHours();
  const name = s.settings.name ? ` ${s.settings.name}` : '';
  const sessionLeft = rule.workout && !day.mainDone && session.type !== 'rest';
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
    if (prog.done > 0) return { mood: 'cheer', text: `Tu es lancé : ${prog.done} séries sur ${prog.total}. On termine ?`, cta: { label: 'Continuer la séance', tab: 'workout' } };
    const detail = session.lifting ? `${session.exercises.length} exercices, environ ${session.duration}` : session.focus;
    return { mood: 'happy', text: `Salut${name} ! Aujourd’hui c’est ${session.name} : ${detail}.`, cta: { label: `Commencer ${session.name}`, tab: 'workout' } };
  }
  if (mealsLeft > 0) {
    return {
      mood: 'happy',
      text: day.mainDone ? `Séance faite, bravo ! Note encore ${mealsLeft} repas pour valider ta journée.` : `Jour de repos. Note ${mealsLeft} repas et ta journée est validée.`,
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

  return (
    <>
      <header className="home-top">
        <span className="who">{s.settings.name ? `Salut ${s.settings.name}` : 'Salut'}</span>
        <span className="stat-pill flame" title={`Jours de série · ${flames.tierInfo.name}`} aria-label={`${st.current} jours de série`}>
          <Flame tier={flames.tier} size={18} animated={st.todayValidated} />
          {st.current}
        </span>
        <span className="stat-pill ice" title="Gels de série" aria-label={`${st.freezes} gels`}>
          <Icon name="snow" size={17} />
          {st.freezes}
        </span>
        <button className="icon-btn" onClick={openSettings} aria-label="Réglages">
          <Icon name="gear" />
        </button>
      </header>

      <section className="hero">
        <button
          style={{ border: 0, background: 'none', padding: 0 }}
          onClick={() => go('coach')}
          aria-label="Parler à Braise, ton coach"
        >
          <Braise mood={step.mood} tier={flames.tier} size={104} />
        </button>
        <div className="talk">
          <Bubble key={step.text}>{step.text}</Bubble>
        </div>
      </section>
      {step.cta && (
        <button className="btn primary block cta" onClick={() => go(step.cta!.tab)}>
          {step.cta.label}
        </button>
      )}

      <Week state={s} today={today} />
      {planLine && (
        <p className="small muted" style={{ margin: '10px 2px 0' }}>
          {planLine}
        </p>
      )}

      {reportPending(s, today) && (
        <button className="card report-banner" onClick={() => setReport(lastWeekMonday(today))}>
          <Icon name="chart" size={22} />
          <span style={{ flex: 1, textAlign: 'left' }}>
            <span style={{ display: 'block', fontWeight: 850 }}>Ton bilan de la semaine est prêt</span>
            <span className="small muted">Ce qui a marché, et ce qu’on ajuste.</span>
          </span>
          <Icon name="chevron" size={18} />
        </button>
      )}
      {report && <ReportSheet monday={report} onClose={() => setReport(null)} openCoach={() => go('coach')} />}

      <section className="section">
        <div className="section-head">
          <h2 style={{ whiteSpace: "nowrap" }}>Ta journée</h2>
          <span className="small muted">{st.todayValidated ? 'Validée' : `Pour valider : ${ruleText(rule)}`}</span>
        </div>
        <div className="group">
          <button className={`todo ${day.mainDone ? 'done' : ''}`} onClick={() => go('workout')}>
            <span className="badge">
              <Icon name={day.mainDone ? 'check' : session.type === 'rest' ? 'moon' : 'dumbbell'} size={22} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="t">{session.name}</span>
              <span className="s">
                {day.mainDone ? 'Fait' : session.lifting ? `${prog.done}/${prog.total} séries · ${session.duration}` : session.focus}
              </span>
              {!day.mainDone && prog.total > 0 && (
                <span className="meter">
                  <i style={{ width: `${Math.round((prog.done / prog.total) * 100)}%` }} />
                </span>
              )}
            </span>
            <Icon name="chevron" size={18} />
          </button>
          {mod.nutrition && (
            <button className={`todo ${meals >= Math.max(1, rule.minMeals) ? 'done' : ''}`} onClick={() => go('food')}>
              <span className="badge">
                <Icon name={meals >= Math.max(1, rule.minMeals) ? 'check' : 'utensils'} size={22} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="t">
                  Repas {meals}/{Math.max(rule.minMeals, 3)}
                </span>
                <span className="s">
                  {formatNumber(t.kcal)} / {formatNumber(s.settings.targets.kcal)} kcal · {formatNumber(t.protein)} / {s.settings.targets.protein} g de protéines
                </span>
                <span className="meter">
                  <i style={{ width: `${Math.min(100, Math.round((t.kcal / s.settings.targets.kcal) * 100))}%`, background: 'var(--flame)' }} />
                </span>
              </span>
              <Icon name="chevron" size={18} />
            </button>
          )}
          {mod.habits && s.habits.length > 0 && (
            <div className={`todo ${habitsDone === s.habits.length ? 'done' : ''}`} style={{ flexWrap: 'wrap' }}>
              <span className="badge">
                <Icon name={habitsDone === s.habits.length ? 'check' : 'list'} size={22} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="t">
                  Habitudes {habitsDone}/{s.habits.length}
                </span>
                <span className="chips" style={{ marginTop: 8 }}>
                  {s.habits.map((h) => {
                    const on = !!day.habits[h.id];
                    return (
                      <button key={h.id} className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggleHabit(today, h.id)}>
                        <Icon name={on ? 'check' : h.icon} size={16} />
                        {h.name}
                      </button>
                    );
                  })}
                </span>
              </span>
            </div>
          )}
        </div>
        {(mod.health || mod.gym) && <Activity today={today} openSettings={openSettings} />}
      </section>

      {mod.weight && s.body.weight[today] === undefined && <WeighIn today={today} value={s.body.weight[today]} />}

      <button className="card ask-braise" onClick={() => go('coach')}>
        <Braise mood="think" tier={flames.tier} size={44} />
        <span style={{ flex: 1 }}>
          <span style={{ display: 'block', fontWeight: 850 }}>Une question ?</span>
          <span className="small muted">Demande à Braise : séance, repas, progression.</span>
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
