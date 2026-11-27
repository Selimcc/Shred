import { useMemo, useState } from 'react';
import { CATALOG, GROUP_NAMES } from '../../shared/catalog';
import { resolveSession } from '../../shared/program';
import { TEMPLATES } from '../../shared/templates';
import type { ExerciseKind, MuscleGroup, SessionDef, SessionType } from '../../shared/types';
import { Icon } from '../components/Icon';
import { ask, toast } from '../components/ui';
import { WEEKDAY_LOWER, WEEKDAY_NAMES, WEEKDAY_SHORT } from '../lib/date';
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
import { setState, useApp } from '../lib/store';
import { Toggle } from '../components/form';
import { sportLabel } from '../../shared/athlete';
import { findSession, planWeek } from '../../shared/program';
import { planSummary } from '../../shared/plans';
import { adaptCurrentProgram, restorePreviousProgram } from '../lib/coaching';
import { PHYSIQUES, regionName } from '../../shared/generator';
import { Pulse } from '../components/Pulse';
import { ProgramBuilder } from './ProgramBuilder';
import { applyTweak, dismissTweak, programTweaks } from '../lib/tweaks';
import { addDays, dayKey, formatShort, mondayOf } from '../lib/date';
import { blockOf, nextRotation, rotates, rotationFor } from '../lib/variety';
import { exerciseName } from '../../shared/catalog';
import { loc, lower, tn, tr } from '../../shared/i18n';

const TYPE_NAMES: Record<SessionType, string> = { lifting: tr('Muscu'), cardio: tr('Cardio'), rest: tr('Repos') };
const REST_OPTIONS = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240];
const fmtRest = (sec: number) => (sec === 0 ? tr('aucun') : sec >= 60 ? `${Math.floor(sec / 60)} min${sec % 60 ? ` ${sec % 60}` : ''}` : `${sec} s`);

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
    return <ExercisePicker onBack={() => setPicker(null)} onPick={(key) => { addExercise(picker, key); setPicker(null); toast(tr('Exercice ajouté')); }} />;
  }

  return (
    <div className="stack" style={{ gap: 22 }}>
      <label className="field">
        <span>{tr('Nom du programme')}</span>
        <input className="input" value={p.name} onChange={(e) => renameProgram(e.target.value)} id="program-name" />
      </label>

      {p.weeks && p.start && <PlanWeeks />}

      <section className="card stack builder-card" style={{ gap: 10 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Pulse mood="happy" size={52} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 850 }}>{s.settings.athlete.physique ? PHYSIQUES[s.settings.athlete.physique].label : tr('Programme sur mesure')}</div>
            <div className="small muted">
              {tr('{sportLabel}, {days} séances de {minutes} min', { sportLabel: sportLabel(s.settings.athlete), days: s.settings.athlete.days, minutes: s.settings.athlete.minutes })}
              {s.settings.athlete.priorities?.length ? tr('. Priorités : {list}', { list: s.settings.athlete.priorities.map((r) => lower(regionName(r))).join(', ') }) : ''}
            </div>
          </div>
        </div>
        <button className="btn primary block" onClick={() => setBuilder(true)}>
          <Icon name="sparkle" size={18} />{' '}{tr('Construire mon programme')}
        </button>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn small"
            onClick={() => {
              const swaps = adaptCurrentProgram();
              toast(swaps.length ? tn(swaps.length, '{n} exercice remplacé selon ta salle', '{n} exercices remplacés selon ta salle') : tr('Tout se fait déjà dans ta salle'));
            }}
          >
            {tr('Adapter à ma salle')}
          </button>
          {s.programHistory?.[0] && (
            <button
              className="btn small"
              onClick={async () => {
                const prev = s.programHistory![0];
                if (await ask(tr('Revenir à « {name} » (remplacé le {date}) ?', { name: prev.program.name, date: formatShort(prev.replacedAt) }), tr('Revenir'))) {
                  restorePreviousProgram();
                  toast(tr('Programme « {name} » rétabli', { name: prev.program.name }));
                }
              }}
            >
              <Icon name="undo" size={15} />{' '}{tr('Programme précédent')}
            </button>
          )}
        </div>
      </section>

      {tweaks.length > 0 && (
        <section className="stack" style={{ gap: 10 }}>
          <h2>{tr('Propositions de Pulse')}</h2>
          {tweaks.map((t) => (
            <div key={t.id} className="card tweak">
              <div style={{ fontWeight: 800 }}>{t.title}</div>
              <div className="small muted">{t.text}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn small primary" onClick={() => toast(applyTweak(t))}>
                  {t.cta}
                </button>
                <button className="btn small" onClick={() => dismissTweak(t.id, dayKey())}>
                  {tr('Plus tard')}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section>
        <div className="section-head">
          <h2>{tr('Partir d’un modèle')}</h2>
          <button className="link small" onClick={() => setTemplates((v) => !v)}>
            {templates ? tr('Masquer') : tr('Voir les modèles')}
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
                  if (await ask(tr('Remplacer ton programme par « {name} » ? Ton historique de séances est conservé.', { name: tr(t.name) }), tr('Remplacer'), true)) {
                    applyTemplate(t.id);
                    adaptCurrentProgram();
                    setTemplates(false);
                    toast(tr('Programme « {name} » chargé', { name: tr(t.name) }));
                  }
                }}
              >
                <div className="grow">
                  <div className="title">
                    {tr(t.name)} <span className="tag">{tr(t.days)}</span>
                  </div>
                  <div className="small muted">{tr(t.description)}</div>
                </div>
                {p.template === t.id && <Icon name="check" />}
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2>{tr('Ma semaine')}</h2>
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
                aria-label={tr('Séance du {day}', { day: WEEKDAY_LOWER[wd] })}
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
          <h2>{tr('Mes séances')}</h2>
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
            <Icon name="plus" size={16} />{' '}{tr('Séance de muscu')}
          </button>
          <button className="btn small" onClick={() => setOpen(addSession('cardio'))}>
            <Icon name="plus" size={16} />{' '}{tr('Cardio')}
          </button>
          <button className="btn small" onClick={() => setOpen(addSession('rest'))}>
            <Icon name="plus" size={16} />{' '}{tr('Repos')}
          </button>
        </div>
      </section>

      <VarietySection />

      <section>
        <div className="section-head">
          <h2>{tr('Avant chaque séance')}</h2>
        </div>
        <div className="group">
          <Toggle
            title={tr('Échauffement')}
            text={tr('5 à 10 minutes choisies d’après la séance du jour : muscles travaillés, sport, séries d’approche. Tu peux toujours le passer.')}
            on={s.settings.warmup !== false}
            onChange={(v) => setState((d) => void (d.settings.warmup = v))}
          />
        </div>
      </section>
    </div>
  );
}

/** Les exercices d'isolation qui changent à chaque bloc, et le rattrapage d'un muscle oublié dans la semaine. */
function VarietySection() {
  const s = useApp();
  const v = s.settings.variety ?? { on: true, since: dayKey(), catchUp: true };
  const today = dayKey();
  const block = blockOf(s, today);
  const next = nextRotation(s, today);
  const set = (patch: Partial<typeof v>) => setState((d) => void (d.settings.variety = { ...v, ...patch }));
  return (
    <section>
      <div className="section-head">
        <h2>{tr('Variété')}</h2>
      </div>
      <div className="group">
        <Toggle
          title={tr('Changer les exercices d’isolation toutes les 4 semaines')}
          text={
            v.on
              ? next
                ? block
                  ? tr('Prochain changement le {date} (bloc {n}). Les polyarticulaires ne bougent pas : ce sont eux qui montrent ta progression.', { n: block, date: formatShort(next) })
                  : tr('Premier changement le {date}, puis toutes les 4 semaines. Les polyarticulaires ne bougent pas : ce sont eux qui montrent ta progression.', { date: formatShort(next) })
                : ''
              : tr('Tes exercices restent les mêmes de semaine en semaine.')
          }
          on={v.on}
          // Rallumée : les exercices changent dès le lundi qui vient.
          onChange={(on) => set(on && v.since < today ? { on, since: addDays(mondayOf(today), 7) } : { on })}
        />
        <Toggle
          title={tr('Rattraper un muscle oublié')}
          text={tr('Si une séance saute dans la semaine, la suivante ajoute un exercice pour le muscle qui n’a pas eu ses séries.')}
          on={v.catchUp}
          onChange={(catchUp) => set({ catchUp })}
        />
      </div>
    </section>
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
  const rotation = rotationFor(s, def, dayKey());
  const variety = s.settings.variety?.on !== false;

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
            {tn(def.exercises.length, '{type}, {n} exercice', '{type}, {n} exercices', { type: TYPE_NAMES[def.type] })}, ~{session.duration}
            {usedDays ? tr(', {usedDays} j/sem', { usedDays }) : tr(', pas au planning')}
          </div>
        </div>
        <span style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
          <Icon name="chevron" size={18} />
        </span>
      </button>

      {open && (
        <div style={{ padding: '0 16px 16px' }} className="stack">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr minmax(110px, max-content)', gap: 8 }}>
            <label className="field">
              <span>{tr('Nom')}</span>
              <input className="input" value={def.name} onChange={(e) => updateSession(def.id, { name: e.target.value.slice(0, 30) })} />
            </label>
            <label className="field">
              <span>{tr('Type')}</span>
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
            <span>{tr('Muscles visés')}</span>
            <input className="input" value={def.focus} placeholder={tr('ex. Pecs, épaules, triceps')} onChange={(e) => updateSession(def.id, { focus: e.target.value.slice(0, 60) })} />
          </label>

          <div className="group" style={{ background: 'var(--surface-2)' }}>
            {def.exercises.length === 0 && <div className="empty small">{tr('Aucun exercice pour l’instant.')}</div>}
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
                        {tr('{sets} × {reps}, repos {rest}', { sets: ex.sets, reps: ex.reps, rest: fmtRest(ex.rest) })}
                      </span>
                      {rotation.has(slot.key) && (
                        <span className="small faint" style={{ display: 'block' }}>
                          {tr('Ce bloc : {name}', { name: lower(exerciseName(rotation.get(slot.key)!, s.customExercises)) })}
                        </span>
                      )}
                    </span>
                  </button>
                  {isOpen && (
                    <div style={{ padding: '0 12px 12px' }} className="stack">
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                        <label className="field">
                          <span>{tr('Séries')}</span>
                          <select className="input" value={ex.sets} onChange={(e) => updateSlot(def.id, i, { sets: Number(e.target.value) })}>
                            {Array.from({ length: 10 }, (_, k) => k + 1).map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span>{tr('Reps')}</span>
                          <input className="input" defaultValue={ex.reps} onBlur={(e) => e.target.value.trim() && updateSlot(def.id, i, { reps: e.target.value.trim().slice(0, 20) })} />
                        </label>
                        <label className="field">
                          <span>{tr('Repos')}</span>
                          <select className="input" value={ex.rest} onChange={(e) => updateSlot(def.id, i, { rest: Number(e.target.value) })}>
                            {[...new Set([...REST_OPTIONS, ex.rest])].sort((a, b) => a - b).map((r) => (
                              <option key={r} value={r}>
                                {fmtRest(r)}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      {variety && def.type === 'lifting' && rotates(s, slot.key) && (
                        <Toggle
                          title={tr('Changer de variante à chaque bloc')}
                          text={slot.pin ? tr('Gardé à chaque bloc.') : tr('Passe à un autre exercice du même mouvement toutes les 4 semaines.')}
                          on={!slot.pin}
                          onChange={(on) => updateSlot(def.id, i, { pin: on ? undefined : true })}
                        />
                      )}
                      <label className="field">
                        <span>{tr('Note (optionnel)')}</span>
                        <input className="input" defaultValue={slot.note ?? ''} placeholder={tr('ex. dernière série en dégressive')} onBlur={(e) => updateSlot(def.id, i, { note: e.target.value.trim() || undefined })} />
                      </label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn small" disabled={i === 0} onClick={() => { moveSlot(def.id, i, -1); setEditing(i - 1); }} aria-label={tr('Monter')}>
                          {tr('↑ Monter')}
                        </button>
                        <button className="btn small" disabled={i === def.exercises.length - 1} onClick={() => { moveSlot(def.id, i, 1); setEditing(i + 1); }} aria-label={tr('Descendre')}>
                          {tr('↓ Descendre')}
                        </button>
                        <button className="btn small danger" style={{ marginLeft: 'auto' }} onClick={() => { removeSlot(def.id, i); setEditing(null); }}>
                          {tr('Retirer')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button className="btn primary block" onClick={onAdd}>
            <Icon name="plus" size={18} />{' '}{tr('Ajouter un exercice')}
          </button>
          {canDelete && (
            <button
              className="link small"
              style={{ color: 'var(--red)', alignSelf: 'flex-start' }}
              onClick={async () => {
                if (await ask(tr('Supprimer la séance « {name} » ?{v}', { name: def.name, v: usedDays ? tr(' Les jours qui l’utilisent passeront en repos.') : '' }), tr('Supprimer'), true)) deleteSession(def.id);
              }}
            >
              {tr('Supprimer cette séance')}
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
    (e) => (group === 'all' || e.group === group) && (!q || norm(`${e.name} ${tr(e.name)} ${e.muscles.join(' ')} ${e.muscles.map((m) => tr(m)).join(' ')}`).includes(norm(q))),
  );

  if (creating) return <CustomExerciseForm onBack={() => setCreating(false)} onCreated={onPick} initialName={q} />;

  return (
    <div className="stack">
      <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={onBack}>
        {tr('← Retour au programme')}
      </button>
      <input className="input" placeholder={tr('Rechercher : développé, dos, mollets…')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tr('Rechercher un exercice')} />
      <div className="chips" style={{ gap: 6 }}>
        {(['all', ...GROUP_ORDER] as const).map((g) => (
          <button key={g} className={`chip ${group === g ? 'on' : ''}`} style={{ minHeight: 34, padding: '0 12px' }} onClick={() => setGroup(g)}>
            {g === 'all' ? tr('Tout') : GROUP_NAMES[g]}
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
                  {e.custom ? e.name : tr(e.name)}
                  {e.custom && <span className="tag" style={{ marginLeft: 6 }}>{tr('perso')}</span>}
                </div>
                <div className="small muted">{(e.custom ? e.muscles : e.muscles.map((m) => tr(m))).join(', ')}</div>
              </div>
              <Icon name="plus" size={20} />
            </button>
          );
        })}
        {list.length === 0 && <div className="empty small">{tr('Aucun exercice ne correspond.')}</div>}
      </div>
      <button className="btn block" onClick={() => setCreating(true)}>
        <Icon name="plus" size={18} />{' '}{tr('Créer un exercice')}
      </button>
    </div>
  );
}

const KINDS: { id: ExerciseKind; label: string }[] = [
  { id: 'compound', label: tr('Avec charge') },
  { id: 'core', label: tr('Poids du corps') },
  { id: 'cardio', label: tr('Cardio ou chrono') },
];

function CustomExerciseForm({ onBack, onCreated, initialName }: { onBack: () => void; onCreated: (key: string) => void; initialName: string }) {
  const [name, setName] = useState(initialName);
  const [group, setGroup] = useState<MuscleGroup>('chest');
  const [kind, setKind] = useState<ExerciseKind>('compound');
  const [sets, setSets] = useState(3);
  const [reps, setReps] = useState('8–12');
  const save = () => {
    if (!name.trim()) return toast(tr('Donne un nom à l’exercice'), true);
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
        {tr('← Retour à la bibliothèque')}
      </button>
      <label className="field">
        <span>{tr('Nom')}</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('ex. Rowing machine convergente')} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label className="field">
          <span>{tr('Muscle principal')}</span>
          <select className="input" value={group} onChange={(e) => setGroup(e.target.value as MuscleGroup)}>
            {GROUP_ORDER.map((g) => (
              <option key={g} value={g}>
                {GROUP_NAMES[g]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{tr('Type')}</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as ExerciseKind)}>
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{tr('Séries par défaut')}</span>
          <select className="input" value={sets} onChange={(e) => setSets(Number(e.target.value))}>
            {Array.from({ length: 10 }, (_, k) => k + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{tr('Reps par défaut')}</span>
          <input className="input" value={reps} onChange={(e) => setReps(e.target.value)} />
        </label>
      </div>
      <button className="btn primary block" onClick={save}>
        {tr('Créer et ajouter')}
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
        <h2>{p.event ? p.event.name : tr('Bloc de {length} semaines', { length: p.weeks!.length })}</h2>
        <span className="small muted">
          {p.event
            ? new Date(`${p.event.date}T12:00:00`).toLocaleDateString(loc(), { day: 'numeric', month: 'long' })
            : tr('jusqu’au {date}', { date: formatShort(addDays(p.start!, p.weeks!.length * 7 - 1)) })}
        </span>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {tr('{planSummary} Le plan change chaque semaine ; la semaine type ci-dessous sert avant et après.', { planSummary: planSummary(p, today) })}
      </p>
      <div className="group">
        {weeks.map(({ w, i }) => (
          <div key={i} className="row" style={{ alignItems: 'flex-start' }}>
            <div className="grow">
              <div className="title">
                {tr('Semaine {n}', { n: i + 1 })}{' '}<span className="small muted">· {formatShort(addDays(p.start!, i * 7))}</span>
                {i === current && <span className="tag blue" style={{ marginLeft: 6 }}>{tr('en cours')}</span>}
              </div>
              <div className="small muted">{p.phases?.[i]}</div>
              <div className="small" style={{ marginTop: 4, lineHeight: 1.5 }}>
                {[1, 2, 3, 4, 5, 6, 0]
                  .filter((d) => w[d] !== 'rest')
                  .map((d) => {
                    const def = findSession(p, w[d]);
                    return `${WEEKDAY_SHORT[d]} ${tr(def.name)}${def.type === 'cardio' ? ` (${tr(def.focus)})` : ''}`;
                  })
                  .join(' · ')}
              </div>
            </div>
          </div>
        ))}
      </div>
      {current !== null && p.weeks!.length > 3 && (
        <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => setAll(!all)}>
          {all ? tr('Masquer') : tr('Voir les {length} semaines', { length: p.weeks!.length })}
        </button>
      )}
    </section>
  );
}
