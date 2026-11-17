import { ReadinessCard } from '../components/Recovery';
import { MonthRecap } from '../components/MonthRecap';
import { ofMonth, recapReady } from '../lib/monthRecap';
import { activeSeason, greeting, SEASON_SHINE, seasonDay, type SeasonId, seasonStart } from '../lib/season';
import { type CSSProperties, useEffect, useState } from 'react';
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
import { SeasonReplay } from '../components/SeasonScene';
import { photoDue } from '../components/BodyPhotos';
import { gymDuration, runShortcut, STEP_GOAL, timeOf } from '../lib/health';
import { SessionProfile } from '../components/SessionProfile';
import { RollingNumber } from '../components/RollingNumber';
import { blocksSeconds, hardSeconds, repMeters, sessionBlocks } from '../../shared/effort';
import { DISCIPLINE_NAMES } from '../../shared/catalog';
import { disciplinesOf } from '../../shared/effort';
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
import { InstallGuide } from '../components/InstallGuide';
import { DEMO } from '../lib/api';
import { installDismissed } from '../lib/install';
import { atGym } from '../lib/places';
import { list, lower, pct as fmtPct, tn, tr } from '../../shared/i18n';



/** Ce que Pulse dit, et le bouton principal : une seule chose à faire maintenant. */
function nextStep(s: AppState, today: string, season: SeasonId | null): { mood: Mood; text: string; cta?: { label: string; tab: Tab } } {
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
    const shine = season ? SEASON_SHINE[season] : tr('Je brille grâce à toi, reviens demain.');
    return { mood: 'proud', text: tn(st.current, 'Journée validée{name} ! {n} jour de série. {shine}', 'Journée validée{name} ! {n} jours de série. {shine}', { name, shine }), cta: { label: tr('Voir ma progression'), tab: 'progress' } };
  }
  if (hour < 7 && !prog.done && !meals) {
    return { mood: 'sleepy', text: tr('Il est tôt… Aujourd’hui : {name}. Je t’attends quand tu es prêt.', { name: session.name }) };
  }
  if (hour >= 20 && st.banked > 0) {
    const what = list([sessionLeft ? tr('ta séance') : '', mealsLeft ? tn(mealsLeft, '{n} repas', '{n} repas') : ''].filter(Boolean));
    return {
      mood: 'sad',
      text: tn(st.banked, 'Ta série de {n} jour est en danger ! Il te manque {what} avant minuit.', 'Ta série de {n} jours est en danger ! Il te manque {what} avant minuit.', { what: what || tr('peu de chose') }),
      cta: sessionLeft ? { label: tr('Faire ma séance'), tab: 'workout' } : { label: tr('Noter un repas'), tab: 'food' },
    };
  }
  if (sessionLeft) {
    if (prog.done > 0) {
      const left = Math.max(1, half - prog.done);
      const why = rule.level === 'half' ? tn(left, ' Encore {n} série et ta flamme du jour est assurée.', ' Encore {n} séries et ta flamme du jour est assurée.') : tr(' On termine ?');
      return { mood: 'cheer', text: tr('Tu es lancé : {done} séries sur {total}.{why}', { done: prog.done, total: prog.total, why }), cta: { label: tr('Continuer la séance'), tab: 'workout' } };
    }
    const detail = session.lifting ? tn(session.exercises.length, '{n} exercice, environ {duration}', '{n} exercices, environ {duration}', { duration: session.duration }) : session.focus;
    const text = season ? seasonStart(season, seasonDay(today), s.settings.name, tr('{name} : {detail}', { name: session.name, detail })) : tr('Salut{name} ! Aujourd’hui c’est {name2} : {detail}.', { name, name2: session.name, detail });
    return { mood: 'happy', text, cta: { label: tr('Commencer {name}', { name: session.name }), tab: 'workout' } };
  }
  if (mealsLeft > 0) {
    return {
      mood: 'happy',
      text:
        session.type === 'rest'
          ? tn(mealsLeft, 'Jour de repos. Note {n} repas et ta journée est validée.', 'Jour de repos. Note {n} repas et ta journée est validée.')
          : tn(mealsLeft, 'Côté sport c’est bon, bravo ! Note encore {n} repas pour valider ta journée.', 'Côté sport c’est bon, bravo ! Note encore {n} repas pour valider ta journée.'),
      cta: { label: tr('Noter un repas'), tab: 'food' },
    };
  }
  return { mood: 'happy', text: tr('Tout est presque bon pour aujourd’hui.'), cta: { label: tr('Voir ma séance'), tab: 'workout' } };
}

export function Today({ today, go, openSettings }: { today: string; go: (t: Tab) => void; openSettings: () => void }) {
  const s = useApp();
  const day = readDay(s, today);
  const session = sessionFor(s, today);
  const st = streakInfo(s, today);
  const flames = flameInfo(s, today);
  const [report, setReport] = useState<string | null>(null);
  const [recap, setRecap] = useState<string | null>(null);
  const recapMonth = recapReady(s, today);
  const [showInstall, setShowInstall] = useState(() => !DEMO && !installDismissed());
  const [arrived, setArrived] = useState(false);
  const gymPlace = s.settings.modules.gym ? s.settings.gym.place : undefined;
  useEffect(() => {
    if (!gymPlace || day.mainDone || session.type === 'rest') return;
    void atGym(gymPlace, today).then(setArrived);
  }, [gymPlace?.id, today]);
  const planLine = planSummary(s.program, today);
  const prog = setProgress(session, day);
  const t = totals(day);
  const meals = mealsCount(day);
  const mod = s.settings.modules;
  const rule = ruleOf(s);
  const season = activeSeason(s, today);
  const step = nextStep(s, today, season);
  const habitsDone = s.habits.filter((h) => day.habits[h.id]).length;

  const blocks = sessionBlocks(session.exercises);
  const endurance = blocks.length > 0;
  const meters = session.exercises.reduce((n, x) => n + (x.discipline && x.discipline !== 'combat' ? repMeters(x) * x.sets : 0), 0);
  const hard = hardSeconds(blocks);
  const sports = disciplinesOf(session.exercises).filter((d) => d !== 'walk');
  const swimOnly = sports.length === 1 && sports[0] === 'swim';
  const steps = s.health[today]?.steps;

  const remaining = Math.max(0, s.settings.targets.kcal - t.kcal);
  const tier = flames.tierInfo.colors[1];

  return (
    <>
      <header className="home-top">
        {/* La date prend toute la largeur : le bouton de la fête s'y range sans serrer le titre. */}
        <div className="date">
          {formatLong(today)}
          {season && <SeasonReplay season={season} />}
        </div>
        <div className="who">
          <h1>{greeting(season, seasonDay(today), s.settings.name)}</h1>
        </div>
        <span className="stat-pill flame" title={tr('Jours de série, {name}', { name: flames.tierInfo.name })} aria-label={tn(st.current, '{n} jour de série', '{n} jours de série')}>
          <Flame tier={flames.tier} size={18} animated={st.todayValidated} />
          <RollingNumber value={st.current} />
        </span>
        {st.freezes > 0 && (
          <span className="stat-pill ice" title={tr('Gels de série')} aria-label={tn(st.freezes, '{n} gel', '{n} gels')}>
            <Icon name="snow" size={16} />
            {st.freezes}
          </span>
        )}
        <button className="icon-btn" onClick={openSettings} aria-label={tr('Réglages')}>
          <Icon name="gear" size={20} />
        </button>
      </header>

      {arrived && !day.mainDone && (
        <section className="card arrival" aria-live="polite">
          <span className="settings-icon">
            <Icon name="pin" size={18} />
          </span>
          <div className="grow" style={{ minWidth: 0 }}>
            <b>{tr('Tu es à {name}', { name: gymPlace?.name })}</b>
            <div className="small muted ellipsis">{tr('{name} t’attend.', { name: session.name })}</div>
          </div>
          <button className="btn primary small" onClick={() => go('workout')}>
            {tr('Commencer')}
          </button>
        </section>
      )}

      {showInstall && (
        <div style={{ marginBottom: 16 }}>
          <InstallGuide compact onLater={() => setShowInstall(false)} />
        </div>
      )}

      {/* Le disque de la séance : rouge pour la muscu, bleu pour l'endurance, vert pour le repos. */}
      <section className="today-hero" data-plate={session.type === 'rest' ? 'green' : session.type === 'cardio' ? 'blue' : 'red'} style={{ '--tier': tier } as CSSProperties}>
        <button className="hero-coach" onClick={() => go('coach')} aria-label={tr('Parler à Pulse, ton coach')}>
          <Pulse mood={step.mood} tier={flames.tier} size={60} />
          <Bubble key={step.text}>{step.text}</Bubble>
        </button>
        <h2 className="hero-title display">{session.name}</h2>
        <p className="hero-focus">{session.focus}</p>
        {endurance && (
          <div className="hero-profile">
            <SessionProfile exercises={session.exercises} compact />
          </div>
        )}
        {endurance && (
          <div className="hero-stats">
            <div>
              <b>
                <RollingNumber
                  value={blocksSeconds(blocks)}
                  format={(v) => (v >= 3600 ? `${Math.floor(v / 3600)}h${String(Math.round((v % 3600) / 60)).padStart(2, '0')}` : String(Math.round(v / 60)))}
                />
              </b>
              <span>{blocksSeconds(blocks) >= 3600 ? tr('durée') : tr('minutes')}</span>
            </div>
            {meters > 0 && (
              <div>
                <b>
                  <RollingNumber value={meters} format={(v) => (swimOnly ? formatNumber(Math.round(v / 100) * 100) : formatNumber(Math.round(v / 100) / 10, 1))} />
                </b>
                <span>{swimOnly ? tr('mètres') : `km${sports.length > 1 ? '' : sports[0] === 'bike' ? tr(' à vélo') : ''}`}</span>
              </div>
            )}
            <div>
              <b>{hard >= 60 ? <RollingNumber value={Math.round(hard / 60)} /> : sports.length > 1 ? sports.length : '–'}</b>
              <span>{hard >= 60 ? tr('min intenses') : sports.length > 1 ? sports.map((d) => lower(DISCIPLINE_NAMES[d])).join(' + ') : tr('tout en aisance')}</span>
            </div>
          </div>
        )}
        {session.type !== 'rest' && !endurance && !session.exercises.some((x) => x.key === 'race-day') && (
          <div className="hero-stats">
            {session.lifting && (
              <div>
                <b>
                  <RollingNumber value={session.exercises.length} />
                </b>
                <span>{tr('exercices')}</span>
              </div>
            )}
            <div>
              <b>
                <RollingNumber value={0} format={() => session.duration.replace(/\s*min/, '')} />
              </b>
              <span>{/min/.test(session.duration) ? tr('minutes') : tr('durée')}</span>
            </div>
            {session.lifting && (
              <div>
                <b>
                  <RollingNumber value={day.mainDone ? prog.total : prog.done} format={(v) => `${Math.round(v)}/${prog.total}`} />
                </b>
                <span>{tr('séries')}</span>
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

      <ReadinessCard today={today} />

      {recapMonth && (
        <button className="card report-banner recap-banner" onClick={() => setRecap(recapMonth)}>
          <Icon name="sparkle" size={22} />
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontWeight: 650 }}>{tr('Ton récap {ofMonth} est prêt', { ofMonth: ofMonth(recapMonth) })}</span>
            <span className="small muted">{tr('Ton mois en story, et ton profil du mois à découvrir.')}</span>
          </span>
          <Icon name="chevron" size={18} />
        </button>
      )}
      {recap && <MonthRecap month={recap} onClose={() => setRecap(null)} />}

      {reportPending(s, today) && (
        <button className="card report-banner" onClick={() => setReport(lastWeekMonday(today))}>
          <Icon name="chart" size={22} />
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontWeight: 650 }}>{tr('Ton bilan de la semaine est prêt')}</span>
            <span className="small muted">{tr('Ce qui a marché, et ce qu’on ajuste.')}</span>
          </span>
          <Icon name="chevron" size={18} />
        </button>
      )}
      {report && <ReportSheet monday={report} onClose={() => setReport(null)} openCoach={() => go('coach')} />}

      {mod.nutrition && (
        <section className="section">
          <div className="section-head">
            <h2>{tr('Nutrition')}</h2>
            <button className="link small" onClick={() => go('food')}>
              {tr('Noter un repas')}
            </button>
          </div>
          <button className="group" style={{ display: 'block', width: '100%', textAlign: 'left', color: 'inherit', font: 'inherit', padding: 0 }} onClick={() => go('food')}>
            <div className="macro-grid">
              <div className="macro">
                <b>
                  <RollingNumber value={remaining} format={(v) => formatNumber(v)} />
                  <small>{tr('kcal')}</small>
                </b>
                <span>{tr('restantes sur {n}', { n: formatNumber(s.settings.targets.kcal) })}</span>
                <span className="meter" style={{ margin: 0 }}>
                  <i style={{ width: `${Math.min(100, Math.round((t.kcal / s.settings.targets.kcal) * 100))}%`, background: 'var(--amber)' }} />
                </span>
              </div>
              <div className="macro">
                <b>
                  <RollingNumber value={t.protein} format={(v) => formatNumber(v)} />
                  <small>g</small>
                </b>
                <span>{tr('protéines sur {protein} g', { protein: s.settings.targets.protein })}</span>
                <span className="meter" style={{ margin: 0 }}>
                  <i style={{ width: `${Math.min(100, Math.round((t.protein / s.settings.targets.protein) * 100))}%`, background: 'var(--glacier)' }} />
                </span>
              </div>
            </div>
          </button>
          <p className="small muted" style={{ margin: '10px 2px 0' }}>
            {tn(meals, '{n} repas noté', '{n} repas notés')}
            {rule.minMeals > 0 ? tr(', {max} pour valider la journée', { max: Math.max(rule.minMeals, meals) }) : ''}.
          </p>
        </section>
      )}

      {mod.habits && s.habits.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>{tr('Habitudes')}</h2>
            <span className="small muted num">
              {habitsDone}/{s.habits.length}
            </span>
          </div>
          <div className="chips">
            {s.habits.map((h) => {
              const on = !!day.habits[h.id];
              // Les pas arrivent d'Apple Santé : la puce se remplit au fil de la journée.
              const live = h.id === 'steps' && steps !== undefined && !on;
              const pct = live ? Math.min(99, Math.floor((steps! / STEP_GOAL) * 100)) : 0;
              return (
                <button
                  key={h.id}
                  className={`chip ${on ? 'on' : ''} ${live ? 'live' : ''}`}
                  style={live ? ({ '--p': `${pct}%` } as CSSProperties) : undefined}
                  aria-pressed={on}
                  aria-label={live ? tr('{name} : {n} pas, {pct} %', { name: tr(h.name), n: formatNumber(steps!), pct }) : undefined}
                  onClick={() => toggleHabit(today, h.id)}
                >
                  <Icon name={on ? 'check' : h.icon} size={16} />
                  {live ? (
                    <>
                      <span className="num">
                        <RollingNumber value={steps!} format={(v) => formatNumber(v)} />{' '}{tr('pas')}
                      </span>
                      <span className="chip-pct num">{fmtPct(pct)}</span>
                    </>
                  ) : (
                    tr(h.name)
                  )}
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

      {mod.weight && weekdayOf(today) === 0 && photoDue(s, today) && (
        <button className="card report-banner" onClick={() => go('progress')}>
          <Icon name="camera" size={22} />
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontWeight: 650 }}>{tr('Photo de la semaine')}</span>
            <span className="small muted">{tr('Face et profil, même lumière que la dernière fois. Ça prend 30 secondes.')}</span>
          </span>
          <Icon name="chevron" size={18} />
        </button>
      )}

      <button className="card ask-pulse" onClick={() => go('coach')}>
        <Pulse mood="think" tier={flames.tier} size={40} />
        <span style={{ flex: 1 }}>
          <span style={{ display: 'block', fontWeight: 650 }}>{tr('Une question pour Pulse ?')}</span>
          <span className="small muted">{tr('Séance, repas, progression : demande.')}</span>
        </span>
        <Icon name="chevron" size={18} />
      </button>
    </>
  );
}

function Week({ state, today }: { state: AppState; today: string }) {
  return (
    <div className="week" aria-label={tr('Ta semaine')}>
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
    if (kg === undefined || kg < 30 || kg > 250) return toast(tr('Entre un poids valide, par exemple 74,6'), true);
    logBody('weight', today, kg);
    setDraft('');
    toast(tr('Pesée enregistrée, +5 XP'));
  };
  return (
    <section className="section">
      <div className="section-head">
        <h2>{tr('Pesée du matin')}</h2>
        {value !== undefined && (
          <span className="tag up num">
            <Icon name="check" size={14} />{' '}{tr('{n} kg', { n: formatNumber(value, 1) })}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <input
          className="input num"
          inputMode="decimal"
          placeholder={value !== undefined ? formatNumber(value, 1) : tr('kg, à jeun')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          aria-label={tr('Poids du jour en kg')}
          id="weigh-in"
        />
        <button className="btn primary" onClick={save} disabled={!draft.trim()}>
          {tr('OK')}
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
        {tr('Relier Apple Santé pour compter tes pas et tes calories automatiquement')}
      </button>
    );
  }
  const duration = gymDuration(h);
  // Plus de deux heures sans nouvelles de Santé : un bouton relance le raccourci.
  const stale = s.settings.modules.health && /iPhone|iPad/.test(navigator.userAgent) && (!h?.at || Date.now() - new Date(h.at).getTime() > 2 * 3600_000);
  const parts: string[] = [];
  if (h?.sleepMin !== undefined) parts.push(tr('{floor} h {padStart} de sommeil', { floor: Math.floor(h.sleepMin / 60), padStart: String(h.sleepMin % 60).padStart(2, '0') }));
  if (h?.steps !== undefined) parts.push(tr('{n} pas', { n: formatNumber(h.steps) }));
  if (h?.active !== undefined) parts.push(tr('{n} kcal brûlées en activité', { n: formatNumber(h.active) }));
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 12 }}>
      {h?.gymIn && (
        <span className="tag flame">
          <Icon name="dumbbell" size={14} />
          {duration ? tr('Salle : {duration}', { duration }) : tr('À la salle depuis {timeOf}', { timeOf: timeOf(h.gymIn) })}
        </span>
      )}
      <span className="small muted">
        {parts.length ? `${parts.join(', ')}.` : tr('Pas encore de données Santé aujourd’hui.')}
        {h?.at ? tr(' Synchro à {timeOf}.', { timeOf: timeOf(h.at) }) : ''}
      </span>
      {stale && (
        <button className="link small" onClick={runShortcut}>
          {tr('Synchroniser')}
        </button>
      )}
    </div>
  );
}
