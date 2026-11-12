// Premier lancement : qui tu es, ce que tu vises, ta salle et ce que tu manges. L'app en tire calories,
// programme et meal plan. Tout reste modifiable dans Réglages.
import { useEffect, useMemo, useState } from 'react';
import { type Athlete, DEFAULT_ATHLETE, type Gym, nutritionPlan, sportLabel, type WeightGoal } from '../../shared/athlete';
import { generateMealPlan } from '../../shared/meals';
import { ChoiceCard, Field, Toggle } from '../components/form';
import { Icon } from '../components/Icon';
import { errorText, toast } from '../components/ui';
import { api, type Health } from '../lib/api';
import { uploadBackup } from '../lib/backup';
import { programFor } from '../lib/coaching';
import { dayKey, formatNumber } from '../lib/date';
import { publishProfile } from '../lib/profile';
import { enablePush, pushSupport } from '../lib/push';
import { signedIn } from '../lib/session';
import { type AiMode, setState, useApp } from '../lib/store';
import { BodyForm, type Body, DietForm, GoalForm, GymForm, PhysiqueForm, SportForm } from './AthleteForms';

const STEPS = ['Toi', 'Objectif', 'Sport', 'Salle', 'Assiette', 'Ton plan', 'Coach'];

export function Onboarding() {
  const s = useApp();
  const [step, setStep] = useState(0);
  const lastWeight = Object.entries(s.body.weight).sort(([a], [b]) => b.localeCompare(a))[0]?.[1];
  const [name, setName] = useState(s.settings.name);
  const [body, setBody] = useState<Body>({ age: s.settings.age, height: s.settings.height, weight: lastWeight });
  const [athlete, setAthlete] = useState<Athlete>(s.settings.athlete ?? DEFAULT_ATHLETE);
  const [gym, setGym] = useState<Gym>(s.settings.gym);
  const [goal, setGoal] = useState<WeightGoal>(s.settings.weightGoal);
  const [streakGoal, setStreakGoal] = useState(s.settings.streakGoal || 7);
  const [withMeals, setWithMeals] = useState(true);
  const [ai, setAi] = useState<AiMode>('claude');
  const [notes, setNotes] = useState(s.settings.coachNotes);
  const [server, setServer] = useState<Health | null>(null);
  const [busy, setBusy] = useState(false);
  const push = pushSupport();
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);

  useEffect(() => {
    if (signedIn()) api<Health>('/api/health').then(setServer, () => undefined);
  }, []);
  const apiOk = Boolean(server && server.ai !== 'missing' && server.aiLimit > 0);

  const ready = body.weight && body.height && body.age && body.weight > 30 && body.weight < 250;
  const plan = useMemo(
    () => (ready ? nutritionPlan({ weight: body.weight!, height: body.height!, age: body.age!, goal, athlete }) : null),
    [ready, body.weight, body.height, body.age, goal, athlete],
  );
  const built = useMemo(() => (step >= 5 ? programFor(athlete, gym) : null), [step, athlete, gym]);
  const meals = useMemo(() => (step >= 5 && plan ? generateMealPlan(plan.targets, athlete) : null), [step, plan, athlete]);

  /** Enregistre tout le profil, le programme et, si demandé, le meal plan. */
  const commit = () => {
    setState((d) => {
      d.settings.name = name.trim().slice(0, 30);
      d.settings.age = body.age;
      d.settings.height = body.height;
      if (body.weight) d.body.weight[dayKey()] = body.weight;
      d.settings.athlete = athlete;
      d.settings.gym = gym;
      d.settings.weightGoal = goal;
      d.settings.streakGoal = streakGoal;
      if (plan) d.settings.targets = plan.targets;
      if (built) d.program = built.program;
      if (withMeals && meals) {
        d.mealPlan = [...meals.meals, ...d.mealPlan.filter((m) => m.slot === 'extra')];
        d.prep = meals.prep;
      }
      d.settings.ai = ai;
      d.settings.coachNotes = notes.trim().slice(0, 1200);
      // Les Raccourcis Santé et salle n'existent que sur iPhone.
      if (!ios) {
        d.settings.modules.health = false;
        d.settings.modules.gym = false;
      }
    });
  };

  const finish = () => {
    commit();
    setState((d) => void (d.settings.onboarded = true));
    void uploadBackup(true).catch(() => undefined);
    void publishProfile(true).catch(() => undefined);
  };

  const next = () => {
    if (step === 5) commit();
    setStep(step + 1);
    window.scrollTo({ top: 0 });
  };

  return (
    <main className="app welcome onboarding">
      <div className="dots" aria-label={`Étape ${step + 1} sur ${STEPS.length}`}>
        {STEPS.map((label, i) => (
          <span key={label} className={i <= step ? 'on' : ''} />
        ))}
      </div>

      {step === 0 && (
        <section className="stack">
          <h1>Faisons connaissance</h1>
          <p className="muted" style={{ margin: 0 }}>
            Ça sert à calculer tes besoins et à donner du contexte au coach. Tout reste modifiable.
          </p>
          <Field label="Prénom">
            <input className="input" autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <BodyForm athlete={athlete} body={body} onAthlete={setAthlete} onBody={setBody} />
        </section>
      )}

      {step === 1 && (
        <section className="stack">
          <h1>Ton objectif</h1>
          <GoalForm
            goal={goal}
            athlete={athlete}
            plan={plan}
            streakGoal={streakGoal}
            onGoal={setGoal}
            onAthlete={setAthlete}
            onStreakGoal={setStreakGoal}
          />
          {!plan && <p className="small muted">Indique âge, taille et poids à l’étape précédente pour avoir tes calories.</p>}
          <h1 style={{ marginTop: 18 }}>Le physique que tu vises</h1>
          <PhysiqueForm athlete={athlete} onAthlete={setAthlete} />
        </section>
      )}

      {step === 2 && (
        <section className="stack">
          <h1>Ton sport</h1>
          <SportForm athlete={athlete} onAthlete={setAthlete} />
        </section>
      )}

      {step === 3 && (
        <section className="stack">
          <h1>Ta salle</h1>
          <GymForm gym={gym} onGym={setGym} />
        </section>
      )}

      {step === 4 && (
        <section className="stack">
          <h1>Ton assiette</h1>
          <DietForm diet={athlete.diet} onDiet={(diet) => setAthlete({ ...athlete, diet })} />
        </section>
      )}

      {step === 5 && (
        <section className="stack" style={{ gap: 16 }}>
          <h1>Ton plan</h1>
          {plan && (
            <div className="card stack" style={{ gap: 4 }}>
              <div style={{ fontWeight: 850 }}>
                {formatNumber(plan.targets.kcal)} kcal · {plan.targets.protein} g de protéines par jour
              </div>
              <div className="small muted">
                Glucides {plan.targets.carbs} g, lipides {plan.targets.fat} g.
                {plan.projection && (goal === 'cut' || goal === 'recomp') ? ` ${athlete.targetBodyFat} % de masse grasse dans environ ${plan.projection.weeks} semaines.` : ''}
              </div>
            </div>
          )}
          {built && (
            <div className="card stack" style={{ gap: 6 }}>
              <div style={{ fontWeight: 850 }}>
                <Icon name="dumbbell" size={18} /> {built.program.name}
              </div>
              <div className="small muted">
                {sportLabel(athlete)}, {athlete.days} séances par semaine
                {built.program.weeks ? `, ${built.program.weeks.length} semaines jusqu’au jour J` : ''}.
              </div>
              {built.swaps.length > 0 && (
                <div className="small faint">
                  Adapté à ta salle : {built.swaps.slice(0, 3).map((x) => `${x.from} → ${x.to}`).join(', ')}
                  {built.swaps.length > 3 ? `, et ${built.swaps.length - 3} autre(s)` : ''}.
                </div>
              )}
            </div>
          )}
          {meals && (
            <div className="card stack" style={{ gap: 6 }}>
              <Toggle
                title="Créer mon meal plan"
                text={`${meals.meals.length} repas pour ${formatNumber(meals.prep.day.kcal)} kcal par jour, préparation le dimanche et le mercredi, liste de courses.`}
                on={withMeals}
                onChange={setWithMeals}
              />
              {withMeals && (
                <div className="small muted" style={{ padding: '0 16px 12px' }}>
                  {meals.meals.map((m) => m.label).join(' · ')}
                </div>
              )}
            </div>
          )}
          {!plan && <p className="small muted">Sans âge, taille et poids, les calories restent par défaut. Tu pourras les calculer dans Réglages, Profil sportif.</p>}
        </section>
      )}

      {step === 6 && (
        <section className="stack">
          <h1>Ton coach</h1>
          <ChoiceCard
            on={ai === 'claude'}
            title="App Claude"
            badge="gratuit"
            text="L’app prépare ta question avec ton contexte et l’ouvre dans Claude, avec ton propre compte (gratuit ou payant)."
            onClick={() => setAi('claude')}
          />
          <ChoiceCard
            on={ai === 'api'}
            disabled={!apiOk}
            title="Intégré à l’app"
            text={apiOk ? `Photo de repas analysée toute seule, coach dans l’onglet. ${server!.aiLimit} requêtes par jour.` : 'Pas disponible sur ce serveur pour ton compte.'}
            onClick={() => setAi('api')}
          />
          <ChoiceCard on={ai === 'off'} title="Sans IA" text="Tout se note à la main." onClick={() => setAi('off')} />
          <Field label="Ce que le coach doit savoir (facultatif)">
            <textarea
              className="input"
              rows={3}
              style={{ resize: 'vertical' }}
              placeholder="Blessures, horaires, sport à côté…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          {signedIn() && (
            <div className="group">
              <Toggle
                title="Montrer mon profil aux autres testeurs"
                text="Ta série, tes flammes et ta fiche de force. Réglable dans Réglages, Profil public."
                on={s.settings.profile.visible}
                onChange={(v) => setState((d) => void (d.settings.profile.visible = v))}
              />
            </div>
          )}
          {signedIn() && push.supported && !(push.ios && !push.standalone) && (
            <button
              className="btn block"
              disabled={busy || s.settings.pushEnabled}
              onClick={async () => {
                setBusy(true);
                try {
                  await enablePush();
                  toast('Notifications activées');
                } catch (e) {
                  toast(errorText(e), true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon name="bell" size={18} /> {s.settings.pushEnabled ? 'Rappels activés' : 'Activer les rappels'}
            </button>
          )}
          {signedIn() && push.ios && !push.standalone && (
            <p className="small muted" style={{ margin: 0 }}>
              Rappels : ajoute d’abord l’app à l’écran d’accueil (Safari, Partager, « Sur l’écran d’accueil »), puis active-les dans Réglages, Rappels.
            </p>
          )}
        </section>
      )}

      <div className="onboarding-nav">
        {step > 0 && (
          <button className="btn" onClick={() => setStep(step - 1)} aria-label="Étape précédente">
            ←
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button className="btn primary" style={{ flex: 1 }} onClick={next} disabled={step === 0 && !name.trim()}>
            Suivant
          </button>
        ) : (
          <button className="btn fire" style={{ flex: 1 }} onClick={finish}>
            C’est parti
          </button>
        )}
      </div>
      {step < STEPS.length - 1 && (
        <button
          className="link small"
          style={{ display: 'block', margin: '14px auto 0', color: 'var(--ink-2)' }}
          onClick={() => {
            if (step < 5) setStep(5);
            else finish();
          }}
          disabled={!name.trim()}
        >
          {step < 5 ? 'Passer les questions' : 'Passer'}
        </button>
      )}
    </main>
  );
}

