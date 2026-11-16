import { closeDeload } from './recovery';
import { api, DEMO } from './api';
import { startBackup } from './backup';
import { startProfileSync } from './profile';
import { lastWeekMonday } from './report';
import { addDays, dayKey, mondayOf } from './date';
import { syncHealth } from './health';
import { dayValidated, mealsCount, reconcileStreak, sessionFor, streakInfo } from './logic';
import { signedIn } from './session';
import { getState, readDay, setState, subscribe } from './store';

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
    mainDone: day.mainDone,
    meals: mealsCount(day),
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
  subscribe(() => schedule());
  startBackup();
  startProfileSync();
  setTimeout(() => void autoMailReport(), 8000);
  void syncHealth(true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      tick();
      schedule(300);
      void syncHealth(true);
    }
  });
  setInterval(tick, 60_000);
  schedule(500);
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
