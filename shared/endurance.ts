// Plans d'endurance : natation, vélo, triathlon (du S à l'Ironman) et course à pied sans date de course.
// Chaque semaine a ses propres séances : la charge monte par phases, une semaine sur quatre est allégée,
// et l'affûtage fait baisser le volume avant le jour J. Sans objectif daté : un bloc de 8 semaines renouvelable.
import { type Athlete, type EnduranceEvent, EVENT_NAMES, type Experience, type Sport } from './athlete';
import { enduranceStrength, type GenInput } from './generator';
import { addDays, DAY, fmtDuration, fmtPace, mondayOf, parse, paces, weekday, type WeekPlan, weekPlans } from './plans';
import type { ExerciseSlot, Program, SessionDef, Zone } from './types';
import { loc, tr } from './i18n';

/* ---------- Allures et zones ---------- */

export interface Zones {
  /** Secondes au km. */
  run: { recovery: number; easy: [number, number]; tempo: number; interval: number; race: number };
  /** Secondes aux 100 m : CSS = allure seuil. */
  swim: { css: number };
  /** FTP en watts si connue ; vitesse d'endurance en km/h. */
  bike: { ftp?: number; speed: number };
}

const DEFAULT_CSS: Record<Experience, number> = { beginner: 150, intermediate: 120, advanced: 98 };
const BIKE_SPEED: Record<Experience, number> = { beginner: 24, intermediate: 27, advanced: 30 };

export function zonesFor(a: Athlete): Zones {
  const ref = a.race?.refSec ? { sec: a.race.refSec, km: a.race.refKm ?? 10 } : undefined;
  const p = paces('10k', a.experience, ref);
  const css = a.swimPace && a.swimPace > 50 && a.swimPace < 300 ? a.swimPace : DEFAULT_CSS[a.experience];
  return {
    run: { recovery: p.easy[1] + 20, easy: p.easy, tempo: p.tempo, interval: p.interval, race: p.race },
    swim: { css },
    bike: { ftp: a.ftp && a.ftp > 60 && a.ftp < 600 ? a.ftp : undefined, speed: BIKE_SPEED[a.experience] },
  };
}

export function fmtSwim(secPer100: number): string {
  const s = Math.round(secPer100);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}/100 m`;
}

/** CSS estimée à partir d'un chrono sur 400 m : un peu plus lente que l'allure du 400. */
export const cssFrom400 = (sec400: number) => Math.round(sec400 / 4 + 3);

const runPace = (z: Zones, zone: Zone) =>
  zone === 1 ? z.run.recovery : zone === 2 ? (z.run.easy[0] + z.run.easy[1]) / 2 : zone === 3 ? z.run.tempo + 15 : zone === 4 ? z.run.tempo : z.run.interval;
const swimPace = (z: Zones, zone: Zone) => z.swim.css + ({ 1: 20, 2: 12, 3: 5, 4: 0, 5: -8 } as const)[zone];
const bikeKmh = (z: Zones, zone: Zone) => z.bike.speed * ({ 1: 0.82, 2: 1, 3: 1.1, 4: 1.2, 5: 1.28 } as const)[zone];

function bikeTarget(z: Zones, lo: number, hi: number, words: string): string {
  return z.bike.ftp ? `${Math.round(lo * z.bike.ftp)}–${Math.round(hi * z.bike.ftp)} W` : tr('{n}–{n2} % FTP, {words}', { n: Math.round(lo * 100), n2: Math.round(hi * 100), words });
}

const easyText = (z: Zones) => tr('{replace} à {pace}', { replace: fmtPace(z.run.easy[0]).replace('/km', ''), pace: fmtPace(z.run.easy[1]) });

/** « 45 s », « 8 min », « 1 h 30 » : lisible et relu par l'app pour les durées. */
export function fmtMin(min: number): string {
  if (min < 1) return `${Math.round(min * 60)} s`;
  if (min < 20) return `${Math.round(min)} min`;
  const m = Math.round(min / 5) * 5;
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}` : `${m} min`;
}
const roundMin = (min: number) => Math.max(5, Math.round(min / 5) * 5);
const round100 = (m: number) => Math.max(100, Math.round(m / 100) * 100);

/* ---------- Objectifs ---------- */

type EnduranceSport = 'running' | 'swimming' | 'cycling' | 'triathlon';
type Range = [number, number];

interface Load {
  weeks: number;
  taper: number;
  /** Minutes : sortie longue et footing. */
  run?: { long: Range; easy: Range };
  /** Minutes : sortie longue et sortie d'endurance. */
  bike?: { long: Range; easy: Range };
  /** Mètres par séance de natation. */
  swim?: Range;
  /** Enchaînement : minutes de vélo, puis de course. */
  brick?: { bike: Range; run: Range };
}

export const EVENTS: Record<EnduranceEvent, { sport: EnduranceSport; detail: string; load: Load; advice: string }> = {
  'tri-sprint': {
    sport: 'triathlon',
    detail: tr('750 m de nage, 20 km de vélo, 5 km de course'),
    load: { weeks: 10, taper: 1, swim: [1200, 2000], brick: { bike: [60, 90], run: [10, 20] }, run: { long: [40, 60], easy: [30, 40] }, bike: { long: [60, 90], easy: [45, 60] } },
    advice: tr('Pars en nage à ton allure seuil, pas plus vite. Sur le vélo, garde des jambes pour le 5 km.'),
  },
  'tri-olympic': {
    sport: 'triathlon',
    detail: tr('1,5 km de nage, 40 km de vélo, 10 km de course'),
    load: { weeks: 12, taper: 2, swim: [1500, 2600], brick: { bike: [75, 150], run: [15, 30] }, run: { long: [50, 85], easy: [30, 45] }, bike: { long: [75, 150], easy: [60, 75] } },
    advice: tr('Vélo à allure sweet spot, bois et mange un gel vers le km 25. Les 3 premiers km de course en dedans.'),
  },
  'tri-half': {
    sport: 'triathlon',
    detail: tr('1,9 km de nage, 90 km de vélo, 21,1 km de course'),
    load: { weeks: 16, taper: 2, swim: [1800, 3200], brick: { bike: [120, 240], run: [15, 40] }, run: { long: [60, 110], easy: [35, 50] }, bike: { long: [120, 240], easy: [60, 90] } },
    advice: tr('Vélo en endurance haute, jamais au seuil. 60 à 90 g de glucides par heure, dès la première heure.'),
  },
  'tri-full': {
    sport: 'triathlon',
    detail: tr('3,8 km de nage, 180 km de vélo, 42,2 km de course'),
    load: { weeks: 20, taper: 3, swim: [2200, 3800], brick: { bike: [150, 330], run: [20, 45] }, run: { long: [70, 150], easy: [35, 55] }, bike: { long: [150, 330], easy: [75, 90] } },
    advice: tr('Le marathon se gagne sur le vélo : reste en zone 2. Mange toutes les 20 à 30 minutes, avant d’avoir faim.'),
  },
  'swim-1500': {
    sport: 'swimming',
    detail: tr('1 500 m de nage'),
    load: { weeks: 8, taper: 1, swim: [1800, 3200] },
    advice: tr('Les 200 premiers mètres en dedans, puis ton allure seuil. Accélère sur les 300 derniers mètres.'),
  },
  'swim-5k': {
    sport: 'swimming',
    detail: tr('5 km en eau libre'),
    load: { weeks: 12, taper: 2, swim: [2200, 4500] },
    advice: tr('Vise une bouée toutes les 6 à 8 brassées. Ravitaille toutes les 30 minutes si l’organisation le permet.'),
  },
  'bike-100': {
    sport: 'cycling',
    detail: tr('100 km à vélo'),
    load: { weeks: 10, taper: 1, bike: { long: [120, 270], easy: [60, 90] } },
    advice: tr('Reste dans les roues sur le plat, monte les côtes à ton rythme. Mange toutes les 45 minutes.'),
  },
  'bike-160': {
    sport: 'cycling',
    detail: tr('160 km à vélo'),
    load: { weeks: 14, taper: 2, bike: { long: [150, 360], easy: [60, 100] } },
    advice: tr('Les deux premières heures doivent sembler faciles. 60 à 80 g de glucides par heure, bois à chaque ravitaillement.'),
  },
};

/** Bloc de 8 semaines sans objectif daté. */
const BLOCKS: Record<EnduranceSport, Load> = {
  running: { weeks: 8, taper: 0, run: { long: [60, 95], easy: [35, 50] } },
  swimming: { weeks: 8, taper: 0, swim: [1600, 2600] },
  cycling: { weeks: 8, taper: 0, bike: { long: [120, 210], easy: [60, 90] } },
  triathlon: { weeks: 8, taper: 0, swim: [1500, 2400], brick: { bike: [75, 120], run: [10, 20] }, run: { long: [50, 80], easy: [30, 45] }, bike: { long: [90, 150], easy: [60, 75] } },
};

export const eventsFor = (sport: Sport): EnduranceEvent[] => (Object.keys(EVENTS) as EnduranceEvent[]).filter((e) => EVENTS[e].sport === sport);

/* ---------- Semaine type : quelle séance quel jour (0 = dimanche) ---------- */

type Role =
  | 'runQ' | 'runQ2' | 'runEasy' | 'runRec' | 'runLong'
  | 'swimQ' | 'swimTech' | 'swimEnd' | 'swimSpeed' | 'swimEasy'
  | 'bikeQ' | 'bikeQ2' | 'bikeEnd' | 'bikeLong' | 'bikeRec'
  | 'brick' | 'strength';

const LAYOUTS: Record<EnduranceSport, Record<number, Partial<Record<number, Role>>>> = {
  running: {
    2: { 2: 'runQ', 0: 'runLong' },
    3: { 2: 'runQ', 4: 'runEasy', 0: 'runLong' },
    4: { 2: 'runQ', 3: 'strength', 5: 'runEasy', 0: 'runLong' },
    5: { 2: 'runQ', 3: 'strength', 4: 'runQ2', 6: 'runEasy', 0: 'runLong' },
    6: { 1: 'runRec', 2: 'runQ', 3: 'strength', 4: 'runQ2', 6: 'runEasy', 0: 'runLong' },
  },
  swimming: {
    2: { 2: 'swimQ', 6: 'swimEnd' },
    3: { 2: 'swimQ', 4: 'swimTech', 6: 'swimEnd' },
    4: { 1: 'strength', 2: 'swimQ', 4: 'swimTech', 6: 'swimEnd' },
    5: { 1: 'strength', 2: 'swimQ', 3: 'swimTech', 5: 'swimSpeed', 6: 'swimEnd' },
    6: { 1: 'strength', 2: 'swimQ', 3: 'swimTech', 5: 'swimSpeed', 6: 'swimEnd', 0: 'swimEasy' },
  },
  cycling: {
    2: { 3: 'bikeQ', 6: 'bikeLong' },
    3: { 2: 'bikeQ', 4: 'bikeEnd', 6: 'bikeLong' },
    4: { 1: 'strength', 2: 'bikeQ', 4: 'bikeEnd', 6: 'bikeLong' },
    5: { 1: 'strength', 2: 'bikeQ', 4: 'bikeQ2', 6: 'bikeLong', 0: 'bikeRec' },
    6: { 1: 'strength', 2: 'bikeQ', 3: 'bikeEnd', 4: 'bikeQ2', 6: 'bikeLong', 0: 'bikeRec' },
  },
  triathlon: {
    3: { 2: 'swimQ', 4: 'runQ', 6: 'brick' },
    4: { 2: 'swimQ', 3: 'runQ', 6: 'brick', 0: 'runLong' },
    5: { 1: 'swimQ', 2: 'runQ', 4: 'bikeQ', 6: 'brick', 0: 'runLong' },
    6: { 1: 'swimTech', 2: 'runQ', 3: 'swimQ', 4: 'bikeQ', 6: 'brick', 0: 'runLong' },
    7: { 1: 'swimTech', 2: 'runQ', 3: 'swimQ', 4: 'bikeQ', 5: 'strength', 6: 'brick', 0: 'runLong' },
  },
};

const DAYS_RANGE: Record<EnduranceSport, Range> = { running: [2, 6], swimming: [2, 6], cycling: [2, 6], triathlon: [3, 7] };

/* ---------- Séances ---------- */

interface Ctx {
  k: string;
  w: WeekPlan;
  i: number;
  a: Athlete;
  z: Zones;
  load: Load;
  /** Allègement (semaine de récupération, affûtage) et progression d'un bloc à l'autre. */
  scale: number;
  /** Objectif triathlon ou eau libre : on ajoute l'eau libre et les transitions en phase spécifique. */
  event?: EnduranceEvent;
  block: boolean;
}

const raw = (r: Range, c: Ctx) => r[0] + (r[1] - r[0]) * c.w.progress;
const lerp = (r: Range, c: Ctx) => raw(r, c) * c.scale;
/** Plafonné par le temps dispo en semaine, puis allégé : les semaines de récup et d'affûtage baissent toujours. */
const capped = (r: Range, c: Ctx, cap: number) => Math.min(raw(r, c) * Math.max(1, c.scale), cap) * Math.min(1, c.scale);
const phaseKey = (c: Ctx) => (c.w.taper ? 'taper' : c.w.progress < 0.35 ? 'base' : c.w.progress < 0.75 ? 'build' : 'peak');

const def = (id: string, name: string, focus: string, exercises: ExerciseSlot[]): SessionDef => ({ id, name, focus, type: 'cardio', exercises, generated: true });

function runSlot(c: Ctx, key: string, zone: Zone, sets: number, span: { min?: number; m?: number }, rest = 0, target?: string, note?: string): ExerciseSlot {
  const sec = span.min ? (span.min < 20 ? Math.round(span.min * 60) : roundMin(span.min) * 60) : (span.m! / 1000) * runPace(c.z, zone);
  const reps = span.min ? fmtMin(span.min) : span.m! >= 1000 && span.m! % 1000 === 0 ? `${span.m! / 1000} km` : `${span.m} m`;
  return { key, sets, reps, rest, sec: Math.round(sec), zone, ...(target ? { target } : {}), ...(note ? { note } : {}) };
}

function swimSlot(c: Ctx, key: string, zone: Zone, sets: number, m: number, rest = 0, target?: string, note?: string): ExerciseSlot {
  return { key, sets, reps: `${m} m`, rest, sec: Math.round((m / 100) * swimPace(c.z, zone)), zone, ...(target ? { target } : {}), ...(note ? { note } : {}) };
}

function bikeSlot(key: string, zone: Zone, sets: number, min: number, rest = 0, target?: string, note?: string): ExerciseSlot {
  return { key, sets, reps: fmtMin(min), rest, sec: min < 20 ? Math.round(min * 60) : roundMin(min) * 60, zone, ...(target ? { target } : {}), ...(note ? { note } : {}) };
}

/* Course */

function runEasy(c: Ctx, id: string): SessionDef {
  const min = roundMin(capped(c.load.run!.easy, c, c.a.minutes || 60));
  const strides = c.w.progress > 0.2 && !c.w.taper;
  return def(id, tr('Footing'), tr('{fmtMin} à {easyText}{v}', { fmtMin: fmtMin(min), easyText: easyText(c.z), v: strides ? tr(', puis lignes droites') : '' }), [
    runSlot(c, 'run-easy', 2, 1, { min }, 0, easyText(c.z)),
    ...(strides ? [runSlot(c, 'strides', 5, 6, { m: 80 }, 60, tr('vite et relâché'))] : []),
  ]);
}

function runRecovery(c: Ctx, id: string): SessionDef {
  const min = roundMin(Math.min(35, lerp(c.load.run!.easy, c) * 0.75));
  return def(id, tr('Footing récup'), tr('{fmtMin} très facile', { fmtMin: fmtMin(min) }), [runSlot(c, 'run-recovery', 1, 1, { min }, 0, fmtPace(c.z.run.recovery))]);
}

function runLong(c: Ctx, id: string): SessionDef {
  const min = roundMin(lerp(c.load.run!.long, c) * (c.a.experience === 'beginner' ? 0.85 : 1));
  const km = Math.round((min * 60) / runPace(c.z, 2));
  const finish = !c.w.taper && !c.w.recovery && (phaseKey(c) === 'peak' || (phaseKey(c) === 'build' && c.i % 2 === 1)) && min >= 50;
  const tail = finish ? 15 : 0;
  return def(id, tr('Sortie longue'), tr('{duration} en endurance, environ {km} km{v}', { duration: fmtDuration(min * 60), km, v: finish ? tr(', fin à allure seuil') : '' }), [
    runSlot(c, 'run-long', 2, 1, { min: min - tail }, 0, easyText(c.z), min >= 75 ? tr('Bois toutes les 20 minutes, emporte un gel au-delà d’1 h 15.') : undefined),
    ...(finish ? [runSlot(c, 'run-progressive', 4, 1, { min: tail }, 0, fmtPace(c.z.run.tempo), tr('Accélère sans forcer : la fin doit rester propre.'))] : []),
  ]);
}

function runQuality(c: Ctx, id: string, variant: number): SessionDef {
  const z = c.z;
  const wu = runSlot(c, 'run-warmup', 1, 1, { min: 15 }, 0, easyText(z));
  const cd = runSlot(c, 'run-cooldown', 1, 1, { min: 10 });
  const ph = phaseKey(c);
  const s = (n: number) => Math.max(3, Math.round(n * Math.min(1, c.scale + 0.15)));
  if (ph === 'taper') {
    const n = s(4);
    return def(id, tr('Rappel d’allure'), tr('{n} × 400 m vite, sans se fatiguer', { n }), [wu, runSlot(c, 'run-intervals', 5, n, { m: 400 }, 90, fmtPace(z.run.interval)), cd]);
  }
  if (ph === 'base') {
    if (variant % 2 === 0) {
      const n = s(6 + Math.round(c.w.progress * 8));
      return def(id, tr('Côtes'), tr('{n} × 45 s en côte : puissance et foulée', { n }), [wu, runSlot(c, 'run-drills', 2, 1, { min: 8 }), runSlot(c, 'run-hills', 5, n, { min: 0.75 }, 90, tr('fort, buste droit')), cd]);
    }
    const n = s(8 + Math.round(c.w.progress * 6));
    return def(id, tr('Fartlek'), tr('{n} × 1 min vite, 1 min trottinée', { n }), [wu, runSlot(c, 'run-fartlek', 4, n, { min: 1 }, 60, fmtPace(z.run.interval + 8)), cd]);
  }
  if (variant % 2 === 0) {
    const [n, m] = ph === 'build' ? (c.w.progress < 0.55 ? [s(8), 400] : [s(6), 800]) : [s(5), 1000];
    return def(id, tr('Fractionné'), tr('{n} × {m} m à {pace}', { n, m, pace: fmtPace(z.run.interval) }), [wu, runSlot(c, 'run-intervals', 5, n, { m }, 90, fmtPace(z.run.interval), tr('Récupération en trottinant. La dernière doit ressembler à la première.')), cd]);
  }
  const [n, min] = ph === 'build' ? [2, c.w.progress < 0.55 ? 10 : 12] : [3, 10];
  return def(id, tr('Seuil'), tr('{n} × {min} min à {pace}', { n, min, pace: fmtPace(z.run.tempo) }), [wu, runSlot(c, 'run-tempo', 4, n, { min }, 120, fmtPace(z.run.tempo), tr('« Confortablement dur » : tu peux dire trois mots, pas une phrase.')), cd]);
}

/* Natation */

const DRILLS = ['swim-drill-catchup', 'swim-drill-fist', 'swim-drill-side', 'swim-drill-scull'];

function swimTotal(c: Ctx, weekday = true): number {
  if (!weekday) return round100(lerp(c.load.swim!, c));
  // En semaine, la séance tient dans le temps que tu as.
  const cap = (((c.a.minutes || 60) * 60 * 0.8) / (c.z.swim.css + 12)) * 100;
  return round100(capped(c.load.swim!, c, cap));
}

function swimTech(c: Ctx, id: string, easy = false): SessionDef {
  const T = swimTotal(c) * (easy ? 0.8 : 1);
  const d1 = DRILLS[c.i % 4];
  const d2 = DRILLS[(c.i + 1) % 4];
  const ex: ExerciseSlot[] = [swimSlot(c, 'swim-warmup', 1, 1, 300), swimSlot(c, d1, 2, 4, d1 === 'swim-drill-scull' ? 25 : 50, 20), swimSlot(c, d2, 2, 4, d2 === 'swim-drill-scull' ? 25 : 50, 20), swimSlot(c, 'swim-kick', 3, 4, 50, 20)];
  if (T >= 1800) ex.push(swimSlot(c, 'swim-pull', 3, 4, 100, 20));
  const used = ex.reduce((n, x) => n + x.sets! * parseInt(x.reps!, 10), 0) + 200;
  const main = Math.max(200, round100(T - used));
  ex.push(swimSlot(c, 'swim-endurance', 2, Math.max(1, Math.round(main / 200)), 200, 20, fmtSwim(c.z.swim.css + 12), tr('Applique les éducatifs : nage longue, main qui entre loin devant.')));
  ex.push(swimSlot(c, 'swim-cooldown', 1, 1, 200));
  return def(id, easy ? tr('Natation souple') : tr('Natation technique'), tr('{round100} m : éducatifs, jambes et bras', { round100: round100(T) }), ex);
}

function swimThreshold(c: Ctx, id: string): SessionDef {
  const T = swimTotal(c);
  const ph = phaseKey(c);
  const rep = ph === 'base' ? 100 : ph === 'build' ? (c.w.progress < 0.55 ? 100 : 200) : ph === 'peak' ? (c.event === 'swim-1500' ? 300 : 400) : 100;
  const rest = rep <= 100 ? 15 : rep <= 200 ? 20 : 30;
  const n = Math.max(3, Math.min(16, Math.floor((T - 300 - 200 - 200) / rep)));
  const target = fmtSwim(c.z.swim.css);
  return def(id, tr('Natation seuil'), tr('{n} × {rep} m à {target}', { n, rep, target }), [
    swimSlot(c, 'swim-warmup', 1, 1, 300),
    swimSlot(c, DRILLS[c.i % 4], 2, 4, 50, 20),
    swimSlot(c, 'swim-css', 4, n, rep, rest, target, tr('{rest} s de repos entre chaque. Toutes à la même allure.', { rest })),
    swimSlot(c, 'swim-cooldown', 1, 1, 200),
  ]);
}

function swimEndurance(c: Ctx, id: string): SessionDef {
  const T = swimTotal(c, false);
  const open = Boolean(c.event && (c.event.startsWith('tri') || c.event === 'swim-5k') && phaseKey(c) === 'peak');
  const main = Math.max(400, round100(T - 300 - 400 - 200));
  // Débutant : la distance en morceaux, avec 30 s pour souffler.
  const pieces = c.a.experience === 'beginner' && main > 600 ? Math.ceil(main / 400) : 1;
  const per = round100(main / pieces);
  return def(id, open ? tr('Eau libre') : tr('Natation endurance'), `${main} m ${pieces > 1 ? tr('en {pieces} morceaux', { pieces }) : tr('en continu')}${open ? tr(', en eau libre si possible') : ''}`, [
    swimSlot(c, 'swim-warmup', 1, 1, 300),
    swimSlot(c, 'swim-pull', 3, 4, 100, 20),
    swimSlot(c, open ? 'swim-openwater' : 'swim-endurance', 2, pieces, per, pieces > 1 ? 30 : 0, fmtSwim(c.z.swim.css + 10), open ? tr('Sinon en piscine, en levant les yeux toutes les 6 brassées.') : undefined),
    swimSlot(c, 'swim-cooldown', 1, 1, 200),
  ]);
}

function swimSpeed(c: Ctx, id: string): SessionDef {
  const T = swimTotal(c);
  const n50 = Math.max(4, Math.round(8 * Math.min(1, c.scale + 0.1)));
  const used = 300 + 100 + n50 * 50 + 150 + 200;
  return def(id, tr('Natation vitesse'), tr('{n50} × 50 m vite, 6 × 25 m à fond', { n50 }), [
    swimSlot(c, 'swim-warmup', 1, 1, 300),
    swimSlot(c, 'swim-drill-scull', 2, 4, 25, 20),
    swimSlot(c, 'swim-intervals', 5, n50, 50, 30, fmtSwim(c.z.swim.css - 8)),
    swimSlot(c, 'swim-sprint', 5, 6, 25, 45, tr('à fond')),
    ...(T - used >= 200 ? [swimSlot(c, 'swim-endurance', 2, 1, round100(T - used), 0, fmtSwim(c.z.swim.css + 12))] : []),
    swimSlot(c, 'swim-cooldown', 1, 1, 200),
  ]);
}

/* Vélo */

function bikeEndurance(c: Ctx, id: string): SessionDef {
  const min = roundMin(capped(c.load.bike!.easy, c, Math.max(45, c.a.minutes || 60)));
  const cadence = phaseKey(c) === 'base' && min >= 50;
  const t = bikeTarget(c.z, 0.56, 0.75, tr('tu peux parler'));
  return def(id, tr('Vélo endurance'), tr('{fmtMin} en zone 2{v}', { fmtMin: fmtMin(min), v: cadence ? tr(', avec vélocité') : '' }), [
    bikeSlot('bike-endurance', 2, 1, cadence ? min - 12 : min, 0, t),
    ...(cadence ? [bikeSlot('bike-cadence', 2, 6, 1, 60, tr('110 tr/min et plus'))] : []),
  ]);
}

function bikeLong(c: Ctx, id: string): SessionDef {
  const min = roundMin(lerp(c.load.bike!.long, c) * (c.a.experience === 'beginner' ? 0.85 : 1));
  const km = Math.round((min / 60) * bikeKmh(c.z, 2));
  const race = phaseKey(c) === 'peak' && !c.w.recovery && min >= 90;
  return def(id, tr('Sortie longue vélo'), tr('{duration}, environ {km} km{v}', { duration: fmtDuration(min * 60), km, v: race ? tr(', dont 2 × 15 min à allure course') : '' }), [
    bikeSlot('bike-long', 2, 1, race ? min - 40 : min, 0, bikeTarget(c.z, 0.56, 0.75, 'endurance'), tr('Mange toutes les 30 à 45 minutes, bois souvent.')),
    ...(race ? [bikeSlot('bike-sweetspot', 3, 2, 15, 300, bikeTarget(c.z, 0.85, 0.9, tr('allure course')))] : []),
  ]);
}

function bikeQuality(c: Ctx, id: string, variant: number): SessionDef {
  const z = c.z;
  const wu = bikeSlot('bike-warmup', 1, 1, 15);
  const cd = bikeSlot('bike-cooldown', 1, 1, 10);
  const ph = phaseKey(c);
  if (ph === 'taper') return def(id, tr('Rappel vélo'), tr('4 × 2 min fort : garder le tonus'), [wu, bikeSlot('bike-vo2', 5, 4, 2, 180, bikeTarget(z, 1.05, 1.15, tr('fort'))), cd]);
  if (ph === 'base') {
    if (variant % 2 === 0) {
      const min = roundMin(8 + c.w.progress * 12);
      return def(id, tr('Sweet spot'), tr('3 × {min} min en sweet spot', { min }), [wu, bikeSlot('bike-sweetspot', 3, 3, min, 300, bikeTarget(z, 0.88, 0.94, tr('dur mais tenable'))), cd]);
    }
    return def(id, tr('Force vélo'), tr('5 × 4 min gros braquet, 50 à 60 tr/min'), [wu, bikeSlot('bike-force', 3, 5, 4, 180, bikeTarget(z, 0.76, 0.85, tr('tempo'))), cd]);
  }
  if (variant % 2 === 0) {
    const [n, min] = ph === 'build' ? [2, c.w.progress < 0.55 ? 12 : 15] : [3, 12];
    return def(id, tr('Seuil vélo'), tr('{n} × {min} min au seuil', { n, min }), [wu, bikeSlot('bike-threshold', 4, n, min, 300, bikeTarget(z, 0.95, 1.05, tr('au seuil'))), cd]);
  }
  const n = ph === 'build' ? 5 : 6;
  return def(id, tr('PMA'), tr('{n} × 3 min à fond régulier', { n }), [wu, bikeSlot('bike-vo2', 5, n, 3, 180, bikeTarget(z, 1.1, 1.2, tr('très fort'))), cd]);
}

function bikeRecovery(c: Ctx, id: string): SessionDef {
  const min = roundMin(Math.min(60, lerp(c.load.bike!.easy, c) * 0.6));
  return def(id, tr('Vélo récup'), tr('{fmtMin} sans forcer', { fmtMin: fmtMin(min) }), [bikeSlot('bike-recovery', 1, 1, min, 0, bikeTarget(c.z, 0.4, 0.55, tr('tout doux')))]);
}

/* Enchaînement */

function brick(c: Ctx, id: string): SessionDef {
  const bike = roundMin(lerp(c.load.brick!.bike, c) * (c.a.experience === 'beginner' ? 0.85 : 1));
  const run = roundMin(lerp(c.load.brick!.run, c));
  const race = phaseKey(c) === 'peak' && !c.w.recovery;
  const ex: ExerciseSlot[] = [
    bikeSlot(bike >= 120 ? 'bike-long' : 'bike-endurance', 2, 1, race ? bike - 30 : bike, 0, bikeTarget(c.z, 0.6, 0.75, 'endurance'), tr('Mange et bois sur le vélo : la course commence là.')),
    ...(race ? [bikeSlot('bike-sweetspot', 3, 1, 30, 0, bikeTarget(c.z, 0.8, 0.88, tr('allure course')))] : []),
    runSlot(c, 'brick-run', 3, 1, { min: run }, 0, fmtPace(c.z.run.tempo + 15)),
  ];
  if (race && c.event?.startsWith('tri') && c.i % 2 === 0) ex.unshift({ key: 'transition' });
  return def(id, tr('Enchaînement vélo + course'), tr('{duration} de vélo puis {run} min de course{v}', { duration: fmtDuration(bike * 60), run, v: race ? tr(', à allure course') : '' }), ex);
}

const BUILD: Record<Exclude<Role, 'strength'>, (c: Ctx, id: string) => SessionDef> = {
  runQ: (c, id) => runQuality(c, id, c.i),
  runQ2: (c, id) => runQuality(c, id, c.i + 1),
  runEasy,
  runRec: runRecovery,
  runLong,
  swimQ: swimThreshold,
  swimTech: (c, id) => swimTech(c, id),
  swimEasy: (c, id) => swimTech(c, id, true),
  swimEnd: swimEndurance,
  swimSpeed,
  bikeQ: (c, id) => bikeQuality(c, id, c.i),
  bikeQ2: (c, id) => bikeQuality(c, id, c.i + 1),
  bikeEnd: bikeEndurance,
  bikeLong,
  bikeRec: bikeRecovery,
  brick,
};

/* ---------- Le plan ---------- */

export interface EnduranceInput extends GenInput {
  today: string;
  /** Numéro du bloc (sans objectif daté) : chaque nouveau bloc monte un peu la charge. */
  block?: number;
}

const REST: SessionDef = { id: 'rest', name: tr('Repos'), focus: tr('Marche et mobilité'), type: 'rest', exercises: [{ key: 'walk' }, { key: 'mobility' }] };

const STRENGTH_KIND: Record<EnduranceSport, 'run' | 'swim' | 'bike' | 'tri'> = { running: 'run', swimming: 'swim', cycling: 'bike', triathlon: 'tri' };
const BLOCK_NAMES: Record<EnduranceSport, string> = { running: tr('Bloc course'), swimming: tr('Bloc natation'), cycling: tr('Bloc vélo'), triathlon: tr('Bloc triathlon') };

export function endurancePlan(input: EnduranceInput): Program {
  const a = input.athlete;
  const sport = (['running', 'swimming', 'cycling', 'triathlon'].includes(a.sport) ? a.sport : 'running') as EnduranceSport;
  const ev = a.race?.date && a.race.distance in EVENTS && EVENTS[a.race.distance as EnduranceEvent].sport === sport ? (a.race.distance as EnduranceEvent) : undefined;
  const date = ev ? a.race!.date! : undefined;
  const load = ev ? EVENTS[ev].load : BLOCKS[sport];
  const z = zonesFor(a);
  const level = a.experience === 'beginner' ? 0.85 : a.experience === 'advanced' ? 1.12 : 1;
  const block = Math.max(1, input.block ?? 1);
  const blockBoost = ev ? 1 : Math.min(1.3, 1 + 0.06 * (block - 1));

  let n: number;
  let start: string;
  if (date) {
    const raceMonday = mondayOf(date);
    const available = Math.floor((parse(raceMonday) - parse(mondayOf(input.today))) / (7 * DAY)) + 1;
    n = Math.max(Math.min(4, available), Math.min(load.weeks, available));
    start = addDays(raceMonday, -(n - 1) * 7);
  } else {
    n = load.weeks;
    start = mondayOf(input.today);
  }

  const [lo, hi] = DAYS_RANGE[sport];
  const days = Math.max(lo, Math.min(hi, a.days));
  const layout = LAYOUTS[sport][days];
  const strength = Object.values(layout).includes('strength') ? enduranceStrength(input, STRENGTH_KIND[sport]) : null;
  const sessions: SessionDef[] = [REST, ...(strength ? [strength] : [])];
  const weeks: string[][] = [];
  const phases: string[] = [];

  weekPlans(n, Math.min(load.taper, Math.max(0, n - 2))).forEach((w, i) => {
    const k = `w${i + 1}`;
    const taperWeeks = Math.min(load.taper, Math.max(0, n - 2));
    const taperScale = w.taper ? (w.taper === taperWeeks ? 0.45 : 0.7 - 0.1 * (w.taper - 1)) : 1;
    const scale = (w.recovery ? 0.72 : 1) * taperScale * level * blockBoost;
    const c: Ctx = { k, w, i, a, z, load, scale, event: ev, block: !ev };
    const week = Array<string>(7).fill('rest');
    for (const [wd, role] of Object.entries(layout) as [string, Role][]) {
      if (role === 'strength') {
        // Pas de renfo pendant l'affûtage : on garde les jambes fraîches.
        if (!w.taper && strength) week[Number(wd)] = strength.id;
        continue;
      }
      const s = BUILD[role](c, `${k}-${role}`);
      sessions.push(s);
      week[Number(wd)] = s.id;
    }
    // Semaine de l'objectif : repos la veille et après, et la course le jour J.
    if (date && i === n - 1) {
      const d = weekday(date);
      const order = [1, 2, 3, 4, 5, 6, 0];
      const pos = order.indexOf(d);
      for (const wd of order.slice(pos + 1)) week[wd] = 'rest';
      week[(d + 6) % 7] = 'rest';
      const info = EVENTS[ev!];
      const race: SessionDef = { id: `${k}-race`, name: EVENT_NAMES[ev!], focus: info.detail, type: 'cardio', generated: true, exercises: [{ key: 'race-day', note: info.advice }] };
      sessions.push(race);
      week[d] = race.id;
    }
    weeks.push(week);
    const phase = w.phase === tr('Spécifique') && !ev ? tr('Intensification') : w.phase;
    phases.push(w.recovery ? tr('{phase}, semaine allégée', { phase }) : phase);
  });

  // Avant le plan et une fois le bloc fini : une semaine type de développement.
  const typical = weeks[Math.min(n - 1, Math.max(0, Math.round(n * 0.5) - 1))] ?? weeks[0];

  return {
    name: ev
      ? tr('{EVENT_NAMES} du {toLocaleDateString}', { EVENT_NAMES: EVENT_NAMES[ev], toLocaleDateString: new Date(parse(date!)).toLocaleDateString(loc(), { day: 'numeric', month: 'long' }) })
      : tr('{BLOCK_NAMES}{v}, {n} semaines', { BLOCK_NAMES: BLOCK_NAMES[sport], v: block > 1 ? ` ${block}` : '', n }),
    template: `endu-${sport}${ev ? `-${ev}` : ''}`,
    sessions,
    schedule: typical,
    start,
    weeks,
    phases,
    ...(ev ? { event: { name: EVENT_NAMES[ev], date: date! } } : {}),
    meta: { physique: a.physique ?? 'athletic', priorities: a.priorities ?? [], generatedAt: input.today, ...(ev ? {} : { block }) },
  };
}
