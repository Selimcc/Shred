import { useState } from 'react';
import { SLOTS } from '../../shared/program';
import { Flame } from '../components/Flame';
import { Icon } from '../components/Icon';
import { Ring } from '../components/Ring';
import { toast } from '../components/ui';
import { logBody, parseDecimal, toggleHabit, togglePlannedMeal } from '../lib/actions';
import { formatNumber, parseKey, WEEKDAY_LETTERS, weekdayOf } from '../lib/date';
import { exerciseFrames } from '../lib/exercise-info';
import { flameInfo } from '../lib/flames';
import { lastWeekMonday, reportPending } from '../lib/report';
import { planSummary } from '../../shared/plans';
import { ReportSheet } from '../components/ReportSheet';
import { gymDuration, runShortcut, STEP_GOAL, timeOf } from '../lib/health';
import {
  dayStatus,
  levelFor,
  mealsCount,
  type Rule,
  ruleOf,
  sessionFor,
  setProgress,
  streakInfo,
  totals,
  totalXp,
  weekKeys,
} from '../lib/logic';
import { type AppState, readDay, useApp } from '../lib/store';
import type { Tab } from '../App';

const shortFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const shortDate = (k: string) => {
  const t = shortFmt.format(parseKey(k));
  return t.charAt(0).toUpperCase() + t.slice(1);
};

const SLOT_ICON: Record<string, string> = { breakfast: 'sunrise', lunch: 'sun', snack: 'apple', dinner: 'moon' };

function ruleText(rule: Rule): string {
  const parts: string[] = [];
  if (rule.workout) parts.push('la séance');
  if (rule.minMeals > 0) parts.push(`au moins ${rule.minMeals} repas`);
  return parts.join(' et ');
}

export function Today({ today, go, openSettings }: { today: string; go: (t: Tab) => void; openSettings: () => void }) {
  const s = useApp();
  const day = readDay(s, today);
  const session = sessionFor(s, today);
  const st = streakInfo(s, today);
  const flames = flameInfo(s, today);
  const [report, setReport] = useState<string | null>(null);
  const planLine = planSummary(s.program, today);
  const lvl = levelFor(totalXp(s));
  const prog = setProgress(session, day);
  const t = totals(day);
  const meals = mealsCount(day);
  const target = s.settings.targets;
  const health = s.health[today];
  const mod = s.settings.modules;
  const rule = ruleOf(s);

  return (
    <>
      <header className="hud">
        <Ring value={lvl.xp - lvl.floor} max={lvl.next - lvl.floor} color="var(--gold)" size={50} stroke={5} label="Progression du niveau">
          <span className="num" style={{ fontWeight: 900, fontSize: '1.05rem' }}>
            {lvl.level}
          </span>
        </Ring>
        <div className="who">
          <div className="small muted">{shortDate(today)}</div>
          <div style={{ fontWeight: 850, fontStretch: '115%', fontSize: '1.15rem' }}>
            {s.settings.name ? `Salut ${s.settings.name}` : 'Salut'}
          </div>
        </div>
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

      <Week state={s} today={today} />

      {reportPending(s, today) && (
        <button className="card report-banner" onClick={() => setReport(lastWeekMonday(today))}>
          <Icon name="chart" size={22} />
          <span style={{ flex: 1, textAlign: 'left' }}>
            <span style={{ display: 'block', fontWeight: 850 }}>Ton bilan de la semaine est prêt</span>
            <span className="small muted">Séances, nutrition, poids, et ce qu’on ajuste.</span>
          </span>
          <Icon name="chevron" size={18} />
        </button>
      )}
      {planLine && <p className="small muted" style={{ margin: '12px 2px 0' }}>{planLine}</p>}
      {report && <ReportSheet monday={report} onClose={() => setReport(null)} openCoach={() => go('coach')} />}

      <section className="section">
        <Mission state={s} today={today} go={go} />
      </section>

      <section className="section">
        <div className="rings" style={{ gridTemplateColumns: `repeat(${1 + (mod.nutrition ? 2 : 0) + (mod.health ? 1 : 0)}, 1fr)` }}>
          <button className="ring-card" onClick={() => go('workout')}>
            <Ring value={day.mainDone ? 1 : prog.done} max={day.mainDone ? 1 : Math.max(1, prog.total)} color="var(--blue)" label="Séance" size={58} stroke={7}>
              <span className="num" style={{ fontWeight: 850 }}>
                {day.mainDone ? <Icon name="check" size={20} /> : `${Math.round((prog.done / Math.max(1, prog.total)) * 100)}%`}
              </span>
            </Ring>
            <span className="label">Séance</span>
          </button>
          {mod.nutrition && (
            <button className="ring-card" onClick={() => go('food')}>
              <Ring value={meals} max={4} color="var(--gold)" label="Repas notés" size={58} stroke={7}>
                <span className="num" style={{ fontWeight: 850 }}>
                  {meals}/4
                </span>
              </Ring>
              <span className="label">Repas</span>
            </button>
          )}
          {mod.nutrition && (
            <button className="ring-card" onClick={() => go('food')}>
              <Ring value={t.protein} max={target.protein} color="var(--green)" label="Protéines" size={58} stroke={7}>
                <span className="num" style={{ fontWeight: 850, fontSize: '0.82rem' }}>
                  {formatNumber(t.protein)}g
                </span>
              </Ring>
              <span className="label">Protéines</span>
            </button>
          )}
          {mod.health && (
            <button className="ring-card" onClick={() => (health?.steps === undefined ? openSettings() : go('progress'))}>
              <Ring value={health?.steps ?? 0} max={STEP_GOAL} color="var(--flame)" label="Pas" size={58} stroke={7}>
                <span className="num" style={{ fontWeight: 850, fontSize: '0.82rem' }}>
                  {health?.steps === undefined ? '?' : `${formatNumber(health.steps / 1000, 1)}k`}
                </span>
              </Ring>
              <span className="label">Pas</span>
            </button>
          )}
        </div>
        {(mod.health || mod.gym) && <Activity today={today} openSettings={openSettings} />}
        <p className="small" style={{ margin: '12px 2px 0', color: st.todayValidated ? 'var(--green)' : 'var(--ink-2)', fontWeight: st.todayValidated ? 700 : 400 }}>
          {st.todayValidated ? `Journée validée. Série : ${st.current} jour${st.current > 1 ? 's' : ''}.` : `Pour valider ta journée : ${ruleText(rule)}.`}
        </p>
      </section>

      {mod.nutrition && (
        <section className="section">
          <div className="section-head">
            <h2>Repas du jour</h2>
            <button className="link small" onClick={() => go('food')}>
              <Icon name="camera" size={16} /> Photo
            </button>
          </div>
          <div className="tiles">
            {SLOTS.filter((sl) => sl.id !== 'extra').map((slot) => {
              const planned = s.mealPlan.find((m) => m.slot === slot.id);
              const entries = day.meals.filter((m) => m.slot === slot.id);
              const plannedOn = !!planned && entries.some((m) => m.planId === planned.id);
              const other = entries.find((m) => !planned || m.planId !== planned.id);
              const on = entries.length > 0;
              const kcal = on ? entries.reduce((n, m) => n + m.kcal, 0) : (planned?.kcal ?? 0);
              const label = other && !plannedOn ? other.label : (planned?.label ?? 'Rien de prévu');
              return (
                <button
                  key={slot.id}
                  className={`tile ${on ? 'on' : ''}`}
                  aria-pressed={on}
                  aria-label={`${slot.name} : ${label}`}
                  onClick={() => (!planned || (other && !plannedOn) ? go('food') : togglePlannedMeal(today, planned))}
                >
                  <span className="ico">
                    <Icon name={SLOT_ICON[slot.id]} size={24} />
                  </span>
                  <span className="t">{slot.name}</span>
                  <span className="s">{label}</span>
                  {kcal > 0 && (
                    <span className="s num" style={{ fontWeight: 700 }}>
                      {formatNumber(kcal)} kcal
                    </span>
                  )}
                  <span className="mark">
                    <Icon name="check" size={16} />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {mod.habits && s.habits.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Habitudes</h2>
          </div>
          <div className="chips">
            {s.habits.map((h) => {
              const on = !!day.habits[h.id];
              const name = h.id === 'steps' && mod.health && health?.steps !== undefined && !on ? `${formatNumber(health.steps)} / 8 000 pas` : h.name;
              return (
                <button key={h.id} className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggleHabit(today, h.id)}>
                  <Icon name={on ? 'check' : h.icon} size={17} />
                  {name}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {mod.weight && <WeighIn today={today} value={s.body.weight[today]} />}
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

function Mission({ state, today, go }: { state: AppState; today: string; go: (t: Tab) => void }) {
  const day = readDay(state, today);
  const session = sessionFor(state, today);
  const prog = setProgress(session, day);
  const shown = session.exercises.slice(0, 4);
  const extra = session.exercises.length - shown.length;
  const label = day.mainDone
    ? 'Revoir la séance'
    : prog.done > 0
      ? `Continuer, ${prog.done}/${prog.total} séries`
      : session.lifting
        ? 'Commencer la séance'
        : 'C’est parti';
  return (
    <div className={`mission ${day.mainDone ? 'done' : ''}`}>
      <div className="kicker">{day.mainDone ? 'Mission accomplie' : 'Mission du jour'}</div>
      <div className="display name">{session.name}</div>
      <div className="focus small">
        {session.focus}
        {session.lifting ? `, ${session.exercises.length} exercices, ${session.duration}` : ''}
      </div>
      <div className="thumbs" aria-hidden>
        {shown.map((ex) => {
          const f = exerciseFrames(ex.key);
          return f ? <img key={ex.key} src={f[0]} alt="" loading="lazy" /> : <span key={ex.key}>{ex.name.slice(0, 1)}</span>;
        })}
        {extra > 0 && <span>+{extra}</span>}
      </div>
      <button className="btn block" onClick={() => go('workout')}>
        {day.mainDone && <Icon name="check" size={20} />}
        {label}
      </button>
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
