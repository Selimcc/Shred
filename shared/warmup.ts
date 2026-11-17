// Échauffement avant la séance, choisi d'après ce qu'elle va faire travailler. Toujours court et dans le même ordre :
// on monte la température, on mobilise les articulations qui vont servir, on réveille les muscles clés, puis on
// prépare le premier gros effort (séries d'approche à la barre, gammes et accélérations en course).
// Calculs purs et sans affichage : l'écran de séance, le mode séance et le connecteur Claude s'en servent.
import { has, type Gym } from './athlete';
import { catalogEntry, DISCIPLINE_NAMES, GROUP_NAMES } from './catalog';
import type { CatalogEntry, Discipline, Exercise, MuscleGroup, Session } from './types';
import { lower, tr } from './i18n';

/** Monter la température, mobiliser, activer, préparer le premier effort. */
export type WarmPhase = 'raise' | 'mobilise' | 'activate' | 'prime';
const PHASES: WarmPhase[] = ['raise', 'mobilise', 'activate', 'prime'];

export interface WarmMove {
  key: string;
  name: string;
  cue: string;
  phase: WarmPhase;
  /** Au chrono, en secondes. */
  sec?: number;
  /** En répétitions, éventuellement par côté. */
  reps?: number;
  side?: boolean;
}

/** Séries d'approche du premier exercice chargé : barre vide puis paliers, de moins en moins de reps. */
export interface WarmRamp {
  key: string;
  name: string;
  work: number;
  sets: { w: number; r: number }[];
}

export interface Warmup {
  /** Ce que la séance fait travailler, en clair : « Pecs, épaules, bras », « Course ». */
  focus: string;
  moves: WarmMove[];
  ramp?: WarmRamp;
  /** La suite, à faire une fois lancé : le début du plan, des accélérations. */
  then?: string;
  /** Durée estimée des mouvements (les séries d'approche se font à la salle, avant la première série). */
  min: number;
}

type Dose = Pick<WarmMove, 'sec' | 'reps' | 'side'>;
type Def = Omit<WarmMove, 'key'>;

/** La bibliothèque des mouvements d'échauffement. */
export const WARM_MOVES = {
  // Monter la température
  'easy-cardio': { name: tr('Cardio tranquille'), cue: tr('Tu dois pouvoir parler : on fait juste monter la température.'), phase: 'raise', sec: 150 },
  'jumping-jacks': { name: tr('Jumping jacks'), cue: tr('Rythme tranquille, les bras montent au-dessus de la tête.'), phase: 'raise', sec: 60 },
  'easy-jog': { name: tr('Footing très lent'), cue: tr('Plus lent que ton footing habituel. À la salle, rameur ou vélo tranquille.'), phase: 'raise', sec: 180 },
  'rope-easy': { name: tr('Corde à sauter, tranquille'), cue: tr('Petits sauts sur l’avant du pied. Sans corde, sautille sur place.'), phase: 'raise', sec: 120 },
  // Mobiliser
  'arm-circles': { name: tr('Cercles de bras'), cue: tr('Petits cercles puis grands, vers l’avant puis vers l’arrière.'), phase: 'mobilise', sec: 30 },
  'shoulder-pass': { name: tr('Passages d’épaules au bâton'), cue: tr('Bâton ou serviette tenu large, bras tendus : passe de l’avant à l’arrière sans forcer.'), phase: 'mobilise', reps: 10 },
  'thoracic-rotation': { name: tr('Rotations du haut du dos'), cue: tr('À quatre pattes, une main derrière la tête : ouvre le coude vers le plafond et suis-le des yeux.'), phase: 'mobilise', reps: 6, side: true },
  'cat-camel': { name: tr('Dos rond, dos creux'), cue: tr('À quatre pattes, enroule puis creuse le dos, lentement, en respirant.'), phase: 'mobilise', reps: 8 },
  'neck-mobility': { name: tr('Mobilité du cou'), cue: tr('Oui, non, oreille vers l’épaule : lentement, sans rouler la tête en arrière.'), phase: 'mobilise', sec: 30 },
  'leg-swings': { name: tr('Balancés de jambe'), cue: tr('Une main sur un appui, la jambe balance d’avant en arrière, de plus en plus haut.'), phase: 'mobilise', reps: 10, side: true },
  'leg-swings-side': { name: tr('Balancés de jambe sur le côté'), cue: tr('Face à un appui, la jambe passe devant toi puis s’ouvre sur le côté.'), phase: 'mobilise', reps: 10, side: true },
  'worlds-greatest': { name: tr('Fente avec rotation'), cue: tr('Grande fente, main au sol à l’intérieur du pied avant, puis ouvre l’autre bras vers le plafond.'), phase: 'mobilise', reps: 5, side: true },
  'ankle-rocks': { name: tr('Chevilles au mur'), cue: tr('Pied à une main du mur : avance le genou vers le mur sans décoller le talon.'), phase: 'mobilise', reps: 10, side: true },
  'deep-squat': { name: tr('Squat profond tenu'), cue: tr('Tout en bas, talons au sol, coudes qui écartent les genoux. Respire.'), phase: 'mobilise', sec: 30 },
  'hip-hinge': { name: tr('Charnière de hanche'), cue: tr('Mains sur les hanches, recule les fesses dos plat jusqu’à sentir l’arrière des cuisses.'), phase: 'mobilise', reps: 10 },
  'hip-circles': { name: tr('Cercles de hanche'), cue: tr('Debout sur une jambe, le genou dessine de grands cercles vers l’extérieur.'), phase: 'mobilise', reps: 6, side: true },
  inchworm: { name: tr('Chenille'), cue: tr('Mains au sol, avance sur les mains jusqu’à la planche, puis ramène les pieds en marchant.'), phase: 'mobilise', reps: 5 },
  streamline: { name: tr('Étirement en flèche'), cue: tr('Bras tendus au-dessus de la tête, mains l’une sur l’autre : grandis-toi, côtes rentrées.'), phase: 'mobilise', sec: 20 },
  // Activer
  'scap-pushup': { name: tr('Pompes omoplates'), cue: tr('En planche bras tendus : laisse la poitrine descendre entre les omoplates, puis repousse le sol.'), phase: 'activate', reps: 10 },
  ytw: { name: tr('Y, T, W penché'), cue: tr('Buste penché, dos plat : 5 bras en Y, 5 en T, 5 en W, en serrant les omoplates.'), phase: 'activate', reps: 15 },
  'face-pull-light': { name: tr('Face pull très léger'), cue: tr('Corde à hauteur des yeux, tire vers le front en écartant les mains. Charge minimale.'), phase: 'activate', reps: 15 },
  'scap-pullup': { name: tr('Tractions omoplates'), cue: tr('Suspendu bras tendus : abaisse les épaules sans plier les coudes.'), phase: 'activate', reps: 8 },
  'external-rotation': { name: tr('Rotations externes'), cue: tr('Coude collé au corps, ouvre l’avant-bras vers l’extérieur. Élastique, poulie légère ou à vide.'), phase: 'activate', reps: 12, side: true },
  'glute-bridge': { name: tr('Pont fessier'), cue: tr('Pousse dans les talons, serre les fessiers une seconde en haut.'), phase: 'activate', reps: 12 },
  'bw-squat': { name: tr('Squats au poids du corps'), cue: tr('Lents et complets, genoux dans l’axe des pieds.'), phase: 'activate', reps: 10 },
  'reverse-lunge': { name: tr('Fentes arrière'), cue: tr('Grand pas en arrière, le genou frôle le sol, buste droit.'), phase: 'activate', reps: 5, side: true },
  'calf-raise': { name: tr('Montées sur pointes'), cue: tr('Monte haut, redescends lentement.'), phase: 'activate', reps: 15 },
  'dead-bug': { name: tr('Dead bug'), cue: tr('Bas du dos plaqué au sol : tends le bras et la jambe opposés, lentement.'), phase: 'activate', reps: 6, side: true },
  'bird-dog': { name: tr('Bird dog'), cue: tr('À quatre pattes, tends le bras et la jambe opposés sans bouger le bassin.'), phase: 'activate', reps: 6, side: true },
  // Préparer le premier effort
  'high-knees': { name: tr('Montées de genoux'), cue: tr('Sur place ou sur 20 m : genoux à hauteur de hanche, bras actifs.'), phase: 'prime', sec: 20 },
  'butt-kicks': { name: tr('Talons-fesses'), cue: tr('Petits pas rapides, les talons viennent toucher les fesses.'), phase: 'prime', sec: 20 },
  'shadow-light': { name: tr('Shadow boxing léger'), cue: tr('Garde haute, déplacements, coups relâchés à la moitié de ta vitesse.'), phase: 'prime', sec: 120 },
  'first-light': { name: tr('Série légère'), cue: tr('12 reps à environ la moitié de ta charge, sans forcer.'), phase: 'prime', reps: 12 },
} satisfies Record<string, Def>;

export type WarmKey = keyof typeof WARM_MOVES;

const move = (key: WarmKey, patch: Partial<Def> = {}): WarmMove => ({ key, ...(WARM_MOVES[key] as Def), ...patch });

/** « 30 s », « 3 min », « 10 reps », « 6 par côté ». */
export function fmtDose(m: Dose): string {
  if (m.sec) return m.sec >= 60 ? `${Math.floor(m.sec / 60)} min${m.sec % 60 ? ` ${m.sec % 60}` : ''}` : `${m.sec} s`;
  if (m.reps) return m.side ? tr('{reps} par côté', { reps: m.reps }) : tr('{reps} reps', { reps: m.reps });
  return '';
}

/** Temps d'un mouvement, transition comprise : 3 s par rep, deux fois par côté. */
export function moveSeconds(m: Dose): number {
  return (m.sec ?? (m.reps ?? 0) * 3 * (m.side ? 2 : 1)) + 10;
}

/* ---------- Séries d'approche ---------- */

/** Exercice à la barre olympique (20 kg), où le calcul des disques a un sens. */
export function isBarbell(key: string, name: string): boolean {
  if (/poulie|guidée|smith|machine|haltère|ez\b|trap/i.test(name)) return false;
  return /\bbarre\b/i.test(name) || ['bench', 'squat', 'deadlift', 'barbell-row', 'military-press', 'front-squat', 'rdl', 'hip-thrust'].includes(key);
}

/**
 * Échauffement avant la première série lourde : barre vide puis paliers à 50, 70 et 85 %, de moins en moins de
 * reps pour arriver frais. Charges arrondies au pas de l'exercice.
 */
export function warmupSets(work: number, step = 2.5, barbell = true): { w: number; r: number }[] {
  if (!(work > 0)) return [];
  const round = (x: number) => Math.max(step, Math.round(x / step) * step);
  const out: { w: number; r: number }[] = [];
  if (barbell && work > 30) out.push({ w: 20, r: 10 });
  for (const [pct, r] of [
    [0.5, 6],
    [0.7, 4],
    [0.85, 2],
  ] as const) {
    const w = round(work * pct);
    if (w < work && (!out.length || w > out[out.length - 1].w)) out.push({ w, r });
  }
  return out;
}

/** Au poids du corps d'abord (la charge notée est un lest) : pas de séries d'approche. */
const BODYWEIGHT = new Set(['pullup', 'chin-up', 'dips', 'pushup']);

/**
 * Le premier gros mouvement de la séance, s'il est chargé : c'est lui que les séries d'approche préparent.
 * Une séance qui commence par des tractions ou des dips n'en a pas (on ne prépare pas le deuxième exercice avant le premier).
 */
export function firstLoaded(exercises: Exercise[]): Exercise | undefined {
  const first = exercises.find((x) => x.kind === 'compound' && !x.discipline);
  return first && !first.noLoad && !BODYWEIGHT.has(first.key) ? first : undefined;
}

/* ---------- Ce que la séance fait travailler ---------- */

const OVERHEAD = new Set(['military-press', 'db-shoulder-press', 'arnold-press', 'machine-shoulder-press', 'wall-ball']);
const PULL_KEYS = new Set(['rear-delt', 'face-pull', 'sled-pull', 'farmer-walk']);
const SQUAT_KEYS = new Set(['squat', 'front-squat', 'smith-squat', 'goblet-squat', 'leg-press', 'hack-squat', 'bulgarian', 'lunge', 'walking-lunge', 'leg-extension', 'box-jump', 'sled-push', 'wall-ball', 'sandbag-lunge', 'burpee-broad-jump']);
const HINGE_KEYS = new Set(['deadlift', 'sumo-deadlift', 'rdl', 'good-morning', 'hip-thrust', 'leg-curl', 'kettlebell-swing', 'hip-abduction']);
const BAR_KEYS = new Set(['pullup', 'chin-up']);
/** Les stations d'Hyrox : course et stations s'enchaînent, l'échauffement couvre tout le corps. */
const HYROX_KEYS = new Set(['sled-push', 'sled-pull', 'wall-ball', 'sandbag-lunge', 'burpee-broad-jump', 'ski-erg', 'hyrox-sim', 'farmer-walk']);

interface Load {
  push: number;
  overhead: number;
  pull: number;
  squat: number;
  hinge: number;
  calves: number;
  core: number;
  neck: number;
  bar: boolean;
  groups: Partial<Record<MuscleGroup, number>>;
}

function loadOf(exercises: Exercise[], custom: Record<string, CatalogEntry>): Load {
  const l: Load = { push: 0, overhead: 0, pull: 0, squat: 0, hinge: 0, calves: 0, core: 0, neck: 0, bar: false, groups: {} };
  for (const ex of exercises) {
    if (ex.kind === 'task' || (ex.kind === 'cardio' && !HYROX_KEYS.has(ex.key))) continue;
    const e = catalogEntry(ex.key, custom);
    const group = e?.group ?? 'other';
    const name = (e?.name ?? ex.name).toLowerCase();
    const w = ex.kind === 'compound' || ex.kind === 'power' ? 2 : 1;
    const k = ex.key;
    if (BAR_KEYS.has(k)) l.bar = true;
    if (OVERHEAD.has(k)) l.overhead += w;
    if (SQUAT_KEYS.has(k)) l.squat += w;
    else if (HINGE_KEYS.has(k)) l.hinge += w;
    else if (group === 'legs') {
      if (/mollet|calf/.test(name) || k.includes('calf')) l.calves += w;
      else if (/soulev|deadlift|roumain|ischio|fessier|hip/.test(name)) l.hinge += w;
      else l.squat += w;
    }
    if (group === 'chest' || k === 'dips' || k === 'wall-ball') l.push += w;
    else if (group === 'shoulders') {
      if (PULL_KEYS.has(k) || /oiseau|arrière|face pull/.test(name)) l.pull += w;
      else l.push += w;
      if (!OVERHEAD.has(k) && /militaire|press|développé/.test(name)) l.overhead += w;
    } else if (group === 'back' || PULL_KEYS.has(k)) l.pull += w;
    else if (group === 'arms') {
      if (/curl|biceps/.test(name)) l.pull += w;
      else l.push += w;
    } else if (group === 'core') l.core += w;
    else if (group === 'neck') l.neck += w;
    if (group !== 'other' && group !== 'cardio') l.groups[group] = (l.groups[group] ?? 0) + w;
  }
  return l;
}

/** « Pecs, épaules et bras » : les trois zones les plus sollicitées. */
function focusOf(l: Load): string {
  const top = (Object.entries(l.groups) as [MuscleGroup, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([g]) => lower(GROUP_NAMES[g]));
  if (!top.length) return tr('Tout le corps');
  const text = top.length > 1 ? tr('{join} et {top}', { join: top.slice(0, -1).join(', '), top: top[top.length - 1] }) : top[0];
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* ---------- Les échauffements ---------- */

type Machine = [Parameters<typeof has>[1], string];

/** La machine pour monter la température : celle qui sert le plus la séance, parmi celles de la salle. */
function raise(gym: Gym | undefined, up: number, low: number): WarmMove {
  const lower = low > 0 && up * 2 <= low;
  const upper = up > 0;
  const bike: Machine = ['bike', tr('Vélo tranquille')];
  const rower: Machine = ['rower', tr('Rameur tranquille')];
  const tread: Machine = ['treadmill', tr('Tapis, marche rapide')];
  const order = lower || !upper ? [bike, rower, tread] : [rower, ['skierg', tr('SkiErg tranquille')] as Machine, bike, tread];
  const found = order.find(([e]) => has(gym, e));
  return found ? move('easy-cardio', { name: found[1] }) : move('jumping-jacks');
}

/** Combien de places pour le haut et pour le bas du corps : la moitié qui domine la séance en prend plus. */
function split(total: number, up: number, low: number): [number, number] {
  if (!up) return [0, total];
  if (!low) return [total, 0];
  const minor = up >= 2 * low || low >= 2 * up ? 1 : Math.floor(total / 2);
  return up >= low ? [total - minor, minor] : [minor, total - minor];
}

function liftWarmup(exercises: Exercise[], l: Load, gym: Gym | undefined, ramp: WarmRamp | undefined): Omit<Warmup, 'min'> {
  const up = l.push + l.pull + l.neck;
  const low = l.squat + l.hinge + l.calves;
  const moves: WarmMove[] = [];
  // La séance commence par un bloc de cardio : il fait déjà monter la température.
  const first = exercises[0];
  if (!(first && (first.kind === 'cardio' || first.discipline))) moves.push(raise(gym, up, low));

  const pushFirst = l.overhead > 0 || l.push >= l.pull;
  const upMob = [move('arm-circles'), ...(pushFirst ? [move('shoulder-pass'), ...(l.pull ? [move('thoracic-rotation')] : [])] : [move('thoracic-rotation'), ...(l.push ? [move('shoulder-pass')] : [])])];
  const squatFirst = l.squat >= l.hinge;
  const squatMob = move(l.squat >= 4 ? 'deep-squat' : 'ankle-rocks');
  const lowMob = [
    move('leg-swings'),
    ...(l.squat || l.hinge ? (squatFirst ? [squatMob, ...(l.hinge ? [move('hip-hinge')] : [])] : [move('hip-hinge'), ...(l.squat ? [squatMob] : [])]) : [move('ankle-rocks')]),
    move('worlds-greatest'),
  ];
  if (!up && !low) moves.push(move('cat-camel'), move('worlds-greatest'));
  else {
    const [mu, ml] = split(up && low ? 4 : 3, up, low);
    moves.push(...upMob.slice(0, mu), ...lowMob.slice(0, ml));
  }
  if (l.neck) moves.push(move('neck-mobility'));

  const pullAct = l.bar && has(gym, 'pullup') ? move('scap-pullup') : has(gym, 'cables') ? move('face-pull-light') : move('ytw');
  const upAct = [
    ...(l.push >= l.pull ? [move('scap-pushup'), ...(l.pull ? [pullAct] : [])] : [pullAct, ...(l.push ? [move('scap-pushup')] : [])]),
    ...(l.overhead && !l.pull ? [move('external-rotation')] : []),
  ];
  const lowAct = l.squat || l.hinge ? (squatFirst ? [move('bw-squat'), ...(l.hinge ? [move('glute-bridge')] : [])] : [move('glute-bridge'), ...(l.squat ? [move('bw-squat')] : [])]) : [move('calf-raise')];
  if (!up && !low) moves.push(move('dead-bug'), move('bird-dog'));
  else {
    const [au, al] = split(up && low ? 3 : 2, up, low);
    moves.push(...upAct.slice(0, au), ...lowAct.slice(0, al));
    if (l.core >= 3 && moves.length < 8) moves.push(move('dead-bug'));
  }

  // La première série lourde : séries d'approche si on connaît ta charge, sinon une série légère.
  const main = firstLoaded(exercises);
  if (!ramp && main) moves.push(move('first-light', { name: tr('Série légère : {replace}', { replace: main.name.replace(/ \(.*\)$/, '') }) }));
  return { focus: focusOf(l), moves, ramp };
}

const startsWith = (exercises: Exercise[], key: RegExp) => exercises.length > 0 && key.test(exercises[0].key);
const intense = (exercises: Exercise[]) => exercises.some((x) => (x.zone ?? 0) >= 4);

function enduranceWarmup(d: Discipline, exercises: Exercise[]): Omit<Warmup, 'min'> {
  const hard = intense(exercises);
  const focus = DISCIPLINE_NAMES[d];
  switch (d) {
    case 'run': {
      const race = exercises.some((x) => x.key === 'race-day');
      const moves = [move('leg-swings'), move('leg-swings-side'), move('worlds-greatest'), move('ankle-rocks'), move('glute-bridge')];
      if (hard || race) moves.push(move('high-knees'), move('butt-kicks'));
      const then = race
        ? tr('Ensuite 15 min de footing très facile et 3 ou 4 accélérations. Sur la ligne 10 min avant le départ.')
        : startsWith(exercises, /warmup/)
          ? hard
            ? tr('Ton plan commence par le footing d’échauffement : finis-le par 3 accélérations de 80 m.')
            : tr('Ton plan commence par le footing d’échauffement : garde-le vraiment facile.')
          : hard
            ? tr('Avant la partie rapide : 10 à 15 min de footing facile, puis 3 accélérations de 80 m.')
            : tr('Pars très doucement : les 10 premières minutes font partie de l’échauffement.');
      return { focus, moves, then };
    }
    case 'bike': {
      const moves = [move('leg-swings'), move('worlds-greatest'), move('cat-camel'), move('glute-bridge'), move('bw-squat')];
      const then = startsWith(exercises, /warmup/)
        ? tr('Ton plan commence par l’échauffement vélo : petit braquet, cadence qui monte{v}.', { v: hard ? ', puis 3 accélérations de 15 s' : '' })
        : tr('Les 10 premières minutes en souplesse, petit braquet, cadence qui monte{v}.', { v: hard ? ', puis 3 accélérations de 15 s' : '' });
      return { focus, moves, then };
    }
    case 'swim': {
      const moves = [move('arm-circles'), move('shoulder-pass'), move('thoracic-rotation'), move('ytw'), move('streamline')];
      const then = startsWith(exercises, /warmup/) ? tr('Dans l’eau, ton plan commence par l’échauffement nage : souple, sans forcer.') : tr('Dans l’eau, 200 m très souples avant le reste.');
      return { focus, moves, then };
    }
    case 'row':
      return {
        focus,
        moves: [move('cat-camel'), move('hip-hinge'), move('worlds-greatest'), move('arm-circles'), move('glute-bridge')],
        then: tr('Rameur : 3 min tranquilles en montant la cadence, puis 3 fois 10 coups plus appuyés.'),
      };
    case 'ski':
      return {
        focus,
        moves: [move('arm-circles'), move('shoulder-pass'), move('cat-camel'), move('hip-hinge'), move('scap-pushup')],
        then: tr('SkiErg : 2 min tranquilles, puis 3 fois 10 tirages plus forts.'),
      };
    case 'combat':
      return { focus, moves: [move('rope-easy'), move('neck-mobility'), move('arm-circles'), move('hip-circles'), move('shadow-light')] };
    case 'walk':
      return {
        focus,
        moves: [move('ankle-rocks'), move('leg-swings'), move('calf-raise')],
        then: exercises.some((x) => x.key === 'incline-walk') ? tr('Les 5 premières minutes à plat, puis monte la pente.') : undefined,
      };
  }
}

function hyroxWarmup(gym: Gym | undefined): Omit<Warmup, 'min'> {
  return {
    focus: tr('Course et stations'),
    moves: [move('easy-jog', has(gym, 'rower') ? {} : { cue: tr('Plus lent que ton footing habituel.') }), move('worlds-greatest'), move('inchworm'), move('bw-squat'), move('scap-pushup'), move('glute-bridge')],
    then: tr('Premier passage sur chaque station à 70 %, puis à ton allure.'),
  };
}

/** Le sport par lequel la séance commence : c'est lui que l'échauffement prépare. */
function mainDiscipline(exercises: Exercise[]): Discipline | null {
  return exercises.find((x) => x.discipline)?.discipline ?? null;
}

/** Récupération ou tâche sans effort : pas d'échauffement. */
const CALM = new Set(['walk', 'mobility', 'transition']);

/**
 * L'échauffement de la séance, ou null quand il n'y a rien à préparer (repos, marche, mobilité).
 * `ramp` : la charge de travail prévue sur le premier exercice chargé, pour calculer les séries d'approche.
 */
export function warmupFor(
  session: Pick<Session, 'type' | 'exercises'> & { name?: string },
  opts: { gym?: Gym; custom?: Record<string, CatalogEntry>; ramp?: { key: string; work: number } } = {},
): Warmup | null {
  const exercises = session.exercises;
  if (session.type === 'rest' || !exercises.length || exercises.every((x) => CALM.has(x.key))) return null;
  // Récupération pure (tout en zone 1) : la séance elle-même fait office d'échauffement.
  const blocks = exercises.filter((x) => x.discipline && x.zone);
  if (blocks.length && blocks.length === exercises.length && blocks.every((x) => x.zone === 1)) return null;
  const custom = opts.custom ?? {};
  const l = loadOf(exercises, custom);
  const lifts = exercises.filter((x) => x.kind !== 'cardio' && x.kind !== 'task' && !HYROX_KEYS.has(x.key)).length;
  const hyrox = exercises.filter((x) => HYROX_KEYS.has(x.key)).length;

  let w: Omit<Warmup, 'min'>;
  const race = exercises.some((x) => x.key === 'race-day');
  if (race && /hyrox/i.test(session.name ?? '')) w = { ...hyroxWarmup(opts.gym), then: tr('Sur place : 10 min de footing et de rameur faciles, 2 accélérations, puis chaque station à ton allure de course.') };
  else if (hyrox >= 2 && hyrox >= lifts && !firstLoaded(exercises)) w = hyroxWarmup(opts.gym);
  else if (lifts >= 2 || (lifts === 1 && !mainDiscipline(exercises))) {
    const first = firstLoaded(exercises);
    let ramp: WarmRamp | undefined;
    if (first && opts.ramp?.key === first.key && opts.ramp.work > 0) {
      const sets = warmupSets(opts.ramp.work, first.step ?? 2.5, isBarbell(first.key, catalogEntry(first.key, custom)?.name ?? first.name));
      if (sets.length) ramp = { key: first.key, name: first.name.replace(/ \(.*\)$/, ''), work: opts.ramp.work, sets };
    }
    w = liftWarmup(exercises, l, opts.gym, ramp);
  } else {
    const d = mainDiscipline(exercises) ?? (race ? 'run' : null);
    if (d) w = enduranceWarmup(d, exercises);
    else if (exercises.some((x) => x.key === 'hyrox-sim')) w = hyroxWarmup(opts.gym);
    else w = { focus: tr('Cardio'), moves: [move('leg-swings'), move('worlds-greatest'), move('arm-circles')], then: tr('Les 5 premières minutes plus lentes que le reste.') };
  }
  // Toujours dans l'ordre : température, mobilité, activation, préparation.
  const moves = [...w.moves].sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase));
  const sec = moves.reduce((n, m) => n + moveSeconds(m), 0);
  return { ...w, moves, min: Math.max(2, Math.round(sec / 60)) };
}
