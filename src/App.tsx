import { useEffect, useState } from 'react';
import { Celebration } from './components/Celebration';
import { Icon } from './components/Icon';
import { AskHost, ToastHost } from './components/ui';
import { DEMO } from './lib/api';
import { useToday } from './lib/hooks';
import { useSession } from './lib/session';
import { type AppState, useApp } from './lib/store';
import { Coach } from './screens/Coach';
import { Food } from './screens/Food';
import { Onboarding } from './screens/Onboarding';
import { Progress } from './screens/Progress';
import { Settings, type SettingsPage } from './screens/Settings';
import { Today } from './screens/Today';
import { Welcome } from './screens/Welcome';
import { Workout } from './screens/Workout';

export type Tab = 'today' | 'workout' | 'food' | 'coach' | 'progress';

/** Onglets disponibles ; chacun peut dépendre d'un module ou du mode IA. */
const TABS: { id: Tab; label: string; icon: string; enabled?: (s: AppState) => boolean }[] = [
  { id: 'today', label: 'Aujourd’hui', icon: 'flame' },
  { id: 'workout', label: 'Séance', icon: 'dumbbell' },
  { id: 'food', label: 'Repas', icon: 'utensils', enabled: (s) => s.settings.modules.nutrition },
  { id: 'coach', label: 'Coach', icon: 'chat', enabled: (s) => s.settings.ai !== 'off' },
  { id: 'progress', label: 'Fiche', icon: 'radar' },
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
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg);
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
        <div
          className="small"
          style={{ background: 'var(--gold-soft)', color: 'var(--ink)', textAlign: 'center', padding: '6px 12px' }}
        >
          Aperçu avec données d’exemple. L’analyse photo et le coach sont simulés.
        </div>
      )}
      <main className="app">
        {tab === 'today' && <Today today={today} go={go} openSettings={() => setSettings('menu')} />}
        {tab === 'workout' && <Workout today={today} editProgram={() => setSettings('program')} />}
        {tab === 'food' && <Food today={today} openCoach={() => go('coach')} />}
        {tab === 'coach' && <Coach today={today} />}
        {tab === 'progress' && <Progress today={today} openSettings={(p = 'menu') => setSettings(p)} openCoach={() => go('coach')} />}
      </main>

      <div className="tabbar">
        <nav aria-label="Navigation" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => go(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
            >
              <span className="pill">
                <Icon name={t.icon} size={22} filled={t.icon === 'flame' && tab === t.id} />
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
