// Endurance : plans natation, vélo, triathlon et course sans date, profil d'effort, stats d'entraînement.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'shred-endurance-'));
await build({
  stdin: {
    contents: `
      export * from './shared/endurance';
      export * from './shared/effort';
      export { DEFAULT_ATHLETE, DEFAULT_GYM } from './shared/athlete';
      export { catalogEntry } from './shared/catalog';
      export { resolveSession, resolveExercise, sessionDuration, planWeek } from './shared/program';
      export { runningPlan, planSummary } from './shared/plans';
      export { initial, setState, getState } from './src/lib/store';
      export { programFor, applyProgram } from './src/lib/coaching';
      export { dayTraining, trainingWeeks, rollingWeeks, liftSeries, trackedLifts, totalMinutes } from './src/lib/training';
      export { weeklyReport } from './src/lib/report';
      export { programTweaks } from './src/lib/tweaks';
      export { addDays, mondayOf } from './src/lib/date';
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: join(dir, 'e.mjs'),
  logLevel: 'error',
  define: { 'import.meta.env': '{"MODE":"test"}' },
});
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.navigator ??= { userAgent: 'node' };
const k = await import(pathToFileURL(join(dir, 'e.mjs')).href);

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

const today = '2026-11-16';
const athlete = (a) => ({ ...k.DEFAULT_ATHLETE, ...a });
const plan = (a, extra = {}) => k.endurancePlan({ athlete: athlete(a), gym: k.DEFAULT_GYM, known: [], custom: {}, today, ...extra });
const sessionOf = (p, id) => p.sessions.find((x) => x.id === id);
const weekSeconds = (p, i) =>
  p.weeks[i].reduce((n, id) => {
    const s = sessionOf(p, id);
    if (!s || s.type !== 'cardio') return n;
    return n + k.blocksSeconds(k.sessionBlocks(k.resolveSession(s).exercises));
  }, 0);

/* ---------- Effort ---------- */

check('parseSpan : 45 s', k.parseSpan('45 s').sec === 45);
check('parseSpan : 1 h 30', k.parseSpan('1 h 30').sec === 5400);
check('parseSpan : 2 h', k.parseSpan('2 h').sec === 7200);
check('parseSpan : 8 min', k.parseSpan('8 min').sec === 480);
check('parseSpan : 12 km', k.parseSpan('12 km').m === 12000);
check('parseSpan : 800 m', k.parseSpan('800 m').m === 800);
check('parseSpan : 30–60 s garde la fin', k.parseSpan('30–60 s').sec === 60);
const swim400 = k.resolveExercise({ key: 'swim-css', sets: 4, reps: '400 m' });
check('Natation : discipline et zone du catalogue', swim400.discipline === 'swim' && swim400.zone === 4);
check('Natation : 400 m ≈ 7 min 40 sans chrono', Math.abs(k.repSeconds(swim400) - 460) < 5, `${k.repSeconds(swim400)} s`);
check('Distance estimée d’un footing de 40 min', Math.round(k.repMeters(k.resolveExercise({ key: 'run-easy', reps: '40 min' }))) === 6667);
check('fmtMin : 45 s, 8 min, 1 h 30', k.fmtMin(0.75) === '45 s' && k.fmtMin(8) === '8 min' && k.fmtMin(90) === '1 h 30');

// Les plans de course mettent l'échauffement dans la consigne : le profil l'ajoute.
const road = k.runningPlan({ distance: 'half', date: '2027-03-21', athlete: { experience: 'intermediate', days: 4 }, today });
const q = road.sessions.find((x) => x.name === 'Fractionné');
const qb = k.sessionBlocks(k.resolveSession(q).exercises);
check('Profil : échauffement et retour au calme implicites', qb[0].implicit && qb[qb.length - 1].implicit && qb[0].sec === 900);
check('Profil : récupération entre les répétitions', qb.filter((b) => b.rest).length === q.exercises[0].sets - 1);
check('Durée d’une séance d’endurance calculée sur les blocs', /min|h/.test(k.resolveSession(q).duration) && k.resolveSession(q).duration !== '10 min', k.resolveSession(q).duration);

/* ---------- Plans ---------- */

for (const [sport, distance, weeks] of [
  ['triathlon', 'tri-sprint', 10],
  ['triathlon', 'tri-olympic', 12],
  ['triathlon', 'tri-half', 16],
  ['triathlon', 'tri-full', 20],
  ['swimming', 'swim-1500', 8],
  ['swimming', 'swim-5k', 12],
  ['cycling', 'bike-100', 10],
  ['cycling', 'bike-160', 14],
]) {
  const date = k.addDays(today, 7 * 30 + 6);
  const p = plan({ sport, days: sport === 'triathlon' ? 6 : 4, race: { distance, date } });
  const last = p.weeks[p.weeks.length - 1];
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
  const raceDef = sessionOf(p, last[wd]);
  check(`${distance} : ${weeks} semaines`, p.weeks.length === weeks, `${p.weeks.length}`);
  check(`${distance} : course le jour J, repos la veille`, raceDef?.exercises[0].key === 'race-day' && last[(wd + 6) % 7] === 'rest');
  check(`${distance} : phases jusqu’à l’affûtage`, p.phases[0].startsWith('Fondamental') && p.phases[p.weeks.length - 1].startsWith('Affûtage'));
  const taper = p.phases.findIndex((x) => x.startsWith('Affûtage'));
  check(`${distance} : l’affûtage allège`, weekSeconds(p, taper) < Math.max(...p.weeks.map((_, i) => weekSeconds(p, i))) * 0.8, `${Math.round(weekSeconds(p, taper) / 60)} min`);
  check(`${distance} : semaine 4 allégée`, weekSeconds(p, 3) < weekSeconds(p, 2), `${Math.round(weekSeconds(p, 3) / 60)} < ${Math.round(weekSeconds(p, 2) / 60)} min`);
  const keysOk = p.sessions.every((s) => s.exercises.every((x) => k.catalogEntry(x.key)) && new Set(s.exercises.map((x) => x.key)).size === s.exercises.length);
  check(`${distance} : exercices connus, pas de doublon dans une séance`, keysOk);
  check(`${distance} : objectif daté`, p.event?.date === date && !p.meta.block);
}

const tri = plan({ sport: 'triathlon', days: 6, race: { distance: 'tri-olympic', date: k.addDays(today, 7 * 11 + 6) } });
const triSports = new Set(tri.weeks[2].flatMap((id) => k.resolveSession(sessionOf(tri, id)).exercises.map((x) => x.discipline).filter(Boolean)));
check('Triathlon : natation, vélo et course dans la semaine', ['swim', 'bike', 'run'].every((d) => triSports.has(d)));
check('Triathlon : enchaînement vélo puis course', tri.sessions.some((s) => s.name.startsWith('Enchaînement') && s.exercises.some((x) => x.key === 'brick-run')));
check('Triathlon : 6 jours d’entraînement', tri.weeks[1].filter((id) => id !== 'rest').length === 6);
check('Triathlon : 7 jours avec le renfo', plan({ sport: 'triathlon', days: 7 }).weeks[0].includes('tri-strength'));

const swim = plan({ sport: 'swimming', days: 4, swimPace: 105 });
const css = swim.sessions.find((s) => s.name === 'Natation seuil');
check('Natation : séance au seuil à l’allure CSS donnée', css.exercises.some((x) => x.key === 'swim-css' && x.target === '1:45/100 m'));
check('Natation : éducatifs dans la séance technique', swim.sessions.some((s) => s.name === 'Natation technique' && s.exercises.some((x) => x.key.startsWith('swim-drill'))));
check('Natation : renfo nageur (dos, épaules)', swim.sessions.some((s) => s.id === 'swim-strength' && s.exercises.some((x) => x.key === 'external-rotation')));

const bike = plan({ sport: 'cycling', days: 5, ftp: 250 });
check('Vélo : watts quand la FTP est connue', bike.sessions.some((s) => s.exercises.some((x) => /^\d+–\d+ W$/.test(x.target ?? ''))));
check('Vélo : sans FTP, % de FTP en clair', plan({ sport: 'cycling', days: 4 }).sessions.some((s) => s.exercises.some((x) => /% FTP/.test(x.target ?? ''))));
check('Vélo : sortie longue le samedi', sessionOf(bike, bike.weeks[0][6]).name === 'Sortie longue vélo');

const run = plan({ sport: 'running', days: 5 });
check('Course sans date : bloc de 8 semaines', run.weeks.length === 8 && !run.event && run.meta.block === 1);
check('Course sans date : côtes ou fartlek au début, fractionné ensuite', ['Côtes', 'Fartlek'].includes(sessionOf(run, run.weeks[0][2]).name) && ['Fractionné', 'Seuil'].includes(sessionOf(run, run.weeks[5][2]).name));
check('Course sans date : sortie longue le dimanche', sessionOf(run, run.weeks[0][0]).name === 'Sortie longue');
check('Course sans date : résumé du bloc', /Semaine 1 sur 8 du bloc/.test(k.planSummary(run, today)));
const run2 = plan({ sport: 'running', days: 5 }, { block: 2 });
check('Bloc suivant : un peu plus de volume', weekSeconds(run2, 2) > weekSeconds(run, 2), `${Math.round(weekSeconds(run2, 2) / 60)} > ${Math.round(weekSeconds(run, 2) / 60)} min`);
check('Débutant : moins de volume', weekSeconds(plan({ sport: 'running', days: 5, experience: 'beginner' }), 2) < weekSeconds(run, 2));

const zones = k.zonesFor(athlete({ race: { distance: '10k', refSec: 45 * 60, refKm: 10 }, swimPace: 100, ftp: 280 }));
check('Zones : allure seuil course d’après le chrono', zones.run.tempo > 270 && zones.run.tempo < 300, `${zones.run.tempo}`);
check('Zones : CSS et FTP repris du profil', zones.swim.css === 100 && zones.bike.ftp === 280);
check('CSS estimée sur 400 m', k.cssFrom400(7 * 60) === 108);

/* ---------- Programme et stats ---------- */

k.setState((d) => void (d.createdAt = '2026-10-01'));
let s = k.getState();
const noRace = k.programFor(athlete({ sport: 'running', days: 4, race: { distance: 'half' } }), k.DEFAULT_GYM, today, s);
check('Coureur sans date : un vrai plan de course, pas un split muscu', noRace.program.sessions.some((x) => x.name === 'Sortie longue') && noRace.notes.length > 0);
const dated = k.programFor(athlete({ sport: 'running', days: 4, race: { distance: 'half', date: '2027-03-21' } }), k.DEFAULT_GYM, today, s);
check('Coureur avec date : plan daté jusqu’au semi', dated.program.event?.name === 'Semi-marathon');
const triP = k.programFor(athlete({ sport: 'triathlon', days: 5 }), k.DEFAULT_GYM, today, s);
check('Triathlète : bloc triathlon', triP.program.template === 'endu-triathlon');

k.applyProgram(noRace.program);
const d0 = k.addDays(today, -3);
const d1 = k.addDays(today, -2);
k.setState((d) => {
  d.days[d0] = { sets: { 'run-easy': [{ done: true, km: 9.2, min: 50 }], 'bike-endurance': [{ done: true }] }, mainDone: true, meals: [], habits: {} };
  d.days[d1] = { sets: { squat: [{ done: true, w: 100, r: 5 }, { done: true, w: 100, r: 5 }, { done: true, w: 100, r: 5 }], 'swim-endurance': [{ done: true, km: 1.5, min: 32 }] }, mainDone: true, meals: [], habits: {} };
  d.days[k.addDays(today, -9)] = { sets: { squat: [{ done: true, w: 95, r: 5 }] }, mainDone: true, meals: [], habits: {} };
});
s = k.getState();
const t0 = k.dayTraining(s, d0);
check('Stats : km et minutes notés pour la course', Math.abs(t0.km.run - 9.2) < 0.01 && Math.abs(t0.min.run - 50) < 0.01);
check('Stats : vélo sans saisie estimé d’après la consigne', t0.min.bike === 90 && t0.km.bike > 30, `${t0.min.bike} min, ${Math.round(t0.km.bike)} km`);
const t1 = k.dayTraining(s, d1);
check('Stats : muscu comptée en minutes', t1.min.lift > 5 && t1.min.swim === 32 && Math.abs(t1.km.swim - 1.5) < 0.01);
const weeks = k.trainingWeeks(s, today, 4);
check('Stats : semaines dans l’ordre, la dernière est la semaine en cours', weeks.length === 4 && weeks[3].monday === k.mondayOf(today));
const roll = k.rollingWeeks(s, today, 2);
check('Stats : 7 jours glissants', Math.abs(roll[1].km.run - 9.2) < 0.01);
const lift = k.liftSeries(s, 'squat', today);
check('Charges : record marqué', lift.length === 2 && lift[1].pr && lift[1].e1rm > lift[0].e1rm);
const rep = k.weeklyReport(s, k.mondayOf(d0));
check('Bilan : temps et distances d’endurance', rep.training.minutes > 100 && rep.training.km.some((x) => x.name === 'Course'), `${rep.training.minutes} min`);

// Bloc fini : Pulse propose le suivant.
const later = k.addDays(today, 7 * 8 + 1);
const tw = k.programTweaks(k.getState(), later);
check('Bloc terminé : Pulse propose le bloc 2', tw.some((t) => t.action.kind === 'next-block' && t.action.block === 2));
check('Plan périodisé : pas de décharge proposée en plus', !k.programTweaks(k.getState(), k.addDays(today, 50)).some((t) => t.action.kind === 'deload'));

console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
