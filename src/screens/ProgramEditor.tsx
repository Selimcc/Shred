import { useMemo, useState } from 'react';
import { CATALOG, GROUP_NAMES } from '../../shared/catalog';
import { resolveSession } from '../../shared/program';
import { TEMPLATES } from '../../shared/templates';
import type { ExerciseKind, MuscleGroup, SessionDef, SessionType } from '../../shared/types';
import { Icon } from '../components/Icon';
import { ask, toast } from '../components/ui';
import { WEEKDAY_NAMES } from '../lib/date';
import { exerciseFrames } from '../lib/exercise-info';
import {
  addExercise,
  addSession,
  applyTemplate,
  createCustomExercise,
  deleteSession,
  moveSlot,
  removeSlot,
  renameProgram,
  setScheduleDay,
  updateSession,
  updateSlot,
} from '../lib/program-edit';
import { useApp } from '../lib/store';
import { sportLabel } from '../../shared/athlete';
import { findSession, planWeek } from '../../shared/program';
import { planSummary } from '../../shared/plans';
import { adaptCurrentProgram, restorePreviousProgram } from '../lib/coaching';
import { PHYSIQUES, regionName } from '../../shared/generator';
import { Braise } from '../components/Braise';
import { ProgramBuilder } from './ProgramBuilder';
import { applyTweak, dismissTweak, programTweaks } from '../lib/tweaks';
import { addDays, dayKey, formatShort } from '../lib/date';

const TYPE_NAMES: Record<SessionType, string> = { lifting: 'Muscu', cardio: 'Cardio', rest: 'Repos' };
const REST_OPTIONS = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240];
const fmtRest = (sec: number) => (sec === 0 ? 'aucun' : sec >= 60 ? `${Math.floor(sec / 60)} min${sec % 60 ? ` ${sec % 60}` : ''}` : `${sec} s`);

/** Éditeur du split : planning de la semaine, séances, exercices. */
export function ProgramEditor() {
  const s = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const [picker, setPicker] = useState<string | null>(null);
  const [templates, setTemplates] = useState(false);
  const [builder, setBuilder] = useState(false);
  const tweaks = programTweaks(s, dayKey());
  const p = s.program;
  const own = p.sessions.filter((x) => !x.generated);

  if (builder) return <ProgramBuilder onDone={() => setBuilder(false)} />;

  if (picker) {
    return <ExercisePicker onBack={() => setPicker(null)} onPick={(key) => { addExercise(picker, key); setPicker(null); toast('Exercice ajouté'); }} />;
  }

  return (
    <div className="stack" style={{ gap: 22 }}>
      <label className="field">
        <span>Nom du programme</span>
        <input className="input" value={p.name} onChange={(e) => renameProgram(e.target.value)} id="program-name" />
      </label>

      {p.event && p.weeks && <PlanWeeks />}

      <section className="card stack builder-card" style={{ gap: 10 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Braise mood="happy" size={52} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 850 }}>{s.settings.athlete.physique ? PHYSIQUES[s.settings.athlete.physique].label : 'Programme sur mesure'}</div>
            <div className="small muted">
              {sportLabel(s.settings.athlete)}, {s.settings.athlete.days} séances de {s.settings.athlete.minutes} min
              {s.settings.athlete.priorities?.length ? `. Priorités : ${s.settings.athlete.priorities.map((r) => regionName(r).toLowerCase()).join(', ')}` : ''}
            </div>
          </div>
        </div>
        <button className="btn primary block" onClick={() => setBuilder(true)}>
          <Icon name="sparkle" size={18} /> Construire mon programme
        </button>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn small"
            onClick={() => {
              const swaps = adaptCurrentProgram();
              toast(swaps.length ? `${swaps.length} exercice(s) remplacé(s) selon ta salle` : 'Tout se fait déjà dans ta salle');
            }}
          >
            Adapter à ma salle
          </button>
          {s.programHistory?.[0] && (
            <button
              className="btn small"
              onClick={async () => {
                const prev = s.programHistory![0];
                if (await ask(`Revenir à « ${prev.program.name} » (remplacé le ${formatShort(prev.replacedAt)}) ?`, 'Revenir')) {
                  restorePreviousProgram();
                  toast(`Programme « ${prev.program.name} » rétabli`);
                }
              }}
            >
              <Icon name="undo" size={15} /> Programme précédent
            </button>
          )}
        </div>
      </section>

      {tweaks.length > 0 && (
        <section className="stack" style={{ gap: 10 }}>
          <h2>Propositions de Braise</h2>
          {tweaks.map((t) => (
            <div key={t.id} className="card tweak">
              <div style={{ fontWeight: 800 }}>{t.title}</div>
              <div className="small muted">{t.text}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn small primary" onClick={() => toast(applyTweak(t))}>
                  {t.cta}
                </button>
                <button className="btn small" onClick={() => dismissTweak(t.id, dayKey())}>
                  Plus tard
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section>
        <div className="section-head">
          <h2>Partir d’un modèle</h2>
          <button className="link small" onClick={() => setTemplates((v) => !v)}>
            {templates ? 'Masquer' : 'Voir les modèles'}
          </button>
        </div>
        {templates && (
          <div className="group">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                className="row"
                style={{ width: '100%', border: 0, background: 'none', textAlign: 'left' }}
                onClick={async () => {
                  if (await ask(`Remplacer ton programme par « ${t.name} » ? Ton historique de séances est conservé.`, 'Remplacer', true)) {
                    applyTemplate(t.id);
                    adaptCurrentProgram();
                    setTemplates(false);
                    toast(`Programme « ${t.name} » chargé`);
                  }
                }}
              >
                <div className="grow">
                  <div className="title">
                    {t.name} <span className="tag">{t.days}</span>
                  </div>
                  <div className="small muted">{t.description}</div>
                </div>
                {p.template === t.id && <Icon name="check" />}
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2>Ma semaine</h2>
        </div>
        <div className="group">
          {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
            <label className="row" key={wd} style={{ minHeight: 52, padding: '8px 16px' }}>
              <span className="grow">{WEEKDAY_NAMES[wd]}</span>
              <select
                className="input"
                style={{ width: 180, minHeight: 40 }}
                value={p.schedule[wd]}
                onChange={(e) => setScheduleDay(wd, e.target.value)}
                aria-label={`Séance du ${WEEKDAY_NAMES[wd].toLowerCase()}`}
              >
                {own.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>Mes séances</h2>
          <span className="small muted">{own.length}</span>
        </div>
        <div className="stack">
          {own.map((def) => (
            <SessionCard
              key={def.id}
              def={def}
              open={open === def.id}
              onToggle={() => setOpen(open === def.id ? null : def.id)}
              onAdd={() => setPicker(def.id)}
              usedDays={p.schedule.filter((x) => x === def.id).length}
              canDelete={own.length > 1}
            />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn small" onClick={() => setOpen(addSession('lifting'))}>
            <Icon name="plus" size={16} /> Séance de muscu
          </button>
          <button className="btn small" onClick={() => setOpen(addSession('cardio'))}>
            <Icon name="plus" size={16} /> Cardio
          </button>
          <button className="btn small" onClick={() => setOpen(addSession('rest'))}>
            <Icon name="plus" size={16} /> Repos
          </button>
        </div>
      </section>
    </div>
  );
}

function SessionCard({
  def,
  open,
  onToggle,
  onAdd,
  usedDays,
  canDelete,
}: {
  def: SessionDef;
  open: boolean;
  onToggle: () => void;
  onAdd: () => void;
  usedDays: number;
  canDelete: boolean;
}) {
  const s = useApp();
  const session = resolveSession(def, s.customExercises);
  const [editing, setEditing] = useState<number | null>(null);

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <button
        onClick={onToggle}
        style={{ width: '100%', border: 0, background: 'none', textAlign: 'left', padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}
        aria-expanded={open}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 850, fontStretch: '115%' }}>{def.name}</div>
          <div className="small muted">
            {TYPE_NAMES[def.type]}, {def.exercises.length} exercice{def.exercises.length > 1 ? 's' : ''}, ~{session.duration}
            {usedDays ? `, ${usedDays} j/sem` : ', pas au planning'}
          </div>
        </div>
        <span style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
          <Icon name="chevron" size={18} />
        </span>
      </button>

      {open && (
        <div style={{ padding: '0 16px 16px' }} className="stack">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 8 }}>
            <label className="field">
              <span>Nom</span>
              <input className="input" value={def.name} onChange={(e) => updateSession(def.id, { name: e.target.value.slice(0, 30) })} />
            </label>
            <label className="field">
              <span>Type</span>
              <select className="input" value={def.type} onChange={(e) => updateSession(def.id, { type: e.target.value as SessionType })}>
                {(Object.keys(TYPE_NAMES) as SessionType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_NAMES[t]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Muscles visés</span>
            <input className="input" value={def.focus} placeholder="ex. Pecs, épaules, triceps" onChange={(e) => updateSession(def.id, { focus: e.target.value.slice(0, 60) })} />
          </label>

          <div className="group" style={{ background: 'var(--surface-2)' }}>
            {def.exercises.length === 0 && <div className="empty small">Aucun exercice pour l’instant.</div>}
            {def.exercises.map((slot, i) => {
              const ex = session.exercises[i];
              const frames = exerciseFrames(slot.key);
              const isOpen = editing === i;
              return (
                <div key={`${slot.key}-${i}`} style={{ borderTop: i ? '1px solid var(--line)' : 0 }}>
                  <button
                    onClick={() => setEditing(isOpen ? null : i)}
                    style={{ width: '100%', border: 0, background: 'none', textAlign: 'left', display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px' }}
                  >
                    {frames ? (
                      <img src={frames[0]} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', flex: 'none' }} />
                    ) : (
                      <span style={{ width: 44, height: 44, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--surface)', flex: 'none' }}>
                        <Icon name="dumbbell" size={20} />
                      </span>
                    )}
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 700, lineHeight: 1.25 }}>{ex.name}</span>
                      <span className="small muted num">
                        {ex.sets} × {ex.reps}, repos {fmtRest(ex.rest)}
                      </span>
                    </span>
                  </button>
                  {isOpen && (
                    <div style={{ padding: '0 12px 12px' }} className="stack">
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                        <label className="field">
                          <span>Séries</span>
                          <select className="input" value={ex.sets} onChange={(e) => updateSlot(def.id, i, { sets: Number(e.target.value) })}>
                            {Array.from({ length: 10 }, (_, k) => k + 1).map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span>Reps</span>
                          <input className="input" defaultValue={ex.reps} onBlur={(e) => e.target.value.trim() && updateSlot(def.id, i, { reps: e.target.value.trim().slice(0, 20) })} />
                        </label>
                        <label className="field">
                          <span>Repos</span>
                          <select className="input" value={ex.rest} onChange={(e) => updateSlot(def.id, i, { rest: Number(e.target.value) })}>
                            {[...new Set([...REST_OPTIONS, ex.rest])].sort((a, b) => a - b).map((r) => (
                              <option key={r} value={r}>
                                {fmtRest(r)}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <label className="field">
                        <span>Note (optionnel)</span>
                        <input className="input" defaultValue={slot.note ?? ''} placeholder="ex. dernière série en dégressive" onBlur={(e) => updateSlot(def.id, i, { note: e.target.value.trim() || undefined })} />
                      </label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn small" disabled={i === 0} onClick={() => { moveSlot(def.id, i, -1); setEditing(i - 1); }} aria-label="Monter">
                          ↑ Monter
                        </button>
                        <button className="btn small" disabled={i === def.exercises.length - 1} onClick={() => { moveSlot(def.id, i, 1); setEditing(i + 1); }} aria-label="Descendre">
                          ↓ Descendre
                        </button>
                        <button className="btn small danger" style={{ marginLeft: 'auto' }} onClick={() => { removeSlot(def.id, i); setEditing(null); }}>
                          Retirer
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button className="btn primary block" onClick={onAdd}>
            <Icon name="plus" size={18} /> Ajouter un exercice
          </button>
          {canDelete && (
            <button
              className="link small"
              style={{ color: 'var(--red)', alignSelf: 'flex-start' }}
              onClick={async () => {
                if (await ask(`Supprimer la séance « ${def.name} » ?${usedDays ? ' Les jours qui l’utilisent passeront en repos.' : ''}`, 'Supprimer', true)) deleteSession(def.id);
              }}
            >
              Supprimer cette séance
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const GROUP_ORDER: MuscleGroup[] = ['chest', 'back', 'shoulders', 'arms', 'legs', 'core', 'neck', 'cardio', 'other'];

/** Bibliothèque d'exercices avec recherche, filtre par muscle et création d'exercice. */
export function ExercisePicker({ onBack, onPick }: { onBack: () => void; onPick: (key: string) => void }) {
  const s = useApp();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<MuscleGroup | 'all'>('all');
  const [creating, setCreating] = useState(false);
  const all = useMemo(() => [...Object.values(s.customExercises), ...CATALOG], [s.customExercises]);
  const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const list = all.filter(
    (e) => (group === 'all' || e.group === group) && (!q || norm(`${e.name} ${e.muscles.join(' ')}`).includes(norm(q))),
  );

  if (creating) return <CustomExerciseForm onBack={() => setCreating(false)} onCreated={onPick} initialName={q} />;

  return (
    <div className="stack">
      <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={onBack}>
        ← Retour au programme
      </button>
      <input className="input" placeholder="Rechercher : développé, dos, mollets…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un exercice" />
      <div className="chips" style={{ gap: 6 }}>
        {(['all', ...GROUP_ORDER] as const).map((g) => (
          <button key={g} className={`chip ${group === g ? 'on' : ''}`} style={{ minHeight: 34, padding: '0 12px' }} onClick={() => setGroup(g)}>
            {g === 'all' ? 'Tout' : GROUP_NAMES[g]}
          </button>
        ))}
      </div>
      <div className="group">
        {list.map((e) => {
          const frames = exerciseFrames(e.key);
          return (
            <button key={e.key} className="row" style={{ width: '100%', border: 0, background: 'none', textAlign: 'left', padding: '10px 14px' }} onClick={() => onPick(e.key)}>
              {frames ? (
                <img src={frames[0]} alt="" loading="lazy" style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'cover', flex: 'none' }} />
              ) : (
                <span style={{ width: 48, height: 48, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--surface-2)', flex: 'none' }}>
                  <Icon name="dumbbell" size={20} />
                </span>
              )}
              <div className="grow">
                <div className="title" style={{ lineHeight: 1.25 }}>
                  {e.name}
                  {e.custom && <span className="tag" style={{ marginLeft: 6 }}>perso</span>}
                </div>
                <div className="small muted">{e.muscles.join(', ')}</div>
              </div>
              <Icon name="plus" size={20} />
            </button>
          );
        })}
        {list.length === 0 && <div className="empty small">Aucun exercice ne correspond.</div>}
      </div>
      <button className="btn block" onClick={() => setCreating(true)}>
        <Icon name="plus" size={18} /> Créer un exercice
      </button>
    </div>
  );
}

const KINDS: { id: ExerciseKind; label: string }[] = [
  { id: 'compound', label: 'Avec charge' },
  { id: 'core', label: 'Poids du corps' },
  { id: 'cardio', label: 'Cardio ou chrono' },
];

function CustomExerciseForm({ onBack, onCreated, initialName }: { onBack: () => void; onCreated: (key: string) => void; initialName: string }) {
  const [name, setName] = useState(initialName);
  const [group, setGroup] = useState<MuscleGroup>('chest');
  const [kind, setKind] = useState<ExerciseKind>('compound');
  const [sets, setSets] = useState(3);
  const [reps, setReps] = useState('8–12');
  const save = () => {
    if (!name.trim()) return toast('Donne un nom à l’exercice', true);
    const key = createCustomExercise({
      name: name.trim().slice(0, 50),
      kind,
      group,
      muscles: [GROUP_NAMES[group]],
      defaults: { sets, reps: reps.trim() || '10', rest: kind === 'cardio' ? 0 : 90 },
      step: 2.5,
      noLoad: kind !== 'compound',
    });
    onCreated(key);
  };
  return (
    <div className="stack">
      <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={onBack}>
        ← Retour à la bibliothèque
      </button>
      <label className="field">
        <span>Nom</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. Rowing machine convergente" />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label className="field">
          <span>Muscle principal</span>
          <select className="input" value={group} onChange={(e) => setGroup(e.target.value as MuscleGroup)}>
            {GROUP_ORDER.map((g) => (
              <option key={g} value={g}>
                {GROUP_NAMES[g]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Type</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as ExerciseKind)}>
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Séries par défaut</span>
          <select className="input" value={sets} onChange={(e) => setSets(Number(e.target.value))}>
            {Array.from({ length: 10 }, (_, k) => k + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Reps par défaut</span>
          <input className="input" value={reps} onChange={(e) => setReps(e.target.value)} />
        </label>
      </div>
      <button className="btn primary block" onClick={save}>
        Créer et ajouter
      </button>
    </div>
  );
}

/** Le plan daté, semaine par semaine. */
function PlanWeeks() {
  const s = useApp();
  const p = s.program;
  const today = dayKey();
  const current = planWeek(p, today);
  const [all, setAll] = useState(false);
  const weeks = p.weeks!.map((w, i) => ({ w, i })).filter(({ i }) => all || current === null || (i >= current && i < current + 3));
  return (
    <section className="stack">
      <div className="section-head" style={{ marginBottom: 0 }}>
        <h2>{p.event!.name}</h2>
        <span className="small muted">{new Date(`${p.event!.date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}</span>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {planSummary(p, today)} Le plan change chaque semaine ; la semaine type ci-dessous sert avant et après.
      </p>
      <div className="group">
        {weeks.map(({ w, i }) => (
          <div key={i} className="row" style={{ alignItems: 'flex-start' }}>
            <div className="grow">
              <div className="title">
                Semaine {i + 1} <span className="small muted">· {formatShort(addDays(p.start!, i * 7))}</span>
                {i === current && <span className="tag blue" style={{ marginLeft: 6 }}>en cours</span>}
              </div>
              <div className="small muted">{p.phases?.[i]}</div>
              <div className="small" style={{ marginTop: 4, lineHeight: 1.5 }}>
                {[1, 2, 3, 4, 5, 6, 0]
                  .filter((d) => w[d] !== 'rest')
                  .map((d) => {
                    const def = findSession(p, w[d]);
                    return `${WEEKDAY_NAMES[d].slice(0, 3)}. ${def.name}${def.type === 'cardio' ? ` (${def.focus})` : ''}`;
                  })
                  .join(' · ')}
              </div>
            </div>
          </div>
        ))}
      </div>
      {current !== null && p.weeks!.length > 3 && (
        <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => setAll(!all)}>
          {all ? 'Masquer' : `Voir les ${p.weeks!.length} semaines`}
        </button>
      )}
    </section>
  );
}
