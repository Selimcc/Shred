// Données d'exemple pour l'aperçu en mode démo uniquement.
import { DEFAULT_MEAL_PLAN as PLANNED_MEALS, findSession, resolveSession } from '../../shared/program';
import { DEFAULT_PROGRAM } from '../../shared/templates';
import { addDays, dayKey, weekdayOf } from './date';
import type { AppState, DayLog } from './store';
import { tr } from '../../shared/i18n';

export function demoState(base: AppState): AppState {
  const today = dayKey();
  const start = addDays(today, -24);
  const missed = addDays(today, -9);
  const days: Record<string, DayLog> = {};
  const weight: Record<string, number> = {};
  const waist: Record<string, number> = {};
  const loads: Record<string, number> = {
    'incline-db-press': 24, 'db-shoulder-press': 20, dips: 10, 'db-lateral-raise': 8, 'rope-pushdown': 25,
    'overhead-triceps': 20, 'cable-crunch': 35, pullup: 5, 'barbell-row': 60, 'neutral-pulldown': 55,
    'rear-delt': 25, 'cable-lateral-raise': 6, 'incline-curl': 11, 'hammer-curl': 14, 'neck-flexion': 5,
    'neck-extension': 7.5, squat: 85, rdl: 80, 'leg-press': 160, 'leg-curl': 40, 'leg-extension': 45,
    'standing-calf': 70, bench: 70, 'db-row': 28, 'wide-pulldown': 55, 'low-high-fly': 12, 'face-pull': 20,
    'arms-superset': 25, deadlift: 115, bulgarian: 16, 'hack-squat': 80, 'seated-calf': 40,
  };

  for (let i = 0; i < 24; i++) {
    const d = addDays(start, i);
    const session = resolveSession(findSession(DEFAULT_PROGRAM, DEFAULT_PROGRAM.schedule[weekdayOf(d)]));
    const ok = d !== missed;
    const sets: DayLog['sets'] = {};
    if (ok && session.lifting) {
      for (const ex of session.exercises) {
        const w = loads[ex.key];
        const reps = ex.repMax ?? 10;
        sets[ex.key] = Array.from({ length: ex.sets }, (_, j) => ({
          w: ex.noLoad ? undefined : w,
          r: Math.max(ex.repMin ?? 8, reps - j),
          done: true,
        }));
        if (w !== undefined) loads[ex.key] = Math.round((w + (ex.step ?? 2.5) / 4) * 4) / 4;
      }
    } else if (ok) {
      sets[session.exercises[0].key] = Array.from({ length: session.exercises[0].sets }, () => ({ done: true }));
      // Un footing ou une sortie vélo les jours sans muscu : de quoi remplir les stats d'endurance.
      const grow = 1 + i / 60;
      if (i % 2 === 0) sets['run-easy'] = [{ done: true, km: Math.round(7.2 * grow * 10) / 10, min: Math.round(42 * grow) }];
      else sets['bike-endurance'] = [{ done: true, km: Math.round(31 * grow), min: Math.round(70 * grow) }];
    }
    const meals = PLANNED_MEALS.filter((m) => m.slot !== 'extra' && m.id !== 'fish-dinner')
      .slice(0, ok ? 4 : 1)
      .map((m, j) => ({ ...m, id: `${d}-${j}`, planId: m.id, source: 'plan' as const, at: 0 }));
    days[d] = { sets, mainDone: ok, meals, habits: { creatine: true, steps: i % 3 !== 0 } };
    if (i % 5 !== 3) weight[d] = Math.round((75.1 - i * 0.075 + Math.sin(i * 1.7) * 0.35) * 10) / 10;
    if (weekdayOf(d) === 0) waist[d] = Math.round((82.5 - i * 0.085) * 10) / 10;
  }
  // Trois mois de sèche avant : pesées et tour de taille, pour que le corps estimé ait de quoi comparer.
  for (let i = -70; i < 0; i++) {
    const d = addDays(start, i);
    if (i % 3 !== 1) weight[d] = Math.round((75.1 - i * 0.075 + Math.sin(i * 1.7) * 0.35) * 10) / 10;
    if (weekdayOf(d) === 0) waist[d] = Math.round((82.5 - i * 0.085) * 10) / 10;
  }

  days[today] = {
    sets: {},
    mainDone: false,
    meals: [{ ...PLANNED_MEALS[0], id: `${today}-0`, planId: PLANNED_MEALS[0].id, source: 'plan', at: 0 }],
    habits: { creatine: true },
  };
  weight[today] = Math.round((75.1 - 24 * 0.075) * 10) / 10;

  return {
    ...base,
    createdAt: start,
    settings: {
      ...base.settings,
      onboarded: true,
      age: 29,
      height: 178,
      ai: 'api',
      coachNotes: tr('Objectif : sèche en gardant mes charges. Meal prep le dimanche, budget serré.'),
      athlete: { ...base.settings.athlete, physique: 'aesthetic', priorities: ['delts', 'back'], days: 5, minutes: 75 },
    },
    days,
    body: { weight, waist },
    streak: { banked: 0, best: 0, freezes: 1, through: addDays(start, -1), frozen: [] },
  };
}
