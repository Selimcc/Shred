// Strava côté app : relier le compte, importer les sorties récentes, se déconnecter.
// Les sorties Strava restent visibles par toi seul (règle de Strava) : elles ne partent jamais dans le club.
import { importActivities, type ImportResult } from './activities';
import { api, DEMO } from './api';
import { addDays, dayKey } from './date';
import { isNative } from './native';
import { signedIn } from './session';
import { type Activity, getState, setState } from './store';
import { tr } from '../../shared/i18n';

export interface StravaStatus {
  configured: boolean;
  connected: boolean;
  athlete: string | null;
  connectedAt: string | null;
}

const EVERY = 15 * 60_000;
let inflight: Promise<ImportResult | null> | null = null;

export async function stravaStatus(): Promise<StravaStatus> {
  if (DEMO) {
    const s = getState().strava;
    return { configured: true, connected: Boolean(s?.athlete), athlete: s?.athlete ?? null, connectedAt: s?.connectedAt ?? null };
  }
  const st = await api<StravaStatus>('/api/strava/status');
  // Déconnecté depuis Strava ou un autre appareil : on l'oublie ici aussi.
  setState((d) => {
    if (st.connected) d.strava = { ...d.strava, athlete: st.athlete ?? undefined, connectedAt: st.connectedAt ?? undefined };
    else delete d.strava;
  });
  return st;
}

/** Ouvre la page d'autorisation de Strava. Le retour se fait sur le serveur, l'app vérifie en revenant au premier plan. */
export async function connectStrava(): Promise<void> {
  if (DEMO) {
    setState((d) => void (d.strava = { athlete: tr('Démo S'), connectedAt: new Date().toISOString() }));
    await syncStrava(true);
    return;
  }
  const { url } = await api<{ url: string }>('/api/strava/connect', { body: {} });
  try {
    localStorage.setItem('shred:strava-pending', '1');
  } catch {
    // sans stockage, l'app vérifiera depuis Réglages, Strava
  }
  // Dans l'app installée (iPhone), on ouvre Safari ; ailleurs un nouvel onglet, ou la page elle-même si bloqué.
  const w = window.open(url, '_blank');
  if (w) w.opener = null;
  else if (!isNative()) location.href = url;
}

export async function disconnectStrava(): Promise<void> {
  if (!DEMO) await api('/api/strava/disconnect', { body: {} });
  setState((d) => void delete d.strava);
}

function demoActivities(): Activity[] {
  const today = dayKey();
  const at = (days: number, time: string) => `${addDays(today, -days)}T${time}:00`;
  return [
    { id: 'strava:demo-1', source: 'strava', sport: 'run', name: tr('Footing du soir'), start: at(1, '18:40'), min: 46, km: 8.4, elev: 38, hr: 148 },
    { id: 'strava:demo-2', source: 'strava', sport: 'bike', name: tr('Sortie vélo'), start: at(3, '09:10'), min: 92, km: 41.2, elev: 410, hr: 136 },
    { id: 'strava:demo-3', source: 'strava', sport: 'swim', name: tr('Piscine'), start: at(5, '07:15'), min: 38, km: 1.8 },
  ];
}

/** Importe les sorties des derniers jours (au plus toutes les 15 minutes, sauf `force`). */
export function syncStrava(force = false): Promise<ImportResult | null> {
  const s = getState();
  if (!s.strava?.athlete) return Promise.resolve(null);
  if (!DEMO && !signedIn()) return Promise.resolve(null);
  const last = s.strava.lastSync ? Date.parse(s.strava.lastSync) : 0;
  if (!force && Date.now() - last < EVERY) return Promise.resolve(null);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      // On repart un jour avant la dernière synchro : une sortie envoyée en retard n'est pas perdue.
      const after = last ? Math.floor(last / 1000) - 86400 : undefined;
      const res = DEMO ? { activities: demoActivities(), athlete: s.strava!.athlete! } : await api<{ activities: Activity[]; athlete: string }>('/api/strava/sync', { body: { after } });
      const result = importActivities(res.activities);
      setState((d) => void (d.strava = { ...d.strava, athlete: res.athlete, lastSync: new Date().toISOString() }));
      return result;
    } catch (e) {
      // Accès retiré depuis Strava : le serveur a oublié les jetons.
      if ((e as { status?: number }).status === 409) setState((d) => void delete d.strava);
      return null;
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
