// Sport de combat : la force reste dans les séances de muscu générées (full body athlétique) ; le cardio de combat
// devient un bloc de 8 semaines qui change chaque semaine, comme la préparation physique d'un club :
// - semaines 1 à 3, le moteur : du volume de rounds à allure régulière et de l'endurance continue ;
// - semaines 5 et 6, la tolérance à l'effort : rounds plus durs, repos plus courts, intervalles ;
// - semaine 7, la puissance : fins de round explosives, intervalles courts, sprints avec récupération complète ;
// - semaines 4 et 8 allégées (cardio et muscu), pour assimiler.
// À la fin, Pulse propose le bloc suivant, un cran plus fort (un round de plus tous les deux blocs).
import { catalogEntry } from './catalog';
import { mondayOf, weekPlans } from './plans';
import type { ExerciseSlot, Program, SessionDef } from './types';
import { tr } from './i18n';

/** La séance de cardio combat du générateur, remplacée ici par celles du bloc. */
export const FIGHT_CARDIO = 'gen-fight-cardio';

type Role = 'rounds' | 'engine' | 'power';
/** Les jours de cardio de la semaine, dans l'ordre : rounds d'abord, puis le moteur, puis l'explosivité. */
const ROLES: Role[] = ['rounds', 'engine', 'power'];

interface Week {
  /** Rounds de 3 min et repos (s). */
  rounds: number;
  rest: number;
  /** Consigne des rounds. */
  cue: string;
  /** Moteur : minutes d'endurance continue, ou intervalles [nombre, effort, récupération en clair, en secondes]. */
  engine: number | [number, string, string, number];
  /** Sprawls après les rounds. */
  sprawls: [number, string];
  light: boolean;
}

const steady = tr('Rythme régulier, technique propre : garde haute, menton rentré, et bouge entre les enchaînements.');
const finish = tr('À 80 % ; les 30 dernières secondes de chaque round, à fond.');

/** Le bloc semaine par semaine (avant le bonus des blocs suivants). */
const WEEKS: Week[] = [
  { rounds: 5, rest: 60, cue: steady, engine: 30, sprawls: [3, '8'], light: false },
  { rounds: 6, rest: 60, cue: steady, engine: 35, sprawls: [3, '10'], light: false },
  { rounds: 6, rest: 45, cue: finish, engine: 40, sprawls: [4, '10'], light: false },
  { rounds: 4, rest: 60, cue: tr('Semaine allégée : rounds souples, tout dans la technique.'), engine: 25, sprawls: [2, '8'], light: true },
  { rounds: 6, rest: 60, cue: finish, engine: [6, tr('2 min'), tr('1 min'), 60], sprawls: [4, '10'], light: false },
  { rounds: 7, rest: 45, cue: tr('Allure de combat du début à la fin : ne descends jamais sous 80 %.'), engine: [8, tr('1 min'), tr('1 min'), 60], sprawls: [4, '12'], light: false },
  { rounds: 6, rest: 60, cue: tr('Toutes les 30 s, 5 s d’explosion : un enchaînement de 4 à 6 coups à pleine vitesse, puis reprends ton rythme.'), engine: [10, tr('30 s'), tr('30 s'), 30], sprawls: [5, '8'], light: false },
  { rounds: 4, rest: 60, cue: tr('Semaine allégée : rounds souples, tout dans la technique.'), engine: 25, sprawls: [2, '8'], light: true },
];

function session(id: string, name: string, focus: string, exercises: ExerciseSlot[]): SessionDef {
  return { id, name, focus, type: 'cardio', generated: true, exercises };
}

function rounds(id: string, w: Week, extra: number): SessionDef {
  const n = w.rounds + (w.light ? 0 : extra);
  return session(id, tr('Rounds de combat'), tr('{n} rounds de 3 min, {rest} s de repos', { n, rest: w.rest }), [
    { key: 'jump-rope', sets: w.light ? 2 : 3, reps: tr('3 min'), rest: 45, note: tr('Échauffement : sauts bas et réguliers.') },
    { key: 'bag-rounds', sets: n, reps: tr('3 min'), rest: w.rest, note: w.cue },
    { key: 'sprawl', sets: w.sprawls[0], reps: w.sprawls[1], rest: 45 },
    { key: 'neck-flexion', sets: 2, reps: '15', rest: 45 },
    { key: 'neck-extension', sets: 2, reps: '15', rest: 45 },
  ]);
}

function engine(id: string, w: Week, extra: number): SessionDef {
  if (typeof w.engine === 'number') {
    const min = w.engine + (w.light ? 0 : 5 * extra);
    return session(id, tr('Moteur aérobie'), tr('{n} min en endurance : tu peux parler en phrases courtes', { n: min }), [
      { key: 'running', sets: 1, reps: tr('{n} min', { n: min }), note: tr('Course, vélo ou rameur : une allure que tu tiendrais une heure. C’est ce qui te fait récupérer entre les rounds.') },
      { key: 'mobility' },
    ]);
  }
  const [count, work, rec, recSec] = w.engine;
  const n = count + 2 * extra;
  return session(id, tr('Intervalles'), tr('{n} × {work} fort, {rest} facile', { n, work, rest: rec }), [
    { key: 'run-warmup', sets: 1, reps: tr('10 min'), note: tr('Très facile, sur vélo, rameur ou en courant.') },
    { key: 'intervals', sets: n, reps: work, rest: recSec, note: tr('{work} fort, puis {rest} facile (le temps de repos), sur vélo, rameur ou en courant. Chaque répétition à la même intensité.', { work, rest: rec }) },
    { key: 'plank', sets: 3 },
  ]);
}

function power(id: string, w: Week, extra: number): SessionDef {
  if (w.light) {
    return session(id, tr('Explosivité'), tr('Semaine allégée : vitesse sans fatigue'), [
      { key: 'jump-rope', sets: 2, reps: tr('3 min'), rest: 60 },
      { key: 'med-ball-slam', sets: 3, reps: '6', rest: 60 },
      { key: 'mobility' },
    ]);
  }
  return session(id, tr('Explosivité'), tr('Sprints courts et frappes : la puissance des fins de round'), [
    { key: 'jump-rope', sets: 2, reps: tr('3 min'), rest: 45 },
    { key: 'sprint', sets: 6 + 2 * extra, reps: tr('10 s'), rest: 50, note: tr('À fond, puis récupère complètement en marchant : la qualité avant tout.') },
    { key: 'med-ball-slam', sets: 4, reps: '8', rest: 60 },
    { key: 'sprawl', sets: 3, reps: '8', rest: 45 },
    { key: 'box-jump', sets: 3, reps: '5', rest: 90 },
  ]);
}

const BUILD: Record<Role, (id: string, w: Week, extra: number) => SessionDef> = { rounds, engine, power };

/** Semaine allégée : un tiers de séries en moins sur les séances de muscu. */
function lighter(def: SessionDef): SessionDef {
  return {
    ...def,
    id: `${def.id}-light`,
    name: tr('{name}, allégée', { name: def.name }),
    generated: true,
    exercises: def.exercises.map((x) => ({ ...x, sets: Math.max(1, Math.round(((x.sets ?? catalogEntry(x.key)?.defaults.sets ?? 3) * 2) / 3)) })),
  };
}

/**
 * Transforme le programme du générateur (muscu + une séance de cardio combat répétée) en bloc de 8 semaines :
 * chaque jour de cardio reçoit son rôle (rounds, moteur, explosivité) et ses chiffres de la semaine.
 */
export function combatBlock(program: Program, today: string, blockNumber = 1): Program {
  const block = Math.max(1, blockNumber);
  const extra = Math.min(2, Math.floor((block - 1) / 2));
  const order = [1, 2, 3, 4, 5, 6, 0];
  const cardioDays = order.filter((wd) => program.schedule[wd] === FIGHT_CARDIO);
  if (!cardioDays.length) return program;
  const lifting = program.sessions.filter((x) => x.type === 'lifting');
  const light = new Map(lifting.map((x) => [x.id, lighter(x)]));
  const sessions: SessionDef[] = program.sessions.filter((x) => x.id !== FIGHT_CARDIO);
  sessions.push(...light.values());
  const weeks: string[][] = [];
  const phases: string[] = [];
  weekPlans(WEEKS.length, 0).forEach((plan, i) => {
    const w = WEEKS[i];
    const week = program.schedule.map((id) => (w.light && light.has(id) ? light.get(id)!.id : id));
    cardioDays.forEach((wd, k) => {
      const def = BUILD[ROLES[k % ROLES.length]](`fc-w${i + 1}-${ROLES[k % ROLES.length]}`, w, extra);
      sessions.push(def);
      week[wd] = def.id;
    });
    weeks.push(week);
    const phase = plan.phase === tr('Spécifique') ? tr('Intensification') : plan.phase;
    phases.push(plan.recovery ? tr('{phase}, semaine allégée', { phase }) : phase);
  });
  return {
    ...program,
    name: block > 1 ? tr('{name}, bloc {n}', { name: program.name, n: block }) : program.name,
    sessions,
    // Avant et après le bloc : une semaine type de développement.
    schedule: weeks[4],
    start: mondayOf(today),
    weeks,
    phases,
    meta: { physique: program.meta?.physique ?? 'athletic', priorities: program.meta?.priorities ?? [], generatedAt: today, block },
  };
}
