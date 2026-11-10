import { useEffect, useRef, useState } from 'react';
import { type Exercise, findSession, scheduleFor } from '../../shared/program';
import { Icon } from '../components/Icon';
import { Ring } from '../components/Ring';
import { ask, Bar, Check, Sheet, toast } from '../components/ui';
import { chooseSession, finishSession, parseDecimal, previousWeight, toggleSet, updateSet } from '../lib/actions';
import { formatShort, weekdayOf, WEEKDAY_NAMES } from '../lib/date';
import { exerciseFrames, exerciseInfo, videoUrl } from '../lib/exercise-info';
import { adviseLoad, loadFor } from '../lib/advisor';
import { e1rm } from '../lib/strength';
import { fmtKg, formatSets, lastPerformance, nextTarget, sessionFor, setProgress } from '../lib/logic';
import { readDay, type SetLog, useApp } from '../lib/store';

const fmtRest = (sec: number) => (sec >= 60 ? `${Math.floor(sec / 60)} min${sec % 60 ? ` ${sec % 60}` : ''}` : `${sec} s`);

export function Workout({ today, editProgram }: { today: string; editProgram: () => void }) {
  const s = useApp();
  const day = readDay(s, today);
  const session = sessionFor(s, today);
  const prog = setProgress(session, day);
  const [picker, setPicker] = useState(false);
  const [demo, setDemo] = useState<Exercise | null>(null);
  const [timer, setTimer] = useState<{ end: number; total: number } | null>(null);
  const planned = scheduleFor(s.program, today)[weekdayOf(today)];

  const onSet = (ex: Exercise, i: number) => {
    const done = toggleSet(today, ex, i);
    if (done && ex.rest > 0) setTimer({ end: Date.now() + ex.rest * 1000, total: ex.rest });
  };

  const finish = async () => {
    const ratio = prog.total ? prog.done / prog.total : 1;
    if (session.lifting && ratio < 0.6) {
      const ok = await ask(`Tu as fait ${prog.done} séries sur ${prog.total}. Valider la séance quand même ?`, 'Valider');
      if (!ok) return;
    }
    finishSession(today, true);
    toast('Séance validée, +50 XP');
  };

  return (
    <>
      <header className="topbar" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="date">
            {day.session && day.session !== planned ? `À la place de ${findSession(s.program, planned).name}` : WEEKDAY_NAMES[weekdayOf(today)]}
          </div>
          <h1 className="display" style={{ fontSize: '2.4rem' }}>
            {session.name}
          </h1>
          <div className="muted small" style={{ marginTop: 6 }}>
            {session.focus}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn small" onClick={() => setPicker(true)}>
              Changer de séance
            </button>
            <button className="btn small" onClick={editProgram}>
              Modifier le programme
            </button>
          </div>
        </div>
        {session.lifting && (
          <Ring value={day.mainDone ? 1 : prog.done} max={day.mainDone ? 1 : prog.total} color={day.mainDone ? 'var(--green)' : 'var(--blue)'} size={84} stroke={9} label="Séries faites">
            <div>
              <div className="num" style={{ fontWeight: 900, fontSize: '1.15rem' }}>
                {prog.done}
              </div>
              <div className="faint" style={{ fontSize: '0.7rem', fontWeight: 700 }}>
                sur {prog.total}
              </div>
            </div>
          </Ring>
        )}
      </header>

      {session.exercises.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '28px 18px' }}>
          <p style={{ marginTop: 0, fontWeight: 700 }}>Cette séance est vide.</p>
          <p className="small muted">Ajoute tes exercices depuis la bibliothèque, avec leurs séries et leurs reps.</p>
          <button className="btn primary" onClick={editProgram}>
            Composer la séance
          </button>
        </div>
      )}

      <div className="stack">
        {session.exercises.map((ex) => (
          <ExerciseCard key={ex.key} ex={ex} date={today} logs={day.sets[ex.key] ?? []} onSet={onSet} onDemo={() => setDemo(ex)} />
        ))}
      </div>

      <div style={{ marginTop: 22 }}>
        {day.mainDone ? (
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="check on" aria-hidden>
              <Icon name="check" size={20} />
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800 }}>Séance terminée</div>
              <div className="small muted">Note tes repas pour valider la journée.</div>
            </div>
            <button className="link small" onClick={() => finishSession(today, false)}>
              Annuler
            </button>
          </div>
        ) : (
          <button className="btn go block" onClick={finish}>
            <Icon name="check" size={20} /> Terminer la séance
          </button>
        )}
      </div>

      {timer && (
        <RestTimer
          key={timer.end}
          {...timer}
          onAdd={(n) => setTimer({ ...timer, end: timer.end + n * 1000 })}
          onClose={() => setTimer(null)}
        />
      )}

      {demo && <DemoSheet ex={demo} onClose={() => setDemo(null)} />}

      {picker && (
        <Sheet title="Séance du jour" onClose={() => setPicker(false)}>
          <p className="small muted" style={{ marginTop: -6 }}>
            Ton emploi du temps a bougé ? Garde l’ordre Push, Pull, Legs, Upper, Lower.
          </p>
          <div className="group">
            {s.program.sessions.map(({ id, name, focus }) => (
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
                    {id === planned ? <span className="faint small"> (prévue)</span> : null}
                  </div>
                  <div className="small muted">{focus}</div>
                </div>
                {session.id === id && <Icon name="check" />}
              </button>
            ))}
          </div>
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
}: {
  ex: Exercise;
  date: string;
  logs: SetLog[];
  onSet: (ex: Exercise, i: number) => void;
  onDemo: () => void;
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

  return (
    <article className={`ex-card ${complete ? 'complete' : ''}`}>
      <div className="ex-head">
        <button className="thumb" onClick={onDemo} aria-label={`Voir la démo : ${ex.name}`}>
          {frames ? <img src={frames[0]} alt="" loading="lazy" /> : <Icon name="dumbbell" size={28} />}
          <span className="play">
            <Icon name="play" size={12} filled />
          </span>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, lineHeight: 1.25 }}>{ex.name}</div>
          {!isTask && (
            <div className="chips" style={{ gap: 6, marginTop: 8 }}>
              <span className="tag num">
                {ex.sets} × {ex.reps}
              </span>
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
              {complete && <span className="tag up">Fait</span>}
            </div>
          )}
          {isTask && complete && (
            <span className="tag up" style={{ marginTop: 6 }}>
              Fait
            </span>
          )}
        </div>
      </div>

      {last && !isTask && (
        <p className="small faint num" style={{ margin: '10px 0 0' }}>
          Dernière fois ({formatShort(last.date)}) : {ex.noLoad ? last.sets.map((l) => l.r ?? '?').join(', ') : formatSets(last.sets)}
          {!advice && target.up ? '. Toutes les reps au max : on monte.' : ''}
        </p>
      )}
      {advice && !complete && (
        <p className="small advice" style={{ margin: '6px 0 0' }}>
          <Icon name="bolt" size={13} /> {advice.text}
        </p>
      )}

      <div style={{ marginTop: 10 }}>
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
                  label={`Charge série ${i + 1}`}
                  onCommit={(w) => updateSet(date, ex.key, i, { w }, ex.sets)}
                />
              )}
              {!isTask && !rounds ? (
                <NumInput
                  value={log.r}
                  placeholder={ex.repMin !== undefined ? `${ex.reps} reps`.replace('–', '-') : ex.reps.replace(/ .*/, '')}
                  label={`Répétitions série ${i + 1}`}
                  onCommit={(r) => updateSet(date, ex.key, i, { r }, ex.sets)}
                />
              ) : (
                <span className="small muted">{isTask ? 'Marquer comme fait' : ex.reps}</span>
              )}
              <Check on={log.done} onClick={() => onSet(ex, i)} label={`Série ${i + 1} faite`} tone="blue" />
            </div>
          );
        })}
      </div>
    </article>
  );
}

function DemoSheet({ ex, onClose }: { ex: Exercise; onClose: () => void }) {
  const frames = exerciseFrames(ex.key);
  const info = exerciseInfo(ex.key, useApp().customExercises);
  return (
    <Sheet title={ex.name} onClose={onClose}>
      {frames ? (
        <div className="demo">
          <img src={frames[0]} alt={`${ex.name}, position de départ`} />
          <img className="b" src={frames[1]} alt={`${ex.name}, position d’arrivée`} />
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
          {ex.sets} séries de {ex.reps}
          {ex.rest > 0 ? `, ${fmtRest(ex.rest)} de repos` : ''}.
        </p>
      )}
      <LoadCalculator ex={ex} />
      <a className="btn block" style={{ marginTop: 18, textDecoration: 'none' }} href={videoUrl(ex.name)} target="_blank" rel="noreferrer">
        <Icon name="play" size={16} filled /> Voir des vidéos de l’exercice
      </a>
    </Sheet>
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
      <div style={{ fontWeight: 800 }}>Combien mettre ?</div>
      <p className="small muted" style={{ margin: 0 }}>
        {manual
          ? 'D’après la série que tu viens de saisir.'
          : advice
            ? 'D’après tes dernières séances. Saisis une série pour recalculer.'
            : 'Saisis une série que tu as faite (charge et reps) pour estimer tes charges.'}
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <NumInput value={w} placeholder="kg" label="Charge" onCommit={setW} />
        <span className="muted">×</span>
        <NumInput value={r} placeholder="reps" label="Répétitions" onCommit={setR} />
      </div>
      {oneRm && (
        <>
          <div className="small">
            1RM estimé : <b className="num">{fmtKg(Math.round(oneRm * 2) / 2)}</b>
          </div>
          <div className="calc-grid">
            {table.map((t) => (
              <div key={t.reps} className={`calc-cell ${advice && advice.reps.split('–').map(Number).includes(t.reps) ? 'on' : ''}`}>
                <div className="num" style={{ fontWeight: 800 }}>{fmtKg(t.weight)}</div>
                <div className="small faint">{t.reps} reps</div>
              </div>
            ))}
          </div>
          <p className="small faint" style={{ margin: 0 }}>
            Charges qui laissent environ 2 reps en réserve. Pour progresser : 3 à 5 séries dans ta fourchette, et +1 rep par séance jusqu’au haut de la fourchette avant de monter.
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
      <button type="button" onClick={() => bump(-1)} aria-label={`${label} : moins ${step} kg`}>
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
      <button type="button" onClick={() => bump(1)} aria-label={`${label} : plus ${step} kg`}>
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
}: {
  value?: number;
  placeholder: string;
  label: string;
  onCommit: (v: number | undefined) => void;
}) {
  const fmt = (v?: number) => (v === undefined ? '' : String(v));
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
        inputMode="numeric"
        placeholder={placeholder}
        value={text}
        onFocus={() => (focused.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          focused.current = false;
          const n = parseDecimal(text);
          const v = n === undefined ? undefined : Math.round(n);
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
        <strong style={{ flex: 1 }}>Série suivante</strong>
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
        {left === 0 ? 'OK' : 'Passer'}
      </button>
    </div>
  );
}
