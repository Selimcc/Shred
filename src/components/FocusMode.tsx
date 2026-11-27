// Mode séance : plein écran, une série à la fois. Charge et reps en grand, un bouton pour valider, puis le repos
// en grand avec la série suivante en aperçu. Gainages et rounds au temps : un chrono d'effort qui valide tout seul.
// L'écran reste allumé (Wake Lock) et un bip annonce la fin du repos. Tout passe par les mêmes actions que la
// liste : ce que tu vois en grand est exactement ce qui sera noté.
import { type CSSProperties, type KeyboardEvent, type TouchEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { repMeters } from '../../shared/effort';
import type { Exercise } from '../../shared/program';
import { finishSession, parseDecimal, setDefaults, toggleSet, updateSet } from '../lib/actions';
import { adviseLoad, firstTimeText, startingLoad } from '../lib/advisor';
import { beep, primeAudio } from '../lib/beep';
import { sessionSummary } from '../lib/club';
import { exerciseFrames } from '../lib/exercise-info';
import { leave } from '../lib/leave';
import { fmtKg, formatSets, lastPerformance, sessionFor } from '../lib/logic';
import { isRecord } from '../lib/moments';
import { cancelRestPush, scheduleRestPush } from '../lib/restPush';
import { continuous, minutesOf, nextUndone, recordReps, type Step, stepsOf, workSpan } from '../lib/focus';
import { type AppState, type DayLog, getState, readDay, setState, useApp } from '../lib/store';
import { dayWarmup } from '../lib/warmupDay';
import { setWarmup } from '../lib/workoutActions';
import { fmtDose, type WarmMove, type WarmPhase, type WarmRamp } from '../../shared/warmup';
import { DISCIPLINE_ICON, Icon } from './Icon';
import { useScrollLock } from './ui';
import { loc, tn, tr } from '../../shared/i18n';

export type Rest = { end: number; total: number } | null;
/** Chrono d'effort : compte à rebours (durée fixe) ou chrono qui monte (fourchette, tu l'arrêtes). */
type Work = { kind: 'down'; end: number; total: number } | { kind: 'up'; start: number; min: number; max: number } | null;
const fmtRest = (sec: number) => (sec >= 60 ? `${Math.floor(sec / 60)} min${sec % 60 ? ` ${sec % 60}` : ''}` : `${sec} s`);
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const buzz = (p: number | number[]) => {
  try {
    navigator.vibrate?.(p);
  } catch {
    // pas de vibration sur iPhone
  }
};

// Début de la séance en mode plein écran, gardé si on en sort et qu'on y revient le même jour.
const started = new Map<string, number>();

function useWakeLock() {
  useEffect(() => {
    type Sentinel = { release: () => Promise<void> };
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } }).wakeLock;
    if (!wl) return;
    let lock: Sentinel | null = null;
    let live = true;
    // Le verrou saute quand l'app passe en arrière-plan : on le redemande au retour.
    const ask = () => {
      if (document.visibilityState !== 'visible') return;
      wl.request('screen')
        .then((l) => (live ? (lock = l) : void l.release().catch(() => undefined)))
        .catch(() => undefined);
    };
    ask();
    document.addEventListener('visibilitychange', ask);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', ask);
      void lock?.release().catch(() => undefined);
    };
  }, []);
}

type WarmStep = { kind: 'move'; move: WarmMove } | { kind: 'ramp'; ramp: WarmRamp } | { kind: 'then'; text: string };

export function FocusMode({
  today,
  warmFirst = false,
  rest,
  setRest,
  onSet,
  onClose,
  onShare,
}: {
  today: string;
  /** Ouvert depuis la carte d'échauffement : on commence par lui même s'il est déjà fait. */
  warmFirst?: boolean;
  rest: Rest;
  setRest: (r: Rest) => void;
  /** La validation de la liste : coche, record, minuteur de repos et notification. */
  onSet: (ex: Exercise, i: number) => void;
  onClose: () => void;
  onShare: () => void;
}) {
  useScrollLock();
  useWakeLock();
  const s = useApp();
  const day = readDay(s, today);
  const session = sessionFor(s, today);
  const steps = stepsOf(session.exercises);
  const isDone = (st: Step, d: DayLog = day) => !!d.sets[st.ex.key]?.[st.set]?.done;
  const [cur, setCur] = useState<string | null>(() => steps.find((st) => !isDone(st))?.id ?? steps[0]?.id ?? null);
  const [since] = useState(() => started.get(today) ?? (started.set(today, Date.now()), Date.now()));
  const [last, setLast] = useState<{ id: string; record: { w: number; r: number } | null } | null>(null);
  const [work, setWork] = useState<Work>(null);
  const [dir, setDir] = useState<1 | -1>(1);
  const muted = !!s.ui.focusMute;
  // L'échauffement, avant la première série : guidé mouvement par mouvement, chrono quand c'est au temps.
  const warm = dayWarmup(s, today);
  const warmSteps: WarmStep[] = warm
    ? [
        ...warm.moves.map((move) => ({ kind: 'move' as const, move })),
        ...(warm.ramp ? [{ kind: 'ramp' as const, ramp: warm.ramp }] : []),
        ...(warm.then ? [{ kind: 'then' as const, text: warm.then }] : []),
      ]
    : [];
  const [warming, setWarming] = useState(() => !!warm && (warmFirst || (!day.warmup && steps.every((st) => !isDone(st)))));
  const [wi, setWi] = useState(0);
  const endWarm = (status: 'done' | 'skipped') => {
    if (status === 'done' || !readDay(getState(), today).warmup) setWarmup(today, status);
    setWarming(false);
    setDir(1);
  };
  const goWarm = (to: number) => {
    if (to < 0 || to >= warmSteps.length || to === wi) return;
    setDir(to > wi ? 1 : -1);
    setWi(to);
  };
  const root = useRef<HTMLDivElement>(null);
  // Les +30 s / −15 s s'enchaînent vite : on ne reprogramme la notification qu'une fois les doigts posés.
  const pending = useRef<{ t: number; end: number; label?: string } | null>(null);
  const dropPending = () => {
    if (pending.current) clearTimeout(pending.current.t);
    pending.current = null;
  };
  const sendPending = () => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.t);
    pending.current = null;
    scheduleRestPush((p.end - Date.now()) / 1000, p.label);
  };
  // En quittant pendant le repos, la notification part quand même à la bonne heure.
  useEffect(() => sendPending, []);
  const stopRest = () => {
    dropPending();
    setRest(null);
    cancelRestPush();
  };

  let idx = steps.findIndex((st) => st.id === cur);
  if (idx < 0)
    idx = Math.max(
      0,
      steps.findIndex((st) => !isDone(st)),
    );
  const step = steps[idx] as Step | undefined;
  const allDone = steps.length > 0 && steps.every((st) => isDone(st));
  const phase = warming && warmSteps.length ? 'warm' : allDone ? 'done' : rest ? 'rest' : 'set';

  // Séance finie : plus de repos à décompter.
  useEffect(() => {
    if (allDone && rest) stopRest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone, rest]);

  // En partant, le plein écran s'efface au lieu de disparaître d'un coup.
  useLayoutEffect(() => {
    const el = root.current;
    el?.focus();
    return () => leave(el, 'focus-out', 240);
  }, []);

  const go = (to: number) => {
    if (to < 0 || to >= steps.length || to === idx) return;
    setDir(to > idx ? 1 : -1);
    setWork(null);
    setCur(steps[to].id);
  };

  const validate = (st: Step) => {
    primeAudio();
    setWork(null);
    const before = readDay(getState(), today);
    // Bloc continu : on note la distance et la durée affichées si rien n'a été saisi.
    if (continuous(st.ex) && !isDone(st, before)) {
      const log = before.sets[st.ex.key]?.[0];
      const planned = st.ex.discipline ? repMeters(st.ex) : 0;
      const min = minutesOf(st.ex.reps);
      const patch = { ...(log?.km === undefined && planned ? { km: Math.round(planned) / 1000 } : {}), ...(log?.min === undefined && min ? { min } : {}) };
      if (Object.keys(patch).length) updateSet(today, st.ex.key, 0, patch, 1);
    }
    onSet(st.ex, st.set);
    const fresh = getState();
    const now = readDay(fresh, today);
    if (!isDone(st, now)) return;
    buzz(14);
    setLast({ id: st.id, record: !st.ex.noLoad ? isRecord(fresh, st.ex.key, today, st.set) : null });
    const next = nextUndone(steps, now, steps.indexOf(st));
    if (!next) return stopRest();
    setDir(1);
    setCur(next.id);
  };

  const undo = () => {
    const st = steps.find((x) => x.id === last?.id);
    if (st && isDone(st, readDay(getState(), today))) toggleSet(today, st.ex, st.set);
    stopRest();
    setLast(null);
    if (st) {
      setDir(-1);
      setCur(st.id);
    }
  };

  const nextLabel = step ? tr('{name}, série {n}', { name: step.ex.name, n: step.set + 1 }) : undefined;
  const shift = (sec: number) => {
    if (!rest) return;
    const start = rest.end - rest.total * 1000;
    const end = Math.max(Date.now() + 1000, rest.end + sec * 1000);
    setRest({ end, total: Math.max(1, (end - start) / 1000) });
    dropPending();
    pending.current = { t: window.setTimeout(sendPending, 700), end, label: nextLabel };
  };
  const skip = stopRest;

  const toggleMute = () =>
    setState((d) => {
      d.ui.focusMute = !d.ui.focusMute;
    });

  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    touch.current = (e.target as HTMLElement).closest('input, button, .big-stepper') ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const t = touch.current;
    touch.current = null;
    if (!t || (phase !== 'set' && phase !== 'warm')) return;
    const dx = e.changedTouches[0].clientX - t.x;
    const dy = e.changedTouches[0].clientY - t.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (phase === 'warm') goWarm(wi + (dx < 0 ? 1 : -1));
      else go(idx + (dx < 0 ? 1 : -1));
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if ((e.target as HTMLElement).tagName === 'INPUT' || (phase !== 'set' && phase !== 'warm')) return;
    const move = phase === 'warm' ? (n: number) => goWarm(wi + n) : (n: number) => go(idx + n);
    if (e.key === 'ArrowRight') move(1);
    if (e.key === 'ArrowLeft') move(-1);
  };

  return createPortal(
    <div
      ref={root}
      className={`focus ${phase}`}
      role="dialog"
      aria-modal="true"
      aria-label={tr('Mode séance')}
      tabIndex={-1}
      onKeyDown={onKey}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <header className="focus-head">
        <button className="icon-btn" onClick={onClose} aria-label={tr('Quitter le mode séance')}>
          <Icon name="x" />
        </button>
        <div className="focus-head-mid">
          <span className="small muted ellipsis" style={{ maxWidth: '100%' }}>
            {session.name}
          </span>
          <Elapsed since={since} />
        </div>
        <button className="icon-btn" onClick={toggleMute} aria-label={muted ? tr('Activer les bips') : tr('Couper les bips')} aria-pressed={!muted}>
          <Icon name={muted ? 'mute' : 'sound'} />
        </button>
      </header>
      <div className="focus-progress" aria-hidden="true">
        {phase === 'warm' &&
          warmSteps.map((_, i) => (
            <span key={i} className={i === wi ? 'cur' : ''} style={{ flexGrow: 1 }}>
              <i style={{ transform: `scaleX(${i < wi ? 1 : 0})` }} />
            </span>
          ))}
        {phase !== 'warm' && session.exercises.map((ex, i) => {
          const n = continuous(ex) ? 1 : ex.sets;
          const d = (day.sets[ex.key] ?? []).slice(0, n).filter((l) => l.done).length;
          return (
            <span key={ex.key} className={phase === 'set' && step?.ei === i ? 'cur' : ''} style={{ flexGrow: n }}>
              <i style={{ transform: `scaleX(${d / n})` }} />
            </span>
          );
        })}
      </div>

      <div className="focus-body">
        {phase === 'warm' && (
          <WarmView
            key={wi}
            step={warmSteps[wi]}
            index={wi}
            count={warmSteps.length}
            dir={dir}
            muted={muted}
            onPrev={wi > 0 ? () => goWarm(wi - 1) : undefined}
            onNext={() => (wi < warmSteps.length - 1 ? goWarm(wi + 1) : endWarm('done'))}
            onSkip={() => endWarm('skipped')}
          />
        )}
        {phase === 'done' && <DoneView s={s} today={today} since={since} onShare={onShare} onClose={onClose} />}
        {phase === 'rest' && rest && (
          <RestView
            s={s}
            today={today}
            rest={rest}
            next={step ?? null}
            record={last?.record ?? null}
            muted={muted}
            canUndo={!!last}
            onShift={shift}
            onSkip={skip}
            onUndo={undo}
            onDone={(late) => {
              if (!late && !muted) beep('end');
              buzz([200, 100, 200]);
              dropPending();
              setRest(null);
            }}
          />
        )}
        {phase === 'set' && step && (
          <SetView
            key={step.id}
            s={s}
            today={today}
            step={step}
            dir={dir}
            exCount={session.exercises.length}
            work={work}
            muted={muted}
            onValidate={() => validate(step)}
            onUndo={() => {
              toggleSet(today, step.ex, step.set);
              setLast(null);
            }}
            onStartWork={(span) => {
              primeAudio();
              setWork(
                span.min === span.max
                  ? { kind: 'down', end: Date.now() + span.max * 1000, total: span.max }
                  : { kind: 'up', start: Date.now(), min: span.min, max: span.max },
              );
            }}
            onStopWork={() => {
              // Chrono qui monte : on note le temps tenu, en secondes, et la série est faite.
              if (work?.kind === 'up') {
                const sec = Math.round((Date.now() - work.start) / 1000);
                setWork(null);
                if (sec >= 3) {
                  updateSet(today, step.ex.key, step.set, { r: sec }, step.ex.sets);
                  validate(step);
                }
                return;
              }
              setWork(null);
            }}
            onWorkDone={(late) => {
              if (!late && !muted) beep('end');
              buzz([200, 100, 200]);
              if (work?.kind === 'down' && step.ex.kind !== 'cardio') updateSet(today, step.ex.key, step.set, { r: work.total }, step.ex.sets);
              validate(step);
            }}
            hasPrev={idx > 0}
            hasNext={idx < steps.length - 1}
            onPrev={() => go(idx - 1)}
            onNext={() => go(idx + 1)}
            onNextUndone={() => {
              const n = nextUndone(steps, day, idx);
              if (n) go(steps.indexOf(n));
            }}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const t = Math.max(0, Math.floor((now - since) / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return (
    <span className="num focus-clock" aria-label={tr('Temps écoulé')}>
      {h ? `${h}:${String(m).padStart(2, '0')}` : m}:{String(t % 60).padStart(2, '0')}
    </span>
  );
}

/** Grand anneau qui se vide. Bips sur les 3 dernières secondes, `onDone(late)` une seule fois à zéro. */
function Countdown({
  end,
  total,
  label,
  size,
  muted,
  onDone,
  onFinal,
}: {
  end: number;
  total: number;
  label: string;
  size: number;
  muted: boolean;
  onDone: (late: boolean) => void;
  onFinal?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);
  const leftMs = Math.max(0, end - now);
  const sec = Math.ceil(leftMs / 1000);
  const fired = useRef(false);
  const lastSec = useRef(sec);
  useEffect(() => {
    if (sec !== lastSec.current) {
      lastSec.current = sec;
      if (sec > 0 && sec <= 3) {
        if (!muted) beep('tick');
        if (sec === 3) onFinal?.();
      }
    }
    if (sec > 0) fired.current = false;
    else if (!fired.current) {
      fired.current = true;
      onDone(now - end > 1500);
    }
  });
  const R = 46;
  const C = 2 * Math.PI * R;
  const frac = total > 0 ? Math.min(1, leftMs / (total * 1000)) : 0;
  return (
    <div className={`countdown ${sec <= 3 ? 'final' : ''}`} style={{ width: size, height: size }} role="timer" aria-label={tr('{name} : {detail}', { name: label, detail: clock(sec) })}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={R} className="countdown-track" />
        <circle cx="50" cy="50" r={R} className="countdown-arc" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} />
      </svg>
      <div className="countdown-text">
        <span className="small muted">{label}</span>
        <span className="countdown-time num">{clock(sec)}</span>
      </div>
    </div>
  );
}

/** Chrono qui monte pour un gainage : l'anneau se remplit jusqu'au haut de la fourchette, bip au bas et au haut. */
function Stopwatch({ start, min, max, size, muted }: { start: number; min: number; max: number; size: number; muted: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);
  const sec = Math.max(0, Math.floor((now - start) / 1000));
  const hit = useRef({ min: false, max: false });
  useEffect(() => {
    if (sec >= min && !hit.current.min) {
      hit.current.min = true;
      if (!muted) beep('tick');
      buzz(40);
    }
    if (sec >= max && !hit.current.max) {
      hit.current.max = true;
      if (!muted) beep('end');
      buzz([120, 60, 120]);
    }
  });
  const R = 46;
  const C = 2 * Math.PI * R;
  const frac = Math.min(1, (now - start) / (max * 1000));
  const label = sec < min ? tr('Cible {min} à {max} s', { min, max }) : sec < max ? tr('Dans la cible') : tr('Objectif atteint');
  return (
    <div
      className={`countdown ${sec >= min ? 'reached' : ''}`}
      style={{ width: size, height: size }}
      role="timer"
      aria-label={tr('Chrono : {clock}, {label}', { clock: clock(sec), label })}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={R} className="countdown-track" />
        <circle cx="50" cy="50" r={R} className="countdown-arc" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} />
      </svg>
      <div className="countdown-text">
        <span className="small muted">{label}</span>
        <span className="countdown-time num">{clock(sec)}</span>
      </div>
    </div>
  );
}

function BigStepper({
  label,
  unit,
  value,
  fallback,
  step,
  decimals,
  onCommit,
}: {
  label: string;
  unit: string;
  value?: number;
  fallback?: number;
  step: number;
  decimals: number;
  onCommit: (v: number | undefined) => void;
}) {
  const fmt = (v?: number) => (v === undefined ? '' : v.toLocaleString(loc(), { maximumFractionDigits: decimals, useGrouping: false }));
  const shown = value ?? fallback;
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const display = editing ? text : fmt(shown);
  const bump = (d: 1 | -1) => {
    const f = 10 ** decimals;
    onCommit(Math.max(0, Math.round(((shown ?? 0) + d * step) * f) / f));
    buzz(6);
  };
  return (
    <div className="big-stepper">
      <span className="big-stepper-label small muted">{label}</span>
      <label className="big-value">
        <span className="visually-hidden">{label}</span>
        <input
          className="num"
          inputMode={decimals ? 'decimal' : 'numeric'}
          value={display}
          placeholder="–"
          style={{
            width: `${Math.max(
              1.1,
              [...display].reduce((n, ch) => n + (/\d/.test(ch) ? 0.47 : 0.28), 0.14),
            )}em`,
          }}
          onFocus={(e) => {
            setText(fmt(shown));
            setEditing(true);
            requestAnimationFrame(() => e.target.select());
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            setEditing(false);
            const n = parseDecimal(text);
            const f = 10 ** decimals;
            const v = n === undefined ? undefined : Math.max(0, Math.round(n * f) / f);
            if (v !== shown) onCommit(v);
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        {unit && <span className="big-unit">{unit}</span>}
      </label>
      <div className="big-stepper-row">
        <button type="button" className="big-step" onClick={() => bump(-1)} aria-label={tr('{label} : moins {fmt}{v}', { label, fmt: fmt(step), v: unit ? ` ${unit}` : '' })}>
          −
        </button>
        <button type="button" className="big-step" onClick={() => bump(1)} aria-label={tr('{label} : plus {fmt}{v}', { label, fmt: fmt(step), v: unit ? ` ${unit}` : '' })}>
          +
        </button>
      </div>
    </div>
  );
}

function SetView({
  s,
  today,
  step,
  dir,
  exCount,
  work,
  muted,
  onValidate,
  onUndo,
  onStartWork,
  onStopWork,
  onWorkDone,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onNextUndone,
}: {
  s: AppState;
  today: string;
  step: Step;
  dir: 1 | -1;
  exCount: number;
  work: Work;
  muted: boolean;
  onValidate: () => void;
  onUndo: () => void;
  onStartWork: (span: { min: number; max: number }) => void;
  onStopWork: () => void;
  onWorkDone: (late: boolean) => void;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onNextUndone: () => void;
}) {
  const { ex, set } = step;
  const logs = readDay(s, today).sets[ex.key] ?? [];
  const log = logs[set] ?? { done: false };
  const last = lastPerformance(s, ex.key, today);
  const advice = adviseLoad(s, ex, today);
  const start = !last && !advice ? startingLoad(s, ex, today) : null;
  const def = setDefaults(s, ex, today, logs, set);
  const isTask = ex.kind === 'task';
  const rounds = ex.kind === 'cardio';
  const cont = continuous(ex);
  const loaded = !isTask && !ex.noLoad && !rounds;
  const span = workSpan(ex);
  const timed = span && span.min === span.max ? span.max : null;
  const repsInput = !isTask && !rounds && !span;
  const frames = exerciseFrames(ex.key);
  const w = log.w ?? def.w;
  const rec = loaded && !log.done ? recordReps(s, ex.key, today, w) : null;
  const swim = ex.discipline === 'swim';
  const planned = ex.discipline ? repMeters(ex) : 0;
  const what = isTask ? tr('À faire') : cont ? tr('Bloc continu') : rounds ? tr('Round {n} sur {sets}', { n: set + 1, sets: ex.sets }) : tr('Série {n} sur {sets}', { n: set + 1, sets: ex.sets });
  const cta = isTask ? tr('C’est fait') : cont ? tr('Bloc terminé') : rounds ? tr('Round {n} fait', { n: set + 1 }) : tr('Valider la série');

  return (
    <div className={`focus-step in${dir}`}>
      <div className={`focus-media ${work ? 'working' : ''}`}>
        {work?.kind === 'down' ? (
          <Countdown end={work.end} total={work.total} label={tr('Effort')} size={190} muted={muted} onDone={onWorkDone} />
        ) : work?.kind === 'up' ? (
          <Stopwatch start={work.start} min={work.min} max={work.max} size={190} muted={muted} />
        ) : frames ? (
          <div className="demo focus-demo">
            <img src={frames[0]} alt={tr('{name}, position de départ', { name: ex.name })} />
            <img className="b" src={frames[1]} alt="" />
          </div>
        ) : (
          <span className="focus-glyph">
            <Icon name={ex.discipline ? DISCIPLINE_ICON[ex.discipline] : isTask ? 'check' : 'dumbbell'} size={58} />
          </span>
        )}
      </div>

      <div className="focus-kicker small">
        {tr('Exercice {n} sur {exCount}', { n: step.ei + 1, exCount })}
      </div>
      <h2 className="display focus-name">{ex.name}</h2>
      <div className="focus-meta">
        <span className="focus-set num">{what}</span>
        {!isTask && (
          <span className="tag num">
            {ex.reps}
            {ex.repMin !== undefined ? ` ${tr('reps')}` : ''}
          </span>
        )}
        {ex.target && <span className="tag num blue">{ex.target}</span>}
        {ex.rest > 0 && !cont && (
          <span className="tag">
            <Icon name="clock" size={13} /> {fmtRest(ex.rest)}
          </span>
        )}
      </div>
      {last && !isTask && (
        <p className="small faint num focus-line">
          {tr('Dernière fois :')}{' '}
          {ex.noLoad || rounds
            ? last.sets.map((l) => (l.r !== undefined ? `${l.r}${span ? ' s' : ''}` : l.km ? `${l.km} km` : '✓')).join(', ')
            : formatSets(last.sets)}
        </p>
      )}
      {advice && !log.done && set === 0 && (
        <p className="small advice focus-line">
          <Icon name="bolt" size={13} /> {advice.text}
        </p>
      )}
      {!advice && !last && start && !log.done && set === 0 && (
        <p className="small advice focus-line">
          <Icon name="bolt" size={13} /> {firstTimeText(start, ex)}
        </p>
      )}
      {(isTask || cont) && ex.note && <p className="small muted focus-line">{ex.note}</p>}
      {rec !== null && rec <= (ex.repMax ?? 12) + 3 && w !== undefined && (
        <p className="small focus-record">
          <Icon name="trophy" size={14} />{' '}{tn(rec, 'Record dès {n} rep à {kg}', 'Record dès {n} reps à {kg}', { kg: fmtKg(w) })}
        </p>
      )}

      {(loaded || repsInput || cont) && (
        <div className={`focus-steppers ${(loaded && repsInput) || cont ? 'two' : ''}`}>
          {loaded && (
            <BigStepper
              label={tr('Charge')}
              unit="kg"
              value={log.w}
              fallback={def.w}
              step={ex.step ?? 2.5}
              decimals={2}
              onCommit={(v) => updateSet(today, ex.key, set, { w: v }, ex.sets)}
            />
          )}
          {repsInput && (
            <BigStepper
              label={tr('Reps')}
              unit=""
              value={log.r}
              fallback={def.r}
              step={1}
              decimals={0}
              onCommit={(v) => updateSet(today, ex.key, set, { r: v }, ex.sets)}
            />
          )}
          {cont && (
            <>
              <BigStepper
                label={tr('Distance')}
                unit={swim ? 'm' : 'km'}
                value={log.km !== undefined ? (swim ? Math.round(log.km * 1000) : log.km) : undefined}
                fallback={planned ? (swim ? Math.round(planned) : Math.round(planned / 100) / 10) : undefined}
                step={swim ? 50 : 0.5}
                decimals={swim ? 0 : 2}
                onCommit={(v) => updateSet(today, ex.key, 0, { km: v === undefined ? undefined : swim ? v / 1000 : v }, 1)}
              />
              <BigStepper
                label={tr('Durée')}
                unit="min"
                value={log.min}
                fallback={minutesOf(ex.reps)}
                step={1}
                decimals={0}
                onCommit={(v) => updateSet(today, ex.key, 0, { min: v }, 1)}
              />
            </>
          )}
        </div>
      )}

      {log.done && (
        <p className="focus-done-line">
          <Icon name="check" size={18} /> {isTask ? tr('Fait') : tr('Série faite')}
          <button className="link small" onClick={onUndo}>
            {tr('annuler')}
          </button>
        </p>
      )}

      <div className="focus-actions">
        <button className="focus-nav prev" onClick={onPrev} disabled={!hasPrev} aria-label={tr('Série précédente')}>
          <Icon name="chevron" size={22} />
        </button>
        {log.done ? (
          <button className="btn go" onClick={onNextUndone}>
            {tr('Série suivante')}
          </button>
        ) : work?.kind === 'up' ? (
          <button className="btn go" onClick={onStopWork}>
            <Icon name="check" size={20} />{' '}{tr('Stop, je note')}
          </button>
        ) : work ? (
          <button className="btn go" onClick={onStopWork}>
            {tr('Arrêter le chrono')}
          </button>
        ) : span ? (
          <button className="btn go" onClick={() => onStartWork(span)}>
            <Icon name="play" size={18} filled /> {timed ? tr('Lancer {rest}', { rest: fmtRest(timed) }) : tr('Lancer le chrono')}
          </button>
        ) : (
          <button className="btn go" onClick={onValidate}>
            <Icon name="check" size={20} /> {cta}
          </button>
        )}
        <button className="focus-nav" onClick={onNext} disabled={!hasNext} aria-label={tr('Série suivante')}>
          <Icon name="chevron" size={22} />
        </button>
      </div>
      {span && !log.done && work?.kind !== 'up' && (
        <button className="link small focus-alt" onClick={onValidate}>
          {work ? tr('Valider maintenant') : tr('Déjà fait, valider')}
        </button>
      )}
    </div>
  );
}

function RestView({
  s,
  today,
  rest,
  next,
  record,
  muted,
  canUndo,
  onShift,
  onSkip,
  onUndo,
  onDone,
}: {
  s: AppState;
  today: string;
  rest: { end: number; total: number };
  next: Step | null;
  record: { w: number; r: number } | null;
  muted: boolean;
  canUndo: boolean;
  onShift: (sec: number) => void;
  onSkip: () => void;
  onUndo: () => void;
  onDone: (late: boolean) => void;
}) {
  const frames = next ? exerciseFrames(next.ex.key) : null;
  const pushCut = useRef(false);
  let line = '';
  if (next) {
    const logs = readDay(s, today).sets[next.ex.key] ?? [];
    const def = setDefaults(s, next.ex, today, logs, next.set);
    const w = logs[next.set]?.w ?? def.w;
    const r = logs[next.set]?.r ?? def.r;
    const isLift = next.ex.kind !== 'task' && next.ex.kind !== 'cardio' && !workSpan(next.ex);
    const which = { n: next.set + 1, sets: next.ex.sets };
    const detail = isLift && w !== undefined ? ` · ${fmtKg(w)}${r !== undefined ? ` × ${r}` : ''}` : isLift && r !== undefined ? tr(' · {r} reps', { r }) : ` · ${next.ex.reps}`;
    line = `${next.ex.kind === 'cardio' ? tr('Round {n} sur {sets}', which) : tr('Série {n} sur {sets}', which)}${detail}`;
  }
  const size = Math.round(Math.min(280, Math.max(200, (typeof window !== 'undefined' ? window.innerWidth : 390) * 0.66)));
  return (
    <div className="focus-rest">
      {record && (
        <div className="focus-record-banner" role="status">
          <Icon name="trophy" size={18} />{' '}{tr('Nouveau record : {kg} × {r}', { kg: fmtKg(record.w), r: record.r })}
        </div>
      )}
      <Countdown
        end={rest.end}
        total={rest.total}
        label={tr('Repos')}
        size={size}
        muted={muted}
        onDone={onDone}
        onFinal={() => {
          // App à l'écran à la fin du repos : pas besoin de la notification du serveur.
          if (!pushCut.current && document.visibilityState === 'visible') {
            pushCut.current = true;
            cancelRestPush();
          }
        }}
      />
      <div className="focus-rest-actions">
        <button className="btn" onClick={() => onShift(-15)}>
          −15 s
        </button>
        <button className="btn" onClick={() => onShift(30)}>
          +30 s
        </button>
        <button className="btn primary" onClick={onSkip}>
          {tr('Passer')}
        </button>
      </div>
      {next && (
        <div className="focus-next">
          <span className="small muted">{tr('Ensuite')}</span>
          <div className="focus-next-row">
            <span className="focus-next-thumb">
              {frames ? <img src={frames[0]} alt="" /> : <Icon name={next.ex.discipline ? DISCIPLINE_ICON[next.ex.discipline] : 'dumbbell'} size={24} />}
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="focus-next-name">{next.ex.name}</div>
              <div className="small muted num">{line}</div>
            </div>
          </div>
        </div>
      )}
      {canUndo && (
        <button className="link small" onClick={onUndo}>
          {tr('Annuler la dernière série')}
        </button>
      )}
    </div>
  );
}

const PHASE: Record<WarmPhase, { label: string; icon: string }> = {
  raise: { label: tr('Température'), icon: 'flame' },
  mobilise: { label: tr('Mobilité'), icon: 'warmup' },
  activate: { label: tr('Activation'), icon: 'bolt' },
  prime: { label: tr('Préparation'), icon: 'dumbbell' },
};

/** Un mouvement de l'échauffement : chrono s'il est au temps, sinon « Fait ». Les séries d'approche se cochent. */
function WarmView({
  step,
  index,
  count,
  dir,
  muted,
  onPrev,
  onNext,
  onSkip,
}: {
  step: WarmStep;
  index: number;
  count: number;
  dir: 1 | -1;
  muted: boolean;
  onPrev?: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const [timer, setTimer] = useState<{ end: number; total: number } | null>(null);
  const [ticked, setTicked] = useState<number[]>([]);
  const last = index === count - 1;
  const move = step.kind === 'move' ? step.move : null;
  const phase = move ? PHASE[move.phase] : null;
  const start = (sec: number) => {
    primeAudio();
    setTimer({ end: Date.now() + sec * 1000, total: sec });
  };
  return (
    <div className={`focus-step warm-step in${dir}`}>
      <div className={`focus-media ${timer ? 'working' : ''}`}>
        {timer ? (
          <Countdown
            end={timer.end}
            total={timer.total}
            label={tr('Encore')}
            size={190}
            muted={muted}
            onDone={(late) => {
              if (!late && !muted) beep('end');
              buzz([200, 100, 200]);
              onNext();
            }}
          />
        ) : (
          <span className="focus-glyph warm-glyph">
            <Icon name={phase?.icon ?? (step.kind === 'ramp' ? 'dumbbell' : 'play')} size={58} />
          </span>
        )}
      </div>
      <div className="focus-kicker small warm-kicker">
        <span>
          {tr('Échauffement, {n} sur {count}', { n: index + 1, count })}
        </span>
        <button className="link small" onClick={onSkip}>
          {tr('Passer l’échauffement')}
        </button>
      </div>
      {move && (
        <>
          <h2 className="display focus-name">{move.name}</h2>
          <div className="focus-meta">
            <span className="focus-set num">{fmtDose(move)}</span>
            <span className="tag">{phase?.label}</span>
          </div>
          <p className="small muted focus-line">{move.cue}</p>
        </>
      )}
      {step.kind === 'ramp' && (
        <>
          <h2 className="display focus-name">{step.ramp.name}</h2>
          <p className="small muted focus-line">
            {tr('Séries d’approche avant {kg}. Repos court entre elles, elles ne comptent pas dans la séance.', { kg: fmtKg(step.ramp.work) })}
          </p>
          <div className="ramp-sets">
            {step.ramp.sets.map((x, i) => (
              <button
                key={i}
                type="button"
                className={`ramp-set ${ticked.includes(i) ? 'on' : ''}`}
                aria-pressed={ticked.includes(i)}
                onClick={() => {
                  buzz(10);
                  setTicked((t) => (t.includes(i) ? t.filter((x) => x !== i) : [...t, i]));
                }}
              >
                <b className="num">{fmtKg(x.w)}</b>
                <span className="small num">× {x.r}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {step.kind === 'then' && (
        <>
          <h2 className="display focus-name">{tr('Ensuite')}</h2>
          <p className="focus-line warm-then">{step.text}</p>
        </>
      )}
      <div className="focus-actions">
        <button className="focus-nav prev" onClick={onPrev} disabled={!onPrev} aria-label={tr('Mouvement précédent')}>
          <Icon name="chevron" size={22} />
        </button>
        {timer ? (
          <button className="btn go" onClick={() => setTimer(null)}>
            {tr('Arrêter le chrono')}
          </button>
        ) : move?.sec ? (
          <button className="btn go" onClick={() => start(move.sec!)}>
            <Icon name="play" size={18} filled />{' '}{tr('Lancer {dose}', { dose: fmtDose(move) })}
          </button>
        ) : (
          <button className="btn go" onClick={onNext}>
            {last ? (
              tr('C’est parti')
            ) : (
              <>
                <Icon name="check" size={20} />{' '}{tr('Fait')}
              </>
            )}
          </button>
        )}
        <button className="focus-nav" onClick={onNext} disabled={last} aria-label={tr('Mouvement suivant')}>
          <Icon name="chevron" size={22} />
        </button>
      </div>
      {move?.sec && !timer && (
        <button className="link small focus-alt" onClick={onNext}>
          {last ? tr('Déjà fait, c’est parti') : tr('Déjà fait, suivant')}
        </button>
      )}
    </div>
  );
}

function DoneView({ s, today, since, onShare, onClose }: { s: AppState; today: string; since: number; onShare: () => void; onClose: () => void }) {
  const day = readDay(s, today);
  const sum = sessionSummary(s, today);
  const minutes = Math.round((Date.now() - since) / 60000);
  // La durée vue d'ici est la plus juste : de l'ouverture du mode séance à la dernière série.
  const stats = (sum?.stats ?? []).filter((x) => x.label !== tr('Durée'));
  if (minutes >= 3)
    stats.push({ label: tr('Durée'), value: minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}` : `${minutes} min` });
  return (
    <div className="focus-done">
      <div className="focus-done-mark">
        <Icon name="check" size={54} />
      </div>
      <h2 className="display">{tr('Séance terminée')}</h2>
      <p className="muted" style={{ margin: 0 }}>
        {sum?.title}
      </p>
      {stats.length > 0 && (
        <div className="focus-done-stats" style={{ '--n': stats.length } as CSSProperties}>
          {stats.map((x) => (
            <div key={x.label}>
              <b className="num">{x.value}</b>
              <span className="small muted">{x.label}</span>
            </div>
          ))}
        </div>
      )}
      {sum?.records?.length ? (
        <div className="focus-done-records">
          {sum.records.map((r) => (
            <span key={r}>
              <Icon name="trophy" size={15} /> {r}
            </span>
          ))}
        </div>
      ) : null}
      {!day.mainDone ? (
        <button className="btn go" onClick={() => finishSession(today, true)}>
          <Icon name="check" size={18} />{' '}{tr('Valider la séance')}
        </button>
      ) : (
        <button className="btn primary" onClick={onShare}>
          <Icon name="share" size={17} />{' '}{tr('Partager ma séance')}
        </button>
      )}
      <button className="btn" onClick={onClose}>
        {tr('Revenir à la séance')}
      </button>
    </div>
  );
}
