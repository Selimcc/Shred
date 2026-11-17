import { closeDeload } from './recovery';
import { api, DEMO } from './api';
import { startBackup } from './backup';
import { startProfileSync } from './profile';
import { startWallet } from './wallet';
import { lastWeekMonday } from './report';
import { addDays, dayKey, mondayOf } from './date';
import { syncHealth } from './health';
import { syncNativeHealth } from './nativeHealth';
import { stravaStatus, syncStrava } from './strava';
import { toast } from '../components/ui';
import type { ImportResult } from './activities';
import { startMoments } from './moments';
import { startTrophies } from './trophies';
import { dayValidated, mealsCount, reconcileStreak, sessionFor, streakInfo } from './logic';
import { signedIn } from './session';
import { getState, readDay, setState, subscribe } from './store';
import { tn, tr } from '../../shared/i18n';

/** Résumé du jour envoyé au serveur, utilisé pour personnaliser les rappels. */
export function daySummary() {
  const s = getState();
  const today = dayKey();
  const day = readDay(s, today);
  const st = streakInfo(s, today);
  return {
    date: today,
    label: sessionFor(s, today).name,
    lifting: sessionFor(s, today).lifting,
    rest: sessionFor(s, today).type === 'rest',
    mainDone: day.mainDone,
    meals: mealsCount(day),
    // Les repas déjà notés : le rappel d'un repas ne part que s'il manque.
    slots: [...new Set(day.meals.map((m) => m.slot))].sort(),
    validated: dayValidated(s, today),
    streak: st.current,
    banked: st.banked,
  };
}

let lastSent = '';
let timer: ReturnType<typeof setTimeout> | undefined;

function schedule(delay = 2500) {
  clearTimeout(timer);
  timer = setTimeout(flush, delay);
}

async function flush() {
  const s = getState();
  if (DEMO || !signedIn() || !s.settings.pushEnabled) return;
  const summary = JSON.stringify(daySummary());
  if (summary === lastSent) return;
  try {
    await api('/api/state', { body: JSON.parse(summary) });
    lastSent = summary;
  } catch {
    // Réseau indisponible : on réessaiera au prochain changement.
  }
}

/** Fait avancer la série au changement de jour et synchronise l'état avec le serveur. */
export function startSync() {
  const tick = () => {
    const today = dayKey();
    if (getState().streak.through < addDays(today, -1)) setState((d) => reconcileStreak(d, today));
    const w = getState().deload?.week;
    if (w && today > addDays(w, 6)) setState((d) => closeDeload(d, today));
  };
  tick();
  startMoments();
  startTrophies();
  subscribe(() => schedule());
  startBackup();
  startProfileSync();
  startWallet();
  setTimeout(() => void autoMailReport(), 8000);
  void syncHealth(true);
  void syncNativeHealth(true).then(announce);
  void syncStrava().then(announce);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      tick();
      schedule(300);
      void syncHealth(true);
      void syncNativeHealth().then(announce);
      void returnFromStrava().then(() => syncStrava().then(announce));
    }
  });
  setInterval(tick, 60_000);
  schedule(500);
}

/** Une sortie importée a validé la séance du jour : on le dit. */
function announce(r: ImportResult | null) {
  // Une séance du jour validée par la sortie : Pulse la fête (voir moments.ts), pas besoin de message en plus.
  if (r?.validated.some((x) => x.date === dayKey())) return;
  if (r?.added) toast(tn(r.added, '{n} sortie importée', '{n} sorties importées'));
}

/** Retour de la page d'autorisation Strava : on vérifie que le compte est relié, puis on importe. */
export async function returnFromStrava() {
  let pending = false;
  try {
    pending = localStorage.getItem('shred:strava-pending') === '1';
  } catch {
    pending = false;
  }
  if (!pending || !signedIn()) return;
  const st = await stravaStatus().catch(() => null);
  if (!st?.connected) return;
  try {
    localStorage.removeItem('shred:strava-pending');
  } catch {
    // stockage indisponible : sans conséquence
  }
  toast(tr('Strava relié{v}', { v: st.athlete ? ` (${st.athlete})` : '' }));
  announce(await syncStrava(true));
}

/** Le lundi (ou au premier lancement de la semaine), envoie le bilan par mail si la personne l'a demandé. */
async function autoMailReport() {
  const s = getState();
  if (DEMO || !signedIn() || !s.settings.reportEmail) return;
  const monday = lastWeekMonday(dayKey());
  if (s.ui.reportMailed === monday || monday < mondayOf(s.createdAt)) return;
  const { mailReport } = await import('../components/ReportSheet');
  await mailReport(monday).catch(() => undefined);
}
