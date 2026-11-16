import { useEffect, useState } from 'react';
import { Celebration } from './components/Celebration';
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
  { id: 'club', label: 'Club', icon: 'users' },
  { id: 'progress', label: 'Progrès', icon: 'chart' },
  // Le coach s'ouvre en touchant Pulse : pas d'onglet en plus.
  { id: 'coach', label: 'Pulse', icon: 'chat', enabled: (s) => s.settings.ai !== 'off', hidden: true },
];

function initialTab(): Tab {
  const t = new URLSearchParams(location.search).get('tab');
  return TABS.some((x) => x.id === t) ? (t as Tab) : 'today';
}

export function App() {
  const s = useApp();
  const session = useSession();
  const today = useToday();
  const [tabState, setTab] = useState<Tab>(initialTab);
  const tabs = TABS.filter((t) => !t.enabled || t.enabled(s));
  const tab = tabs.some((t) => t.id === tabState) ? tabState : 'today';
  const [settings, setSettings] = useState<SettingsPage | null>(null);
  const [compose, setCompose] = useState<string | null>(null);
  const [openPost] = useState(() => new URLSearchParams(location.search).get('post'));

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
          Aperçu avec données d’exemple. L’analyse photo et le coach sont simulés.
        </div>
      )}
      <main className="app">
        {tab === 'today' && <Today today={today} go={go} openSettings={() => setSettings('menu')} />}
        {tab === 'workout' && <Workout today={today} editProgram={() => setSettings('program')} />}
        {tab === 'food' && <Food today={today} openCoach={() => go('coach')} />}
        {tab === 'club' && <Club openSettings={() => setSettings('account')} compose={compose} onComposed={() => setCompose(null)} openPost={openPost} />}
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

      <ToastHost />
      <AskHost />
    </>
  );
}
