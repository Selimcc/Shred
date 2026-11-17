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
import { tn, tr } from '../../shared/i18n';

const STEPS = [tr('Toi'), tr('Objectif'), tr('Sport'), tr('Salle'), tr('Assiette'), tr('Ton plan'), tr('Coach')];

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
      <div className="dots" aria-label={tr('Étape {n} sur {length}', { n: step + 1, length: STEPS.length })}>
        {STEPS.map((label, i) => (
          <span key={label} className={i <= step ? 'on' : ''} />
        ))}
      </div>

      {step === 0 && (
        <section className="stack">
          <h1>{tr('Faisons connaissance')}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {tr('Ça sert à calculer tes besoins et à donner du contexte au coach. Tout reste modifiable.')}
          </p>
          <Field label={tr('Prénom')}>
            <input className="input" autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <BodyForm athlete={athlete} body={body} onAthlete={setAthlete} onBody={setBody} />
        </section>
      )}

      {step === 1 && (
        <section className="stack">
          <h1>{tr('Ton objectif')}</h1>
          <GoalForm
            goal={goal}
            athlete={athlete}
            plan={plan}
            streakGoal={streakGoal}
            onGoal={setGoal}
            onAthlete={setAthlete}
            onStreakGoal={setStreakGoal}
          />
          {!plan && <p className="small muted">{tr('Indique âge, taille et poids à l’étape précédente pour avoir tes calories.')}</p>}
          <h1 style={{ marginTop: 18 }}>{tr('Le physique que tu vises')}</h1>
          <PhysiqueForm athlete={athlete} onAthlete={setAthlete} />
        </section>
      )}

      {step === 2 && (
        <section className="stack">
          <h1>{tr('Ton sport')}</h1>
          <SportForm athlete={athlete} onAthlete={setAthlete} />
        </section>
      )}

      {step === 3 && (
        <section className="stack">
          <h1>{tr('Ta salle')}</h1>
          <GymForm gym={gym} onGym={setGym} />
        </section>
      )}

      {step === 4 && (
        <section className="stack">
          <h1>{tr('Ton assiette')}</h1>
          <DietForm diet={athlete.diet} onDiet={(diet) => setAthlete({ ...athlete, diet })} />
        </section>
      )}

      {step === 5 && (
        <section className="stack" style={{ gap: 16 }}>
          <h1>{tr('Ton plan')}</h1>
          {plan && (
            <div className="card stack" style={{ gap: 4 }}>
              <div style={{ fontWeight: 850 }}>
                {tr('{n} kcal · {protein} g de protéines par jour', { n: formatNumber(plan.targets.kcal), protein: plan.targets.protein })}
              </div>
              <div className="small muted">
                {tr('Glucides {carbs} g, lipides {fat} g.', { carbs: plan.targets.carbs, fat: plan.targets.fat })}
                {plan.projection && (goal === 'cut' || goal === 'recomp') ? tr(' {targetBodyFat} % de masse grasse dans environ {weeks} semaines.', { targetBodyFat: athlete.targetBodyFat, weeks: plan.projection.weeks }) : ''}
              </div>
            </div>
          )}
          {built && (
            <div className="card stack" style={{ gap: 6 }}>
              <div style={{ fontWeight: 850 }}>
                <Icon name="dumbbell" size={18} /> {built.program.name}
              </div>
              <div className="small muted">
                {tr('{sportLabel}, {days} séances par semaine', { sportLabel: sportLabel(athlete), days: athlete.days })}
                {built.program.weeks ? tr(', {length} semaines jusqu’au jour J', { length: built.program.weeks.length }) : ''}.
              </div>
              {built.swaps.length > 0 && (
                <div className="small faint">
                  {tr('Adapté à ta salle : {join}', { join: built.swaps.slice(0, 3).map((x) => `${x.from} → ${x.to}`).join(', ') })}
                  {built.swaps.length > 3 ? tn(built.swaps.length - 3, ', et {n} autre', ', et {n} autres') : ''}.
                </div>
              )}
            </div>
          )}
          {meals && (
            <div className="card stack" style={{ gap: 6 }}>
              <Toggle
                title={tr('Créer mon meal plan')}
                text={tr('{length} repas pour {n} kcal par jour, préparation le dimanche et le mercredi, liste de courses.', { length: meals.meals.length, n: formatNumber(meals.prep.day.kcal) })}
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
          {!plan && <p className="small muted">{tr('Sans âge, taille et poids, les calories restent par défaut. Tu pourras les calculer dans Réglages, Profil sportif.')}</p>}
        </section>
      )}

      {step === 6 && (
        <section className="stack">
          <h1>{tr('Ton coach')}</h1>
          <ChoiceCard
            on={ai === 'claude'}
            title={tr('Claude, avec ton compte')}
            badge={tr('gratuit')}
            text={tr('Shred se branche sur Claude comme connecteur : il lit ton historique quand tu lui poses une question, avec ton propre compte (gratuit ou payant).')}
            onClick={() => setAi('claude')}
          />
          <ChoiceCard
            on={ai === 'api'}
            disabled={!apiOk}
            title={tr('Intégré à l’app')}
            text={apiOk ? tr('Photo de repas analysée toute seule, coach dans l’onglet. {aiLimit} requêtes par jour.', { aiLimit: server!.aiLimit }) : tr('Pas disponible sur ce serveur pour ton compte.')}
            onClick={() => setAi('api')}
          />
          <ChoiceCard on={ai === 'off'} title={tr('Sans IA')} text={tr('Tout se note à la main.')} onClick={() => setAi('off')} />
          <Field label={tr('Ce que le coach doit savoir (facultatif)')}>
            <textarea
              className="input"
              rows={3}
              style={{ resize: 'vertical' }}
              placeholder={tr('Blessures, horaires, sport à côté…')}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          {signedIn() && (
            <div className="group">
              <Toggle
                title={tr('Montrer mon profil aux autres testeurs')}
                text={tr('Ta série, tes flammes et ta fiche de force. Réglable dans Réglages, Profil public.')}
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
                  toast(tr('Notifications activées'));
                } catch (e) {
                  toast(errorText(e), true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon name="bell" size={18} /> {s.settings.pushEnabled ? tr('Rappels activés') : tr('Activer les rappels')}
            </button>
          )}
          {signedIn() && push.ios && !push.standalone && (
            <p className="small muted" style={{ margin: 0 }}>
              {tr('Rappels : ajoute d’abord l’app à l’écran d’accueil (Safari, Partager, « Sur l’écran d’accueil »), puis active-les dans Réglages, Rappels.')}
            </p>
          )}
        </section>
      )}

      <div className="onboarding-nav">
        {step > 0 && (
          <button className="btn" onClick={() => setStep(step - 1)} aria-label={tr('Étape précédente')}>
            ←
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button className="btn primary" style={{ flex: 1 }} onClick={next} disabled={step === 0 && !name.trim()}>
            {tr('Suivant')}
          </button>
        ) : (
          <button className="btn fire" style={{ flex: 1 }} onClick={finish}>
            {tr('C’est parti')}
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
          {step < 5 ? tr('Passer les questions') : tr('Passer')}
        </button>
      )}
    </main>
  );
}

