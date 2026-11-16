// Récupère les pas, calories et passages à la salle envoyés par les Raccourcis iPhone.
import { api, DEMO } from './api';
import { addDays, dayKey } from './date';
import { signedIn } from './session';
import { ensureDay, getState, type HealthDay, setState } from './store';

export const SHORTCUT_NAME = 'Shred Santé';
export const STEP_GOAL = 8000;

interface Remote {
  today: string;
  days: Record<
    string,
    {
      health: { steps?: number; activeKcal?: number; restingKcal?: number; sleepMin?: number; restingHr?: number; hrv?: number; exerciseMin?: number; distanceKm?: number; at: string } | null;
      gym: { in?: string; out?: string; visits: number } | null;
    }
  >;
}

export function applyHealthDays(days: Record<string, HealthDay>) {
  // Rien de neuf : on ne touche pas à l'état (pas de sauvegarde inutile).
  const s = getState();
  const changed = Object.entries(days).some(([date, h]) => {
    const cur = s.health[date];
    return (Object.keys(h) as (keyof HealthDay)[]).some((k) => h[k] !== undefined && cur?.[k] !== h[k]);
  });
  if (!changed) return;
  setState((d) => {
    for (const [date, h] of Object.entries(days)) {
      d.health[date] = { ...d.health[date], ...h };
      // L'habitude « 8 000 pas » se coche toute seule quand l'objectif est atteint.
      if ((h.steps ?? 0) >= STEP_GOAL) ensureDay(d, date).habits.steps = true;
    }
    const cutoff = addDays(dayKey(), -60);
    for (const date of Object.keys(d.health)) if (date < cutoff) delete d.health[date];
  });
}

let inflight: Promise<void> | null = null;
let lastSync = 0;

export function syncHealth(force = false): Promise<void> {
  if (!force && Date.now() - lastSync < 60_000) return Promise.resolve();
  if (inflight) return inflight;
  lastSync = Date.now();
  inflight = (async () => {
    if (DEMO) {
      const today = dayKey();
      const demo: Record<string, HealthDay> = {};
      for (let i = 0; i < 14; i++) {
        const date = addDays(today, -i);
        demo[date] = {
          steps: i === 0 ? 6240 : Math.round(6500 + Math.sin(i * 1.9) * 2600 + (i % 3) * 700),
          active: i === 0 ? 380 : Math.round(420 + Math.sin(i * 1.3) * 140),
          resting: 1720,
          sleepMin: Math.round(430 + Math.sin(i * 2.3) * 55 - (i === 0 ? 70 : 0)),
          restingHr: Math.round(58 + Math.sin(i * 1.7) * 3 + (i === 0 ? 4 : 0)),
          hrv: Math.round(62 + Math.sin(i * 1.1) * 9 - (i === 0 ? 14 : 0)),
          exerciseMin: Math.round(38 + Math.sin(i * 1.5) * 20),
          distanceKm: Math.round((4.8 + Math.sin(i * 1.9) * 1.9) * 10) / 10,
          at: new Date().toISOString(),
          ...(i > 0 && i % 7 !== 3 && i % 7 !== 0 ? { gymIn: `${date}T16:40:00Z`, gymOut: `${date}T17:55:00Z`, gymVisits: 1 } : {}),
        };
      }
      applyHealthDays(demo);
      return;
    }
    if (!signedIn()) return;
    try {
      const res = await api<Remote>('/api/health/recent?days=14');
      const days: Record<string, HealthDay> = {};
      for (const [date, v] of Object.entries(res.days)) {
        days[date] = {
          steps: v.health?.steps,
          active: v.health?.activeKcal,
          resting: v.health?.restingKcal,
          sleepMin: v.health?.sleepMin,
          restingHr: v.health?.restingHr,
          hrv: v.health?.hrv,
          exerciseMin: v.health?.exerciseMin,
          distanceKm: v.health?.distanceKm,
          at: v.health?.at,
          gymIn: v.gym?.in,
          gymOut: v.gym?.out,
          gymVisits: v.gym?.visits,
        };
      }
      applyHealthDays(days);
    } catch {
      // Hors ligne ou serveur indisponible : on garde les dernières valeurs connues.
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Lance le Raccourci iPhone qui lit Apple Santé et envoie les chiffres au serveur. */
export function runShortcut() {
  window.location.href = `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}`;
}

export const timeOf = (iso?: string) =>
  iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';

export function gymDuration(h?: HealthDay): string | null {
  if (!h?.gymIn || !h.gymOut) return null;
  const min = Math.round((new Date(h.gymOut).getTime() - new Date(h.gymIn).getTime()) / 60000);
  if (min <= 0 || min > 600) return null;
  return min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`;
}
