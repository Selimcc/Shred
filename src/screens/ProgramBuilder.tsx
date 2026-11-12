// Constructeur de programme : physique visé, priorités, rythme, sport. L'aperçu se met à jour en direct
// (séances, exercices, volume par muscle) et rien ne change tant que tu n'as pas appliqué.
import { useMemo, useState } from 'react';
import type { Athlete, Experience, RaceDistance, Sport } from '../../shared/athlete';
import { catalogEntry } from '../../shared/catalog';
import { PHYSIQUES, programVolume, regionName, targetsFor } from '../../shared/generator';
import { scheduleFor } from '../../shared/program';
import { Braise } from '../components/Braise';
import { Field } from '../components/form';
import { Icon } from '../components/Icon';
import { ask, toast } from '../components/ui';
import { applyProgram, programFor } from '../lib/coaching';
import { addDays, dayKey } from '../lib/date';
import { setState, useApp } from '../lib/store';
import { suggestPriorities } from '../lib/tweaks';
import { PhysiqueForm } from './AthleteForms';

const SHORT = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const chip = (on: boolean) => `chip ${on ? 'on' : ''}`;

const SPORT_CHOICES: { id: Sport; label: string }[] = [
  { id: 'strength', label: 'Muscu' },
  { id: 'mixed', label: 'Muscu + cardio' },
  { id: 'combat', label: 'Combat' },
  { id: 'running', label: 'Course' },
  { id: 'hyrox', label: 'Hyrox' },
];

export function ProgramBuilder({ onDone }: { onDone: () => void }) {
  const s = useApp();
  const today = dayKey();
  const [draft, setDraft] = useState<Athlete>(() => ({ ...s.settings.athlete, physique: s.settings.athlete.physique ?? 'aesthetic' }));
  const suggested = useMemo(() => suggestPriorities(s, today), []);
  const built = useMemo(() => programFor(draft, s.settings.gym, today, s), [draft, s.settings.gym]);
  const p = built.program;
  const week = scheduleFor(p, today);
  const volume = programVolume({ ...p, schedule: week }, s.customExercises);
  const targets = targetsFor(draft);
  const regions = (Object.keys(targets) as (keyof typeof targets)[]).filter((r) => targets[r] > 0 || volume[r] > 0);
  const race = draft.race;
  const dated = (draft.sport === 'running' || draft.sport === 'hyrox') && race?.date;

  const setSport = (sport: Sport) =>
    setDraft({
      ...draft,
      sport,
      race:
        sport === 'running'
          ? { ...race, distance: race?.distance && race.distance !== 'hyrox' ? race.distance : 'half', date: race?.date ?? addDays(today, 84) }
          : sport === 'hyrox'
            ? { ...race, distance: 'hyrox', date: race?.date ?? addDays(today, 84) }
            : race,
    });

  const apply = async () => {
    if (!(await ask(`Remplacer ton programme par « ${p.name} » ? Tes séances passées sont conservées, et l’ancien programme reste disponible pour revenir en arrière.`, 'Appliquer'))) return;
    setState((d) => void (d.settings.athlete = draft));
    applyProgram(p);
    toast(`Programme « ${p.name} » en place`);
    onDone();
  };

  const lifting = week.map((id, i) => ({ id, i })).filter(({ id }) => p.sessions.find((x) => x.id === id)?.type !== 'rest');
  const uniqueIds = [...new Set(lifting.map((x) => x.id))];

  return (
    <div className="stack builder" style={{ gap: 22 }}>
      <div className="builder-hero">
        <Braise mood="think" size={64} />
        <p style={{ margin: 0, fontWeight: 700 }}>
          Dis-moi le physique que tu vises et ton rythme : je construis le split, les exercices et le volume par muscle. Tu vois tout avant d’appliquer.
        </p>
      </div>

      <section className="stack">
        <h2>Le physique que tu vises</h2>
        <PhysiqueForm athlete={draft} onAthlete={setDraft} suggested={suggested} />
      </section>

      <section className="stack">
        <h2>Ton rythme</h2>
        <div className="chips" role="group" aria-label="Sport">
          {SPORT_CHOICES.map((x) => (
            <button key={x.id} type="button" className={chip(draft.sport === x.id)} onClick={() => setSport(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
        {draft.sport === 'running' && (
          <div className="chips" role="group" aria-label="Distance">
            {(
              [
                ['10k', '10 km'],
                ['half', 'Semi'],
                ['marathon', 'Marathon'],
              ] as [RaceDistance, string][]
            ).map(([id, label]) => (
              <button key={id} type="button" className={chip(race?.distance === id)} onClick={() => setDraft({ ...draft, race: { ...race!, distance: id } })}>
                {label}
              </button>
            ))}
          </div>
        )}
        {(draft.sport === 'running' || draft.sport === 'hyrox') && (
          <Field label="Date de la course">
            <input className="input" type="date" min={today} value={race?.date ?? ''} onChange={(e) => setDraft({ ...draft, race: { ...race!, date: e.target.value } })} />
          </Field>
        )}
        <div className="builder-row">
          <span className="small muted">Séances par semaine</span>
          <div className="chips">
            {[2, 3, 4, 5, 6].map((n) => (
              <button key={n} type="button" className={chip(draft.days === n)} onClick={() => setDraft({ ...draft, days: n })}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="builder-row">
          <span className="small muted">Minutes par séance</span>
          <div className="chips">
            {[45, 60, 75, 90].map((n) => (
              <button key={n} type="button" className={chip(draft.minutes === n)} onClick={() => setDraft({ ...draft, minutes: n })}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="builder-row">
          <span className="small muted">Niveau</span>
          <div className="chips">
            {(
              [
                ['beginner', 'Débutant'],
                ['intermediate', 'Intermédiaire'],
                ['advanced', 'Confirmé'],
              ] as [Experience, string][]
            ).map(([id, label]) => (
              <button key={id} type="button" className={chip(draft.experience === id)} onClick={() => setDraft({ ...draft, experience: id })}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="stack">
        <div className="section-head" style={{ marginBottom: 0 }}>
          <h2>Aperçu</h2>
          <span className="tag">{p.name}</span>
        </div>
        {dated && <p className="small muted" style={{ margin: 0 }}>Plan daté jusqu’au jour J. Voici la semaine en cours ; le renfo suit ton physique visé.</p>}
        <div className="week-strip">
          {WEEK_ORDER.map((d) => {
            const def = p.sessions.find((x) => x.id === week[d]);
            return (
              <div key={d} className={`week-cell ${def?.type ?? 'rest'}`}>
                <span className="faint">{SHORT[d]}</span>
                <b>{def?.type === 'rest' || !def ? '·' : def.name.split(' ')[0].slice(0, 5)}</b>
              </div>
            );
          })}
        </div>

        {uniqueIds.map((id) => {
          const def = p.sessions.find((x) => x.id === id)!;
          return (
            <div key={id} className="card stack preview-session" style={{ gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                <div style={{ fontWeight: 850 }}>{def.name}</div>
                <span className="small faint">{def.type === 'lifting' ? 'Muscu' : 'Cardio'}</span>
              </div>
              <div className="small muted">{def.focus}</div>
              <ol className="preview-list">
                {def.exercises.map((x) => (
                  <li key={x.key}>
                    <span>{catalogEntry(x.key, s.customExercises)?.name ?? x.key}</span>
                    <span className="num faint">
                      {x.sets ?? catalogEntry(x.key)?.defaults.sets ?? 1} × {x.reps ?? catalogEntry(x.key)?.defaults.reps ?? ''}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}

        {regions.some((r) => volume[r] > 0) && (
          <div className="card stack" style={{ gap: 10 }}>
            <div style={{ fontWeight: 850 }}>Séries par semaine et par muscle</div>
            {regions.map((r) => (
              <div key={r} className="vol-row">
                <span className="vol-name">
                  {regionName(r)}
                  {draft.priorities?.includes(r) && <Icon name="bolt" size={12} />}
                </span>
                <span className="vol-bar">
                  <i style={{ width: `${Math.min(100, (volume[r] / Math.max(1, targets[r], volume[r])) * 100)}%` }} className={volume[r] >= targets[r] - 1 ? 'ok' : 'low'} />
                  {targets[r] > 0 && <em style={{ left: `${Math.min(100, (targets[r] / Math.max(targets[r], volume[r])) * 100)}%` }} />}
                </span>
                <span className="num small">{volume[r]}</span>
              </div>
            ))}
            <p className="small faint" style={{ margin: 0 }}>
              Le trait marque la cible selon ton physique ({PHYSIQUES[draft.physique ?? 'aesthetic'].label.toLowerCase()}), ton niveau et tes priorités.
            </p>
          </div>
        )}

        {built.notes.map((n) => (
          <p key={n} className="small muted" style={{ margin: 0 }}>
            {n}
          </p>
        ))}
        {built.swaps.length > 0 && (
          <p className="small muted" style={{ margin: 0 }}>
            {built.swaps.length} exercice(s) adapté(s) au matériel de ta salle.
          </p>
        )}
      </section>

      <div className="builder-cta">
        <button className="btn primary block" onClick={apply}>
          <Icon name="sparkle" size={18} /> Appliquer ce programme
        </button>
      </div>
    </div>
  );
}
