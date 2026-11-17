import { useEffect, useRef, useState } from 'react';
import { type Exercise, findSession, scheduleFor } from '../../shared/program';
import { DISCIPLINE_ICON, Icon } from '../components/Icon';
import { Ring } from '../components/Ring';
import { ask, Bar, Check, Sheet, toast } from '../components/ui';
import { chooseSession, finishSession, parseDecimal, previousWeight, toggleSet, updateSet } from '../lib/actions';
import { formatNumber, formatShort, weekdayOf, WEEKDAY_NAMES } from '../lib/date';
import { exerciseFrames, exerciseInfo, videoUrl } from '../lib/exercise-info';
import { adviseLoad, loadFor } from '../lib/advisor';
import { e1rm } from '../lib/strength';
import { fmtKg, formatSets, HALF_SESSION, lastPerformance, nextTarget, ruleOf, sessionFor, setProgress, workoutOk } from '../lib/logic';
import { type Form, getState, readDay, type SetLog, useApp } from '../lib/store';
import { cancelRestPush, scheduleRestPush } from '../lib/restPush';
import { formHint, isDeload } from '../lib/recovery';
import { alternatives, BROKEN_DAYS, isBroken, SWAP_REASONS, type SwapReason } from '../lib/dynamic';
import { addExtra, markRepaired, removeExtra, setExpress, setForm, skipExercise, stopDeload, swapExercise, undoSwap } from '../lib/workoutActions';
import { applyTweak, dismissTweak, programTweaks } from '../lib/tweaks';
import { catalogEntry, exerciseName } from '../../shared/catalog';
import { planWeek } from '../../shared/program';
import { repMeters } from '../../shared/effort';
import { hasProfile, SessionProfile } from '../components/SessionProfile';
import { ExercisePicker } from './ProgramEditor';
import { RollingNumber } from '../components/RollingNumber';
import { exerciseStats, isBarbell, platesFor, warmupSets } from '../lib/exerciseStats';
import { liftSeries } from '../lib/training';
import { LiftChart } from '../components/Charts';
import { StorySheet } from '../components/StorySheet';
import { FocusMode } from '../components/FocusMode';
import { isRecord, moment } from '../lib/moments';
import { dayWarmup } from '../lib/warmupDay';
import { WarmupCard } from '../components/Warmup';
import { ActivityRow, ActivitySheet } from '../components/ActivitySheet';
import { loc, lower, tn, tr } from '../../shared/i18n';

const fmtRest = (sec: number) => (sec >= 60 ? `${Math.floor(sec / 60)} min${sec % 60 ? ` ${sec % 60}` : ''}` : `${sec} s`);

export function Workout({ today, editProgram }: { today: string; editProgram: () => void }) {
  const s = useApp();
  const day = readDay(s, today);
  const session = sessionFor(s, today);
  const prog = setProgress(session, day);
  const [picker, setPicker] = useState(false);
  const [demo, setDemo] = useState<Exercise | null>(null);
  const [timer, setTimer] = useState<{ end: number; total: number } | null>(null);
  const [story, setStory] = useState(false);
  const [focus, setFocus] = useState<false | 'session' | 'warmup'>(false);
  const [swap, setSwap] = useState<Exercise | null>(null);
  const [adding, setAdding] = useState(false);
  // Autre activité (natation un jour de Push, foot…) : `counts` dit si elle remplace la séance du jour par défaut.
  const [activity, setActivity] = useState<{ counts: boolean } | null>(null);
  const tweaks = programTweaks(s, today);
  const broken = Object.entries(s.settings.broken ?? {}).filter(([key]) => isBroken(s, key, today));
  const hint = formHint(s, today);
  const planned = scheduleFor(s.program, today)[weekdayOf(today)];
  const endurance = hasProfile(session.exercises);
  const warm = session.type !== 'rest' && !day.mainDone ? dayWarmup(s, today) : null;
  // Le choix de séance : celles de la semaine en cours et celles qu'on peut faire n'importe quand.
  const thisWeek = new Set(scheduleFor(s.program, today));
  const inPlan = planWeek(s.program, today) !== null;
  const choices = s.program.sessions.filter((x) => !x.generated || thisWeek.has(x.id) || (!inPlan && s.program.schedule.includes(x.id)));

  const onSet = (ex: Exercise, i: number) => {
    const done = toggleSet(today, ex, i);
    // Nouveau record sur cette série : Pulse le salue.
    const rec = done && !ex.noLoad ? isRecord(getState(), ex.key, today, i) : null;
    if (rec) moment('record', tr('Record : {replace}', { replace: ex.name.replace(/ \(.*\)$/, '') }), tr('{kg} × {r}, ton meilleur 1RM estimé', { kg: fmtKg(rec.w), r: rec.r }));
    if (done && ex.rest > 0) {
      setTimer({ end: Date.now() + ex.rest * 1000, total: ex.rest });
      const logs = (getState().days[today]?.sets[ex.key] ?? []).filter((l) => l.done).length;
      const next = logs < ex.sets ? tr('{name}, série {n}', { name: ex.name, n: logs + 1 }) : session.exercises[session.exercises.indexOf(ex) + 1]?.name;
      scheduleRestPush(ex.rest, next);
    }
  };

  const finish = async () => {
    const ratio = prog.total ? prog.done / prog.total : 1;
    if (session.lifting && ratio < 0.6) {
      const ok = await ask(tr('Tu as fait {done} séries sur {total}. Valider la séance quand même ?', { done: prog.done, total: prog.total }), tr('Valider'));
      if (!ok) return;
    }
    // Pulse fête la séance (moments.ts) dès que l'état change.
    finishSession(today, true);
  };

  return (
    <>
      <header className="workout-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="date">
            {day.session && day.session !== planned ? tr('À la place de {name}', { name: findSession(s.program, planned).name }) : WEEKDAY_NAMES[weekdayOf(today)]}
          </div>
          <h1 className="display workout-title">{session.name}</h1>
          <p className="muted" style={{ margin: '8px 0 0' }}>
            {session.focus}
          </p>
        </div>
        {session.type !== 'rest' && prog.total > 0 && (
          <Ring value={day.mainDone ? 1 : prog.done} max={day.mainDone ? 1 : prog.total} color={day.mainDone ? 'var(--mint)' : 'var(--ink)'} size={76} stroke={6} label={session.lifting ? tr('Séries faites') : tr('Blocs faits')}>
            <div>
              <div className="num" style={{ fontWeight: 760, fontStretch: '72%', fontSize: '1.35rem', lineHeight: 1 }}>
                <RollingNumber value={prog.done} />
              </div>
              <div className="faint" style={{ fontSize: '0.7rem', fontWeight: 600 }}>
                {tr('sur {total}', { total: prog.total })}
              </div>
            </div>
          </Ring>
        )}
      </header>
      {session.type !== 'rest' && !day.mainDone && ruleOf(s).workout && (
        <p className="small flame-hint">
          <Icon name="flame" size={15} />
          {workoutOk(s, today)
            ? tr('Flamme du jour assurée côté sport. Le reste de la séance, c’est du bonus.')
            : ruleOf(s).level === 'half'
              ? session.lifting
                ? tn(Math.ceil(prog.total * HALF_SESSION) - prog.done, 'Encore {max} série pour ta flamme du jour (la moitié de la séance suffit).', 'Encore {max} séries pour ta flamme du jour (la moitié de la séance suffit).', { max: Math.max(1, Math.ceil(prog.total * HALF_SESSION) - prog.done) })
                : tr('Commence la séance et ta flamme du jour est assurée.')
              : tr('Termine la séance pour ta flamme du jour.')}
        </p>
      )}
      {endurance && (
        <div className="card workout-profile">
          <SessionProfile exercises={session.exercises} done={Object.fromEntries(Object.entries(day.sets).map(([k, l]) => [k, l.filter((x) => x.done).length]))} />
        </div>
      )}
      {session.type !== 'rest' && session.exercises.length > 0 && !day.mainDone && (
        <button className="focus-cta" onClick={() => setFocus('session')}>
          <span className="focus-cta-play" aria-hidden="true">
            <Icon name="play" size={18} filled />
          </span>
          <span className="grow" style={{ minWidth: 0 }}>
            <b>{prog.done > 0 ? tr('Reprendre en mode séance') : tr('Lancer le mode séance')}</b>
            <span className="small">
              {warm && !day.warmup && prog.done === 0 ? tr('Échauffement guidé, puis une série à la fois.') : tr('Une série à la fois, en grand. Écran allumé, bip à la fin du repos.')}
            </span>
          </span>
        </button>
      )}
      <div className="workout-actions">
        <button className="btn small" onClick={() => setPicker(true)}>
          <Icon name="swap" size={16} />{' '}{tr('Changer de séance')}
        </button>
        <button className="btn small" onClick={editProgram}>
          <Icon name="list" size={16} />{' '}{tr('Mon programme')}
        </button>
      </div>

      {isDeload(s, today) && session.lifting && (
        <div className="card notice" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Icon name="moon" size={18} />
          <div className="grow small">
            <b>{tr('Semaine de décharge')}</b>{' '}{tr('jusqu’à dimanche : un tiers de séries en moins, charges −10 %.')}
          </div>
          <button className="link small" onClick={stopDeload}>
            {tr('Arrêter')}
          </button>
        </div>
      )}

      {session.lifting && !day.mainDone && hint && !day.form && hint.form !== 'ok' && (
        <div className="form-hint">
          <Icon name="moon" size={16} />
          <p className="small grow" style={{ margin: 0 }}>
            {hint.reasons.join(', ')}.{' '}
            {hint.form === 'low' ? tr('Pulse te conseille le mode Fatigué aujourd’hui.') : tr('Bonne récup : profites-en pour pousser.')}
          </p>
          <button className="btn small" onClick={() => setForm(today, hint.form)}>
            {hint.form === 'low' ? tr('Fatigué') : tr('En forme')}
          </button>
        </div>
      )}

      {session.lifting && !day.mainDone && (
        <div className="day-controls">
          <div className="seg" role="group" aria-label={tr('Forme du jour')}>
            {(
              [
                ['low', tr('Fatigué')],
                [undefined, tr('Normal')],
                ['high', tr('En forme')],
              ] as [Form | undefined, string][]
            ).map(([f, label]) => (
              <button key={label} type="button" className={(day.form ?? undefined) === f ? 'on' : ''} onClick={() => setForm(today, f)}>
                {label}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label={tr('Temps disponible')}>
            {([undefined, 45, 30] as (number | undefined)[]).map((m) => (
              <button key={m ?? 'full'} type="button" className={day.express === m ? 'on' : ''} onClick={() => setExpress(today, m)}>
                {m ? `${m} min` : tr('Complet')}
              </button>
            ))}
          </div>
          {(day.form || day.express) && (
            <p className="small muted" style={{ margin: 0 }}>
              {day.form === 'low' && tr('Fatigué : une série de moins sur les exercices secondaires, charges allégées. ')}
              {day.form === 'high' && tr('En forme : charges normales, pousse la dernière série. ')}
              {day.express && tr('Express {express} min : repos raccourcis, l’essentiel d’abord (environ {duration}).', { express: day.express, duration: session.duration })}
            </p>
          )}
        </div>
      )}

      {broken.length > 0 && (
        <div className="card notice stack" style={{ gap: 8 }}>
          {broken.map(([key, b]) => (
            <div key={key} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Icon name="wrench" size={18} />
              <div className="grow small">
                <b>{exerciseName(key, s.customExercises)}</b>{' '}{tr('en panne : remplacé automatiquement jusqu’au {date}.', { date: formatShort(b.until) })}
              </div>
              <button className="link small" onClick={() => markRepaired(key)}>
                {tr('Réparée')}
              </button>
            </div>
          ))}
        </div>
      )}

      {tweaks.length > 0 && !day.mainDone && prog.done === 0 && (
        <section className="stack tweaks" style={{ gap: 10, marginBottom: 14 }}>
          {tweaks.slice(0, 1).map((t) => (
            <div key={t.id} className="card tweak">
              <div className="tweak-head">
                <Icon name="sparkle" size={16} />{' '}{tr('Pulse te propose')}
              </div>
              <div style={{ fontWeight: 800 }}>{t.title}</div>
              <div className="small muted">{t.text}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn small primary" onClick={() => toast(applyTweak(t))}>
                  {t.cta}
                </button>
                <button className="btn small" onClick={() => dismissTweak(t.id, today)}>
                  {tr('Plus tard')}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {session.exercises.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '28px 18px' }}>
          <p style={{ marginTop: 0, fontWeight: 700 }}>{tr('Cette séance est vide.')}</p>
          <p className="small muted">{tr('Ajoute tes exercices depuis la bibliothèque, avec leurs séries et leurs reps.')}</p>
          <button className="btn primary" onClick={editProgram}>
            {tr('Composer la séance')}
          </button>
        </div>
      )}

      {warm && <WarmupCard today={today} warm={warm} status={day.warmup} started={prog.done > 0} onLaunch={() => setFocus('warmup')} />}

      <div className="stack">
        {session.exercises.map((ex) => (
          <ExerciseCard key={ex.key} ex={ex} date={today} logs={day.sets[ex.key] ?? []} onSet={onSet} onDemo={() => setDemo(ex)} onSwap={() => setSwap(ex)} />
        ))}
      </div>
      {session.type !== 'rest' && !day.mainDone && (
        <button className="btn block dashed" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>
          <Icon name="plus" size={18} />{' '}{tr('Ajouter un exercice')}
        </button>
      )}
      <button className="btn block dashed" style={{ marginTop: 10 }} onClick={() => setActivity({ counts: prog.done === 0 })}>
        <Icon name="run" size={18} />{' '}{tr('Noter une autre activité')}
      </button>
      {(day.activities?.length ?? 0) > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>{tr('Activités du jour')}</h2>
          </div>
          <div className="group">
            {day.activities!.map((a) => (
              <ActivityRow key={a.id} a={a} date={today} validated={day.doneBy === a.id} />
            ))}
          </div>
        </section>
      )}
      {(day.skipped?.length ?? 0) > 0 && (
        <p className="small muted" style={{ margin: '10px 2px 0' }}>
          {tr('Sauté aujourd’hui :')}{' '}
          {day.skipped!.map((k, i) => (
            <span key={k}>
              {i > 0 && ', '}
              {exerciseName(k, s.customExercises)}{' '}
              <button className="link small" onClick={() => skipExercise(today, k, false)}>
                {tr('remettre')}
              </button>
            </span>
          ))}
        </p>
      )}

      <div style={{ marginTop: 22 }}>
        {day.mainDone ? (
          <div className="card done-card">
            <span className="check on" aria-hidden>
              <Icon name="check" size={20} />
            </span>
            <div className="done-text">
              <div style={{ fontWeight: 800 }}>{tr('Séance terminée')}</div>
              <div className="small muted">{tr('Note tes repas pour valider la journée.')}</div>
            </div>
            {/* Sur un écran étroit (ou une langue plus longue), les boutons passent sous le texte. */}
            <div className="done-actions">
              <button className="btn small primary" onClick={() => setStory(true)}>
                <Icon name="share" size={15} />{' '}{tr('Partager')}
              </button>
              <button className="link small" onClick={() => finishSession(today, false)}>
                {tr('Annuler')}
              </button>
            </div>
          </div>
        ) : (
          <button className="btn go block" onClick={finish}>
            <Icon name="check" size={20} />{' '}{tr('Terminer la séance')}
          </button>
        )}
      </div>

      {story && <StorySheet date={today} onClose={() => setStory(false)} />}

      {focus && (
        <FocusMode
          today={today}
          warmFirst={focus === 'warmup'}
          rest={timer}
          setRest={setTimer}
          onSet={onSet}
          onClose={() => setFocus(false)}
          onShare={() => {
            setFocus(false);
            setStory(true);
          }}
        />
      )}

      {timer && !focus && (
        <RestTimer
          key={timer.end}
          {...timer}
          onAdd={(n) => {
            setTimer({ ...timer, end: timer.end + n * 1000 });
            scheduleRestPush((timer.end + n * 1000 - Date.now()) / 1000);
          }}
          onClose={() => {
            if (timer.end - Date.now() > 3000) cancelRestPush();
            setTimer(null);
          }}
        />
      )}

      {demo && <DemoSheet ex={demo} onClose={() => setDemo(null)} />}

      {swap && <SwapSheet ex={swap} date={today} sessionId={session.id} taken={session.exercises.map((x) => x.key)} onClose={() => setSwap(null)} />}

      {activity && <ActivitySheet date={today} countDefault={activity.counts} onClose={() => setActivity(null)} />}

      {adding && (
        <Sheet title={tr('Ajouter à la séance')} onClose={() => setAdding(false)}>
          <ExercisePicker
            onBack={() => setAdding(false)}
            onPick={(key) => {
              addExtra(today, key);
              setAdding(false);
              toast(tr('Ajouté à la séance du jour'));
            }}
          />
        </Sheet>
      )}

      {picker && (
        <Sheet title={tr('Séance du jour')} onClose={() => setPicker(false)}>
          <p className="small muted" style={{ marginTop: -6 }}>
            {tr('Ton emploi du temps a bougé ? Garde l’ordre Push, Pull, Legs, Upper, Lower.')}
          </p>
          <div className="group">
            {choices.map(({ id, name, focus }) => (
              <button
                key={id}
                className="row"
                style={{ width: '100%', border: 0, background: 'none', textAlign: 'left' }}
                onClick={() => {
                  chooseSession(today, id);
                  setPicker(false);
                }}
              >
                <div className="grow">
                  <div className="title">
                    {name}
                    {id === planned ? <span className="faint small">{' '}{tr('(prévue)')}</span> : null}
                  </div>
                  <div className="small muted">{focus}</div>
                </div>
                {session.id === id && <Icon name="check" />}
              </button>
            ))}
          </div>
          {!day.mainDone && (
            <button
              className="row picker-other"
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => {
                setPicker(false);
                setActivity({ counts: true });
              }}
            >
              <span className="settings-icon">
                <Icon name="swim" size={18} />
              </span>
              <div className="grow">
                <div className="title">{tr('J’ai fait autre chose')}</div>
                <div className="small muted">{tr('Course, natation, vélo, foot… notée à la place de la séance.')}</div>
              </div>
              <Icon name="chevron" size={18} />
            </button>
          )}
        </Sheet>
      )}
    </>
  );
}

function ExerciseCard({
  ex,
  date,
  logs,
  onSet,
  onDemo,
  onSwap,
}: {
  ex: Exercise;
  date: string;
  logs: SetLog[];
  onSet: (ex: Exercise, i: number) => void;
  onDemo: () => void;
  onSwap: () => void;
}) {
  const s = useApp();
  const last = lastPerformance(s, ex.key, date);
  const target = nextTarget(ex, last);
  const advice = adviseLoad(s, ex, date);
  const aim = advice ? { weight: advice.weight, up: advice.weight > (last ? Math.max(...last.sets.map((l) => l.w ?? 0)) : 0) } : target;
  const done = logs.filter((l) => l.done).length;
  const complete = done >= ex.sets;
  const isTask = ex.kind === 'task';
  const rounds = ex.kind === 'cardio';
  const frames = exerciseFrames(ex.key);
  const loaded = !isTask && !ex.noLoad && !rounds;
  // Un bloc continu (footing, sortie longue, nage continue) : on note la distance et le temps.
  const continuous = rounds && ex.sets === 1 && !!ex.discipline && ex.discipline !== 'combat';
  const swim = ex.discipline === 'swim';
  const planned = ex.discipline ? repMeters(ex) : 0;

  return (
    <article className={`ex-card ${complete ? 'complete' : ''}`}>
      <div className="ex-head">
        <button className="thumb" onClick={onDemo} aria-label={tr('Voir la démo : {name}', { name: ex.name })}>
          {frames ? <img src={frames[0]} alt="" loading="lazy" /> : <Icon name={ex.discipline ? DISCIPLINE_ICON[ex.discipline] : 'dumbbell'} size={28} />}
          <span className="play">
            <Icon name="play" size={12} filled />
          </span>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          {ex.change && (
            <div className="change-badge">
              {ex.change === 'extra' ? (
                <>
                  {tr('Ajouté aujourd’hui')}{' '}
                  <button className="link" onClick={() => removeExtra(date, ex.key)}>
                    {tr('retirer')}
                  </button>
                </>
              ) : (
                <>
                  {ex.change === 'broken'
                    ? tr('Machine en panne : remplace {name}', { name: exerciseName(ex.slotKey!, s.customExercises) })
                    : tr('remplace {name}', { name: exerciseName(ex.slotKey!, s.customExercises) })}
                  {ex.change === 'swap' && (
                    <>
                      {' '}
                      <button className="link" onClick={() => undoSwap(date, ex.slotKey!)}>
                        {tr('annuler')}
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
          <button className="ex-name" onClick={onDemo}>
            {ex.name}
          </button>
          {!isTask && (
            <div className="chips" style={{ gap: 6, marginTop: 8 }}>
              <span className="tag num">{ex.sets > 1 ? `${ex.sets} × ${ex.reps}` : ex.reps}</span>
              {ex.target && <span className="tag num blue">{ex.target}</span>}
              {ex.zone && ex.discipline && <span className={`tag zone-tag z${ex.zone}`}>Z{ex.zone}</span>}
              {ex.rest > 0 && (
                <span className="tag">
                  <Icon name="clock" size={13} /> {fmtRest(ex.rest)}
                </span>
              )}
              {aim.weight !== undefined && (
                <span className={`tag num ${aim.up ? 'up' : 'blue'}`}>
                  {aim.up ? '↑ ' : ''}
                  {fmtKg(aim.weight)}
                </span>
              )}
              {complete && <span className="tag up">{tr('Fait')}</span>}
            </div>
          )}
          {isTask && complete && (
            <span className="tag up" style={{ marginTop: 6 }}>
              {tr('Fait')}
            </span>
          )}
        </div>
        {!isTask && ex.change !== 'extra' && (
          <button className="icon-btn swap-btn" onClick={onSwap} aria-label={tr('Remplacer {name}', { name: ex.name })} title={tr('Remplacer ou sauter')}>
            <Icon name="swap" size={18} />
          </button>
        )}
      </div>

      {last && !isTask && (
        <p className="small faint num" style={{ margin: '10px 0 0' }}>
          {tr('Dernière fois ({date}) :', { date: formatShort(last.date) })}{' '}{ex.noLoad ? last.sets.map((l) => l.r ?? '?').join(', ') : formatSets(last.sets)}
          {!advice && target.up ? tr('. Toutes les reps au max : on monte.') : ''}
        </p>
      )}
      {advice && !complete && (
        <p className="small advice" style={{ margin: '6px 0 0' }}>
          <Icon name="bolt" size={13} /> {advice.text}
        </p>
      )}
      {!last && ex.change && loaded && !complete && (
        <p className="small advice" style={{ margin: '8px 0 0' }}>
          <Icon name="bolt" size={13} />{' '}{tr('Nouvel exercice pour toi : commence léger, garde 2 à 3 reps en réserve sur la 1re série, puis ajuste. La prochaine fois, Pulse aura tes chiffres.')}
        </p>
      )}

      {continuous && (
        <div className="cardio-row" style={{ marginTop: 10 }}>
          <NumInput
            value={logs[0]?.km !== undefined ? (swim ? Math.round(logs[0].km! * 1000) : logs[0].km) : undefined}
            placeholder={planned ? (swim ? `${Math.round(planned)} m` : `${(Math.round(planned / 100) / 10).toLocaleString(loc())} km`) : swim ? tr('mètres') : 'km'}
            label={swim ? tr('Distance nagée en mètres') : tr('Distance en km')}
            decimals={swim ? 0 : 2}
            onCommit={(v) => updateSet(date, ex.key, 0, { km: v === undefined ? undefined : swim ? v / 1000 : v, ...(v ? { done: true } : {}) }, 1)}
          />
          <NumInput
            value={logs[0]?.min}
            placeholder={`${ex.reps.match(/min|h/) ? ex.reps : 'min'}`}
            label={tr('Durée en minutes')}
            onCommit={(v) => updateSet(date, ex.key, 0, { min: v, ...(v ? { done: true } : {}) }, 1)}
          />
          <Check on={!!logs[0]?.done} onClick={() => onSet(ex, 0)} label={tr('Bloc fait')} tone="blue" />
          <span className="small faint cardio-units">{swim ? tr('mètres') : 'km'}</span>
          <span className="small faint cardio-units">{tr('minutes')}</span>
        </div>
      )}

      {!continuous && <div style={{ marginTop: 10 }}>
        {Array.from({ length: ex.sets }, (_, i) => {
          const log = logs[i] ?? { done: false };
          const prevW = previousWeight(logs, i) ?? aim.weight ?? last?.sets[i]?.w;
          return (
            <div key={i} className={`set-row ${loaded ? '' : 'noload'}`}>
              <span className="small faint num" style={{ fontWeight: 700 }}>
                {isTask ? '' : rounds ? `R${i + 1}` : `S${i + 1}`}
              </span>
              {loaded && (
                <WeightStepper
                  value={log.w}
                  fallback={prevW}
                  step={ex.step ?? 2.5}
                  label={tr('Charge série {n}', { n: i + 1 })}
                  onCommit={(w) => updateSet(date, ex.key, i, { w }, ex.sets)}
                />
              )}
              {!isTask && !rounds ? (
                <NumInput
                  value={log.r}
                  // La fourchette seule : « 6-10 reps » ne tient pas dans le champ sur un petit écran, quelle que soit la langue.
                  placeholder={ex.repMin !== undefined ? ex.reps.replace('–', '-') : ex.reps.replace(/ .*/, '')}
                  label={tr('Répétitions série {n}', { n: i + 1 })}
                  onCommit={(r) => updateSet(date, ex.key, i, { r }, ex.sets)}
                />
              ) : (
                <span className="small muted">{isTask ? tr('Marquer comme fait') : ex.reps}</span>
              )}
              <Check on={log.done} onClick={() => onSet(ex, i)} label={tr('Série {n} faite', { n: i + 1 })} tone="blue" />
            </div>
          );
        })}
      </div>}
    </article>
  );
}

function SwapSheet({ ex, date, sessionId, taken, onClose }: { ex: Exercise; date: string; sessionId: string; taken: string[]; onClose: () => void }) {
  const s = useApp();
  const slotKey = ex.slotKey ?? ex.key;
  const [reason, setReason] = useState<SwapReason>('busy');
  const [always, setAlways] = useState(false);
  const alts = alternatives(s, slotKey, date, taken.filter((k) => k !== ex.key)).filter((a) => a.key !== ex.key).slice(0, 8);
  const original = catalogEntry(slotKey, s.customExercises);
  return (
    <Sheet title={tr('Remplacer : {n}', { n: original?.name ?? ex.name })} onClose={onClose}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="chips" role="group" aria-label={tr('Pourquoi')}>
          {SWAP_REASONS.map((r) => (
            <button key={r.id} type="button" className={`chip ${reason === r.id ? 'on' : ''}`} onClick={() => setReason(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {reason === 'broken' && tr('Pulse le remplacera automatiquement pendant {BROKEN_DAYS} jours, puis te reproposera la machine.', { BROKEN_DAYS })}
          {reason === 'busy' && tr('Juste pour aujourd’hui : ton programme ne change pas.')}
          {reason === 'pain' && tr('Choisis un mouvement qui ne fait pas mal, charge modérée. Si la douleur dure, montre-la à un pro.')}
          {reason === 'vary' && tr('Varier de temps en temps relance la progression. Coche « garder » pour l’adopter.')}
        </p>
        <div className="group">
          {alts.map((a) => {
            const last = lastPerformance(s, a.key, date);
            return (
              <button
                key={a.key}
                className="row"
                style={{ width: '100%', border: 0, background: 'none', textAlign: 'left' }}
                onClick={() => {
                  swapExercise(date, slotKey, a.key, { reason, always, sessionId });
                  toast(always ? tr('{name} remplace {name2} dans ton programme', { name: a.name, name2: lower(original?.name) }) : tr('{name} pour aujourd’hui', { name: a.name }));
                  onClose();
                }}
              >
                <div className="grow">
                  <div className="title">{a.name}</div>
                  <div className="small muted">
                    {a.why} · {a.muscles.slice(0, 3).join(', ')}
                    {last && !ex.noLoad ? tr(' · dernière fois {formatSets}', { formatSets: formatSets(last.sets) }) : ''}
                  </div>
                </div>
                <Icon name="chevron" />
              </button>
            );
          })}
          {!alts.length && <p className="small muted" style={{ padding: 12, margin: 0 }}>{tr('Aucun remplaçant avec le matériel de ta salle. Ajoute un exercice libre plus bas.')}</p>}
        </div>
        <label className="check-line">
          <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} />{' '}{tr('Garder ce changement dans mon programme')}
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn small"
            onClick={() => {
              skipExercise(date, slotKey);
              toast(tr('{n} sauté aujourd’hui', { n: original?.name ?? ex.name }));
              onClose();
            }}
          >
            <Icon name="skip" size={15} />{' '}{tr('Sauter aujourd’hui')}
          </button>
          {ex.change === 'swap' && (
            <button
              className="btn small"
              onClick={() => {
                undoSwap(date, slotKey);
                onClose();
              }}
            >
              <Icon name="undo" size={15} />{' '}{tr('Revenir à {name}', { name: lower(original?.name) })}
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function DemoSheet({ ex, onClose }: { ex: Exercise; onClose: () => void }) {
  const frames = exerciseFrames(ex.key);
  const info = exerciseInfo(ex.key, useApp().customExercises);
  return (
    <Sheet title={ex.name} onClose={onClose}>
      {frames ? (
        <div className="demo">
          <img src={frames[0]} alt={tr('{name}, position de départ', { name: ex.name })} />
          <img className="b" src={frames[1]} alt={tr('{name}, position d’arrivée', { name: ex.name })} />
        </div>
      ) : (
        <div className="demo" style={{ display: 'grid', placeItems: 'center', color: 'var(--ink-3)' }}>
          <Icon name="dumbbell" size={48} />
        </div>
      )}
      {info.muscles.length > 0 && (
        <div className="chips" style={{ marginTop: 14 }}>
          {info.muscles.map((m) => (
            <span key={m} className="tag blue">
              {m}
            </span>
          ))}
        </div>
      )}
      {info.cue && <p style={{ margin: '14px 2px 0', fontWeight: 600 }}>{info.cue}</p>}
      {ex.note && <p className="small muted" style={{ margin: '8px 2px 0' }}>{ex.note}</p>}
      {ex.kind !== 'task' && (
        <p className="small muted num" style={{ margin: '8px 2px 0' }}>
          {tr('{sets} séries de {reps}', { sets: ex.sets, reps: ex.reps })}
          {ex.rest > 0 ? tr(', {rest} de repos', { rest: fmtRest(ex.rest) }) : ''}.
        </p>
      )}
      <ExerciseInsights ex={ex} />
      <LoadCalculator ex={ex} />
      <a className="btn block" style={{ marginTop: 18, textDecoration: 'none' }} href={videoUrl(ex.name)} target="_blank" rel="noreferrer">
        <Icon name="play" size={16} filled />{' '}{tr('Voir des vidéos de l’exercice')}
      </a>
    </Sheet>
  );
}

/** Historique, meilleures séries, disques et échauffement : la fiche de l'exercice. */
function ExerciseInsights({ ex }: { ex: Exercise }) {
  const s = useApp();
  const [all, setAll] = useState(false);
  const stats = exerciseStats(s, ex.key);
  const loaded = !ex.noLoad && ex.kind !== 'task' && ex.kind !== 'cardio';
  const advice = loaded ? adviseLoad(s, ex, '9999-12-31') : null;
  const work = advice?.weight ?? stats.sessions[0]?.best?.w ?? 0;
  const barbell = isBarbell(ex.key, catalogEntry(ex.key, s.customExercises)?.name ?? ex.name);
  const [plateW, setPlateW] = useState<number | undefined>(work || undefined);
  const series = liftSeries(s, ex.key, '9999-12-31', 3650);
  if (!stats.sessions.length) return null;
  const shown = all ? stats.sessions.slice(0, 30) : stats.sessions.slice(0, 4);
  const plates = barbell && plateW ? platesFor(plateW) : null;
  const warm = loaded && ex.kind === 'compound' && work ? warmupSets(work, ex.step ?? 2.5, barbell) : [];
  return (
    <div className="stack" style={{ marginTop: 18, gap: 14 }}>
      {loaded && stats.bestE1rm && (
        <div className="ex-records">
          <div>
            <b className="num">{fmtKg(Math.round(stats.bestE1rm.e1rm * 2) / 2)}</b>
            <span className="small muted">{tr('1RM estimé')}</span>
          </div>
          {stats.heaviest && (
            <div>
              <b className="num">{fmtKg(stats.heaviest.w)}</b>
              <span className="small muted">{tr('plus lourd × {r}', { r: stats.heaviest.r })}</span>
            </div>
          )}
          <div>
            <b className="num">{stats.totalVolume >= 1000 ? `${formatNumber(stats.totalVolume / 1000, 1)} t` : `${stats.totalVolume} kg`}</b>
            <span className="small muted">{tr('soulevés en tout')}</span>
          </div>
        </div>
      )}
      {series.length >= 2 && <LiftChart points={series} />}

      <section className="stack" style={{ gap: 8 }}>
        <div className="section-head" style={{ margin: 0 }}>
          <h2 style={{ fontSize: '1rem' }}>{tr('Historique')}</h2>
          <span className="small faint">
            {tn(stats.sessions.length, '{n} séance', '{n} séances')}{tn(stats.totalSets, ', {n} série', ', {n} séries')}
          </span>
        </div>
        <div className="group">
          {shown.map((x) => (
            <div key={x.date} className="row ex-history">
              <div style={{ minWidth: 64 }} className="small muted">
                {formatShort(x.date)}
              </div>
              <div className="grow small num">
                {x.sets.map((l, i) => (
                  <span key={i} className={x.best && l.w === x.best.w && l.r === x.best.r ? 'ex-top' : ''}>
                    {i > 0 && ', '}
                    {l.w ? `${fmtKg(l.w)} × ${l.r ?? '?'}` : l.r ? tr('{r} reps', { r: l.r }) : l.km ? `${formatNumber(l.km, 1)} km` : l.min ? `${l.min} min` : '✓'}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        {stats.sessions.length > 4 && (
          <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => setAll((v) => !v)}>
            {all ? tr('Voir moins') : tr('Voir les {min} dernières', { min: Math.min(30, stats.sessions.length) })}
          </button>
        )}
      </section>

      {warm.length > 0 && (
        <section className="card stack" style={{ gap: 8, background: 'var(--surface-2)' }}>
          <div style={{ fontWeight: 800 }}>{tr('Échauffement avant {kg}', { kg: fmtKg(work) })}</div>
          <div className="chips" style={{ gap: 6 }}>
            {warm.map((w, i) => (
              <span key={i} className="tag num">
                {fmtKg(w.w)} × {w.r}
              </span>
            ))}
          </div>
          <p className="small faint" style={{ margin: 0 }}>
            {tr('Repos court entre ces séries. Elles ne comptent pas dans la séance.')}
          </p>
        </section>
      )}

      {barbell && loaded && (
        <section className="card stack" style={{ gap: 10, background: 'var(--surface-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontWeight: 800, flex: 1 }}>{tr('Disques à charger')}</div>
            <NumInput value={plateW} placeholder="kg" label={tr('Charge totale')} onCommit={setPlateW} />
          </div>
          {plates &&
            (plates.plates.length ? (
              <>
                <div className="plate-bar" aria-label={tr('Par côté : {join}', { join: plates.plates.map((p) => `${formatNumber(p, 2)} kg`).join(', ') })}>
                  <span className="plate-sleeve" />
                  {plates.plates.map((p, i) => (
                    <span key={i} className={`plate p${String(p).replace('.', '_')}`} style={{ height: `${44 + p * 2.4}px` }}>
                      {formatNumber(p, p % 1 ? 2 : 0)}
                    </span>
                  ))}
                </div>
                <p className="small muted" style={{ margin: 0 }}>
                  {tr('Par côté, barre de 20 kg comprise.')}{plates.rest > 0 ? tr(' Il reste {n} kg qui ne tombent pas juste.', { n: formatNumber(plates.rest, 2) }) : ''}
                </p>
              </>
            ) : (
              <p className="small muted" style={{ margin: 0 }}>
                {plateW && plateW <= 20 ? tr('La barre seule suffit (20 kg).') : tr('Saisis la charge totale.')}
              </p>
            ))}
        </section>
      )}
    </div>
  );
}

function LoadCalculator({ ex }: { ex: Exercise }) {
  const s = useApp();
  const advice = adviseLoad(s, ex, '9999-12-31');
  const [w, setW] = useState<number | undefined>();
  const [r, setR] = useState<number | undefined>();
  if (ex.noLoad || ex.kind === 'task' || ex.kind === 'cardio') return null;
  const manual = w && r ? e1rm(w, r) : undefined;
  const oneRm = manual ?? advice?.oneRm;
  const step = ex.step ?? 2.5;
  const table = oneRm ? [3, 5, 6, 8, 10, 12, 15].map((n) => ({ reps: n, weight: Math.max(step, Math.floor(loadFor(oneRm, n) / step) * step) })) : [];
  return (
    <div className="card stack" style={{ marginTop: 16, gap: 10, background: 'var(--surface-2)' }}>
      <div style={{ fontWeight: 800 }}>{tr('Combien mettre ?')}</div>
      <p className="small muted" style={{ margin: 0 }}>
        {manual
          ? tr('D’après la série que tu viens de saisir.')
          : advice
            ? tr('D’après tes dernières séances. Saisis une série pour recalculer.')
            : tr('Saisis une série que tu as faite (charge et reps) pour estimer tes charges.')}
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <NumInput value={w} placeholder="kg" label={tr('Charge')} onCommit={setW} />
        <span className="muted">×</span>
        <NumInput value={r} placeholder={tr('reps')} label={tr('Répétitions')} onCommit={setR} />
      </div>
      {oneRm && (
        <>
          <div className="small">
            {tr('1RM estimé :')}{' '}<b className="num">{fmtKg(Math.round(oneRm * 2) / 2)}</b>
          </div>
          <div className="calc-grid">
            {table.map((t) => (
              <div key={t.reps} className={`calc-cell ${advice && advice.reps.split('–').map(Number).includes(t.reps) ? 'on' : ''}`}>
                <div className="num" style={{ fontWeight: 800 }}>{fmtKg(t.weight)}</div>
                <div className="small faint">{tr('{reps} reps', { reps: t.reps })}</div>
              </div>
            ))}
          </div>
          <p className="small faint" style={{ margin: 0 }}>
            {tr('Charges qui laissent environ 2 reps en réserve. Pour progresser : 3 à 5 séries dans ta fourchette, et +1 rep par séance jusqu’au haut de la fourchette avant de monter.')}
          </p>
        </>
      )}
    </div>
  );
}

function WeightStepper({
  value,
  fallback,
  step,
  label,
  onCommit,
}: {
  value?: number;
  fallback?: number;
  step: number;
  label: string;
  onCommit: (v: number | undefined) => void;
}) {
  const fmt = (v?: number) => (v === undefined ? '' : String(v).replace('.', ','));
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmt(value));
  }, [value]);
  const commit = (v: number | undefined) => {
    if (v !== value) onCommit(v);
    setText(fmt(v));
  };
  const bump = (dir: 1 | -1) => {
    const base = value ?? fallback ?? 0;
    commit(Math.max(0, Math.round((base + dir * step) * 100) / 100));
  };
  return (
    <div className="stepper">
      <button type="button" onClick={() => bump(-1)} aria-label={tr('{label} : moins {step} kg', { label, step })}>
        −
      </button>
      <label style={{ position: 'relative' }}>
        <span className="visually-hidden">{label}</span>
        <input
          className="num"
          inputMode="decimal"
          placeholder={fallback !== undefined ? fmt(fallback) : 'kg'}
          value={text}
          onFocus={() => (focused.current = true)}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            focused.current = false;
            commit(parseDecimal(text));
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </label>
      <button type="button" onClick={() => bump(1)} aria-label={tr('{label} : plus {step} kg', { label, step })}>
        +
      </button>
    </div>
  );
}

function NumInput({
  value,
  placeholder,
  label,
  onCommit,
  decimals = 0,
}: {
  value?: number;
  placeholder: string;
  label: string;
  onCommit: (v: number | undefined) => void;
  decimals?: number;
}) {
  const fmt = (v?: number) => (v === undefined ? '' : decimals ? String(v).replace('.', ',') : String(v));
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmt(value));
  }, [value]);
  return (
    <label style={{ position: 'relative', display: 'block' }}>
      <span className="visually-hidden">{label}</span>
      <input
        className="input center num"
        style={{ minHeight: 46, padding: '10px 4px', fontWeight: 750 }}
        inputMode={decimals ? 'decimal' : 'numeric'}
        placeholder={placeholder}
        value={text}
        onFocus={() => (focused.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          focused.current = false;
          const n = parseDecimal(text);
          const f = 10 ** decimals;
          const v = n === undefined ? undefined : Math.round(n * f) / f;
          if (v !== value) onCommit(v);
          setText(fmt(v));
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

function RestTimer({ end, total, onAdd, onClose }: { end: number; total: number; onAdd: (sec: number) => void; onClose: () => void }) {
  const [now, setNow] = useState(Date.now());
  const buzzed = useRef(false);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, Math.ceil((end - now) / 1000));
  const cancelled = useRef(false);
  // App à l'écran juste avant la fin : pas besoin de la notification du serveur.
  useEffect(() => {
    if (left <= 3 && left > 0 && !cancelled.current && document.visibilityState === 'visible') {
      cancelled.current = true;
      cancelRestPush();
    }
  }, [left]);
  useEffect(() => {
    if (left === 0 && !buzzed.current) {
      buzzed.current = true;
      navigator.vibrate?.([200, 100, 200]);
      const t = setTimeout(onClose, 4000);
      return () => clearTimeout(t);
    }
  }, [left, onClose]);
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');
  return (
    <div className={`rest-timer ${left === 0 ? 'over' : ''}`} role="timer" aria-live="polite">
      {left === 0 ? (
        <strong style={{ flex: 1 }}>{tr('Série suivante')}</strong>
      ) : (
        <>
          <span className="time">
            {mm}:{ss}
          </span>
          <Bar value={total - (end - now) / 1000} max={total} />
          <button className="btn small" onClick={() => onAdd(15)}>
            +15 s
          </button>
        </>
      )}
      <button className="btn small" onClick={onClose}>
        {left === 0 ? 'OK' : tr('Passer')}
      </button>
    </div>
  );
}
