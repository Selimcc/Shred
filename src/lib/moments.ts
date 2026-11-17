// Les petits moments de fête de Pulse : séance validée, record, habitudes du jour, objectif de pas, publication,
// étincelles reçues. Ils sont détectés au changement d'état (quelle que soit la source : bouton, série cochée,
// sortie Strava, montre), pas au lancement de l'app.
import { STEP_GOAL } from './health';
import { dayKey } from './date';
import { CHALLENGE_XP, mealsCount, sessionFor } from './logic';
import { completeChallenges } from './club';
import { DEMO } from './api';
import { signedIn } from './session';
import { type AppState, getState, setState, subscribe } from './store';
import { e1rm } from './strength';
import { loc, tn, tr } from '../../shared/i18n';

export type MomentKind = 'session' | 'record' | 'habits' | 'steps' | 'post' | 'spark' | 'challenge' | 'trophy' | 'plates';

export interface Moment {
  id: number;
  kind: MomentKind;
  title: string;
  text?: string;
}

const listeners = new Set<(m: Moment) => void>();
let seq = 0;

export function moment(kind: MomentKind, title: string, text?: string) {
  const m: Moment = { id: ++seq, kind, title, text };
  for (const l of listeners) l(m);
}

export function onMoment(fn: (m: Moment) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Cette série bat-elle le meilleur 1RM estimé de l'exercice (hors cette série) ? Il faut un historique. */
export function isRecord(s: AppState, key: string, date: string, index: number): { w: number; r: number } | null {
  const log = s.days[date]?.sets[key]?.[index];
  if (!log?.done || !log.w || !log.r) return null;
  let best = 0;
  let history = false;
  for (const [d, day] of Object.entries(s.days)) {
    (day.sets[key] ?? []).forEach((l, i) => {
      if (!l.done || !l.w || !l.r || (d === date && i === index)) return;
      if (d !== date) history = true;
      best = Math.max(best, e1rm(l.w, l.r));
    });
  }
  return history && e1rm(log.w, log.r) > best + 0.01 ? { w: log.w, r: log.r } : null;
}

interface Snap {
  date: string;
  done: boolean;
  habits: boolean;
  steps: boolean;
}

function snap(s: AppState): Snap {
  const date = dayKey();
  const day = s.days[date];
  return {
    date,
    done: Boolean(day?.mainDone),
    habits: s.habits.length > 0 && s.habits.every((h) => day?.habits[h.id]),
    steps: (s.health[date]?.steps ?? 0) >= STEP_GOAL,
  };
}

/** Surveille l'état : chaque passage de « pas encore » à « fait » aujourd'hui donne un moment. */
export function startMoments() {
  let last = snap(getState());
  subscribe(() => {
    const s = getState();
    const now = snap(s);
    if (now.date !== last.date) {
      last = now;
      return;
    }
    if (now.done && !last.done) {
      const session = sessionFor(s, now.date);
      const day = s.days[now.date];
      const sets = Object.values(day?.sets ?? {}).reduce((n, l) => n + l.filter((x) => x.done).length, 0);
      const meals = day ? mealsCount(day) : 0;
      moment(
        'session',
        session.type === 'rest' ? tr('Récup validée') : tr('Séance validée'),
        `${session.name}${session.lifting && sets ? tr(', {sets} séries', { sets }) : ''}. +50 XP${meals < s.settings.goal.minMeals ? tr(', note tes repas pour la flamme') : ''}`,
      );
      // Une séance validée relève aussi les défis reçus encore ouverts.
      if (DEMO || signedIn()) {
        void completeChallenges(getState())
          .then((done) => {
            if (!done.length) return;
            setState((d) => void (d.club = { sparks: d.club?.sparks ?? 0, challenges: (d.club?.challenges ?? 0) + done.length }));
            const who = done.map((c) => c.fromName).join(', ');
            const plates = done.reduce((n, c) => n + (c.stake ?? 0), 0);
            const won = plates ? tn(plates, ', +{n} disque', ', +{n} disques') : '';
            setTimeout(() => moment('challenge', done.length > 1 ? tr('{length} défis relevés', { length: done.length }) : tr('Défi relevé'), tr('{who} est prévenu. +{n} XP{won}', { who, n: CHALLENGE_XP * done.length, won })), 3600);
          })
          .catch(() => undefined);
      }
    } else if (now.habits && !last.habits) {
      moment('habits', tr('Habitudes du jour bouclées'), tr('{length} sur {length}, propre.', { length: s.habits.length }));
    } else if (now.steps && !last.steps) {
      moment('steps', tr('{STEP_GOAL} pas', { STEP_GOAL: STEP_GOAL.toLocaleString(loc()) }), tr('Objectif atteint, l’habitude est cochée.'));
    }
    last = now;
  });
}
