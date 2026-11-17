// Échauffements : choisis d'après la séance (muscles, sport), dans l'ordre, séries d'approche, réglage et fusion.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'shred-warmup-'));
await build({
  stdin: {
    contents: `
      export * from './shared/warmup';
      export { endurancePlan } from './shared/endurance';
      export { DEFAULT_ATHLETE, DEFAULT_GYM, gymDefaults } from './shared/athlete';
      export { resolveSession } from './shared/program';
      export { runningPlan, hyroxPlan } from './shared/plans';
      export { TEMPLATES } from './shared/templates';
      export { dayWarmup } from './src/lib/warmupDay';
      export { mergeDay } from './src/lib/merge';
      export { initial } from './src/lib/state';
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: join(dir, 'w.mjs'),
  logLevel: 'error',
});
const k = await import(pathToFileURL(join(dir, 'w.mjs')).href);

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

const PHASES = ['raise', 'mobilise', 'activate', 'prime'];
const ordered = (w) => w.moves.every((m, i) => i === 0 || PHASES.indexOf(w.moves[i - 1].phase) <= PHASES.indexOf(m.phase));
const keys = (w) => w?.moves.map((m) => m.key) ?? [];
const warm = (def, opts = {}) => k.warmupFor({ ...k.resolveSession(def), name: def.name }, { gym: k.DEFAULT_GYM, ...opts });
const session = (type, exercises, name = 'Test') => ({ id: 't', name, focus: '', type, exercises: exercises.map((x) => (typeof x === 'string' ? { key: x } : x)) });

/* ---------- Muscu : toutes les séances des modèles ---------- */

let all = 0;
let bad = [];
for (const t of k.TEMPLATES)
  for (const def of t.program.sessions) {
    if (def.type !== 'lifting' || !def.exercises.length) continue;
    all++;
    const w = warm(def);
    if (!w || w.moves.length < 4 || w.moves.length > 9 || w.min < 3 || w.min > 10 || !ordered(w) || w.moves[0].phase !== 'raise' || new Set(keys(w)).size !== w.moves.length) bad.push(`${t.id}/${def.name}`);
  }
check(`muscu : ${all} séances des modèles, échauffement de 4 à 9 mouvements, 3 à 10 min, dans l'ordre, sans doublon`, all > 15 && !bad.length, bad.join(', '));

const push = warm(session('lifting', ['bench', 'military-press', 'db-lateral-raise', 'rope-pushdown']));
check('push : épaules mobilisées, pompes omoplates', keys(push).includes('shoulder-pass') && keys(push).includes('scap-pushup'), keys(push).join(','));
check('push : rien pour les jambes', !keys(push).some((x) => ['leg-swings', 'glute-bridge', 'bw-squat'].includes(x)));
check('push : rameur pour monter la température', push.moves[0].key === 'easy-cardio' && /Rameur/.test(push.moves[0].name), push.moves[0].name);
check('push : zones en clair, la plus travaillée d\u2019abord', push.focus === 'Épaules, pecs et bras', push.focus);

const legs = warm(session('lifting', ['squat', 'rdl', 'leg-curl', 'standing-calf']));
check('jambes : balancés, charnière, pont fessier', ['leg-swings', 'hip-hinge', 'glute-bridge'].every((x) => keys(legs).includes(x)), keys(legs).join(','));
check('jambes : vélo, rien pour le haut du corps', /Vélo/.test(legs.moves[0].name) && !keys(legs).some((x) => ['arm-circles', 'scap-pushup'].includes(x)));

const pull = warm(session('lifting', ['pullup', 'barbell-row', 'face-pull', 'barbell-curl']));
check('tirage avec tractions : tractions omoplates', keys(pull).includes('scap-pullup'), keys(pull).join(','));
const noBar = k.warmupFor(k.resolveSession(session('lifting', ['barbell-row', 'seated-cable-row'])), { gym: { ...k.DEFAULT_GYM, equipment: { ...k.DEFAULT_GYM.equipment, cables: false } } });
check('tirage sans poulie ni barre : Y, T, W', keys(noBar).includes('ytw'), keys(noBar).join(','));

const neck = warm(session('lifting', ['barbell-row', 'shrug', 'neck-extension']));
check('cou travaillé : mobilité du cou', keys(neck).includes('neck-mobility'));

const home = k.warmupFor(k.resolveSession(session('lifting', ['pushup', 'goblet-squat', 'plank'])), { gym: { chain: 'home', equipment: { dumbbells: true } } });
check('à la maison sans cardio : jumping jacks', home.moves[0].key === 'jumping-jacks', home.moves[0].key);

const core = warm(session('lifting', ['plank', 'side-plank', 'crunch']));
check('abdos seuls : dead bug et bird dog', keys(core).includes('dead-bug') && keys(core).includes('bird-dog'), keys(core).join(','));

const startCardio = warm(session('cardio', [{ key: 'incline-walk' }, 'hanging-leg-raise', 'cable-crunch', 'plank']));
check('séance qui commence par du cardio : pas de machine en plus', startCardio && startCardio.moves[0].phase !== 'raise', keys(startCardio).join(','));

/* ---------- Séries d'approche ---------- */

const ramped = k.warmupFor(k.resolveSession(session('lifting', ['bench', 'barbell-row'])), { gym: k.DEFAULT_GYM, ramp: { key: 'bench', work: 100 } });
check('approche : barre vide puis 50, 70, 85 %', JSON.stringify(ramped.ramp?.sets) === JSON.stringify([{ w: 20, r: 10 }, { w: 50, r: 6 }, { w: 70, r: 4 }, { w: 85, r: 2 }]), JSON.stringify(ramped.ramp?.sets));
check('approche : pas de série légère en double', !keys(ramped).includes('first-light'));
const dumbbell = k.warmupFor(k.resolveSession(session('lifting', ['incline-db-press', 'db-row'])), { ramp: { key: 'incline-db-press', work: 30 } });
check('approche aux haltères : pas de barre de 20 kg', dumbbell.ramp && dumbbell.ramp.sets[0].w !== 20 && dumbbell.ramp.sets.every((x) => x.w < 30), JSON.stringify(dumbbell.ramp?.sets));
const light = warm(session('lifting', ['leg-press', 'leg-curl']));
check('charge inconnue : une série légère du premier exercice', light.moves.at(-1).key === 'first-light' && /Presse à cuisses/.test(light.moves.at(-1).name), light.moves.at(-1).name);
check('tractions en premier : pas de séries d’approche, ni pour l’exercice d’après', k.firstLoaded(k.resolveSession(session('lifting', ['pullup', 'barbell-row'])).exercises) === undefined);
check('sauts en premier : l’approche prépare le soulevé de terre', k.firstLoaded(k.resolveSession(session('lifting', ['box-jump', 'deadlift'])).exercises)?.key === 'deadlift');
check('mauvaise clé de charge : ignorée', !k.warmupFor(k.resolveSession(session('lifting', ['bench', 'squat'])), { ramp: { key: 'squat', work: 100 } }).ramp);

/* ---------- Endurance ---------- */

const easy = warm(session('cardio', [{ key: 'run-easy' }]));
check('footing : mobilité des jambes, pas de gammes', keys(easy).includes('leg-swings') && !keys(easy).includes('high-knees') && /10 premières minutes/.test(easy.then), easy.then);
const intervals = warm(session('cardio', [{ key: 'run-intervals' }]));
check('fractionné : montées de genoux, footing avant la partie rapide', keys(intervals).includes('high-knees') && /footing facile/.test(intervals.then), intervals.then);
const withWu = warm(session('cardio', [{ key: 'run-warmup' }, { key: 'run-tempo' }, { key: 'run-cooldown' }]));
check('plan avec footing d’échauffement : on s’appuie dessus', /Ton plan commence/.test(withWu.then), withWu.then);
const swim = warm(session('cardio', [{ key: 'swim-warmup' }, { key: 'swim-css' }]));
check('natation : épaules à sec, flèche, puis dans l’eau', ['arm-circles', 'streamline', 'ytw'].every((x) => keys(swim).includes(x)) && ordered(swim) && /Dans l’eau/.test(swim.then), keys(swim).join(','));
const bike = warm(session('cardio', [{ key: 'bike-vo2' }]));
check('vélo dur : accélérations en plus', /accélérations/.test(bike.then) && bike.focus === 'Vélo', bike.then);
check('vélo récup : pas d’échauffement', warm(session('cardio', [{ key: 'bike-recovery' }])) === null);
const combat = warm(session('cardio', [{ key: 'rope-shadow' }, { key: 'intervals' }]));
check('combat : corde puis shadow léger', keys(combat)[0] === 'rope-easy' && keys(combat).includes('shadow-light'), keys(combat).join(','));
const row = warm(session('cardio', [{ key: 'rowing-erg' }]));
check('rameur : charnière et dos', keys(row).includes('hip-hinge') && /Rameur/.test(row.then));
const ski = warm(session('cardio', [{ key: 'ski-erg' }]));
check('SkiErg seul : échauffement SkiErg', ski.focus === 'SkiErg' && /SkiErg/.test(ski.then), ski.focus);
const walk = warm(session('cardio', [{ key: 'incline-walk' }]));
check('marche inclinée : chevilles, mollets, à plat d’abord', keys(walk).includes('ankle-rocks') && /à plat/.test(walk.then));
const race = warm(session('cardio', [{ key: 'race-day' }], '10 km'));
check('jour de course : footing et accélérations sur place', /Sur la ligne/.test(race.then) && keys(race).includes('high-knees'));
const hyroxRace = warm(session('cardio', [{ key: 'race-day' }], 'Hyrox'));
check('jour d’Hyrox : stations à l’allure de course', hyroxRace.focus === 'Course et stations' && /station/.test(hyroxRace.then), hyroxRace.focus);
const sim = warm(session('cardio', [{ key: 'hyrox-sim' }]));
check('simulation Hyrox : tout le corps', sim.focus === 'Course et stations' && keys(sim).includes('inchworm'));
const sledDay = warm(session('lifting', ['squat', 'rdl', 'sled-push', 'sled-pull', 'sandbag-lunge']));
check('force + traîneau : échauffement de muscu (squat d’abord)', sledDay.focus !== 'Course et stations' && keys(sledDay).includes('leg-swings'), sledDay.focus);

/* ---------- Pas d'échauffement ---------- */

check('repos : rien', warm(session('rest', ['walk', 'mobility'])) === null);
check('mobilité seule : rien', warm(session('cardio', ['mobility'])) === null);
check('séance vide : rien', warm(session('lifting', [])) === null);

/* ---------- Plans générés : chaque séance d'effort a son échauffement ---------- */

const today = '2026-11-16';
const plans = [
  ['natation', k.endurancePlan({ athlete: { ...k.DEFAULT_ATHLETE, sport: 'swimming', days: 4 }, gym: k.DEFAULT_GYM, known: [], custom: {}, today })],
  ['vélo', k.endurancePlan({ athlete: { ...k.DEFAULT_ATHLETE, sport: 'cycling', days: 5 }, gym: k.DEFAULT_GYM, known: [], custom: {}, today })],
  ['triathlon', k.endurancePlan({ athlete: { ...k.DEFAULT_ATHLETE, sport: 'triathlon', days: 6 }, gym: k.DEFAULT_GYM, known: [], custom: {}, today })],
  ['10 km', k.runningPlan({ distance: '10k', date: '2027-03-01', athlete: { ...k.DEFAULT_ATHLETE, days: 4 }, today })],
  ['Hyrox', k.hyroxPlan({ date: '2027-03-01', athlete: { experience: 'intermediate', days: 4 }, today })],
];
for (const [name, p] of plans) {
  const effort = p.sessions.filter((d) => d.type !== 'rest' && d.exercises.length);
  const missing = effort.filter((d) => {
    const w = warm(d);
    const recovery = k.resolveSession(d).exercises.every((x) => x.discipline && x.zone === 1);
    return recovery ? w !== null : !w || !ordered(w) || w.moves.length < 3;
  });
  check(`plan ${name} : ${effort.length} séances, échauffement adapté à chacune`, effort.length > 2 && !missing.length, missing.map((d) => d.name).join(', '));
}

/* ---------- Affichage ---------- */

check('dose : 30 s, 2 min 30, 10 reps, 6 par côté', [k.fmtDose({ sec: 30 }), k.fmtDose({ sec: 150 }), k.fmtDose({ reps: 10 }), k.fmtDose({ reps: 6, side: true })].join('|') === '30 s|2 min 30|10 reps|6 par côté');
check('durée : chaque côté compte', k.moveSeconds({ reps: 10, side: true }) === 70 && k.moveSeconds({ sec: 30 }) === 40);
check('tous les mouvements ont un nom, une consigne et une dose', Object.values(k.WARM_MOVES).every((m) => m.name && m.cue.length > 20 && (m.sec || m.reps)));

/* ---------- Jour : réglage, charge, fusion ---------- */

const s = k.initial();
s.program = { name: 'T', sessions: [session('lifting', ['bench', 'barbell-row'])], schedule: Array(7).fill('t') };
const d = (sets) => ({ sets, meals: [], habits: {}, mainDone: true });
s.days['2026-11-09'] = d({ bench: [{ w: 80, r: 8, done: true }, { w: 80, r: 8, done: true }] });
const dw = k.dayWarmup(s, today);
check('jour : séries d’approche d’après l’historique', dw?.ramp?.key === 'bench' && dw.ramp.work >= 80, JSON.stringify(dw?.ramp));
s.settings.warmup = false;
check('réglage coupé : pas d’échauffement', k.dayWarmup(s, today) === null);

const day = (warmup) => ({ sets: {}, meals: [], habits: {}, mainDone: false, ...(warmup ? { warmup } : {}) });
check('fusion : fait l’emporte sur passé', k.mergeDay(day('skipped'), day('done')).warmup === 'done' && k.mergeDay(day('done'), day()).warmup === 'done');
check('fusion : passé d’un côté reste passé', k.mergeDay(day(), day('skipped')).warmup === 'skipped' && k.mergeDay(day(), day()).warmup === undefined);

if (failures) {
  console.error(`\n${failures} échec(s)`);
  process.exit(1);
}
console.log('\nÉchauffements : tout est bon.');
