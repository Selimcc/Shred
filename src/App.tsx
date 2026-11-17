import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Celebration } from './components/Celebration';
import { ConnectClaude } from './components/Connector';
import { DemoInviteHost, demoInvite } from './components/DemoInvite';
import { PulseMoment } from './components/PulseMoment';
import { SeasonLayer } from './components/SeasonLayer';
import { SeasonScene } from './components/SeasonScene';
import { activeSeason, SEASON_BAR, seasonDay, seasonPeak, useSeasonLab } from './lib/season';
import { type EnterDir, enterBlocks, reducedMotion } from './lib/motion';
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
import { tr } from '../shared/i18n';

export type Tab = 'today' | 'workout' | 'food' | 'club' | 'coach' | 'progress';

/** Onglets disponibles ; chacun peut dépendre d'un module ou du mode IA. */
const TABS: { id: Tab; label: string; icon: string; enabled?: (s: AppState) => boolean; hidden?: boolean }[] = [
  { id: 'today', label: tr('Aujourd’hui'), icon: 'home' },
  { id: 'workout', label: tr('Séance'), icon: 'dumbbell' },
  { id: 'food', label: tr('Repas'), icon: 'utensils', enabled: (s) => s.settings.modules.nutrition },
  // Pas de club dans la démo publique : profils, photos et publications sont réservés à la vraie app.
  { id: 'club', label: tr('Club'), icon: 'users', enabled: () => !DEMO },
  { id: 'progress', label: tr('Progrès'), icon: 'chart' },
  // Le coach s'ouvre en touchant Pulse : pas d'onglet en plus.
  { id: 'coach', label: tr('Pulse'), icon: 'chat', enabled: (s) => s.settings.ai !== 'off', hidden: true },
];

function initialTab(): Tab {
  const q = new URLSearchParams(location.search);
  // Lien de profil partagé (?member=pseudo) : il s'ouvre dans le club.
  if (q.get('member')) return 'club';
  const t = q.get('tab');
  return TABS.some((x) => x.id === t) ? (t as Tab) : 'today';
}

/** Sens du passage d'un onglet à l'autre : vers la droite de la barre, ou vers la gauche. Pulse est « après ». */
const rank = (t: Tab) => (t === 'coach' ? 99 : TABS.findIndex((x) => x.id === t));

/**
 * La pastille éclairée sous l'onglet actif glisse d'un onglet à l'autre (avec un léger étirement en route),
 * au lieu de s'éteindre ici et de s'allumer là.
 */
function useTabGlow(nav: RefObject<HTMLElement | null>, glow: RefObject<HTMLElement | null>, key: string) {
  const placed = useRef(false);
  useLayoutEffect(() => {
    const n = nav.current;
    const g = glow.current;
    if (!n || !g) return;
    const place = (moved: boolean) => {
      const pill = n.querySelector<HTMLElement>('.tab.active .pill');
      if (!pill) {
        g.style.opacity = '0';
        return;
      }
      const a = pill.getBoundingClientRect();
      const b = n.getBoundingClientRect();
      g.style.opacity = '';
      g.style.width = `${a.width}px`;
      g.style.height = `${a.height}px`;
      g.style.transform = `translate3d(${a.left - b.left - n.clientLeft}px, ${a.top - b.top - n.clientTop}px, 0)`;
      if (moved && placed.current && !reducedMotion() && typeof g.animate === 'function') {
        g.animate([{ scale: '1 1' }, { scale: '1.28 0.86', offset: 0.32 }, { scale: '1 1' }], { duration: 480, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)' });
      }
      if (!placed.current) {
        placed.current = true;
        requestAnimationFrame(() => n.setAttribute('data-glide', 'ready'));
      }
    };
    place(true);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => place(false));
    ro?.observe(n);
    return () => ro?.disconnect();
  }, [nav, glow, key]);
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
  // Claude (connecteur) renvoie ici pour demander l'accès : la demande reste en mémoire le temps de se connecter.
  const [connect, setConnect] = useState(() => (DEMO ? null : (new URLSearchParams(location.search).get('connect') ?? '').slice(0, 200) || null));
  useSeasonLab();
  const season = activeSeason(s, today);
  const sceneDay = seasonDay(today);

  // Thème de saison : toute l'interface suit les jetons de couleur de la fête, et la barre d'état aussi.
  useEffect(() => {
    const root = document.documentElement;
    if (season) root.dataset.season = season;
    else delete root.dataset.season;
    for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) m.content = season ? SEASON_BAR[season] : '#15171b';
  }, [season]);

  // Pas de compte : écran d'accueil. Premier lancement : quelques questions.
  const connectNotice = connect ? tr('Claude demande l’accès à tes données Shred. Connecte-toi pour continuer.') : undefined;
  const gate = DEMO ? null : !session.account && !session.local ? (
    <Welcome notice={connectNotice} />
  ) : session.account?.expired ? (
    <Welcome expired={session.account} notice={connectNotice} />
  ) : !s.settings.onboarded ? (
    <Onboarding />
  ) : null;
  const gated = gate !== null;

  // Chaque onglet retrouve l'endroit où on l'a laissé ; ses blocs arrivent du côté où l'on va.
  const main = useRef<HTMLElement>(null);
  const nav = useRef<HTMLElement>(null);
  const glow = useRef<HTMLSpanElement>(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const scrolls = useRef<Partial<Record<Tab, number>>>({});
  const move = useRef<{ dir: EnterDir; top: number } | null>({ dir: 'up', top: -1 });

  const go = (t: Tab) => {
    const from = tabRef.current;
    if (t === from) {
      // Toucher l'onglet où l'on est : retour en haut, en douceur.
      window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
      return;
    }
    scrolls.current[from] = window.scrollY;
    move.current = { dir: rank(t) > rank(from) ? 'fwd' : 'back', top: scrolls.current[t] ?? 0 };
    setTab(t);
    try {
      history.replaceState(null, '', t === 'today' ? location.pathname : `?tab=${t}`);
    } catch {
      // Navigation d'URL indisponible (aperçu intégré) : l'onglet change quand même.
    }
  };

  useLayoutEffect(() => {
    const m = move.current;
    if (!m || !main.current) return;
    move.current = null;
    if (m.top >= 0) window.scrollTo({ top: m.top });
    enterBlocks(main.current, m.dir);
  }, [tab, gated]);

  useTabGlow(nav, glow, `${tab}:${tabs.length}:${gated}`);

  useEffect(() => {
    // Ouverture depuis une notification alors que l'app tourne déjà.
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'open-tab') go(e.data.tab as Tab);
    };
    navigator.serviceWorker?.addEventListener('message', onMsg);
    // « Partager au club » depuis la séance : on ouvre le club avec la publication prête.
    const onShare = (e: Event) => {
      if (DEMO) return demoInvite(tr('Le club n’est pas disponible dans la démo.'));
      setCompose((e as CustomEvent<{ date: string }>).detail.date);
      go('club');
    };
    window.addEventListener('shred:share', onShare);
    return () => {
      navigator.serviceWorker?.removeEventListener('message', onMsg);
      window.removeEventListener('shred:share', onShare);
    };
  }, []);

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
          {tr('Démo avec données d’exemple, rien n’est enregistré.')}{' '}
          <button className="demo-banner-link" onClick={() => demoInvite()}>
            {tr('Utiliser la vraie app')}
          </button>
        </div>
      )}
      {DEMO && <DemoInviteHost />}
      <SeasonLayer season={season} peak={seasonPeak(season, sceneDay)} />
      <SeasonScene season={season} today={sceneDay} day={today} auto={tab === 'today' && !settings} />
      <main ref={main} className="app">
        {tab === 'today' && <Today today={today} go={go} openSettings={() => setSettings('menu')} />}
        {tab === 'workout' && <Workout today={today} editProgram={() => setSettings('program')} />}
        {tab === 'food' && <Food today={today} openCoach={() => go('coach')} />}
        {tab === 'club' && <Club openSettings={(p = 'account') => setSettings(p)} compose={compose} onComposed={() => setCompose(null)} openPost={openPost} openMember={openMember} />}
        {tab === 'coach' && <Coach today={today} onBack={() => go('today')} />}
        {tab === 'progress' && <Progress today={today} openSettings={(p = 'menu') => setSettings(p)} openCoach={() => go('coach')} />}
      </main>

      <div className="tabbar">
        <nav ref={nav} aria-label={tr('Navigation')} style={{ gridTemplateColumns: `repeat(${tabs.filter((t) => !t.hidden).length}, 1fr)` }}>
          <span ref={glow} className="tab-glow" aria-hidden="true" />
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
      {connect && (
        <ConnectClaude
          handle={connect}
          onClose={() => {
            setConnect(null);
            try {
              history.replaceState(null, '', location.pathname);
            } catch {
              // Aperçu intégré : pas d'historique.
            }
          }}
        />
      )}

      <Celebration today={today} />
      <PulseMoment />

      <ToastHost />
      <AskHost />
    </>
  );
}
