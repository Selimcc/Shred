// Flammes (paliers de série), fêtes de fin de journée et charges recopiées d'une série à l'autre.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'shred-flames-'));
await build({
  stdin: {
    contents: `
      export { initial, getState, replaceState } from './src/lib/store';
      export { ladder, flameInfo, celebrationFor } from './src/lib/flames';
      export { updateSet, toggleSet } from './src/lib/actions';
      export { dayKey, addDays } from './src/lib/date';
      export { sessionFor } from './src/lib/logic';
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: join(dir, 'f.mjs'),
  logLevel: 'error',
  define: { 'import.meta.env': '{"MODE":"test"}' },
});
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const k = await import(pathToFileURL(join(dir, 'f.mjs')).href);

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

const today = k.dayKey();
check('paliers à partir de 7 jours', k.ladder(7).slice(0, 7).join(',') === '7,14,21,30,45,60,90', k.ladder(7).slice(0, 7).join(','));
check('paliers à partir de 3 jours', k.ladder(3)[0] === 3 && k.ladder(3)[1] === 7);
check('après un an, de 100 en 100', k.ladder(7, 500).includes(465) && k.ladder(7, 500).includes(565));

const state = (banked, best, validatedToday = true) => {
  const s = k.initial();
  s.settings.goal = { workout: true, minMeals: 0 };
  s.streak = { ...s.streak, banked, best, through: k.addDays(today, -1) };
  if (validatedToday) s.days[today] = { sets: {}, mainDone: true, meals: [], habits: {} };
  return s;
};

let s = state(0, 0);
check('1re journée validée : Kilo apporte la flamme', k.celebrationFor(s, today)?.kind === 'first');
s.ui.metKilo = true;
check('ensuite : fête du jour', k.celebrationFor(s, today)?.kind === 'daily');
s.ui.celebrated = today;
check('une seule fête par jour', k.celebrationFor(s, today) === null);
check('rien à fêter sans journée validée', k.celebrationFor(state(3, 3, false), today) === null);

s = state(6, 6);
s.ui.metKilo = true;
let c = k.celebrationFor(s, today);
check('7e jour : 1re flamme (palier)', c?.kind === 'milestone' && c.days === 7 && c.tier === 1, JSON.stringify(c));
s = state(13, 13);
c = k.celebrationFor(s, today);
check('14e jour : flamme d’or', c?.kind === 'milestone' && c.tier === 2);
s = state(6, 10);
s.ui.metKilo = true;
check('palier déjà gagné après une série cassée : pas de nouvelle flamme', k.celebrationFor(s, today)?.kind === 'daily');
s = state(4, 4);
s.settings.streakGoal = 3;
check('l’objectif choisi décide du 1er palier', k.flameInfo(s, today).earned.join(',') === '3' && k.flameInfo(s, today).next === 7);

const f = k.flameInfo(state(14, 15), today);
check('flammes gagnées et prochaine', f.earned.join(',') === '7,14' && f.next === 21 && f.tier === 2 && f.toNext === 6, JSON.stringify({ e: f.earned, n: f.next, t: f.tier, to: f.toNext }));

/* Charges recopiées sur les séries suivantes */
const base = k.initial();
k.replaceState(base);
k.updateSet(today, 'bench', 0, { w: 60 }, 4);
let logs = k.getState().days[today].sets.bench;
check('charge de la 1re série recopiée sur les suivantes', logs.map((l) => l.w).join(',') === '60,60,60,60', logs.map((l) => l.w).join(','));
k.updateSet(today, 'bench', 1, { w: 62.5 }, 4);
logs = k.getState().days[today].sets.bench;
check('une hausse en cours de route suit sur la fin', logs.map((l) => l.w).join(',') === '60,62.5,62.5,62.5');
k.updateSet(today, 'bench', 3, { w: 55 }, 4);
k.updateSet(today, 'bench', 0, { w: 65 }, 4);
logs = k.getState().days[today].sets.bench;
check('les séries modifiées à la main ne sont pas écrasées', logs.map((l) => l.w).join(',') === '65,62.5,62.5,55', logs.map((l) => l.w).join(','));
k.updateSet(today, 'bench', 0, { r: 8 }, 4);
logs = k.getState().days[today].sets.bench;
check('les reps aussi', logs.map((l) => l.r).join(',') === '8,8,8,8');
const ex = k.sessionFor(k.getState(), today).exercises[0];
k.updateSet(today, ex.key, 0, { w: 40 }, ex.sets);
logs = k.getState().days[today].sets[ex.key];
logs[1].w = undefined;
k.replaceState({ ...k.getState() });
k.toggleSet(today, ex, 1);
check('valider une série vide reprend la charge précédente', k.getState().days[today].sets[ex.key][1].w === 40 || ex.noLoad, String(k.getState().days[today].sets[ex.key][1].w));

console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent.');
process.exit(failures ? 1 : 0);
