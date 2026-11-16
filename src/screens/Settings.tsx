import { useEffect, useRef, useState } from 'react';
import { HABIT_ICONS, SLOTS } from '../../shared/program';
import type { MealSlot } from '../../shared/types';
import { DossierCard } from '../components/Dossier';
import { EQUIPMENT, GYMS, sportLabel } from '../../shared/athlete';
import { missingEquipment } from '../../shared/plans';
import { adaptCurrentProgram, applyTargets } from '../lib/coaching';
import { GymForm } from './AthleteForms';
import { MealPlanner } from './MealPlanner';
import { ladder, STREAK_GOALS } from '../lib/flames';
import { publicData, publishProfile } from '../lib/profile';
import { ChoiceCard, Field, NumberSetting, Toggle } from '../components/form';
import { Icon } from '../components/Icon';
import { ask, errorText, Sheet, toast } from '../components/ui';
import { api, DEMO, type Health } from '../lib/api';
import { dayKey } from '../lib/date';
import { addHabit, addPlannedMeal, removeHabit, removePlannedMeal, updateHabit, updatePlannedMeal } from '../lib/program-edit';
import { disablePush, enablePush, pushConfig, pushSupport, testPush } from '../lib/push';
import { getSession, signedIn, useSession } from '../lib/session';
import {
  type AiMode,
  type AppState,
  getState,
  migrate,
  type Modules,
  type PublicProfileSettings,
  type ReminderType,
  replaceState,
  resetAll,
  setState,
  useApp,
  WEIGHT_GOALS,
  type WeightGoal,
} from '../lib/store';
import { AccountPage, TestersPage } from './Account';
import { HealthPage } from './HealthSetup';
import { ProgramEditor } from './ProgramEditor';
import { StravaPage } from './Connections';
import { isNative } from '../lib/native';
import { MyProfilePage } from './MyProfile';
import { MemberAvatar } from './Club';
import { useMe } from '../lib/me';
import { UsagePage } from './Usage';

export type SettingsPage =
  | 'menu'
  | 'profile'
  | 'program'
  | 'modules'
  | 'goals'
  | 'meals'
  | 'habits'
  | 'ai'
  | 'notifications'
  | 'health'
  | 'account'
  | 'testers'
  | 'publicProfile'
  | 'athlete'
  | 'gym'
  | 'mealplan'
  | 'report'
  | 'data'
  | 'strava'
  | 'usage';

const TITLES: Record<SettingsPage, string> = {
  menu: 'Réglages',
  profile: 'Mon profil',
  program: 'Mon programme',
  modules: 'Modules',
  goals: 'Objectifs',
  meals: 'Repas prévus',
  habits: 'Habitudes',
  ai: 'Intelligence artificielle',
  notifications: 'Rappels',
  health: 'Apple Santé et salle',
  account: 'Compte',
  testers: 'Testeurs',
  publicProfile: 'Profil public',
  athlete: 'Mon profil',
  gym: 'Ma salle',
  mealplan: 'Meal plan',
  report: 'Bilan de la semaine',
  data: 'Données',
  strava: 'Strava',
  usage: 'Cloudflare',
};

const AI_MODES: { id: AiMode; title: string; text: string }[] = [
  {
    id: 'api',
    title: 'API Claude',
    text: 'Automatique : photo analysée dans l’app, coach intégré. Payé à l’usage par la clé API du serveur, avec une limite par jour.',
  },
  {
    id: 'claude',
    title: 'App Claude',
    text: 'Gratuit : l’app prépare ta question avec ton contexte et ton historique utile, et l’ouvre dans Claude avec ton propre compte.',
  },
  { id: 'off', title: 'Sans IA', text: 'Tout se saisit à la main. L’onglet Coach disparaît.' },
];

const MODULES: { id: keyof Modules; title: string; text: string }[] = [
  { id: 'nutrition', title: 'Nutrition', text: 'Repas, calories, macros, onglet Repas.' },
  { id: 'habits', title: 'Habitudes', text: 'Petites cases à cocher chaque jour.' },
  { id: 'weight', title: 'Poids et tour de taille', text: 'Pesée du matin et courbe de poids.' },
  { id: 'strength', title: 'Fiche de force', text: 'Radar A à E par groupe musculaire.' },
  { id: 'health', title: 'Apple Santé', text: 'Pas et calories brûlées via un raccourci iPhone.' },
  { id: 'gym', title: 'Passages à la salle', text: 'Arrivée et départ détectés par l’iPhone.' },
];

const REMINDERS: { id: ReminderType; label: string; hint: string }[] = [
  { id: 'morning', label: 'Matin', hint: 'Séance du jour et série en cours' },
  { id: 'lunch', label: 'Midi', hint: 'Si ton déjeuner n’est pas noté' },
  { id: 'training', label: 'Séance', hint: 'Si ta séance n’est pas faite' },
  { id: 'evening', label: 'Soir', hint: 'Si ta journée n’est pas validée' },
];

export function Settings({ onClose, initialPage = 'menu' }: { onClose: () => void; initialPage?: SettingsPage }) {
  const s = useApp();
  const session = useSession();
  const [page, setPage] = useState<SettingsPage>(initialPage);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(null);
    }
  };

  /** En quittant une page qui change le planning ou les règles, on prévient le serveur des rappels. */
  const leave = () => {
    if ((page === 'program' || page === 'goals' || page === 'modules') && getState().settings.pushEnabled) {
      void pushConfig().catch(() => undefined);
    }
    if (page === 'menu' || initialPage !== 'menu') onClose();
    else setPage('menu');
  };

  const me = useMe();
  const mod = s.settings.modules;
  const [more, setMore] = useState(false);
  const strava = s.strava;
  type Row = { id: SettingsPage; icon: string; sub: string; show?: boolean };
  const groups: { title: string; rows: Row[] }[] = [
    {
      title: 'Entraînement',
      rows: [
        { id: 'program', icon: 'dumbbell', sub: s.program.name },
        { id: 'goals', icon: 'trophy', sub: `${WEIGHT_GOALS[s.settings.weightGoal].label}${mod.nutrition ? `, ${s.settings.targets.kcal} kcal` : ''}` },
        { id: 'gym', icon: 'wrench', sub: s.settings.gym.place?.name ?? s.settings.gym.club ?? GYMS.find((g) => g.id === s.settings.gym.chain)?.name ?? 'Trouver ma salle' },
      ],
    },
    {
      title: 'Au quotidien',
      rows: [
        { id: 'mealplan', icon: 'utensils', sub: s.prep ? 'Plan, préparation et courses' : 'Générer un plan adapté', show: mod.nutrition },
        { id: 'habits', icon: 'check', sub: s.habits.map((h) => h.name).join(', ') || 'Aucune', show: mod.habits },
        { id: 'notifications', icon: 'bell', sub: s.settings.pushEnabled ? 'Activés' : 'Désactivés', show: !DEMO },
      ],
    },
    {
      title: 'Connexions',
      rows: [
        { id: 'strava', icon: 'route', sub: strava?.athlete ? `Relié à ${strava.athlete}` : 'Importer tes sorties automatiquement', show: !DEMO },
        { id: 'health', icon: 'steps', sub: isNative() ? 'Directement depuis l’app iPhone' : 'Pas, sommeil, cœur, salle', show: !DEMO },
        { id: 'ai', icon: 'bolt', sub: AI_MODES.find((m) => m.id === s.settings.ai)!.title, show: !DEMO },
      ],
    },
    {
      title: 'Compte et club',
      rows: [
        {
          id: 'account',
          icon: 'lock',
          sub: session.account ? `${session.account.email}${session.account.expired ? ', session expirée' : ''}` : 'Sans compte, sur ce téléphone',
          show: !DEMO,
        },
        { id: 'publicProfile', icon: 'users', sub: s.settings.profile.visible ? 'Profil visible par le club' : 'Profil privé', show: !DEMO },
        { id: 'report', icon: 'chart', sub: s.settings.reportEmail ? 'Par mail chaque lundi' : 'Dans l’app chaque lundi', show: !DEMO },
        { id: 'usage', icon: 'pulse', sub: 'Plan gratuit : écritures, lectures, mode économie', show: !DEMO && session.account?.role === 'admin' },
      ],
    },
  ];
  const extra: Row[] = [
    { id: 'modules', icon: 'list', sub: `${Object.values(mod).filter(Boolean).length} sur ${MODULES.length} actifs` },
    { id: 'meals', icon: 'utensils', sub: `${s.mealPlan.length} repas`, show: mod.nutrition },
    { id: 'testers', icon: 'users', sub: 'Inviter, réinitialiser, retirer', show: !DEMO && session.account?.role === 'admin' },
    { id: 'data', icon: 'scale', sub: 'Export, import, remise à zéro', show: !DEMO },
  ];
  const rowButton = (r: Row) => (
    <button key={r.id} className="row settings-row" onClick={() => setPage(r.id)}>
      <span className="settings-icon">
        <Icon name={r.icon} size={18} />
      </span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="title">{TITLES[r.id]}</div>
        <div className="small muted ellipsis">{r.sub}</div>
      </div>
      <Icon name="chevron" size={18} />
    </button>
  );

  return (
    <Sheet title={TITLES[page]} onClose={onClose}>
      {page !== 'menu' && initialPage === 'menu' && (
        <button className="settings-back" onClick={leave}>
          <Icon name="chevron" size={18} /> Réglages
        </button>
      )}

      {page === 'menu' && (
        <div className="stack settings-menu">
          <button className="card settings-me" onClick={() => setPage('profile')}>
            <MemberAvatar m={{ id: me?.id ?? 'me', name: s.settings.name || '?', avatar: me?.avatar ?? null }} size={52} />
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="settings-me-name">{s.settings.name || 'Ton prénom'}</span>
              <span className="small muted ellipsis" style={{ display: 'block' }}>
                Mon profil : {sportLabel(s.settings.athlete).toLowerCase()}, corps, alimentation, coach
              </span>
            </span>
            <Icon name="chevron" size={18} />
          </button>
          {groups.map((g) => {
            const rows = g.rows.filter((r) => r.show !== false);
            if (!rows.length) return null;
            return (
              <section key={g.title}>
                <h3 className="settings-group">{g.title}</h3>
                <div className="group">{rows.map(rowButton)}</div>
              </section>
            );
          })}
          <section>
            <button className="settings-more small" onClick={() => setMore(!more)} aria-expanded={more}>
              {more ? 'Moins de réglages' : 'Plus de réglages'}
              <Icon name="chevron" size={15} />
            </button>
            {more && <div className="group">{extra.filter((r) => r.show !== false).map(rowButton)}</div>}
          </section>
        </div>
      )}

      {(page === 'profile' || page === 'athlete') && <MyProfilePage go={setPage} />}
      {page === 'program' && <ProgramEditor />}
      {page === 'modules' && <ModulesPage />}
      {page === 'goals' && <GoalsPage />}
      {page === 'meals' && <MealPlanPage />}
      {page === 'habits' && <HabitsPage />}
      {page === 'ai' && <AiPage />}
      {page === 'notifications' && <NotificationsPage busy={busy} run={run} />}
      {page === 'health' && <HealthPage />}
      {page === 'account' && <AccountPage onClose={onClose} />}
      {page === 'testers' && <TestersPage />}
      {page === 'publicProfile' && <PublicProfilePage />}
      {page === 'gym' && <GymPage />}
      {page === 'mealplan' && <MealPlanner />}
      {page === 'report' && <ReportPage />}
      {page === 'data' && <DataPage onReset={onClose} />}
      {page === 'strava' && <StravaPage />}
      {page === 'usage' && <UsagePage />}
    </Sheet>
  );
}

/* ---------- Pages ---------- */

const PROFILE_FIELDS: { id: keyof PublicProfileSettings['show']; title: string; text: string }[] = [
  { id: 'streak', title: 'Série actuelle', text: 'Le nombre de jours validés d’affilée.' },
  { id: 'best', title: 'Meilleure série', text: 'Ton record.' },
  { id: 'flames', title: 'Flammes', text: 'Les flammes gagnées et leur couleur.' },
  { id: 'level', title: 'Niveau', text: 'Ton niveau d’XP.' },
  { id: 'radar', title: 'Fiche de force', text: 'Tes notes A à E par groupe musculaire, points forts et faibles.' },
  { id: 'program', title: 'Programme', text: 'Le nom de ton split.' },
];

function PublicProfilePage() {
  const s = useApp();
  const p = s.settings.profile;
  const save = (mutate: (d: AppState) => void) => {
    setState(mutate);
    void publishProfile(true).catch((e) => toast(errorText(e), true));
  };
  const preview = publicData(s, dayKey());
  return (
    <div className="stack" style={{ gap: 18 }}>
      <p className="small muted" style={{ margin: 0 }}>
        Seuls les comptes de cette app, sur invitation, peuvent voir ton profil, et seulement ce que tu coches. Tes séances, repas et poids ne sont
        jamais montrés.
      </p>
      <div className="group">
        <Toggle
          title="Montrer mon profil"
          text={p.visible ? 'Visible dans Fiche, Testeurs.' : 'Privé : personne ne te voit.'}
          on={p.visible}
          onChange={(v) => save((d) => void (d.settings.profile.visible = v))}
        />
      </div>
      {p.visible && (
        <>
          <div className="group">
            {PROFILE_FIELDS.filter((f) => f.id !== 'radar' || s.settings.modules.strength).map((f) => (
              <Toggle
                key={f.id}
                title={f.title}
                text={f.text}
                on={p.show[f.id]}
                onChange={(v) => save((d) => void (d.settings.profile.show[f.id] = v))}
              />
            ))}
          </div>
          <p className="small faint" style={{ margin: 0 }}>
            Ce que les autres voient maintenant :{' '}
            {[
              preview.streak !== undefined && `série ${preview.streak} j`,
              preview.best !== undefined && `record ${preview.best} j`,
              preview.flames !== undefined && `${preview.flames} flamme(s)`,
              preview.level !== undefined && `niveau ${preview.level}`,
              preview.radar && 'fiche de force',
              preview.program && `programme « ${preview.program} »`,
            ]
              .filter(Boolean)
              .join(', ') || 'ton prénom seulement'}
            .
          </p>
        </>
      )}
    </div>
  );
}

function GymPage() {
  const s = useApp();
  const missing = missingEquipment(s.program, s.settings.gym);
  return (
    <div className="stack" style={{ gap: 18 }}>
      <GymForm gym={s.settings.gym} onGym={(g) => setState((d) => void (d.settings.gym = g))} />
      {missing.length > 0 ? (
        <div className="card stack" style={{ gap: 8 }}>
          <div className="small">Ton programme utilise du matériel que tu n’as pas coché ({missing.map((e) => EQUIPMENT.find((x) => x.id === e)?.name.toLowerCase()).join(', ')}).</div>
          <button
            className="btn primary block"
            onClick={() => {
              const swaps = adaptCurrentProgram();
              toast(swaps.length ? `${swaps.length} exercice(s) remplacé(s)` : 'Rien à changer');
            }}
          >
            Adapter mon programme à ma salle
          </button>
        </div>
      ) : (
        <p className="small faint" style={{ margin: 0 }}>
          Tout ton programme se fait dans cette salle.
        </p>
      )}
    </div>
  );
}

function ReportPage() {
  const s = useApp();
  const [server, setServer] = useState<Health | null>(null);
  useEffect(() => {
    if (signedIn()) api<Health>('/api/health').then(setServer, () => undefined);
  }, []);
  const ready = Boolean(server?.email);
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>
        Chaque lundi, l’app fait le bilan de ta semaine : séances, journées validées, calories, poids, records, et des ajustements à appliquer en un tap
        (calories, exercices pour ton point faible, variantes quand un exercice stagne). Il apparaît sur l’accueil et dans Fiche, Bilans.
      </p>
      <div className="group">
        <Toggle
          title="Recevoir le bilan par mail"
          text={server ? (ready ? `Envoyé le lundi à ${getSession().account?.email ?? 'ton adresse'}.` : 'Pas encore configuré sur le serveur.') : 'Vérification…'}
          on={s.settings.reportEmail && ready}
          onChange={(v) => setState((d) => void (d.settings.reportEmail = v))}
        />
      </div>
      {server && !ready && (
        <p className="small faint" style={{ margin: 0 }}>
          L’administrateur doit ajouter une clé Resend au serveur (guide « Mettre Shred en ligne », section Bilan par mail). En attendant, le bilan reste
          dans l’app.
        </p>
      )}
    </div>
  );
}

function ModulesPage() {
  const s = useApp();
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>
        Coupe ce qui ne te sert pas : l’app se simplifie, les onglets et les rappels suivent.
      </p>
      <div className="group">
        {MODULES.map((m) => (
          <Toggle
            key={m.id}
            title={m.title}
            text={m.text}
            on={s.settings.modules[m.id]}
            onChange={(v) => setState((d) => void (d.settings.modules[m.id] = v))}
          />
        ))}
      </div>
    </div>
  );
}

function GoalsPage() {
  const s = useApp();
  const g = s.settings.goal;
  return (
    <div className="stack" style={{ gap: 22 }}>
      <section className="stack">
        <h2>Valider une journée</h2>
        <div className="group">
          <Toggle
            title="Le sport compte"
            text="Les jours d’entraînement, la séance fait partie de la journée validée. Les jours de repos, rien à faire côté sport."
            on={g.workout}
            onChange={(v) => setState((d) => void (d.settings.goal.workout = v || d.settings.goal.minMeals === 0))}
          />
          {g.workout && (
            <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
              <div>
                <div className="title">Ce qui compte comme séance</div>
                <div className="small muted">
                  {(g.level ?? 'half') === 'half'
                    ? 'La moitié des séries cochées, une séance cardio commencée ou 30 min à la salle (avec Santé) suffisent.'
                    : 'Toutes les séries de la séance doivent être faites.'}
                </div>
              </div>
              <div className="seg" role="group" aria-label="Ce qui compte comme séance">
                {(
                  [
                    ['half', 'La moitié suffit'],
                    ['full', 'La séance entière'],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} type="button" className={(g.level ?? 'half') === id ? 'on' : ''} onClick={() => setState((d) => void (d.settings.goal.level = id))}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {s.settings.modules.nutrition && (
            <label className="row">
              <div className="grow">
                <div className="title">Repas à noter</div>
                <div className="small muted">Minimum de repas notés dans la journée.</div>
              </div>
              <select
                className="input"
                style={{ width: 90, minHeight: 40 }}
                value={g.minMeals}
                onChange={(e) =>
                  setState((d) => {
                    d.settings.goal.minMeals = Number(e.target.value);
                    if (d.settings.goal.minMeals === 0) d.settings.goal.workout = true;
                  })
                }
              >
                {[0, 1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>

      <section className="stack">
        <h2>Ma série</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Combien de jours tenir pour ta première flamme. Les suivantes s’espacent : {ladder(s.settings.streakGoal, 0).slice(0, 6).join(', ')} jours…
        </p>
        <div className="chips">
          {STREAK_GOALS.map((n) => (
            <button key={n} className={`chip ${s.settings.streakGoal === n ? 'on' : ''}`} onClick={() => setState((d) => void (d.settings.streakGoal = n))}>
              {n} jours
            </button>
          ))}
        </div>
      </section>

      <section className="stack">
        <h2>Poids</h2>
        <div className="chips">
          {(Object.keys(WEIGHT_GOALS) as WeightGoal[]).map((w) => (
            <button key={w} className={`chip ${s.settings.weightGoal === w ? 'on' : ''}`} onClick={() => setState((d) => void (d.settings.weightGoal = w))}>
              {WEIGHT_GOALS[w].label}
            </button>
          ))}
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {WEIGHT_GOALS[s.settings.weightGoal].text} Rythme visé : {WEIGHT_GOALS[s.settings.weightGoal].min.toLocaleString('fr-FR')} à{' '}
          {WEIGHT_GOALS[s.settings.weightGoal].max.toLocaleString('fr-FR')} kg par semaine.
        </p>
        <button
          className="btn small"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => {
            const plan = applyTargets();
            toast(plan ? `Objectif : ${plan.targets.kcal} kcal, ${plan.targets.protein} g de protéines` : 'Renseigne âge, taille et poids dans Profil sportif', !plan);
          }}
        >
          Recalculer mes calories
        </button>
      </section>

      {s.settings.modules.nutrition && (
        <section className="stack">
          <h2>Nutrition par jour</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {(
              [
                ['kcal', 'Calories'],
                ['protein', 'Protéines (g)'],
                ['carbs', 'Glucides (g)'],
                ['fat', 'Lipides (g)'],
              ] as const
            ).map(([k, label]) => (
              <Field label={label} key={k}>
                <NumberSetting value={s.settings.targets[k]} onChange={(v) => v !== undefined && setState((d) => void (d.settings.targets[k] = Math.round(v)))} />
              </Field>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function MealPlanPage() {
  const s = useApp();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="stack" style={{ gap: 20 }}>
      <p className="small muted" style={{ margin: 0 }}>
        Tes repas habituels. Ils se cochent en un tap sur l’accueil.
      </p>
      {SLOTS.map((slot) => {
        const meals = s.mealPlan.filter((m) => m.slot === slot.id);
        return (
          <section key={slot.id} className="stack">
            <div className="section-head" style={{ marginBottom: 0 }}>
              <h2>{slot.name}</h2>
              <button className="link small" onClick={() => setOpen(addPlannedMeal(slot.id as MealSlot))}>
                <Icon name="plus" size={15} /> Ajouter
              </button>
            </div>
            {meals.length > 0 && (
              <div className="group">
                {meals.map((m) => (
                  <div key={m.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <button
                      className="row"
                      style={{ width: '100%', border: 0, background: 'none', textAlign: 'left' }}
                      onClick={() => setOpen(open === m.id ? null : m.id)}
                    >
                      <div className="grow">
                        <div className="title">{m.label}</div>
                        <div className="small muted num">
                          {m.kcal} kcal, {m.protein} g P, {m.carbs} g G, {m.fat} g L
                        </div>
                      </div>
                      <Icon name="chevron" size={18} />
                    </button>
                    {open === m.id && (
                      <div style={{ padding: '0 16px 16px' }} className="stack">
                        <Field label="Nom">
                          <input className="input" defaultValue={m.label} onBlur={(e) => updatePlannedMeal(m.id, { label: e.target.value.trim() || m.label })} />
                        </Field>
                        <Field label="Détail (quantités)">
                          <input className="input" defaultValue={m.detail} onBlur={(e) => updatePlannedMeal(m.id, { detail: e.target.value.trim() })} />
                        </Field>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                          {(
                            [
                              ['kcal', 'kcal'],
                              ['protein', 'P (g)'],
                              ['carbs', 'G (g)'],
                              ['fat', 'L (g)'],
                            ] as const
                          ).map(([k, label]) => (
                            <Field label={label} key={k}>
                              <NumberSetting value={m[k]} onChange={(v) => v !== undefined && updatePlannedMeal(m.id, { [k]: Math.round(v) })} />
                            </Field>
                          ))}
                        </div>
                        <button className="btn small danger" style={{ alignSelf: 'flex-start' }} onClick={() => removePlannedMeal(m.id)}>
                          Supprimer ce repas
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function HabitsPage() {
  const s = useApp();
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>
        Touche l’icône pour la changer. L’habitude « pas » se coche toute seule avec Apple Santé.
      </p>
      <div className="group">
        {s.habits.map((h) => (
          <div className="row" key={h.id}>
            <button
              className="icon-btn"
              style={{ background: 'var(--surface-2)', width: 40, height: 40 }}
              aria-label="Changer l’icône"
              onClick={() => updateHabit(h.id, { icon: HABIT_ICONS[(HABIT_ICONS.indexOf(h.icon) + 1) % HABIT_ICONS.length] })}
            >
              <Icon name={h.icon} size={19} />
            </button>
            <input className="input" style={{ flex: 1, minWidth: 0 }} defaultValue={h.name} onBlur={(e) => updateHabit(h.id, { name: e.target.value.trim().slice(0, 30) || h.name })} aria-label="Nom de l’habitude" />
            <button className="icon-btn" style={{ background: 'transparent' }} aria-label={`Supprimer ${h.name}`} onClick={() => removeHabit(h.id)}>
              <Icon name="trash" size={18} />
            </button>
          </div>
        ))}
      </div>
      <button className="btn block" onClick={() => addHabit()}>
        <Icon name="plus" size={18} /> Ajouter une habitude
      </button>
    </div>
  );
}

function AiPage() {
  const s = useApp();
  const [server, setServer] = useState<Health | null>(null);
  useEffect(() => {
    if (signedIn()) api<Health>('/api/health').then(setServer, () => undefined);
  }, []);
  const apiOff = server ? server.ai === 'missing' || server.aiLimit === 0 : !signedIn() && !DEMO;
  return (
    <div className="stack">
      {AI_MODES.map((m) => (
        <ChoiceCard
          key={m.id}
          on={s.settings.ai === m.id}
          title={m.title}
          badge={m.id === 'claude' ? 'gratuit' : undefined}
          text={
            m.id === 'api' && apiOff
              ? 'Pas disponible pour ton compte sur ce serveur : choisis « App Claude ».'
              : m.id === 'api' && server
                ? `${m.text} ${server.aiLimit} requêtes par jour pour toi.`
                : m.text
          }
          disabled={m.id === 'api' && apiOff && s.settings.ai !== 'api'}
          onClick={() => setState((d) => void (d.settings.ai = m.id))}
        />
      ))}
      {s.settings.ai === 'claude' && <DossierCard today={dayKey()} />}
    </div>
  );
}

function NotificationsPage({ busy, run }: { busy: string | null; run: (k: string, fn: () => Promise<void>) => void }) {
  const s = useApp();
  const support = pushSupport();
  const sync = () => run('config', () => pushConfig());
  return (
    <div className="stack">
      {support.reason && (
        <p className="small muted" style={{ margin: 0 }}>
          {support.reason}
        </p>
      )}
      {support.supported && (
        <div style={{ display: 'flex', gap: 10 }}>
          {s.settings.pushEnabled ? (
            <>
              <button className="btn" style={{ flex: 1 }} disabled={!!busy} onClick={() => run('test', testPush)}>
                Envoyer un test
              </button>
              <button className="btn danger" disabled={!!busy} onClick={() => run('off', disablePush)}>
                Désactiver
              </button>
            </>
          ) : (
            <button
              className="btn primary block"
              disabled={!!busy}
              onClick={() =>
                run('on', async () => {
                  await enablePush();
                  toast('Notifications activées');
                })
              }
            >
              Activer les rappels
            </button>
          )}
        </div>
      )}
      <div className="group">
        {REMINDERS.filter((r) => r.id !== 'lunch' || s.settings.modules.nutrition).map((r) => {
          const cfg = s.settings.reminders[r.id];
          return (
            <div className="row" key={r.id}>
              <input
                type="checkbox"
                checked={cfg.on}
                aria-label={`Rappel ${r.label}`}
                style={{ width: 22, height: 22, accentColor: 'var(--blue)' }}
                onChange={(e) => {
                  setState((d) => void (d.settings.reminders[r.id].on = e.target.checked));
                  sync();
                }}
              />
              <div className="grow">
                <div className="title">{r.label}</div>
                <div className="small muted">{r.hint}</div>
              </div>
              <input
                type="time"
                className="input"
                style={{ width: 108, minHeight: 40 }}
                value={cfg.time}
                step={900}
                onChange={(e) => setState((d) => void (d.settings.reminders[r.id].time = e.target.value))}
                onBlur={sync}
                aria-label={`Heure du rappel ${r.label}`}
              />
            </div>
          );
        })}
      </div>
      <p className="small faint" style={{ margin: 0 }}>
        Les rappels partent par tranches de 15 minutes. Ils s’arrêtent dès que ta journée est validée.
      </p>
    </div>
  );
}

function DataPage({ onReset }: { onReset: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>
        Avec un compte, tes données sont déjà sauvegardées toutes seules (Réglages, Compte). L’export sert à garder une copie à toi, en fichier.
      </p>
      <div style={{ display: DEMO ? 'none' : 'flex', gap: 10 }}>
        <button className="btn" style={{ flex: 1 }} onClick={exportData}>
          Exporter
        </button>
        <button className="btn" style={{ flex: 1 }} onClick={() => fileRef.current?.click()}>
          Importer
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const data = JSON.parse(await f.text()) as AppState;
            if (data.version !== 1 || !data.days) throw new Error('Fichier non reconnu');
            if (!(await ask('Remplacer toutes les données de ce téléphone par cette sauvegarde ?', 'Remplacer', true))) return;
            const next = migrate(data);
            next.settings.pushEnabled = getState().settings.pushEnabled;
            replaceState(next);
            toast('Sauvegarde importée');
          } catch (err) {
            toast(errorText(err), true);
          }
        }}
      />
      <button
        className="btn danger block"
        onClick={async () => {
          if (await ask('Effacer toutes tes données (séances, repas, série, programme), sur ce téléphone et dans ta sauvegarde ? Action irréversible.', 'Tout effacer', true)) {
            resetAll();
            onReset();
          }
        }}
      >
        Tout effacer
      </button>
    </div>
  );
}

/* ---------- Petits composants ---------- */

function exportData() {
  const { settings, ...rest } = getState();
  const data = { ...rest, settings: { ...settings, shortcutKey: undefined } };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `shred-sauvegarde-${dayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
