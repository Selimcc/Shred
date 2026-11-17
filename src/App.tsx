import { useEffect, useState } from 'react';
import { Celebration } from './components/Celebration';
import { DemoInviteHost, demoInvite } from './components/DemoInvite';
import { PulseMoment } from './components/PulseMoment';
import { SeasonLayer } from './components/SeasonLayer';
import { SeasonScene } from './components/SeasonScene';
import { activeSeason, SEASON_BAR, seasonDay, useSeasonLab } from './lib/season';
import { Icon } from './components/Icon';
import { AskHost, ToastHost } from './components/ui';
import { DEMO } from './lib/api';
import { useToday } from './lib/hooks';
import { useSession } from './lib/session';
import { type AppState, useApp } from './lib/store';
import { Club } from './screens/Club';
import { Coach } from './screens/Coach';
import { Food } from './screens/Food';
import { Onboarding } from './screens/Onboarding';
import { Progress } from './screens/Progress';
import { Settings, type SettingsPage } from './screens/Settings';
import { Today } from './screens/Today';
import { Welcome } from './screens/Welcome';
import { Workout } from './screens/Workout';

export type Tab = 'today' | 'workout' | 'food' | 'club' | 'coach' | 'progress';

/** Onglets disponibles ; chacun peut dépendre d'un module ou du mode IA. */
const TABS: { id: Tab; label: string; icon: string; enabled?: (s: AppState) => boolean; hidden?: boolean }[] = [
  { id: 'today', label: 'Aujourd’hui', icon: 'home' },
  { id: 'workout', label: 'Séance', icon: 'dumbbell' },
  { id: 'food', label: 'Repas', icon: 'utensils', enabled: (s) => s.settings.modules.nutrition },
  // Pas de club dans la démo publique : profils, photos et publications sont réservés à la vraie app.
  { id: 'club', label: 'Club', icon: 'users', enabled: () => !DEMO },
  { id: 'progress', label: 'Progrès', icon: 'chart' },
  // Le coach s'ouvre en touchant Pulse : pas d'onglet en plus.
  { id: 'coach', label: 'Pulse', icon: 'chat', enabled: (s) => s.settings.ai !== 'off', hidden: true },
];

function initialTab(): Tab {
  const q = new URLSearchParams(location.search);
  // Lien de profil partagé (?member=pseudo) : il s'ouvre dans le club.
  if (q.get('member')) return 'club';
  const t = q.get('tab');
  return TABS.some((x) => x.id === t) ? (t as Tab) : 'today';
}

export function App() {
  const s = useApp();
  const session = useSession();
  const today = useToday();
  const [tabState, setTab] = useState<Tab>(initialTab);
  const tabs = TABS.filter((t) => !t.enabled || t.enabled(s));
  const tab = tabs.some((t) => t.id === tabState) ? tabState : 'today';
  const [settings, setSettings] = useState<SettingsPage | null>(() => (new URLSearchParams(location.search).get('settings') === 'usage' ? 'usage' : null));
  const [compose, setCompose] = useState<string | null>(null);
  const [openPost] = useState(() => new URLSearchParams(location.search).get('post'));
  const [openMember] = useState(() => (new URLSearchParams(location.search).get('member') ?? '').toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 20) || null);
  useSeasonLab();
  const season = activeSeason(s, today);

  // Thème de saison : toute l'interface suit les jetons de couleur de la fête, et la barre d'état aussi.
  useEffect(() => {
    const root = document.documentElement;
    if (season) root.dataset.season = season;
    else delete root.dataset.season;
    for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) m.content = season ? SEASON_BAR[season] : '#15171b';
  }, [season]);

  const go = (t: Tab) => {
    setTab(t);
    window.scrollTo({ top: 0 });
    try {
      history.replaceState(null, '', t === 'today' ? location.pathname : `?tab=${t}`);
    } catch {
      // Navigation d'URL indisponible (aperçu intégré) : l'onglet change quand même.
    }
  };

  useEffect(() => {
    // Ouverture depuis une notification alors que l'app tourne déjà.
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'open-tab') go(e.data.tab as Tab);
    };
    navigator.serviceWorker?.addEventListener('message', onMsg);
    // « Partager au club » depuis la séance : on ouvre le club avec la publication prête.
    const onShare = (e: Event) => {
      if (DEMO) return demoInvite('Le club n’est pas disponible dans la démo.');
      setCompose((e as CustomEvent<{ date: string }>).detail.date);
      go('club');
    };
    window.addEventListener('shred:share', onShare);
    return () => {
      navigator.serviceWorker?.removeEventListener('message', onMsg);
      window.removeEventListener('shred:share', onShare);
    };
  }, []);

  // Pas de compte : écran d'accueil. Premier lancement : quelques questions.
  const gate = DEMO ? null : !session.account && !session.local ? (
    <Welcome />
  ) : session.account?.expired ? (
    <Welcome expired={session.account} />
  ) : !s.settings.onboarded ? (
    <Onboarding />
  ) : null;
  if (gate) {
    return (
      <>
        {gate}
        <ToastHost />
        <AskHost />
      </>
    );
  }

  return (
    <>
      {DEMO && (
        <div className="small demo-banner">
          Démo avec données d’exemple, rien n’est enregistré.{' '}
          <button className="demo-banner-link" onClick={() => demoInvite()}>
            Utiliser la vraie app
          </button>
        </div>
      )}
      {DEMO && <DemoInviteHost />}
      <SeasonLayer season={season} />
      <SeasonScene season={season} today={seasonDay(today)} />
      <main className="app">
        {tab === 'today' && <Today today={today} go={go} openSettings={() => setSettings('menu')} />}
        {tab === 'workout' && <Workout today={today} editProgram={() => setSettings('program')} />}
        {tab === 'food' && <Food today={today} openCoach={() => go('coach')} />}
        {tab === 'club' && <Club openSettings={(p = 'account') => setSettings(p)} compose={compose} onComposed={() => setCompose(null)} openPost={openPost} openMember={openMember} />}
        {tab === 'coach' && <Coach today={today} onBack={() => go('today')} />}
        {tab === 'progress' && <Progress today={today} openSettings={(p = 'menu') => setSettings(p)} openCoach={() => go('coach')} />}
      </main>

      <div className="tabbar">
        <nav aria-label="Navigation" style={{ gridTemplateColumns: `repeat(${tabs.filter((t) => !t.hidden).length}, 1fr)` }}>
          {tabs.filter((t) => !t.hidden).map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => go(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
            >
              <span className="pill">
                <Icon name={t.icon} size={22} filled={false} />
              </span>
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {settings && <Settings initialPage={settings} onClose={() => setSettings(null)} />}

      <Celebration today={today} />
      <PulseMoment />

      <ToastHost />
      <AskHost />
    </>
  );
}
