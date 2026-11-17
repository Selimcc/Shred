import { useEffect, useRef, useState } from 'react';
import { canMorph, type NavDir, navigate } from '../lib/nav';
import { HABIT_ICONS, SLOTS } from '../../shared/program';
import type { MealSlot } from '../../shared/types';
import { ConnectorCard } from '../components/Connector';
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
import { dayKey, formatShort } from '../lib/date';
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
  type SeasonPref,
  WEIGHT_GOALS,
  type WeightGoal,
} from '../lib/store';
import { isSeasonId, nextStart, SEASON_IDS, SEASONS, seasonOn } from '../../shared/season';
import { Pulse } from '../components/Pulse';
import { playSeasonScene } from '../components/SeasonScene';
import { activeSeason } from '../lib/season';
import { AccountPage, TestersPage } from './Account';
import { HealthPage } from './HealthSetup';
import { ProgramEditor } from './ProgramEditor';
import { StravaPage } from './Connections';
import { isNative } from '../lib/native';
import { MyProfilePage } from './MyProfile';
import { MemberAvatar } from './Club';
import { useMe } from '../lib/me';
import { club } from '../lib/club';
import { UsagePage } from './Usage';
import { AdminPanel } from './AdminPanel';
import { LANGS, loc, lower, tn, tr, type Lang } from '../../shared/i18n';
import { chooseLang, deviceLang, savedLang } from '../i18n';

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
  | 'admin'
  | 'publicProfile'
  | 'athlete'
  | 'gym'
  | 'mealplan'
  | 'report'
  | 'data'
  | 'strava'
  | 'usage'
  | 'theme'
  | 'language';

const TITLES: Record<SettingsPage, string> = {
  menu: tr('Réglages'),
  profile: tr('Mon profil'),
  program: tr('Mon programme'),
  modules: tr('Modules'),
  goals: tr('Objectifs'),
  meals: tr('Repas prévus'),
  habits: tr('Habitudes'),
  ai: tr('Intelligence artificielle'),
  notifications: tr('Rappels'),
  health: tr('Apple Santé et salle'),
  account: tr('Compte'),
  testers: tr('Invitations'),
  admin: tr('Panneau admin'),
  publicProfile: tr('Profil public'),
  athlete: tr('Mon profil'),
  gym: tr('Ma salle'),
  mealplan: tr('Meal plan'),
  report: tr('Bilan de la semaine'),
  data: tr('Données'),
  strava: tr('Strava'),
  usage: tr('Cloudflare'),
  theme: tr('Thème de saison'),
  language: tr('Langue'),
};

const AI_MODES: { id: AiMode; title: string; text: string }[] = [
  {
    id: 'api',
    title: tr('API Claude'),
    text: tr('Automatique : photo analysée dans l’app, coach intégré. Payé à l’usage par la clé API du serveur, avec une limite par jour.'),
  },
  {
    id: 'claude',
    title: tr('Claude, avec ton compte'),
    text: tr('Gratuit pour toi : Shred devient un connecteur dans Claude, qui lit ton historique quand tu lui poses une question, avec ton abonnement (même gratuit).'),
  },
  { id: 'off', title: tr('Sans IA'), text: tr('Tout se saisit à la main. L’onglet Coach disparaît.') },
];

const MODULES: { id: keyof Modules; title: string; text: string }[] = [
  { id: 'nutrition', title: tr('Nutrition'), text: tr('Repas, calories, macros, onglet Repas.') },
  { id: 'habits', title: tr('Habitudes'), text: tr('Petites cases à cocher chaque jour.') },
  { id: 'weight', title: tr('Poids et tour de taille'), text: tr('Pesée du matin et courbe de poids.') },
  { id: 'strength', title: tr('Fiche de force'), text: tr('Radar A à E par groupe musculaire.') },
  { id: 'health', title: tr('Apple Santé'), text: tr('Pas et calories brûlées via un raccourci iPhone.') },
  { id: 'gym', title: tr('Passages à la salle'), text: tr('Arrivée et départ détectés par l’iPhone.') },
];

const REMINDERS: { id: ReminderType; label: string; hint: string }[] = [
  { id: 'morning', label: tr('Matin'), hint: tr('Séance du jour et série en cours') },
  { id: 'lunch', label: tr('Midi'), hint: tr('Si ton déjeuner n’est pas noté') },
  { id: 'training', label: tr('Séance'), hint: tr('Si ta séance n’est pas faite') },
  { id: 'evening', label: tr('Soir'), hint: tr('Si ta journée n’est pas validée') },
];

export function Settings({ onClose, initialPage = 'menu' }: { onClose: () => void; initialPage?: SettingsPage }) {
  const s = useApp();
  const session = useSession();
  // Pile des pages ouvertes : « retour » revient à la page d'avant (Mon profil, puis Réglages).
  const [stack, setStack] = useState<SettingsPage[]>([initialPage]);
  const [dir, setDir] = useState<NavDir>('forward');
  const page = stack[stack.length - 1];
  const sheetTop = () => document.querySelector('.sheet')?.scrollTo({ top: 0 });
  const setPage = (next: SettingsPage) => {
    if (next === page) return;
    const back = next === 'menu';
    navigate(() => {
      setDir(back ? 'back' : 'forward');
      setStack((st) => (back ? ['menu'] : [...st, next]));
      sheetTop();
    }, back ? 'back' : 'forward');
  };
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
    if (stack.length === 1) return onClose();
    navigate(() => {
      setDir('back');
      setStack((st) => st.slice(0, -1));
      sheetTop();
    }, 'back');
  };

  const me = useMe();
  const mod = s.settings.modules;
  const [more, setMore] = useState(false);
  const strava = s.strava;
  type Row = { id: SettingsPage; icon: string; sub: string; show?: boolean };
  const groups: { title: string; rows: Row[] }[] = [
    {
      title: tr('Entraînement'),
      rows: [
        { id: 'program', icon: 'dumbbell', sub: tr(s.program.name) },
        { id: 'goals', icon: 'trophy', sub: `${WEIGHT_GOALS[s.settings.weightGoal].label}${mod.nutrition ? tr(', {kcal} kcal', { kcal: s.settings.targets.kcal }) : ''}` },
        { id: 'gym', icon: 'wrench', sub: s.settings.gym.place?.name ?? s.settings.gym.club ?? GYMS.find((g) => g.id === s.settings.gym.chain)?.name ?? tr('Trouver ma salle') },
      ],
    },
    {
      title: tr('Au quotidien'),
      rows: [
        { id: 'mealplan', icon: 'utensils', sub: s.prep ? tr('Plan, préparation et courses') : tr('Générer un plan adapté'), show: mod.nutrition },
        { id: 'habits', icon: 'check', sub: s.habits.map((h) => tr(h.name)).join(', ') || tr('Aucune'), show: mod.habits },
        { id: 'notifications', icon: 'bell', sub: s.settings.pushEnabled ? tr('Activés') : tr('Désactivés'), show: !DEMO },
        { id: 'theme', icon: 'sparkle', sub: themeSub(s) },
        { id: 'language', icon: 'globe', sub: langSub() },
      ],
    },
    {
      title: tr('Connexions'),
      rows: [
        { id: 'strava', icon: 'route', sub: strava?.athlete ? tr('Relié à {athlete}', { athlete: strava.athlete }) : tr('Importer tes sorties automatiquement'), show: !DEMO },
        { id: 'health', icon: 'steps', sub: isNative() ? tr('Directement depuis l’app iPhone') : tr('Pas, sommeil, cœur, salle'), show: !DEMO },
        { id: 'ai', icon: 'bolt', sub: AI_MODES.find((m) => m.id === s.settings.ai)!.title, show: !DEMO },
      ],
    },
    {
      title: tr('Compte et club'),
      rows: [
        {
          id: 'account',
          icon: 'lock',
          sub: session.account ? `${session.account.email}${session.account.expired ? tr(', session expirée') : ''}` : tr('Sans compte, sur ce téléphone'),
          show: !DEMO,
        },
        { id: 'publicProfile', icon: 'users', sub: tr('Compte privé, demandes, stats visibles'), show: !DEMO },
        { id: 'report', icon: 'chart', sub: s.settings.reportEmail ? tr('Par mail chaque lundi') : tr('Dans l’app chaque lundi'), show: !DEMO },
        { id: 'admin', icon: 'users', sub: tr('Tous les testeurs, qui est en ligne, appareils'), show: !DEMO && session.account?.role === 'admin' },
        { id: 'testers', icon: 'share', sub: tr('Inviter une personne ou un groupe'), show: !DEMO && session.account?.role === 'admin' },
        { id: 'usage', icon: 'pulse', sub: tr('Plan gratuit : écritures, lectures, mode économie'), show: !DEMO && session.account?.role === 'admin' },
      ],
    },
  ];
  const extra: Row[] = [
    { id: 'modules', icon: 'list', sub: tr('{length} sur {length2} actifs', { length: Object.values(mod).filter(Boolean).length, length2: MODULES.length }) },
    { id: 'meals', icon: 'utensils', sub: tn(s.mealPlan.length, '{n} repas', '{n} repas'), show: mod.nutrition },
    { id: 'data', icon: 'scale', sub: tr('Export, import, remise à zéro'), show: !DEMO },
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
      <div key={page} className={`settings-pane ${canMorph() ? '' : `pane-${dir}`}`}>
      {stack.length > 1 && (
        <button className="settings-back" onClick={leave}>
          <Icon name="chevron" size={18} /> {TITLES[stack[stack.length - 2]]}
        </button>
      )}

      {page === 'menu' && (
        <div className="stack settings-menu">
          <button className="card settings-me" onClick={() => setPage('profile')}>
            <MemberAvatar m={{ id: me?.id ?? 'me', name: s.settings.name || '?', avatar: me?.avatar ?? null }} size={52} />
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="settings-me-name">{s.settings.name || tr('Ton prénom')}</span>
              <span className="small muted ellipsis" style={{ display: 'block' }}>
                {tr('Mon profil : {sportLabel}, corps, alimentation, coach', { sportLabel: lower(sportLabel(s.settings.athlete)) })}
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
              {more ? tr('Moins de réglages') : tr('Plus de réglages')}
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
      {page === 'admin' && <AdminPanel />}
      {page === 'publicProfile' && <PublicProfilePage />}
      {page === 'gym' && <GymPage />}
      {page === 'mealplan' && <MealPlanner />}
      {page === 'report' && <ReportPage />}
      {page === 'data' && <DataPage onReset={onClose} />}
      {page === 'strava' && <StravaPage />}
      {page === 'usage' && <UsagePage />}
      {page === 'theme' && <ThemePage />}
      {page === 'language' && <LanguagePage />}
      </div>
    </Sheet>
  );
}

/* ---------- Pages ---------- */

/** La ligne sous « Langue » : la langue choisie, ou celle du téléphone. */
function langSub(): string {
  const choice = savedLang();
  const name = (l: Lang) => LANGS.find((x) => x.id === l)!.name;
  return choice === 'auto' ? tr('Automatique : {lang}', { lang: name(deviceLang().lang) }) : name(choice);
}

/** Choix de la langue : automatique (celle du téléphone) ou une des six, chacune écrite dans sa langue. */
function LanguagePage() {
  const choice = savedLang();
  const device = deviceLang().lang;
  const options: { id: Lang | 'auto'; title: string; sub?: string }[] = [
    { id: 'auto', title: tr('Automatique'), sub: tr('La langue de ton téléphone : {lang}', { lang: LANGS.find((x) => x.id === device)!.name }) },
    ...LANGS.map((l) => ({ id: l.id, title: l.name })),
  ];
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="group">
        {options.map((o) => (
          <button
            key={o.id}
            className="row"
            lang={o.id === 'auto' ? undefined : o.id}
            style={{ width: '100%', border: 0, background: 'none', textAlign: 'left' }}
            onClick={() => o.id !== choice && chooseLang(o.id)}
          >
            <div className="grow">
              <div className="title">{o.title}</div>
              {o.sub && <div className="small muted">{o.sub}</div>}
            </div>
            {choice === o.id && <Icon name="check" />}
          </button>
        ))}
      </div>
      <p className="small faint" style={{ margin: 0 }}>
        {tr('L’app redémarre dans la langue choisie. Tes séances, tes repas et tes noms de programme restent tels que tu les as écrits.')}
      </p>
    </div>
  );
}

/** La ligne sous « Thème de saison » dans le menu. */
function themeSub(s: AppState): string {
  const pref = s.settings.season ?? 'auto';
  if (pref === 'off') return tr('Désactivé');
  if (isSeasonId(pref)) return tr('Aperçu : {name}', { name: SEASONS[pref].name });
  const today = dayKey();
  const now = seasonOn(today);
  if (now) return tr('{name} en ce moment', { name: SEASONS[now].name });
  const next = [...SEASON_IDS].sort((a, b) => nextStart(a, today).localeCompare(nextStart(b, today)))[0];
  return tr('Prochain : {name}, le {date}', { name: SEASONS[next].name, date: formatShort(nextStart(next, today)) });
}

function ThemePage() {
  const s = useApp();
  const today = dayKey();
  const pref = s.settings.season ?? 'auto';
  const now = seasonOn(today);
  const active = activeSeason(s, today);
  const set = (v: SeasonPref) =>
    setState((d) => {
      d.settings.season = v;
    });
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>
        {tr('Aux fêtes, toute l’app change de couleurs, un décor s’installe en fond et Pulse se déguise. Une fois par jour, sa troupe joue une courte scène sur Aujourd’hui ; la pastille de la fête, à côté de la date, la rejoue. Le thème arrive et repart tout seul avec le calendrier.')}
      </p>
      <div className="seg" role="group" aria-label={tr('Thème de saison')}>
        <button type="button" className={pref !== 'off' ? 'on' : ''} onClick={() => set('auto')}>
          {tr('Selon le calendrier')}
        </button>
        <button type="button" className={pref === 'off' ? 'on' : ''} onClick={() => set('off')}>
          {tr('Jamais')}
        </button>
      </div>
      <h3 className="settings-group" style={{ marginBottom: 0 }}>
        {tr('Essayer un thème')}
      </h3>
      <div className="season-grid">
        {SEASON_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={`season-card sc-${id} ${pref === id ? 'on' : ''}`}
            onClick={() => {
              set(pref === id ? 'auto' : id);
              // Le thème s'applique, puis sa scène passe devant l'écran.
              if (pref !== id) setTimeout(playSeasonScene, 450);
            }}
            aria-pressed={pref === id}
          >
            <Pulse season={id} mood="happy" size={62} />
            <b>{SEASONS[id].name}</b>
            <span className="small">{now === id ? tr('En ce moment') : tr('Dès le {date}', { date: formatShort(nextStart(id, today)) })}</span>
          </button>
        ))}
      </div>
      {active && (
        <button type="button" className="btn block" onClick={playSeasonScene}>
          <Icon name="play" size={16} filled />{' '}{tr('Revoir l’animation de {name}', { name: SEASONS[active].name })}
        </button>
      )}
      <p className="small faint" style={{ margin: 0 }}>
        {isSeasonId(pref)
          ? tr('Aperçu de {name} : touche la carte encore pour revenir au calendrier.', { name: SEASONS[pref].name })
          : tr('Touche une carte pour voir le thème tout de suite, même hors saison.')}
      </p>
    </div>
  );
}

const PROFILE_FIELDS: { id: keyof PublicProfileSettings['show']; title: string; text: string }[] = [
  { id: 'streak', title: tr('Série actuelle'), text: tr('Le nombre de jours validés d’affilée.') },
  { id: 'best', title: tr('Meilleure série'), text: tr('Ton record.') },
  { id: 'flames', title: tr('Flammes'), text: tr('Les flammes gagnées et leur couleur.') },
  { id: 'level', title: tr('Niveau'), text: tr('Ton niveau d’XP.') },
  { id: 'radar', title: tr('Fiche de force'), text: tr('Tes notes A à E par groupe musculaire, points forts et faibles.') },
  { id: 'program', title: tr('Programme'), text: tr('Le nom de ton split.') },
];

function PublicProfilePage() {
  const s = useApp();
  const p = s.settings.profile;
  const save = (mutate: (d: AppState) => void) => {
    setState(mutate);
    void publishProfile(true).catch((e) => toast(errorText(e), true));
  };
  const preview = publicData(s, dayKey());
  // Compte privé : réglage du club, gardé sur le serveur.
  const [priv, setPriv] = useState<boolean | null>(null);
  useEffect(() => {
    if (signedIn()) club.members().then((r) => setPriv(Boolean(r.members.find((m) => m.me)?.private)), () => undefined);
  }, []);
  const setPrivate = async (on: boolean) => {
    if (!on && !(await ask(tr('Repasser en compte public ? Les demandes en attente seront acceptées et tout le club verra tes séances « Tout le club ».'), tr('Passer en public')))) return;
    setPriv(on);
    try {
      await club.privacy(on);
      toast(on ? tr('Compte privé : tu choisis qui te suit') : tr('Compte public'));
    } catch (e) {
      setPriv(!on);
      toast(errorText(e), true);
    }
  };
  return (
    <div className="stack" style={{ gap: 18 }}>
      {priv !== null && (
        <div className="group">
          <Toggle
            title={tr('Compte privé')}
            text={
              priv
                ? tr('Tu acceptes ou refuses chaque demande d’abonnement. Tes séances ne se montrent qu’à tes abonnés.')
                : tr('Tout le monde peut s’abonner, et tes séances « Tout le club » sont visibles par tous.')
            }
            on={priv}
            onChange={(v) => void setPrivate(v)}
          />
        </div>
      )}
      {priv !== null && (
        <div className="group">
          <Toggle
            title={tr('Classement de la semaine')}
            text={
              s.settings.profile.board !== false
                ? tr('Tes abonnés voient tes séances et ton tonnage de la semaine dans leur classement.')
                : tr('Tu n’apparais pas dans le classement de tes abonnés.')
            }
            on={s.settings.profile.board !== false}
            onChange={(v) => {
              setState((d) => void (d.settings.profile.board = v));
              void publishProfile(true).catch(() => undefined);
            }}
          />
        </div>
      )}
      <p className="small muted" style={{ margin: 0 }}>
        {tr('Seuls les comptes de cette app, sur invitation, peuvent voir ton profil, et seulement ce que tu coches. Tes séances, repas et poids ne sont jamais montrés.')}
      </p>
      <div className="group">
        <Toggle
          title={tr('Montrer mes stats')}
          text={p.visible ? tr('Série, niveau et fiche de force visibles sur ta fiche du club.') : tr('Masquées : ta fiche ne montre que ton nom, ton pseudo et ta bio.')}
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
            {tr('Ce que les autres voient maintenant :')}{' '}
            {[
              preview.streak !== undefined && tr('série {streak} j', { streak: preview.streak }),
              preview.best !== undefined && tr('record {best} j', { best: preview.best }),
              preview.flames !== undefined && tn(preview.flames, '{n} flamme', '{n} flammes'),
              preview.level !== undefined && tr('niveau {level}', { level: preview.level }),
              preview.radar && tr('fiche de force'),
              preview.program && tr('programme « {program} »', { program: preview.program }),
            ]
              .filter(Boolean)
              .join(', ') || tr('ton prénom seulement')}
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
          <div className="small">{tr('Ton programme utilise du matériel que tu n’as pas coché ({join}).', { join: missing.map((e) => lower(EQUIPMENT.find((x) => x.id === e)?.name)).join(', ') })}</div>
          <button
            className="btn primary block"
            onClick={() => {
              const swaps = adaptCurrentProgram();
              toast(swaps.length ? tn(swaps.length, '{n} exercice remplacé', '{n} exercices remplacés') : tr('Rien à changer'));
            }}
          >
            {tr('Adapter mon programme à ma salle')}
          </button>
        </div>
      ) : (
        <p className="small faint" style={{ margin: 0 }}>
          {tr('Tout ton programme se fait dans cette salle.')}
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
        {tr('Chaque lundi, l’app fait le bilan de ta semaine : séances, journées validées, calories, poids, records, et des ajustements à appliquer en un tap (calories, exercices pour ton point faible, variantes quand un exercice stagne). Il apparaît sur l’accueil et dans Fiche, Bilans.')}
      </p>
      <div className="group">
        <Toggle
          title={tr('Recevoir le bilan par mail')}
          text={server ? (ready ? tr('Envoyé le lundi à {n}.', { n: getSession().account?.email ?? tr('ton adresse') }) : tr('Pas encore configuré sur le serveur.')) : tr('Vérification…')}
          on={s.settings.reportEmail && ready}
          onChange={(v) => setState((d) => void (d.settings.reportEmail = v))}
        />
      </div>
      {server && !ready && (
        <p className="small faint" style={{ margin: 0 }}>
          {tr('L’administrateur doit ajouter une clé Resend au serveur (guide « Mettre Shred en ligne », section Bilan par mail). En attendant, le bilan reste dans l’app.')}
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
        {tr('Coupe ce qui ne te sert pas : l’app se simplifie, les onglets et les rappels suivent.')}
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
        <h2>{tr('Valider une journée')}</h2>
        <div className="group">
          <Toggle
            title={tr('Le sport compte')}
            text={tr('Les jours d’entraînement, la séance fait partie de la journée validée. Les jours de repos, rien à faire côté sport.')}
            on={g.workout}
            onChange={(v) => setState((d) => void (d.settings.goal.workout = v || d.settings.goal.minMeals === 0))}
          />
          {g.workout && (
            <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
              <div>
                <div className="title">{tr('Ce qui compte comme séance')}</div>
                <div className="small muted">
                  {(g.level ?? 'half') === 'half'
                    ? tr('La moitié des séries cochées, une séance cardio commencée ou 30 min à la salle (avec Santé) suffisent.')
                    : tr('Toutes les séries de la séance doivent être faites.')}
                </div>
              </div>
              <div className="seg" role="group" aria-label={tr('Ce qui compte comme séance')}>
                {(
                  [
                    ['half', tr('La moitié suffit')],
                    ['full', tr('La séance entière')],
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
                <div className="title">{tr('Repas à noter')}</div>
                <div className="small muted">{tr('Minimum de repas notés dans la journée.')}</div>
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
        <h2>{tr('Ma série')}</h2>
        <p className="small muted" style={{ margin: 0 }}>
          {tr('Combien de jours tenir pour ta première flamme. Les suivantes s’espacent : {join} jours…', { join: ladder(s.settings.streakGoal, 0).slice(0, 6).join(', ') })}
        </p>
        <div className="chips">
          {STREAK_GOALS.map((n) => (
            <button key={n} className={`chip ${s.settings.streakGoal === n ? 'on' : ''}`} onClick={() => setState((d) => void (d.settings.streakGoal = n))}>
              {tr('{n} jours', { n })}
            </button>
          ))}
        </div>
      </section>

      <section className="stack">
        <h2>{tr('Poids')}</h2>
        <div className="chips">
          {(Object.keys(WEIGHT_GOALS) as WeightGoal[]).map((w) => (
            <button key={w} className={`chip ${s.settings.weightGoal === w ? 'on' : ''}`} onClick={() => setState((d) => void (d.settings.weightGoal = w))}>
              {WEIGHT_GOALS[w].label}
            </button>
          ))}
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {tr('{text} Rythme visé : {min} à {max} kg par semaine.', { text: WEIGHT_GOALS[s.settings.weightGoal].text, min: WEIGHT_GOALS[s.settings.weightGoal].min.toLocaleString(loc()), max: WEIGHT_GOALS[s.settings.weightGoal].max.toLocaleString(loc()) })}
        </p>
        <button
          className="btn small"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => {
            const plan = applyTargets();
            toast(plan ? tr('Objectif : {kcal} kcal, {protein} g de protéines', { kcal: plan.targets.kcal, protein: plan.targets.protein }) : tr('Renseigne âge, taille et poids dans Profil sportif'), !plan);
          }}
        >
          {tr('Recalculer mes calories')}
        </button>
      </section>

      {s.settings.modules.nutrition && (
        <section className="stack">
          <h2>{tr('Nutrition par jour')}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {(
              [
                ['kcal', tr('Calories')],
                ['protein', tr('Protéines (g)')],
                ['carbs', tr('Glucides (g)')],
                ['fat', tr('Lipides (g)')],
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
        {tr('Tes repas habituels. Ils se cochent en un tap sur l’accueil.')}
      </p>
      {SLOTS.map((slot) => {
        const meals = s.mealPlan.filter((m) => m.slot === slot.id);
        return (
          <section key={slot.id} className="stack">
            <div className="section-head" style={{ marginBottom: 0 }}>
              <h2>{slot.name}</h2>
              <button className="link small" onClick={() => setOpen(addPlannedMeal(slot.id as MealSlot))}>
                <Icon name="plus" size={15} />{' '}{tr('Ajouter')}
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
                          {tr('{kcal} kcal, {protein} g P, {carbs} g G, {fat} g L', { kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat })}
                        </div>
                      </div>
                      <Icon name="chevron" size={18} />
                    </button>
                    {open === m.id && (
                      <div style={{ padding: '0 16px 16px' }} className="stack">
                        <Field label={tr('Nom')}>
                          <input className="input" defaultValue={m.label} onBlur={(e) => updatePlannedMeal(m.id, { label: e.target.value.trim() || m.label })} />
                        </Field>
                        <Field label={tr('Détail (quantités)')}>
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
                          {tr('Supprimer ce repas')}
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
        {tr('Touche l’icône pour la changer. L’habitude « pas » se coche toute seule avec Apple Santé.')}
      </p>
      <div className="group">
        {s.habits.map((h) => (
          <div className="row" key={h.id}>
            <button
              className="icon-btn"
              style={{ background: 'var(--surface-2)', width: 40, height: 40 }}
              aria-label={tr('Changer l’icône')}
              onClick={() => updateHabit(h.id, { icon: HABIT_ICONS[(HABIT_ICONS.indexOf(h.icon) + 1) % HABIT_ICONS.length] })}
            >
              <Icon name={h.icon} size={19} />
            </button>
            <input className="input" style={{ flex: 1, minWidth: 0 }} defaultValue={h.name} onBlur={(e) => updateHabit(h.id, { name: e.target.value.trim().slice(0, 30) || h.name })} aria-label={tr('Nom de l’habitude')} />
            <button className="icon-btn" style={{ background: 'transparent' }} aria-label={tr('Supprimer {name}', { name: h.name })} onClick={() => removeHabit(h.id)}>
              <Icon name="trash" size={18} />
            </button>
          </div>
        ))}
      </div>
      <button className="btn block" onClick={() => addHabit()}>
        <Icon name="plus" size={18} />{' '}{tr('Ajouter une habitude')}
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
              ? tr('Pas disponible pour ton compte sur ce serveur : choisis « Claude, avec ton compte ».')
              : m.id === 'api' && server
                ? tr('{text} {aiLimit} requêtes par jour pour toi.', { text: m.text, aiLimit: server.aiLimit })
                : m.text
          }
          disabled={m.id === 'api' && apiOff && s.settings.ai !== 'api'}
          onClick={() => setState((d) => void (d.settings.ai = m.id))}
        />
      ))}
      {s.settings.ai === 'claude' && (signedIn() ? <ConnectorCard /> : <DossierCard today={dayKey()} />)}
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
                {tr('Envoyer un test')}
              </button>
              <button className="btn danger" disabled={!!busy} onClick={() => run('off', disablePush)}>
                {tr('Désactiver')}
              </button>
            </>
          ) : (
            <button
              className="btn primary block"
              disabled={!!busy}
              onClick={() =>
                run('on', async () => {
                  await enablePush();
                  toast(tr('Notifications activées'));
                })
              }
            >
              {tr('Activer les rappels')}
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
                aria-label={tr('Rappel {label}', { label: r.label })}
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
                aria-label={tr('Heure du rappel {label}', { label: r.label })}
              />
            </div>
          );
        })}
      </div>
      <p className="small faint" style={{ margin: 0 }}>
        {tr('Les rappels partent par tranches de 15 minutes. Ils s’arrêtent dès que ta journée est validée.')}
      </p>
    </div>
  );
}

function DataPage({ onReset }: { onReset: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>
        {tr('Avec un compte, tes données sont déjà sauvegardées toutes seules (Réglages, Compte). L’export sert à garder une copie à toi, en fichier.')}
      </p>
      <div style={{ display: DEMO ? 'none' : 'flex', gap: 10 }}>
        <button className="btn" style={{ flex: 1 }} onClick={exportData}>
          {tr('Exporter')}
        </button>
        <button className="btn" style={{ flex: 1 }} onClick={() => fileRef.current?.click()}>
          {tr('Importer')}
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
            if (data.version !== 1 || !data.days) throw new Error(tr('Fichier non reconnu'));
            if (!(await ask(tr('Remplacer toutes les données de ce téléphone par cette sauvegarde ?'), tr('Remplacer'), true))) return;
            const next = migrate(data);
            next.settings.pushEnabled = getState().settings.pushEnabled;
            replaceState(next);
            toast(tr('Sauvegarde importée'));
          } catch (err) {
            toast(errorText(err), true);
          }
        }}
      />
      <button
        className="btn danger block"
        onClick={async () => {
          if (await ask(tr('Effacer toutes tes données (séances, repas, série, programme), sur ce téléphone et dans ta sauvegarde ? Action irréversible.'), tr('Tout effacer'), true)) {
            resetAll();
            onReset();
          }
        }}
      >
        {tr('Tout effacer')}
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
  a.download = tr('shred-sauvegarde-{dayKey}.json', { dayKey: dayKey() });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
