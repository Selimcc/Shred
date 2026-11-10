// Conseils de charge (1RM estimé, progression, stagnation) et volume par muscle.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'shred-advisor-'));
await build({
  stdin: {
    contents: `
      export * from './src/lib/advisor';
      export { initial } from './src/lib/store';
      export { resolveExercise } from './shared/program';
      export { TEMPLATES } from './shared/templates';
      export { catalogEntry } from './shared/catalog';
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', outfile: join(dir, 'a.mjs'), logLevel: 'error',
  define: { 'import.meta.env': '{"MODE":"test"}' },
});
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const k = await import(pathToFileURL(join(dir, 'a.mjs')).href);

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

const state = (days) => {
  const s = structuredClone(k.initial());
  s.days = {};
  for (const [date, sets] of Object.entries(days)) s.days[date] = { sets, meals: [], habits: {} };
  return s;
};
const sets = (w, reps) => reps.map((r) => ({ w, r, done: true }));
const ex = k.resolveExercise({ key: 'military-press', sets: 5, reps: '5' });
const row = k.resolveExercise({ key: 'barbell-row', sets: 4, reps: '6–8' });

/* Modèle */
const t = k.TEMPLATES.find((x) => x.id === 'recomp-shoulders-back');
check('modèle recompo présent et en premier', k.TEMPLATES[0].id === 'recomp-shoulders-back');
const unknown = t.program.sessions.flatMap((x) => x.exercises).filter((e) => !k.catalogEntry(e.key));
check('tous les exercices du modèle existent', unknown.length === 0, unknown.map((e) => e.key).join(','));
check('planning : jeudi cardio + abdos, dimanche repos', t.program.schedule[4] === 'cardio-abs' && t.program.schedule[0] === 'rest');

/* Calculs */
check('loadFor : 100 kg de 1RM → ~80 kg pour 5 reps à 2 RIR', Math.abs(k.loadFor(100, 5) - 81.1) < 1, k.loadFor(100, 5).toFixed(1));
check('repsAt : 80 kg sur 1RM 100 → 7 reps', k.repsAt(100, 80) === 7);

/* Toutes les reps au max → on monte */
let s = state({ '2026-11-02': { 'military-press': sets(40, [5, 5, 5, 5, 5]) } });
let a = k.adviseLoad(s, ex, '2026-11-09');
check('5×5 réussi → +2,5 kg', a.weight === 42.5, a.text);

/* Reps manquées → même charge, +1 rep */
s = state({ '2026-11-02': { 'military-press': sets(45, [5, 4, 4, 3, 3]) } });
a = k.adviseLoad(s, ex, '2026-11-09');
check('reps manquées → garder la charge', a.weight === 45, a.text);

/* Grosse marge → monter plus */
s = state({ '2026-11-02': { 'barbell-row': sets(40, [12, 12, 11, 11]) } });
a = k.adviseLoad(s, row, '2026-11-09');
check('marge importante → charge estimée plus haute', a.weight >= 42.5 && a.weight <= 47.5, `${a.weight} — ${a.text}`);

/* Stagnation → −10 % */
s = state({
  '2026-10-12': { 'military-press': sets(45, [5, 5, 4, 4, 4]) },
  '2026-10-19': { 'military-press': sets(45, [5, 4, 4, 4, 4]) },
  '2026-10-26': { 'military-press': sets(45, [5, 4, 4, 4, 3]) },
  '2026-11-02': { 'military-press': sets(45, [5, 5, 4, 4, 3]) },
});
a = k.adviseLoad(s, ex, '2026-11-09');
check('stagnation 3 séances → allègement', a.trend === 'stall' && a.weight === 40, `${a.trend} ${a.weight} — ${a.text}`);

/* Volume */
s = state({
  '2026-11-03': { bench: sets(70, [8, 8, 8, 8]), 'incline-db-press': sets(26, [8, 8, 8]), 'db-lateral-raise': sets(10, [12, 12]) },
  '2026-11-06': { bench: sets(70, [8, 8, 8, 8]), dips: sets(0, [10, 10, 10]) },
});
s.body.weight['2026-11-08'] = 74;
const f = k.focusPlan(s, '2026-11-09');
const sh = f.items.find((i) => i.group === 'shoulders');
const back = f.items.find((i) => i.group === 'back');
check('épaules et dos sous le minimum', sh.status === 'low' && back.status === 'low', `${sh.sets} / ${back.sets}`);
check('une priorité est donnée', !!f.headline, f.headline);

console.log(failures ? `\n${failures} échec(s).` : '\nTous les tests passent.');
process.exit(failures ? 1 : 0);
