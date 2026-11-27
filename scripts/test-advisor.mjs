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
      export { strengthProfile, standardOf, ratioAt, sexFactor, levelFor } from './src/lib/strength';
      export { withGymSteps } from './src/lib/logic';
      export { PATTERNS } from './shared/generator';
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

/* Charge de départ d'un exercice jamais fait */
const lateral = k.resolveExercise({ key: 'db-lateral-raise', reps: '12–20' });
const pec = k.resolveExercise({ key: 'pec-deck', reps: '12–15' });
s = state({ '2026-11-03': { bench: sets(80, [8, 8, 8]), 'incline-db-press': sets(28, [8, 8, 8]) } });
s.body.weight['2026-11-08'] = 80;
let st = k.startingLoad(s, lateral, '2026-11-09');
check('élévations latérales : départ réaliste (4 à 10 kg) pour 80 kg', st && st.weight >= 4 && st.weight <= 10, JSON.stringify(st));
check('niveau tiré des autres exercices', st?.from === 'lifts', st?.from);
st = k.startingLoad(s, pec, '2026-11-09');
check('pec deck : niveau du même groupe (pecs)', st?.from === 'group' && st.weight >= 30 && st.weight <= 75, JSON.stringify(st));
const fresh = state({});
fresh.body.weight['2026-11-08'] = 80;
st = k.startingLoad(fresh, k.resolveExercise({ key: 'squat' }), '2026-11-09');
check('sans charge notée : expérience déclarée, barre vide au minimum', st?.from === 'experience' && st.weight >= 20, JSON.stringify(st));
check('tractions (lest) : pas de charge de départ', k.startingLoad(fresh, k.resolveExercise({ key: 'pullup' }), '2026-11-09') === null);
check('exercice sans repères : rien d’inventé', k.startingLoad(fresh, k.resolveExercise({ key: 'straight-arm-pulldown' }), '2026-11-09') === null);
const she = structuredClone(fresh);
she.settings.athlete.sex = 'female';
const male = k.startingLoad(fresh, lateral, '2026-11-09');
const female = k.startingLoad(she, lateral, '2026-11-09');
check('femme : repères ramenés à son échelle', female.weight < male.weight || (female.weight === male.weight && female.weight === 1), `${female.weight} < ${male.weight}`);
check('facteurs : bas du corps plus proche que le haut', k.sexFactor('squat', 'female') > k.sexFactor('bench', 'female') && k.sexFactor('bench', 'male') === 1);
check('ratioAt inverse la note', Math.abs(k.ratioAt(k.standardOf('bench').t, 3) - 1.0) < 1e-9 && Math.abs(k.ratioAt(k.standardOf('bench').t, 3.5) - 1.125) < 1e-9);

/* Repères par niveau */
let bm = k.benchmarks(s, lateral, '2026-11-09');
check('repères : 5 niveaux croissants', bm && bm.levels.length === 5 && bm.levels.every((l, i) => i === 0 || l.weight >= bm.levels[i - 1].weight), JSON.stringify(bm?.levels));
check('repères : élévations latérales légères pour tout le monde (A ≤ 16 kg à 80 kg)', bm.levels[4].weight <= 16, JSON.stringify(bm.levels));
s.days['2026-11-05'] = { sets: { 'db-lateral-raise': sets(10, [15, 15, 14, 14]) }, meals: [], habits: {} };
bm = k.benchmarks(s, lateral, '2026-11-09');
check('repères : ta note sur l’exercice', bm.mine === 'C' || bm.mine === 'B', bm.mine);

/* Petits muscles : les reps d'abord quand l'haltère du dessus est un gros saut */
const lat8 = { ...lateral, sets: 3, step: 2 };
s = state({ '2026-11-02': { 'db-lateral-raise': sets(8, [20, 20, 20]) } });
a = k.adviseLoad(s, lat8, '2026-11-09');
check('8 kg × 20 partout (haut de fourchette) : on reste, on vise 23', a.weight === 8 && a.text.includes('23'), a.text);
s = state({ '2026-11-02': { 'db-lateral-raise': sets(8, [23, 23, 23]) } });
a = k.adviseLoad(s, lat8, '2026-11-09');
check('8 kg × 23 partout : on passe à 10 kg', a.weight === 10, a.text);
s = state({ '2026-11-02': { 'military-press': sets(40, [5, 5, 5, 5, 5]) } });
check('polyarticulaire : rien ne change (+2,5 kg)', k.adviseLoad(s, ex, '2026-11-09').weight === 42.5);

/* Écart entre les haltères de la salle */
s = state({});
s.settings.gym.dumbbellStep = 2;
const session = { id: 'x', name: 'x', focus: '', type: 'lifting', duration: '', completeWhen: 'all', lifting: true, exercises: [lateral, k.resolveExercise({ key: 'bench' })] };
const stepped = k.withGymSteps(s, session);
check('haltères de 2 en 2 : pas de 2 kg sur les élévations, barre inchangée', stepped.exercises[0].step === 2 && stepped.exercises[1].step === 2.5);
delete s.settings.gym.dumbbellStep;
check('sans réglage : la séance ne change pas', k.withGymSteps(s, session) === session);

/* Choix des exercices d'après les études */
check('triceps : extension au-dessus de la tête d’abord', k.PATTERNS.triceps.keys[0] === 'overhead-triceps');
check('ischios : leg curl assis d’abord', k.PATTERNS.hamIso.keys[0] === 'seated-leg-curl' && !!k.catalogEntry('seated-leg-curl')?.why);
check('mollets : debout d’abord', k.PATTERNS.calves.keys[0] === 'standing-calf');

console.log(failures ? `\n${failures} échec(s).` : '\nTous les tests passent.');
process.exit(failures ? 1 : 0);
