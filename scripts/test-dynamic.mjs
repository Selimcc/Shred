// Générateur de programme (physique, priorités, temps, matériel, sports), séance dynamique
// (remplacer, panne, sauter, ajouter, forme, express), ajustements, et données d'avant la v0.6.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'shred-dynamic-'));
await build({
  stdin: {
    contents: `
      export * from './shared/generator';
      export { DEFAULT_ATHLETE, gymDefaults } from './shared/athlete';
      export { usable } from './shared/plans';
      export { catalogEntry } from './shared/catalog';
      export { resolveSession, findSession } from './shared/program';
      export { initial, migrate, replaceState, getState } from './src/lib/store';
      export { sessionFor, dayValidated, workoutOk } from './src/lib/logic';
      export * from './src/lib/dynamic';
      export * from './src/lib/workoutActions';
      export { programTweaks, applyTweak, suggestPriorities } from './src/lib/tweaks';
      export { programFor, applyProgram, restorePreviousProgram } from './src/lib/coaching';
      export { adviseLoad } from './src/lib/advisor';
      export { addDays } from './src/lib/date';
      export * from './src/lib/variety';
      export { mergeDay } from './src/lib/merge';
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', outfile: join(dir, 'd.mjs'), logLevel: 'error',
  define: { 'import.meta.env': '{"MODE":"test"}' },
});
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const k = await import(pathToFileURL(join(dir, 'd.mjs')).href);

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

const gym = k.gymDefaults('fitness-park');
const home = k.gymDefaults('home');
const gen = (over, g = gym) => k.generateProgram({ athlete: { ...k.DEFAULT_ATHLETE, ...over }, gym: g });

/* ---------- Générateur ---------- */
const physiques = Object.keys(k.PHYSIQUES);
let allKnown = true;
let overBudget = [];
let lifts = 0;
for (const physique of physiques)
  for (const days of [2, 3, 4, 5, 6])
    for (const minutes of [45, 60, 90])
      for (const sport of ['strength', 'mixed', 'combat']) {
        const r = gen({ physique, days, minutes, sport });
        for (const s of r.program.sessions) for (const e of s.exercises) if (!k.catalogEntry(e.key)) allKnown = false;
        for (const [id, m] of Object.entries(r.minutes)) if (m > minutes + 5) overBudget.push(`${physique}/${days}j/${minutes}/${sport}:${id}=${m}`);
        const lifting = r.program.schedule.filter((id) => r.program.sessions.find((x) => x.id === id)?.type !== 'rest').length;
        if (lifting <= days) lifts++;
      }
check('tous les exercices générés existent', allKnown);
check('aucune séance ne dépasse le temps prévu (+5 min)', overBudget.length === 0, overBudget.slice(0, 4).join(' '));
check('jamais plus de séances que de jours dispo', lifts === physiques.length * 5 * 3 * 3);

const split = (n) => gen({ physique: 'aesthetic', days: n, minutes: 75 }).program.sessions.filter((s) => s.type === 'lifting').map((s) => s.name).join(',');
check('2 jours : 2 full body', split(2) === 'Full body A,Full body B', split(2));
check('4 jours : haut / bas', split(4) === 'Haut du corps A,Bas du corps A,Haut du corps B,Bas du corps B', split(4));
check('5 jours : push, pull, legs, haut, bas', split(5) === 'Push,Pull,Legs,Haut du corps,Bas du corps', split(5));

const plain = gen({ physique: 'aesthetic', days: 5, minutes: 75 });
const prio = gen({ physique: 'aesthetic', days: 5, minutes: 75, priorities: ['delts', 'back'] });
const vol = (r, reg) => r.volume.find((v) => v.region === reg)?.sets ?? 0;
check('les priorités reçoivent plus de séries', vol(prio, 'delts') > vol(plain, 'delts') && vol(prio, 'back') >= vol(plain, 'back'), `épaules ${vol(plain, 'delts')}→${vol(prio, 'delts')}, dos ${vol(plain, 'back')}→${vol(prio, 'back')}`);
const push = prio.program.sessions.find((s) => s.name === 'Push');
check('priorité épaules : le militaire ouvre le push', push.exercises[0].key === 'military-press', push.exercises[0].key);
const vt = gen({ physique: 'v-taper', days: 4, minutes: 60 });
const lw = gen({ physique: 'lower', days: 4, minutes: 60 });
check('dos en V : plus de dos et d’épaules que « bas du corps »', vol(vt, 'back') > vol(lw, 'back') && vol(vt, 'delts') > vol(lw, 'delts'));
check('bas du corps : plus d’ischios-fessiers', vol(lw, 'posterior') > vol(vt, 'posterior'), `${vol(vt, 'posterior')} vs ${vol(lw, 'posterior')}`);
const st = gen({ physique: 'strength', days: 3, minutes: 75 });
const mains = st.program.sessions.filter((s) => s.type === 'lifting').map((s) => s.exercises[0]);
check('force : mouvements principaux lourds en 3–5', mains.every((e) => ['squat', 'bench', 'deadlift', 'military-press'].includes(e.key) && e.reps === '3–5'), mains.map((e) => `${e.key} ${e.reps}`).join(', '));
const homeR = gen({ physique: 'aesthetic', days: 4, minutes: 60 }, home);
const bad = homeR.program.sessions.flatMap((s) => s.exercises).filter((e) => !k.usable(e.key, home));
check('salle maison : que des exercices faisables', bad.length === 0, bad.map((e) => e.key).join(','));
const avoid = gen({ physique: 'aesthetic', days: 4, minutes: 60 });
const firstKey = avoid.program.sessions[0].exercises.find((e) => e.key === 'bench')?.key;
const rotated = k.generateProgram({ athlete: { ...k.DEFAULT_ATHLETE, physique: 'aesthetic', days: 4, minutes: 60 }, gym, avoid: ['bench'] });
check('un exercice en stagnation est remplacé par une variante', firstKey === 'bench' && !rotated.program.sessions.some((s) => s.exercises.some((e) => e.key === 'bench')));
const combat = gen({ physique: 'athletic', days: 5, minutes: 60, sport: 'combat' });
check('combat : force + cardio combat', combat.program.sessions.some((s) => s.id === 'gen-fight-cardio') && combat.program.schedule.filter((id) => id.startsWith('gen-full')).length >= 2, combat.program.schedule.join(','));
const mixed = gen({ physique: 'aesthetic', days: 5, minutes: 60, sport: 'mixed' });
check('muscu + cardio : zone 2 dans la semaine', mixed.program.schedule.includes('gen-zone2'), mixed.program.schedule.join(','));
const dbRow = k.regionOf('db-row');
check('le rowing haltère compte pour le dos', dbRow === 'back', dbRow);

/* Plans de course : renfo selon le physique */
const runner = { ...k.DEFAULT_ATHLETE, sport: 'running', physique: 'v-taper', priorities: ['back'], days: 4, race: { distance: 'half', date: k.addDays('2026-11-12', 84) } };
const run = k.programFor(runner, gym, '2026-11-12', k.initial());
const renfo = run.program.sessions.find((s) => s.id === 'run-strength');
check('semi : plan daté conservé', Boolean(run.program.weeks?.length) && run.program.event?.name === 'Semi-marathon');
check('semi : renfo avec du dos pour un physique en V', renfo.exercises.some((e) => k.regionOf(e.key) === 'back'), renfo.exercises.map((e) => e.key).join(','));

/* ---------- Séance dynamique ---------- */
const today = '2026-11-12'; // jeudi
const s0 = k.initial();
s0.program = gen({ physique: 'aesthetic', days: 5, minutes: 75, priorities: ['delts'] }).program;
s0.days[today] = { sets: {}, mainDone: false, meals: [], habits: {}, session: s0.program.sessions.find((x) => x.name === 'Bas du corps').id };
k.replaceState(s0);
let sess = k.sessionFor(k.getState(), today);
const target = sess.exercises.find((e) => e.key === 'seated-leg-curl');
check('séance du jour trouvée', Boolean(target), sess.exercises.map((e) => e.key).join(','));
const alts = k.alternatives(k.getState(), 'seated-leg-curl', today, sess.exercises.map((e) => e.key));
check('remplaçants du leg curl assis : même muscle, dispo', alts.length > 0 && alts.every((a) => k.regionOf(a.key) === 'posterior' || a.why !== 'Même mouvement'), alts.map((a) => a.key).join(','));
k.swapExercise(today, 'seated-leg-curl', alts[0].key, { reason: 'busy' });
sess = k.sessionFor(k.getState(), today);
const swapped = sess.exercises.find((e) => e.slotKey === 'seated-leg-curl');
check('remplacement du jour appliqué', swapped?.key === alts[0].key && swapped.change === 'swap');
check('le programme ne change pas', k.getState().program.sessions.some((x) => x.exercises.some((e) => e.key === 'seated-leg-curl')));
k.undoSwap(today, 'seated-leg-curl');
check('annuler le remplacement', k.sessionFor(k.getState(), today).exercises.some((e) => e.key === 'seated-leg-curl' && !e.change));

// Machine en panne : remplacée automatiquement 7 jours, aussi sur une autre séance qui l'utilise.
k.swapExercise(today, 'seated-leg-curl', alts[0].key, { reason: 'broken' });
const later = k.addDays(today, 3);
const s1 = k.getState();
const legsId = s1.program.sessions.find((x) => x.name === 'Legs').id;
k.replaceState({ ...s1, days: { ...s1.days, [later]: { sets: {}, mainDone: false, meals: [], habits: {}, session: legsId } } });
const auto = k.sessionFor(k.getState(), later).exercises.find((e) => e.slotKey === 'seated-leg-curl');
check('panne : remplacé automatiquement les jours suivants', auto?.change === 'broken' && auto.key !== 'seated-leg-curl', auto?.key);
check('panne : finie après 7 jours', !k.isBroken(k.getState(), 'seated-leg-curl', k.addDays(today, 8)));
k.markRepaired('seated-leg-curl');
check('machine réparée : retour à la normale', k.sessionFor(k.getState(), later).exercises.some((e) => e.key === 'seated-leg-curl'));

// Garder dans le programme
const sid = k.sessionFor(k.getState(), today).id;
k.swapExercise(today, 'seated-leg-curl', 'hip-thrust', { reason: 'vary', always: true, sessionId: sid });
const def = k.getState().program.sessions.find((x) => x.id === sid);
check('« garder » remplace dans le programme', def.exercises.some((e) => e.key === 'hip-thrust') && !def.exercises.some((e) => e.key === 'seated-leg-curl'));

// Sauter, ajouter
k.skipExercise(today, 'hip-thrust');
check('sauter un exercice', !k.sessionFor(k.getState(), today).exercises.some((e) => e.key === 'hip-thrust'));
k.skipExercise(today, 'hip-thrust', false);
k.addExtra(today, 'face-pull');
const extra = k.sessionFor(k.getState(), today).exercises.find((e) => e.key === 'face-pull');
check('ajouter un exercice', extra?.change === 'extra');
k.removeExtra(today, 'face-pull');

// Forme et express
const full = k.sessionFor(k.getState(), today);
const setsOf = (x) => x.exercises.reduce((n, e) => n + e.sets, 0);
const secs = (x) => x.exercises.reduce((n, e) => n + e.sets * (40 + e.rest), 0);
k.setForm(today, 'low');
const tired = k.sessionFor(k.getState(), today);
check('fatigué : moins de séries, le 1er exercice intact', setsOf(tired) < setsOf(full) && tired.exercises[0].sets === full.exercises[0].sets, `${setsOf(full)} → ${setsOf(tired)}`);
k.setForm(today, undefined);
k.setExpress(today, 30);
const quick = k.sessionFor(k.getState(), today);
check('express 30 min : tient dans le temps', secs(quick) <= 30 * 60 && secs(full) > 30 * 60, `${Math.round(secs(full) / 60)} → ${Math.round(secs(quick) / 60)} min`);
check('express : on garde le gros mouvement', quick.exercises[0].key === full.exercises[0].key);
k.setExpress(today, undefined);

// Forme basse : charge conseillée allégée
const st2 = k.getState();
const main = full.exercises[0];
st2.days[k.addDays(today, -7)] = { sets: { [main.key]: [{ w: 100, r: 8, done: true }, { w: 100, r: 7, done: true }, { w: 100, r: 6, done: true }, { w: 100, r: 6, done: true }] }, mainDone: true, meals: [], habits: {} };
k.replaceState(st2);
const normal = k.adviseLoad(k.getState(), main, today);
k.setForm(today, 'low');
const low = k.adviseLoad(k.getState(), main, today);
check('forme basse : charge conseillée −7 %', low.weight < normal.weight, `${normal.weight} → ${low.weight}`);
k.setForm(today, undefined);

/* ---------- Ajustements ---------- */
const s3 = k.initial();
s3.settings.athlete = { ...s3.settings.athlete, physique: 'v-taper', priorities: ['delts'], days: 5, minutes: 75 };
s3.program = structuredClone(s3.program);
for (const x of s3.program.sessions) x.exercises = x.exercises.filter((e) => k.regionOf(e.key) !== 'delts');
const tw = k.programTweaks(s3, today);
check('priorité sans volume : Pulse propose d’en ajouter', tw.some((t) => t.id.startsWith('vol-delts')), tw.map((t) => t.id).join(','));
k.replaceState(s3);
const t0 = tw.find((t) => t.id.startsWith('vol-delts'));
k.applyTweak(t0);
check('proposition appliquée', k.getState().program.sessions.some((x) => x.exercises.some((e) => k.regionOf(e.key) === 'delts')));

/* ---------- Données d'avant la v0.6 ---------- */
const old = JSON.parse(JSON.stringify(k.initial()));
delete old.settings.athlete.physique;
delete old.settings.broken;
old.days['2026-10-01'] = { sets: { bench: [{ w: 80, r: 8, done: true }] }, mainDone: true, meals: [], habits: {} };
const m = k.migrate(old);
check('anciennes données : séances conservées', m.days['2026-10-01'].sets.bench[0].w === 80);
k.replaceState(m);
check('anciennes données : séance du jour sans erreur', Array.isArray(k.sessionFor(k.getState(), '2026-10-01').exercises));
const before = k.getState().program.name;
k.applyProgram(gen({ physique: 'mass', days: 4, minutes: 60 }).program);
check('nouveau programme : l’historique des séances reste', k.getState().days['2026-10-01'].sets.bench[0].w === 80);
check('revenir au programme précédent', k.restorePreviousProgram() && k.getState().program.name === before);


/* ---------- Flammes : la moitié de la séance suffit ---------- */
{
  const st = k.initial();
  st.program = gen({ physique: 'aesthetic', days: 5, minutes: 75 }).program;
  const trainDay = '2026-11-16'; // lundi : push
  const restDay = '2026-11-19'; // jeudi : repos
  const meals = ['breakfast', 'lunch', 'dinner'].map((slot) => ({ slot, kcal: 600, protein: 40, carbs: 60, fat: 20, name: 'x', id: slot }));
  const sess = k.sessionFor(st, trainDay);
  const total = sess.exercises.reduce((n, e) => n + e.sets, 0);
  const fill = (n) => {
    const sets = {};
    let left = n;
    for (const e of sess.exercises) {
      const c = Math.min(e.sets, left);
      if (c > 0) sets[e.key] = Array.from({ length: c }, () => ({ w: 20, r: 10, done: true }));
      left -= c;
    }
    return sets;
  };
  st.days[trainDay] = { sets: fill(Math.ceil(total / 2)), mainDone: false, meals, habits: {} };
  check('flamme : la moitié des séries + 3 repas valide la journée', k.dayValidated(st, trainDay), `${Math.ceil(total / 2)}/${total}`);
  st.days[trainDay] = { sets: fill(Math.floor(total * 0.4)), mainDone: false, meals, habits: {} };
  check('flamme : 40 % des séries ne suffisent pas', !k.dayValidated(st, trainDay));
  st.health[trainDay] = { gymIn: `${trainDay}T18:00:00Z`, gymOut: `${trainDay}T18:40:00Z` };
  check('flamme : 40 min à la salle (Santé) comptent comme séance', k.dayValidated(st, trainDay));
  delete st.health[trainDay];
  st.settings.goal.level = 'full';
  st.days[trainDay] = { sets: fill(Math.ceil(total / 2)), mainDone: false, meals, habits: {} };
  check('flamme : en mode « séance entière », la moitié ne suffit pas', !k.dayValidated(st, trainDay));
  st.settings.goal.level = 'half';
  st.days[restDay] = { sets: {}, mainDone: false, meals, habits: {} };
  check('flamme : jour de repos, les repas suffisent', k.dayValidated(st, restDay));
  st.days[restDay] = { sets: {}, mainDone: false, meals: meals.slice(0, 2), habits: {} };
  check('flamme : jour de repos, il faut quand même les repas', !k.dayValidated(st, restDay));
}

/* ---------- Variété : isolation qui tourne par bloc, rattrapage d'un muscle oublié ---------- */
{
  const st = k.initial();
  st.createdAt = '2026-10-01';
  st.program = gen({ physique: 'aesthetic', days: 5, minutes: 75 }).program;
  st.settings.variety = { on: true, since: '2026-11-30', catchUp: false };
  const lifting = st.program.sessions.filter((x) => x.type === 'lifting');
  const at = (def, date, s = st) => k.adaptSession(def, k.resolveSession(def, s.customExercises), s, date, date);
  const kinds = (key) => k.catalogEntry(key).kind;

  check('bloc : 0 avant le premier lundi', k.blockOf(st, '2026-11-29') === 0);
  check('bloc : 1 du 30 novembre au 27 décembre', k.blockOf(st, '2026-11-30') === 1 && k.blockOf(st, '2026-12-27') === 1);
  check('bloc : 2 à partir du 28 décembre', k.blockOf(st, '2026-12-28') === 2);
  check('bloc : prochain changement', k.nextRotation(st, '2026-12-05') === '2026-12-28' && k.nextRotation(st, '2026-11-20') === '2026-11-30');

  const before = lifting.flatMap((def) => at(def, '2026-11-27').exercises);
  check('bloc 0 : le programme tel quel', before.every((e) => e.change !== 'rotate'));

  const b1 = lifting.map((def) => ({ def, list: at(def, '2026-12-01').exercises }));
  const rotated = b1.flatMap(({ list }) => list.filter((e) => e.change === 'rotate'));
  check('bloc 1 : des exercices d’isolation changent', rotated.length >= 3, `${rotated.length} changés`);
  check('bloc 1 : même zone, toujours de l’isolation ou du gainage', rotated.every((e) => k.regionOf(e.key) === k.regionOf(e.slotKey) && ['isolation', 'core'].includes(kinds(e.key))), rotated.map((e) => `${e.slotKey}→${e.key}`).join(' '));
  check('bloc 1 : les polyarticulaires ne bougent pas', b1.every(({ def, list }) => list.filter((e) => kinds(e.key) === 'compound').every((e) => !e.change && def.exercises.some((x) => x.key === e.key))));
  check('bloc 1 : pas deux fois le même exercice dans une séance', b1.every(({ list }) => new Set(list.map((e) => e.key)).size === list.length));
  check('bloc 1 : le badge donne le numéro du bloc', rotated.every((e) => e.because === '1'));

  const keysAt = (date) => lifting.map((def) => at(def, date).exercises.map((e) => e.key).join(',')).join('|');
  check('bloc 2 : encore d’autres variantes', keysAt('2026-12-29') !== keysAt('2026-12-01'));
  check('dans un bloc, la semaine se répète', keysAt('2026-12-01') === keysAt('2026-12-15'));

  const one = rotated[0];
  const pinned = structuredClone(st);
  for (const def of pinned.program.sessions) for (const x of def.exercises) if (x.key === one.slotKey) x.pin = true;
  const host = pinned.program.sessions.find((def) => def.exercises.some((x) => x.key === one.slotKey));
  check('épinglé : il reste à chaque bloc', at(host, '2026-12-01', pinned).exercises.some((e) => e.key === one.slotKey && !e.change));

  const off = structuredClone(st);
  off.settings.variety.on = false;
  check('variété coupée : rien ne tourne', lifting.every((def) => at(def, '2026-12-01', off).exercises.every((e) => e.change !== 'rotate')));

  const swapped = structuredClone(st);
  swapped.days['2026-12-01'] = { sets: {}, mainDone: false, meals: [], habits: {}, swaps: { [one.slotKey]: 'cable-curl' } };
  const sHost = swapped.program.sessions.find((def) => def.exercises.some((x) => x.key === one.slotKey));
  check('un remplacement du jour passe avant la variante du bloc', at(sHost, '2026-12-01', swapped).exercises.some((e) => e.slotKey === one.slotKey && e.change === 'swap'));

  // Rattrapage : semaine du lundi 23 novembre, push lundi et pull mardi faits, legs mercredi sauté.
  const cu = k.initial();
  cu.createdAt = '2026-10-01';
  cu.program = gen({ physique: 'aesthetic', days: 5, minutes: 75 }).program;
  cu.settings.variety = { on: false, since: '2027-01-04', catchUp: true };
  const sessionOf = (date) => k.findSession(cu.program, cu.program.schedule[new Date(`${date}T12:00:00`).getDay()]);
  const doneAll = (date) => {
    const def = sessionOf(date);
    cu.days[date] = { sets: Object.fromEntries(def.exercises.map((x) => [x.key, Array.from({ length: x.sets ?? 3 }, () => ({ w: 20, r: 10, done: true }))])), mainDone: true, meals: [], habits: {} };
  };
  doneAll('2026-11-23');
  doneAll('2026-11-24');
  const friday = sessionOf('2026-11-27');
  const legsRegions = ['quads', 'posterior', 'calves'];
  const fri = at(friday, '2026-11-27', cu).exercises.filter((e) => e.change === 'catchup');
  check('rattrapage : legs sauté mercredi, la séance de vendredi rattrape les jambes', fri.length >= 1 && fri.every((e) => legsRegions.includes(k.regionOf(e.key))), fri.map((e) => e.key).join(','));
  check('rattrapage : 2 ou 3 séries, en fin de séance', fri.every((e) => e.sets >= 2 && e.sets <= 3) && at(friday, '2026-11-27', cu).exercises.slice(-fri.length).every((e) => e.change === 'catchup'));
  check('rattrapage : la zone est nommée dans le badge', fri.every((e) => e.because && e.because.length > 2), fri.map((e) => e.because).join(','));
  check('rattrapage : jamais pour un jour à venir', at(friday, '2026-11-27', cu).exercises.length === k.adaptSession(friday, k.resolveSession(friday), cu, '2026-11-27', '2026-11-26').exercises.length + fri.length);
  const monday = sessionOf('2026-11-30');
  check('rattrapage : rien le lundi, toute la semaine est devant', at(monday, '2026-11-30', cu).exercises.every((e) => e.change !== 'catchup'));
  doneAll('2026-11-25');
  check('rattrapage : rien si legs a été fait', at(friday, '2026-11-27', cu).exercises.every((e) => e.change !== 'catchup'));
  delete cu.days['2026-11-25'];
  cu.days['2026-11-27'] = { sets: {}, mainDone: false, meals: [], habits: {}, noCatchUp: true };
  check('rattrapage : retiré pour la journée', at(friday, '2026-11-27', cu).exercises.every((e) => e.change !== 'catchup'));
  cu.days['2026-11-27'] = { sets: {}, mainDone: false, meals: [], habits: {}, form: 'low' };
  check('rattrapage : pas un jour de fatigue', at(friday, '2026-11-27', cu).exercises.every((e) => e.change !== 'catchup'));
  delete cu.days['2026-11-27'];
  cu.settings.variety.catchUp = false;
  check('rattrapage coupé : rien', at(friday, '2026-11-27', cu).exercises.every((e) => e.change !== 'catchup'));
  const merged = k.mergeDay({ sets: {}, meals: [], habits: {}, mainDone: false, noCatchUp: true }, { sets: { bench: [{ w: 60, r: 8, done: true }] }, meals: [], habits: {}, mainDone: false });
  check('rattrapage retiré : gardé à la fusion de deux appareils', merged.noCatchUp === true);
}

console.log(failures ? `\n${failures} échec(s).` : '\nTous les tests passent.');
process.exit(failures ? 1 : 0);
