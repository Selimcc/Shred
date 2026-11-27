// Formulaires du profil sportif : partagés par l'accueil (brouillon validé à la fin) et les réglages (direct).
import {
  ACTIVITIES,
  type Activity,
  type Athlete,
  BODY_FAT_HINTS,
  type DietPrefs,
  EQUIPMENT,
  type EventDistance,
  EVENT_NAMES,
  type Experience,
  chainFromName,
  type Gym,
  GYM_KINDS,
  type GymPlace,
  gymDefaults,
  GYMS,
  type Plan,
  isEndurance,
  type Sex,
  type Sport,
  WEIGHT_GOALS,
  type WeightGoal,
} from '../../shared/athlete';
import { PHYSIQUES, type Physique, type Region, REGIONS } from '../../shared/generator';
import { cssFrom400, fmtSwim, zonesFor } from '../../shared/endurance';
import { fmtDuration, fmtPace, isRoadRace, paces } from '../../shared/plans';
import { useState } from 'react';
import { ChoiceCard, Field, NumberSetting, Toggle } from '../components/form';
import { GymFinder } from '../components/GymFinder';
import { Icon } from '../components/Icon';
import { addDays, dayKey, formatNumber } from '../lib/date';
import { STREAK_GOALS } from '../lib/flames';
import { loc, lower, pct, tn, tr } from '../../shared/i18n';

export interface Body {
  age?: number;
  height?: number;
  weight?: number;
}

const chip = (on: boolean) => `chip ${on ? 'on' : ''}`;

export function BodyForm({ athlete, body, onAthlete, onBody }: { athlete: Athlete; body: Body; onAthlete: (a: Athlete) => void; onBody: (b: Body) => void }) {
  const hints = athlete.sex ? BODY_FAT_HINTS[athlete.sex] : null;
  return (
    <div className="stack">
      <div className="chips" role="group" aria-label={tr('Sexe')}>
        {(
          [
            ['male', tr('Homme')],
            ['female', tr('Femme')],
          ] as [Sex, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" className={chip(athlete.sex === id)} onClick={() => onAthlete({ ...athlete, sex: id })}>
            {label}
          </button>
        ))}
      </div>
      <p className="small faint" style={{ margin: '-4px 0 0' }}>
        {tr('Sert uniquement au calcul des besoins (métabolisme, repères de masse grasse).')}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <Field label={tr('Âge')}>
          <NumberSetting label={tr('Âge')} value={body.age} onChange={(age) => onBody({ ...body, age })} />
        </Field>
        <Field label={tr('Taille (cm)')}>
          <NumberSetting label={tr('Taille')} value={body.height} onChange={(height) => onBody({ ...body, height })} />
        </Field>
        <Field label={tr('Poids (kg)')}>
          <NumberSetting label={tr('Poids')} value={body.weight} onChange={(weight) => onBody({ ...body, weight })} />
        </Field>
      </div>
      <Field label={tr('Masse grasse estimée (%)')} hint={tr('Facultatif. Balance à impédance, pince, ou les repères ci-dessous.')}>
        <NumberSetting label={tr('Masse grasse')} value={athlete.bodyFat} onChange={(v) => onAthlete({ ...athlete, bodyFat: v && v > 3 && v < 60 ? v : undefined })} />
      </Field>
      {hints && (
        <div className="chips">
          {hints.map((h) => (
            <button key={h.bf} type="button" className={chip(athlete.bodyFat === h.bf)} style={{ textAlign: 'left' }} onClick={() => onAthlete({ ...athlete, bodyFat: h.bf })}>
              ~{pct(h.bf)} · {h.text}
            </button>
          ))}
        </div>
      )}
      <h2 style={{ marginTop: 6 }}>{tr('Ton quotidien, hors sport')}</h2>
      <div className="chips">
        {(Object.keys(ACTIVITIES) as Activity[]).map((id) => (
          <button key={id} type="button" className={chip(athlete.activity === id)} onClick={() => onAthlete({ ...athlete, activity: id })}>
            {ACTIVITIES[id].label}
          </button>
        ))}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {ACTIVITIES[athlete.activity].text}
      </p>
    </div>
  );
}

export function GoalForm({
  goal,
  athlete,
  plan,
  streakGoal,
  onGoal,
  onAthlete,
  onStreakGoal,
}: {
  goal: WeightGoal;
  athlete: Athlete;
  plan: Plan | null;
  streakGoal?: number;
  onGoal: (g: WeightGoal) => void;
  onAthlete: (a: Athlete) => void;
  onStreakGoal?: (n: number) => void;
}) {
  const leaning = goal === 'cut' || goal === 'recomp';
  return (
    <div className="stack">
      {(Object.keys(WEIGHT_GOALS) as WeightGoal[]).map((g) => (
        <ChoiceCard key={g} on={goal === g} title={WEIGHT_GOALS[g].label} text={WEIGHT_GOALS[g].text} onClick={() => onGoal(g)} />
      ))}
      {leaning && (
        <Field label={tr('Masse grasse visée (%)')} hint={athlete.bodyFat ? tr('Tu pars de {bodyFat} %.', { bodyFat: athlete.bodyFat }) : tr('Indique d’abord ta masse grasse actuelle pour avoir une projection.')}>
          <NumberSetting
            label={tr('Masse grasse visée')}
            value={athlete.targetBodyFat}
            onChange={(v) => onAthlete({ ...athlete, targetBodyFat: v && v > 3 && v < 50 ? v : undefined })}
          />
        </Field>
      )}
      {plan && (
        <div className="card stack" style={{ gap: 6 }}>
          <div style={{ fontWeight: 850 }}>
            {tr('{n} kcal par jour · {protein} g de protéines', { n: formatNumber(plan.targets.kcal), protein: plan.targets.protein })}
          </div>
          <div className="small muted">
            {tr('Maintien estimé : {n} kcal. Glucides {carbs} g, lipides {fat} g.', { n: formatNumber(plan.maintenance), carbs: plan.targets.carbs, fat: plan.targets.fat })}
            {plan.rate ? tr(' Rythme visé : {v}{n} kg par semaine.', { v: plan.rate > 0 ? '+' : '', n: formatNumber(plan.rate, 2) }) : ''}
          </div>
          {plan.projection && leaning && (
            <div className="small" style={{ color: 'var(--green)', fontWeight: 650 }}>
              {tr('{targetBodyFat} % de masse grasse vers {n} kg, en gardant ton muscle : environ {weeks} semaines, soit vers le {toLocaleDateString}.', { targetBodyFat: athlete.targetBodyFat, n: formatNumber(plan.projection.targetWeight, 1), weeks: plan.projection.weeks, toLocaleDateString: new Date(`${addDays(dayKey(), plan.projection.weeks * 7)}T12:00:00`).toLocaleDateString(loc(), { day: 'numeric', month: 'long' }) })}
            </div>
          )}
          <div className="small faint">{tr('Point de départ : ajuste après 2 à 3 semaines selon ta courbe de poids. Le bilan du lundi le fait pour toi.')}</div>
        </div>
      )}
      {onStreakGoal && (
        <>
          <h2 style={{ marginTop: 8 }}>{tr('Ta première flamme')}</h2>
          <p className="small muted" style={{ margin: 0 }}>
            {tr('Combien de jours de suite pour la gagner ? Les suivantes viendront de plus en plus loin.')}
          </p>
          <div className="chips">
            {STREAK_GOALS.map((n) => (
              <button key={n} type="button" className={chip(streakGoal === n)} onClick={() => onStreakGoal(n)}>
                {tn(n, '{n} jour', '{n} jours')}{n === 7 ? tr(' (conseillé)') : ''}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const SPORTS: { id: Sport; title: string; text: string }[] = [
  { id: 'strength', title: tr('Musculation'), text: tr('Prendre du muscle et de la force.') },
  { id: 'running', title: tr('Course à pied'), text: tr('Footings, sorties longues, fractionné, côtes : du 5 km au marathon, ou pour progresser sans date.') },
  { id: 'triathlon', title: tr('Triathlon'), text: tr('Natation, vélo, course et enchaînements : du format S à l’Ironman.') },
  { id: 'swimming', title: tr('Natation'), text: tr('Éducatifs, séries au seuil, vitesse et nage continue, en piscine ou en eau libre.') },
  { id: 'cycling', title: tr('Vélo'), text: tr('Sorties longues, sweet spot, seuil et PMA, avec ou sans capteur de puissance.') },
  { id: 'hyrox', title: tr('Hyrox'), text: tr('8 × 1 km de course et 8 stations : un plan hybride force et cardio.') },
  { id: 'mixed', title: tr('Muscu et cardio'), text: tr('Physique et cardio dans la même semaine, sans objectif de course.') },
  { id: 'combat', title: tr('Sport de combat'), text: tr('MMA, boxe, grappling : force, puissance et cardio de combat, à côté de tes entraînements au club.') },
];

/** Les objectifs datés proposés pour chaque sport, avec la durée de préparation conseillée (semaines). */
export const EVENT_CHOICES: Partial<Record<Sport, { id: EventDistance; label: string; weeks: number }[]>> = {
  running: [
    { id: '5k', label: tr('5 km'), weeks: 6 },
    { id: '10k', label: tr('10 km'), weeks: 8 },
    { id: 'half', label: tr('Semi'), weeks: 12 },
    { id: 'marathon', label: tr('Marathon'), weeks: 16 },
  ],
  triathlon: [
    { id: 'tri-sprint', label: tr('S (sprint)'), weeks: 10 },
    { id: 'tri-olympic', label: tr('M (olympique)'), weeks: 12 },
    { id: 'tri-half', label: '70.3', weeks: 16 },
    { id: 'tri-full', label: tr('Ironman'), weeks: 20 },
  ],
  swimming: [
    { id: 'swim-1500', label: '1 500 m', weeks: 8 },
    { id: 'swim-5k', label: tr('5 km eau libre'), weeks: 12 },
  ],
  cycling: [
    { id: 'bike-100', label: tr('100 km'), weeks: 10 },
    { id: 'bike-160', label: tr('160 km'), weeks: 14 },
  ],
  hyrox: [{ id: 'hyrox', label: tr('Hyrox'), weeks: 12 }],
};

/** Le sport change : on garde la date si l'objectif reste valable, sinon on propose le format le plus courant. */
export function withSport(a: Athlete, sport: Sport): Athlete {
  const choices = EVENT_CHOICES[sport];
  if (!choices) return { ...a, sport };
  const keep = choices.some((c) => c.id === a.race?.distance);
  const distance = keep ? a.race!.distance : (choices[Math.min(1, choices.length - 1)].id as EventDistance);
  // Hyrox part d'une course en vue (12 semaines) ; les autres d'un bloc sans date. Tous peuvent changer ensuite.
  const date = keep ? a.race?.date : sport === 'hyrox' ? addDays(dayKey(), 84) : undefined;
  return { ...a, sport, days: isEndurance(sport) ? Math.max(a.days, sport === 'triathlon' ? 4 : 3) : Math.min(a.days, 6), race: { ...a.race, distance, date } };
}

function parseTime(text: string): number | undefined {
  const parts = text.trim().split(/[:h' ]+/).filter(Boolean).map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return undefined;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 60;
}

const fmtTime = (sec?: number) => {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

/** Objectif daté ou bloc sans date, distance, date et chronos de référence. */
export function EventForm({ athlete, onAthlete, compact = false }: { athlete: Athlete; onAthlete: (a: Athlete) => void; compact?: boolean }) {
  const choices = EVENT_CHOICES[athlete.sport];
  if (!choices) return null;
  const race = athlete.race;
  const distance = race?.distance ?? choices[0].id;
  const dated = Boolean(race?.date);
  const setRace = (patch: Partial<NonNullable<Athlete['race']>>) => onAthlete({ ...athlete, race: { distance, ...race, ...patch } });
  const spec = choices.find((c) => c.id === distance) ?? choices[0];
  const weeksLeft = race?.date ? Math.round((Date.parse(race.date) - Date.parse(dayKey())) / (7 * 86_400_000)) : null;
  const sport = athlete.sport;
  const runs = sport === 'running' || sport === 'triathlon' || sport === 'hyrox';
  const swims = sport === 'swimming' || sport === 'triathlon';
  const rides = sport === 'cycling' || sport === 'triathlon';
  const z = zonesFor(athlete);
  const ref = race?.refSec ? { sec: race.refSec, km: race.refKm ?? 10 } : undefined;
  const p = isRoadRace(distance) ? paces(distance, athlete.experience, ref) : null;

  return (
    <div className={compact ? 'stack' : 'card stack'}>
      <div className="seg" role="group" aria-label={tr('Objectif')}>
        <button type="button" className={dated ? 'on' : ''} onClick={() => setRace({ date: race?.date ?? addDays(dayKey(), spec.weeks * 7) })}>
          {tr('Une course en vue')}
        </button>
        <button type="button" className={!dated ? 'on' : ''} onClick={() => setRace({ date: undefined })}>
          {tr('Progresser sans date')}
        </button>
      </div>
      {dated ? (
        <>
          {choices.length > 1 && (
            <div className="chips" role="group" aria-label={tr('Format')}>
              {choices.map((c) => (
                <button key={c.id} type="button" className={chip(distance === c.id)} onClick={() => setRace({ distance: c.id })}>
                  {c.label}
                </button>
              ))}
            </div>
          )}
          <Field label={tr('Date de l’objectif')}>
            <input className="input" type="date" min={dayKey()} value={race?.date ?? ''} onChange={(e) => setRace({ date: e.target.value || undefined })} />
          </Field>
          {weeksLeft !== null && weeksLeft >= 0 && weeksLeft < spec.weeks - 2 && (
            <p className="small" style={{ margin: 0, color: 'var(--gold)' }}>
              {tr('{weeksLeft} semaines seulement : le plan sera raccourci. Pour {EVENT_NAMES}, compte {weeks} semaines de préparation.', { weeksLeft, EVENT_NAMES: lower(EVENT_NAMES[distance]), weeks: spec.weeks })}
            </p>
          )}
        </>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>
          {tr('Un bloc de 8 semaines qui monte par paliers, avec une semaine allégée toutes les 4. À la fin, Pulse te propose le suivant, un cran plus fort.')}
        </p>
      )}

      {!compact && runs && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label={tr('Chrono récent en course')} hint={tr('Ex. 52:30')}>
            <input
              className="input num"
              inputMode="numeric"
              placeholder="mm:ss"
              defaultValue={fmtTime(race?.refSec)}
              onBlur={(e) => setRace({ refSec: parseTime(e.target.value), refKm: race?.refKm ?? 10 })}
            />
          </Field>
          <Field label={tr('Sur')}>
            <select className="input" value={race?.refKm ?? 10} onChange={(e) => setRace({ refKm: Number(e.target.value) })}>
              {[5, 10, 21.1, 42.2].map((k) => (
                <option key={k} value={k}>
                  {k === 21.1 ? tr('Semi') : k === 42.2 ? tr('Marathon') : `${k} km`}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      {!compact && swims && (
        <Field label={tr('Ton temps sur 400 m nage libre')} hint={tr('Facultatif. Ex. 8:20 : sert à calculer ton allure seuil (CSS).')}>
          <input
            className="input num"
            inputMode="numeric"
            placeholder="mm:ss"
            defaultValue={athlete.swimPace ? fmtTime((athlete.swimPace - 3) * 4) : ''}
            onBlur={(e) => {
              const t = parseTime(e.target.value);
              onAthlete({ ...athlete, swimPace: t && t > 200 && t < 1200 ? cssFrom400(t) : undefined });
            }}
          />
        </Field>
      )}
      {!compact && rides && (
        <Field label={tr('Ta FTP (watts)')} hint={tr('Facultatif : la puissance que tu tiens une heure. Sans capteur, laisse vide.')}>
          <input
            className="input num"
            inputMode="numeric"
            placeholder={tr('ex. 230')}
            defaultValue={athlete.ftp ?? ''}
            onBlur={(e) => {
              const n = Number(e.target.value.replace(/\D/g, ''));
              onAthlete({ ...athlete, ftp: n >= 60 && n <= 600 ? n : undefined });
            }}
          />
        </Field>
      )}
      {!compact && (
        <p className="small muted" style={{ margin: 0 }}>
          {[
            p && dated ? tr('Objectif estimé : {duration} ({pace}).', { duration: fmtDuration(p.predicted), pace: fmtPace(p.race) }) : '',
            runs ? tr('Course : endurance {pace}–{pace2}, seuil {pace3}, fractionné {pace4}.', { pace: fmtPace(z.run.easy[0]), pace2: fmtPace(z.run.easy[1]), pace3: fmtPace(z.run.tempo), pace4: fmtPace(z.run.interval) }) : '',
            swims ? tr('Natation : seuil à {fmtSwim}{v}.', { fmtSwim: fmtSwim(z.swim.css), v: athlete.swimPace ? '' : tr(' (estimé)') }) : '',
            rides ? (z.bike.ftp ? tr('Vélo : endurance {n}–{n2} W, seuil {n3}–{n4} W.', { n: Math.round(z.bike.ftp * 0.56), n2: Math.round(z.bike.ftp * 0.75), n3: Math.round(z.bike.ftp * 0.95), n4: Math.round(z.bike.ftp * 1.05) }) : tr('Vélo : intensités en sensations et en % de FTP.')) : '',
          ]
            .filter(Boolean)
            .join(' ')}
        </p>
      )}
    </div>
  );
}

export function SportForm({ athlete, onAthlete }: { athlete: Athlete; onAthlete: (a: Athlete) => void }) {
  const maxDays = athlete.sport === 'triathlon' ? 7 : 6;
  return (
    <div className="stack">
      {SPORTS.map((x) => (
        <ChoiceCard key={x.id} on={athlete.sport === x.id} title={x.title} text={x.text} onClick={() => onAthlete(withSport(athlete, x.id))} />
      ))}

      <EventForm athlete={athlete} onAthlete={onAthlete} />

      <h2 style={{ marginTop: 6 }}>{tr('Ton niveau')}</h2>
      <div className="chips">
        {(
          [
            ['beginner', tr('Débutant')],
            ['intermediate', tr('Intermédiaire')],
            ['advanced', tr('Confirmé')],
          ] as [Experience, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" className={chip(athlete.experience === id)} onClick={() => onAthlete({ ...athlete, experience: id })}>
            {label}
          </button>
        ))}
      </div>

      <h2 style={{ marginTop: 6 }}>{tr('Tes disponibilités')}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label={tr('Séances par semaine')}>
          <select className="input" value={Math.min(athlete.days, maxDays)} onChange={(e) => onAthlete({ ...athlete, days: Number(e.target.value) })}>
            {Array.from({ length: maxDays - 1 }, (_, i) => i + 2).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label={isEndurance(athlete.sport) ? tr('Minutes en semaine') : tr('Minutes par séance')} hint={isEndurance(athlete.sport) ? tr('Les sorties longues du week-end vont au-delà.') : undefined}>
          <select className="input" value={athlete.minutes} onChange={(e) => onAthlete({ ...athlete, minutes: Number(e.target.value) })}>
            {[30, 45, 60, 75, 90].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </div>
  );
}

export function GymForm({ gym, onGym }: { gym: Gym; onGym: (g: Gym) => void }) {
  const [finding, setFinding] = useState(!gym.place && !gym.club);
  const [manual, setManual] = useState(false);
  const pick = (p: GymPlace & { brand?: string }) => {
    const chain = chainFromName(`${p.brand ?? ''} ${p.name}`);
    const base = chain ? gymDefaults(chain) : gym.chain === 'home' ? gymDefaults('other') : gym;
    onGym({ ...base, club: p.name, place: { id: p.id, name: p.name, lat: p.lat, lon: p.lon, ...(p.address ? { address: p.address } : {}) } });
    setFinding(false);
    setManual(false);
  };
  return (
    <div className="stack">
      {!finding && (gym.place || gym.club) ? (
        <div className="gym-picked">
          <span className="settings-icon">
            <Icon name="pin" size={18} />
          </span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="title ellipsis">{gym.place?.name ?? gym.club}</div>
            <div className="small muted ellipsis">{gym.place?.address ?? (gym.place ? tr('Position enregistrée') : tr('Nom seulement, sans position'))}</div>
          </div>
          <button type="button" className="btn small" onClick={() => setFinding(true)}>
            {tr('Changer')}
          </button>
        </div>
      ) : (
        <>
          <GymFinder onPick={pick} />
          {(manual || gym.club) && (
            <Field label={tr('Nom de ta salle')} hint={tr('Pour une salle absente de la carte. Sans position, pas de proposition de séance en arrivant.')}>
              <input
                className="input"
                placeholder={tr('Ex. Iron Gym Sousse')}
                value={gym.club ?? ''}
                onChange={(e) => onGym({ ...gym, club: e.target.value.slice(0, 60), place: undefined })}
              />
            </Field>
          )}
          {!manual && !gym.club && (
            <button type="button" className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => setManual(true)}>
              {tr('Ma salle n’est pas sur la carte : écrire son nom')}
            </button>
          )}
          {(gym.place || gym.club) && (
            <button type="button" className="btn block" onClick={() => setFinding(false)}>
              {tr('Garder')}{' '}{gym.place?.name ?? gym.club}
            </button>
          )}
        </>
      )}

      <Field label={tr('Type de salle')}>
        <div className="chips">
          {GYM_KINDS.map((id) => {
            const g = GYMS.find((x) => x.id === id)!;
            const on = gym.chain === id || (id === 'other' && ['fitness-park', 'basic-fit', 'on-air'].includes(gym.chain));
            return (
              <button key={id} type="button" className={chip(on)} onClick={() => onGym({ ...gymDefaults(id), club: gym.club, place: gym.place })}>
                {g.name}
              </button>
            );
          })}
        </div>
      </Field>
      <p className="small muted" style={{ margin: 0 }}>
        {tr('Coche ce que ta salle a vraiment : le matériel change d’une salle à l’autre. Les exercices impossibles sont remplacés automatiquement.')}
      </p>
      <div className="group">
        {EQUIPMENT.map((e) => (
          <Toggle
            key={e.id}
            title={e.name}
            text=""
            on={Boolean(gym.equipment[e.id])}
            onChange={(v) => onGym({ ...gym, equipment: { ...gym.equipment, [e.id]: v } })}
          />
        ))}
      </div>
      {gym.equipment.dumbbells && (
        <Field label={tr('Écart entre deux paires d’haltères')} hint={tr('Les charges conseillées tombent alors sur des haltères qui existent dans ta salle.')}>
          <div className="chips">
            {([1, 2, 2.5] as const).map((n) => (
              <button key={n} type="button" className={chip(gym.dumbbellStep === n)} onClick={() => onGym({ ...gym, dumbbellStep: gym.dumbbellStep === n ? undefined : n })}>
                {tr('{n} kg', { n: n.toLocaleString(loc()) })}
              </button>
            ))}
          </div>
        </Field>
      )}
    </div>
  );
}

export function DietForm({ diet, onDiet }: { diet: DietPrefs; onDiet: (d: DietPrefs) => void }) {
  return (
    <div className="stack">
      <Field label={tr('Repas par jour')}>
        <div className="chips">
          {([3, 4] as const).map((n) => (
            <button key={n} type="button" className={chip(diet.meals === n)} onClick={() => onDiet({ ...diet, meals: n })}>
              {n === 4 ? tr('3 repas + collation') : tr('3 repas')}
            </button>
          ))}
        </div>
      </Field>
      <div className="group">
        <Toggle title={tr('Végétarien')} text={tr('Ni viande ni poisson.')} on={diet.vegetarian} onChange={(v) => onDiet({ ...diet, vegetarian: v })} />
        <Toggle title={tr('Sans porc')} text="" on={diet.noPork} onChange={(v) => onDiet({ ...diet, noPork: v })} />
        <Toggle title={tr('Sans lactose')} text={tr('Pas de lait, skyr, fromage ni whey de lait.')} on={diet.lactoseFree} onChange={(v) => onDiet({ ...diet, lactoseFree: v })} />
        <Toggle title={tr('Cuisine rapide')} text={tr('Des plats prêts en 15 minutes en semaine.')} on={diet.cook === 'quick'} onChange={(v) => onDiet({ ...diet, cook: v ? 'quick' : 'normal' })} />
        <Toggle title={tr('Petit budget')} text={tr('Pas de saumon, d’amandes ni de produits chers.')} on={diet.budget === 'tight'} onChange={(v) => onDiet({ ...diet, budget: v ? 'tight' : 'normal' })} />
      </div>
      <Field label={tr('Ce que tu ne manges pas')} hint={tr('Séparés par des virgules : saumon, champignons, pommes de terre…')}>
        <input className="input" value={diet.dislikes} onChange={(e) => onDiet({ ...diet, dislikes: e.target.value.slice(0, 200) })} />
      </Field>
    </div>
  );
}

/** Le physique visé et les zones à prioriser : c'est ce qui oriente le split et le volume. */
export function PhysiqueForm({ athlete, onAthlete, suggested = [] }: { athlete: Athlete; onAthlete: (a: Athlete) => void; suggested?: Region[] }) {
  const current = athlete.physique ?? 'aesthetic';
  const prios = athlete.priorities ?? [];
  const toggle = (r: Region) => {
    const next = prios.includes(r) ? prios.filter((x) => x !== r) : [...prios, r].slice(-3);
    onAthlete({ ...athlete, priorities: next });
  };
  return (
    <div className="stack">
      <div className="physique-grid">
        {(Object.keys(PHYSIQUES) as Physique[]).map((id) => (
          <button key={id} type="button" className={`physique ${current === id ? 'on' : ''}`} onClick={() => onAthlete({ ...athlete, physique: id })}>
            <PhysiqueGlyph id={id} />
            <span className="physique-title">{PHYSIQUES[id].label}</span>
            <span className="physique-text">{PHYSIQUES[id].text}</span>
          </button>
        ))}
      </div>
      <h2 style={{ marginTop: 6 }}>{tr('Tes priorités')}</h2>
      <p className="small muted" style={{ margin: 0 }}>
        {tr('Jusqu’à 3 zones : elles passent en début de séance et reçoivent plus de séries.')}
        {suggested.length > 0 && tr(' Les zones marquées d’un point viennent de tes données (force et volume des dernières semaines).')}
      </p>
      <div className="chips">
        {REGIONS.map((r) => (
          <button key={r.id} type="button" className={chip(prios.includes(r.id))} onClick={() => toggle(r.id)}>
            {r.name}
            {suggested.includes(r.id) && <span className="dot-hint" aria-label={tr(' (suggéré)')} />}
          </button>
        ))}
      </div>
      {suggested.length > 0 && suggested.some((r) => !prios.includes(r)) && (
        <button type="button" className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => onAthlete({ ...athlete, priorities: [...new Set([...suggested, ...prios])].slice(0, 3) })}>
          {tr('Prendre les priorités suggérées')}
        </button>
      )}
    </div>
  );
}

const GLYPHS: Record<Physique, string> = {
  aesthetic: 'M14 6h12l4 6-3 22H13l-3-22 4-6ZM17 16h6M17 21h6M17 26h6M20 14v16',
  'v-taper': 'M6 7h28l-9 27h-10L6 7ZM20 7v27',
  mass: 'M9 8h22c3 0 4 3 3 7l-3 19H9L6 15c-1-4 0-7 3-7ZM14 16c3 2 9 2 12 0',
  strength: 'M4 20h32M8 13v14M12 11v18M28 11v18M32 13v14',
  athletic: 'M22 4 10 22h9l-2 14 13-19h-9l1-13Z',
  lower: 'M12 5h16l-1 10-3 20h-3l-1-16-1 16h-3l-3-20-1-10Z',
};

function PhysiqueGlyph({ id }: { id: Physique }) {
  return (
    <svg className={`physique-icon p-${id}`} viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
      <path d={GLYPHS[id]} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
