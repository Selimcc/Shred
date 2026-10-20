// Formulaires du profil sportif : partagés par l'accueil (brouillon validé à la fin) et les réglages (direct).
import {
  ACTIVITIES,
  type Activity,
  type Athlete,
  BODY_FAT_HINTS,
  type DietPrefs,
  EQUIPMENT,
  type Experience,
  type Gym,
  type GymChain,
  gymDefaults,
  GYMS,
  type Plan,
  type Sex,
  type Sport,
  WEIGHT_GOALS,
  type WeightGoal,
} from '../../shared/athlete';
import { fmtDuration, fmtPace, paces } from '../../shared/plans';
import { ChoiceCard, Field, NumberSetting, Toggle } from '../components/form';
import { addDays, dayKey, formatNumber } from '../lib/date';
import { STREAK_GOALS } from '../lib/flames';

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
      <div className="chips" role="group" aria-label="Sexe">
        {(
          [
            ['male', 'Homme'],
            ['female', 'Femme'],
          ] as [Sex, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" className={chip(athlete.sex === id)} onClick={() => onAthlete({ ...athlete, sex: id })}>
            {label}
          </button>
        ))}
      </div>
      <p className="small faint" style={{ margin: '-4px 0 0' }}>
        Sert uniquement au calcul des besoins (métabolisme, repères de masse grasse).
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <Field label="Âge">
          <NumberSetting label="Âge" value={body.age} onChange={(age) => onBody({ ...body, age })} />
        </Field>
        <Field label="Taille (cm)">
          <NumberSetting label="Taille" value={body.height} onChange={(height) => onBody({ ...body, height })} />
        </Field>
        <Field label="Poids (kg)">
          <NumberSetting label="Poids" value={body.weight} onChange={(weight) => onBody({ ...body, weight })} />
        </Field>
      </div>
      <Field label="Masse grasse estimée (%)" hint="Facultatif. Balance à impédance, pince, ou les repères ci-dessous.">
        <NumberSetting label="Masse grasse" value={athlete.bodyFat} onChange={(v) => onAthlete({ ...athlete, bodyFat: v && v > 3 && v < 60 ? v : undefined })} />
      </Field>
      {hints && (
        <div className="chips">
          {hints.map((h) => (
            <button key={h.bf} type="button" className={chip(athlete.bodyFat === h.bf)} style={{ textAlign: 'left' }} onClick={() => onAthlete({ ...athlete, bodyFat: h.bf })}>
              ~{h.bf} % · {h.text}
            </button>
          ))}
        </div>
      )}
      <h2 style={{ marginTop: 6 }}>Ton quotidien, hors sport</h2>
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
        <Field label="Masse grasse visée (%)" hint={athlete.bodyFat ? `Tu pars de ${athlete.bodyFat} %.` : 'Indique d’abord ta masse grasse actuelle pour avoir une projection.'}>
          <NumberSetting
            label="Masse grasse visée"
            value={athlete.targetBodyFat}
            onChange={(v) => onAthlete({ ...athlete, targetBodyFat: v && v > 3 && v < 50 ? v : undefined })}
          />
        </Field>
      )}
      {plan && (
        <div className="card stack" style={{ gap: 6 }}>
          <div style={{ fontWeight: 850 }}>
            {formatNumber(plan.targets.kcal)} kcal par jour · {plan.targets.protein} g de protéines
          </div>
          <div className="small muted">
            Maintien estimé : {formatNumber(plan.maintenance)} kcal. Glucides {plan.targets.carbs} g, lipides {plan.targets.fat} g.
            {plan.rate ? ` Rythme visé : ${plan.rate > 0 ? '+' : ''}${formatNumber(plan.rate, 2)} kg par semaine.` : ''}
          </div>
          {plan.projection && leaning && (
            <div className="small" style={{ color: 'var(--green)', fontWeight: 650 }}>
              {athlete.targetBodyFat} % de masse grasse vers {formatNumber(plan.projection.targetWeight, 1)} kg, en gardant ton muscle : environ {plan.projection.weeks}{' '}
              semaines, soit vers le {new Date(`${addDays(dayKey(), plan.projection.weeks * 7)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}.
            </div>
          )}
          <div className="small faint">Point de départ : ajuste après 2 à 3 semaines selon ta courbe de poids. Le bilan du lundi le fait pour toi.</div>
        </div>
      )}
      {onStreakGoal && (
        <>
          <h2 style={{ marginTop: 8 }}>Ta première flamme</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Combien de jours de suite pour la gagner ? Les suivantes viendront de plus en plus loin.
          </p>
          <div className="chips">
            {STREAK_GOALS.map((n) => (
              <button key={n} type="button" className={chip(streakGoal === n)} onClick={() => onStreakGoal(n)}>
                {n} jours{n === 7 ? ' (conseillé)' : ''}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const SPORTS: { id: Sport; title: string; text: string }[] = [
  { id: 'strength', title: 'Musculation', text: 'Prendre du muscle et de la force.' },
  { id: 'running', title: 'Course à pied', text: '10 km, semi-marathon ou marathon, avec un plan daté jusqu’à la course.' },
  { id: 'hyrox', title: 'Hyrox', text: '8 × 1 km de course et 8 stations : un plan hybride force et cardio.' },
  { id: 'mixed', title: 'Muscu et cardio', text: 'Garder la forme sans objectif de course.' },
];

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

export function SportForm({ athlete, onAthlete }: { athlete: Athlete; onAthlete: (a: Athlete) => void }) {
  const race = athlete.race;
  const isRun = athlete.sport === 'running';
  const isHyrox = athlete.sport === 'hyrox';
  const distance = isRun ? (race?.distance && race.distance !== 'hyrox' ? race.distance : 'half') : 'hyrox';
  const setRace = (patch: Partial<NonNullable<Athlete['race']>>) =>
    onAthlete({ ...athlete, race: { distance, date: race?.date ?? addDays(dayKey(), 7 * 12), ...race, ...patch } });
  const ref = race?.refSec ? { sec: race.refSec, km: race.refKm ?? 10 } : undefined;
  const p = isRun ? paces(distance === 'hyrox' ? 'half' : distance, athlete.experience, ref) : null;
  const weeksLeft = race?.date ? Math.round((Date.parse(race.date) - Date.parse(dayKey())) / (7 * 86_400_000)) : null;

  return (
    <div className="stack">
      {SPORTS.map((x) => (
        <ChoiceCard
          key={x.id}
          on={athlete.sport === x.id}
          title={x.title}
          text={x.text}
          onClick={() =>
            onAthlete({
              ...athlete,
              sport: x.id,
              race: x.id === 'running' ? { ...race, distance: race?.distance && race.distance !== 'hyrox' ? race.distance : 'half', date: race?.date ?? addDays(dayKey(), 84) } : x.id === 'hyrox' ? { ...race, distance: 'hyrox', date: race?.date ?? addDays(dayKey(), 84) } : race,
            })
          }
        />
      ))}

      {(isRun || isHyrox) && (
        <div className="card stack">
          {isRun && (
            <div className="chips" role="group" aria-label="Distance">
              {(
                [
                  ['10k', '10 km'],
                  ['half', 'Semi-marathon'],
                  ['marathon', 'Marathon'],
                ] as const
              ).map(([id, label]) => (
                <button key={id} type="button" className={chip(distance === id)} onClick={() => setRace({ distance: id })}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <Field label="Date de la course">
            <input className="input" type="date" min={dayKey()} value={race?.date ?? ''} onChange={(e) => setRace({ date: e.target.value })} />
          </Field>
          {weeksLeft !== null && weeksLeft < (distance === 'marathon' ? 12 : 8) && weeksLeft >= 0 && (
            <p className="small" style={{ margin: 0, color: 'var(--gold)' }}>
              {weeksLeft} semaines seulement : le plan sera raccourci. Pour un {distance === 'marathon' ? 'marathon' : 'objectif'} serein, compte {distance === 'marathon' ? '16' : '10 à 12'} semaines.
            </p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Chrono récent" hint="Ex. 52:30">
              <input
                className="input num"
                inputMode="numeric"
                placeholder="mm:ss"
                defaultValue={fmtTime(race?.refSec)}
                onBlur={(e) => setRace({ refSec: parseTime(e.target.value), refKm: race?.refKm ?? 10 })}
              />
            </Field>
            <Field label="Sur (km)">
              <select className="input" value={race?.refKm ?? 10} onChange={(e) => setRace({ refKm: Number(e.target.value) })}>
                {[5, 10, 21.1, 42.2].map((k) => (
                  <option key={k} value={k}>
                    {k === 21.1 ? 'Semi' : k === 42.2 ? 'Marathon' : `${k} km`}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {p && (
            <p className="small muted" style={{ margin: 0 }}>
              Objectif estimé : {fmtDuration(p.predicted)} ({fmtPace(p.race)}). Endurance à {fmtPace(p.easy[0])}–{fmtPace(p.easy[1])}, fractionné à {fmtPace(p.interval)}.
              {!ref && ' Sans chrono, on part d’une estimation selon ton niveau.'}
            </p>
          )}
        </div>
      )}

      <h2 style={{ marginTop: 6 }}>Ton niveau</h2>
      <div className="chips">
        {(
          [
            ['beginner', 'Débutant'],
            ['intermediate', 'Intermédiaire'],
            ['advanced', 'Confirmé'],
          ] as [Experience, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" className={chip(athlete.experience === id)} onClick={() => onAthlete({ ...athlete, experience: id })}>
            {label}
          </button>
        ))}
      </div>

      <h2 style={{ marginTop: 6 }}>Tes disponibilités</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Séances par semaine">
          <select className="input" value={athlete.days} onChange={(e) => onAthlete({ ...athlete, days: Number(e.target.value) })}>
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Minutes par séance">
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
  return (
    <div className="stack">
      <div className="chips">
        {GYMS.map((g) => (
          <button
            key={g.id}
            type="button"
            className={chip(gym.chain === g.id)}
            onClick={() => onGym({ ...gymDefaults(g.id as GymChain), club: gym.club })}
          >
            {g.name}
          </button>
        ))}
      </div>
      <Field label="Ton club (facultatif)" hint="Pour t’y retrouver, et pour les automatisations d’arrivée à la salle.">
        <input className="input" placeholder="Ex. Basic-Fit Sartrouville" value={gym.club ?? ''} onChange={(e) => onGym({ ...gym, club: e.target.value.slice(0, 60) })} />
      </Field>
      <p className="small muted" style={{ margin: 0 }}>
        Coche ce que ton club a vraiment : l’équipement change d’un club à l’autre, même dans une même chaîne. Les exercices impossibles sont remplacés
        automatiquement.
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
    </div>
  );
}

export function DietForm({ diet, onDiet }: { diet: DietPrefs; onDiet: (d: DietPrefs) => void }) {
  return (
    <div className="stack">
      <Field label="Repas par jour">
        <div className="chips">
          {([3, 4] as const).map((n) => (
            <button key={n} type="button" className={chip(diet.meals === n)} onClick={() => onDiet({ ...diet, meals: n })}>
              {n === 4 ? '3 repas + collation' : '3 repas'}
            </button>
          ))}
        </div>
      </Field>
      <div className="group">
        <Toggle title="Végétarien" text="Ni viande ni poisson." on={diet.vegetarian} onChange={(v) => onDiet({ ...diet, vegetarian: v })} />
        <Toggle title="Sans porc" text="" on={diet.noPork} onChange={(v) => onDiet({ ...diet, noPork: v })} />
        <Toggle title="Sans lactose" text="Pas de lait, skyr, fromage ni whey de lait." on={diet.lactoseFree} onChange={(v) => onDiet({ ...diet, lactoseFree: v })} />
        <Toggle title="Cuisine rapide" text="Des plats prêts en 15 minutes en semaine." on={diet.cook === 'quick'} onChange={(v) => onDiet({ ...diet, cook: v ? 'quick' : 'normal' })} />
        <Toggle title="Petit budget" text="Pas de saumon, d’amandes ni de produits chers." on={diet.budget === 'tight'} onChange={(v) => onDiet({ ...diet, budget: v ? 'tight' : 'normal' })} />
      </div>
      <Field label="Ce que tu ne manges pas" hint="Séparés par des virgules : saumon, champignons, pommes de terre…">
        <input className="input" value={diet.dislikes} onChange={(e) => onDiet({ ...diet, dislikes: e.target.value.slice(0, 200) })} />
      </Field>
    </div>
  );
}
