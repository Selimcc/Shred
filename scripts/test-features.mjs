// Fonctions de la v0.22 côté téléphone : trophées, fiche exercice (disques, échauffement, historique),
// recherche et aliments récents, données du classement.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

globalThis.localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
const dir = mkdtempSync(join(tmpdir(), 'shred-features-'));
await build({
  entryPoints: { trophies: 'src/lib/trophies.ts', ex: 'src/lib/exerciseStats.ts', food: 'src/lib/foodSearch.ts', profile: 'src/lib/profile.ts' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outdir: dir,
  logLevel: 'error',
  define: { __BUILD__: '"0.22.0+test"', 'import.meta.env': '{"MODE":"test","DEV":false,"PROD":true}' },
});
const load = (n) => import(pathToFileURL(join(dir, `${n}.js`)).href);
const [tr, ex, food, profile] = await Promise.all(['trophies', 'ex', 'food', 'profile'].map(load));

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

// Un petit historique : trois séances de développé couché qui progressent, de l'eau, des repas.
const day = (sets, extra = {}) => ({ sets, meals: [], habits: {}, mainDone: true, ...extra });
const state = {
  version: 1,
  createdAt: '2026-11-01',
  days: {
    '2026-11-02': day(
      {
        bench: [
          { w: 60, r: 8, done: true },
          { w: 60, r: 7, done: true },
        ],
      },
      {
        mainDoneAt: new Date('2026-11-02T07:10:00').getTime(),
        meals: [{ id: 'a', slot: 'lunch', label: 'Skyr', kcal: 150, protein: 20, carbs: 10, fat: 0, source: 'manual', at: 1 }],
      },
    ),
    '2026-11-04': day(
      {
        bench: [
          { w: 62.5, r: 8, done: true },
          { w: 62.5, r: 6, done: true },
          { w: 40, r: 10, done: false },
        ],
      },
      {
        meals: [
          { id: 'b', slot: 'dinner', label: 'Poulet riz', kcal: 650, protein: 45, carbs: 80, fat: 12, source: 'manual', at: 3 },
          { id: 'c', slot: 'lunch', label: 'skyr', kcal: 150, protein: 20, carbs: 10, fat: 0, source: 'manual', at: 2 },
        ],
      },
    ),
    '2026-11-07': day(
      { bench: [{ w: 65, r: 8, done: true }], run: [{ km: 5.2, min: 28, done: true }] },
      { mainDoneAt: new Date('2026-11-07T22:40:00').getTime() },
    ),
    '2026-11-08': day({ squat: [{ w: 100, r: 5, done: true }] }),
  },
  body: { weight: { '2026-11-02': 74 }, waist: {}, photos: [] },
  streak: { banked: 4, best: 9, freezes: 0, through: '2026-11-08', frozen: [] },
  coach: [],
  settings: { onboarded: true, goal: { workout: true, minMeals: 2 }, modules: {} },
  program: { name: 'Test', sessions: [], schedule: [] },
  customExercises: {},
  mealPlan: [],
  habits: [],
  health: { '2026-11-02': { steps: 12000 }, '2026-11-03': { steps: 4000 } },
  ui: {},
};

/* ---------- Trophées ---------- */
const st = tr.trophyStats(state);
check('séances validées comptées', st.sessions === 4, JSON.stringify(st));
check('tonnage : seules les séries faites', st.tonnage === 60 * 8 + 60 * 7 + 62.5 * 8 + 62.5 * 6 + 65 * 8 + 100 * 5, String(st.tonnage));
check('records : chaque progression du 1RM estimé', st.records === 2, String(st.records));
check('cardio : km notés', st.cardioKm === 5);
check('lève-tôt et oiseau de nuit', st.early === 1 && st.late === 1);
check('week-end complet (samedi et dimanche)', st.weekends === 1, String(st.weekends));
check('pas : journées à 10 000', st.steps10k === 1);
check('série : la meilleure', st.bestStreak === 9);
const won = tr.unlockedOf(st).map((t) => t.id);
check('trophées gagnés cohérents', won.includes('s1') && won.includes('r1') && won.includes('f7') && won.includes('e1') && !won.includes('s10'), won.join(','));
check('identifiants de trophées uniques', new Set(tr.TROPHIES.map((t) => t.id)).size === tr.TROPHIES.length);

/* ---------- Fiche exercice ---------- */
const es = ex.exerciseStats(state, 'bench');
check('historique : du plus récent au plus ancien', es.sessions.map((x) => x.date).join() === '2026-11-07,2026-11-04,2026-11-02');
check('séries non faites ignorées', es.totalSets === 5);
check('meilleure série et plus lourde', es.heaviest.w === 65 && Math.round(es.bestE1rm.e1rm) > 80);
check('disques : 100 kg = 25 + 15 par côté', JSON.stringify(ex.platesFor(100).plates) === '[25,15]');
check(
  'disques : 62,5 kg = 20 + 1,25 par côté',
  ex.platesFor(62.5).rest === 0 && JSON.stringify(ex.platesFor(62.5).plates) === '[20,1.25]',
  JSON.stringify(ex.platesFor(62.5)),
);
check('disques : reste signalé', ex.platesFor(101).rest > 0);
check('disques : barre seule', ex.platesFor(20).plates.length === 0);
const warm = ex.warmupSets(100);
check(
  'échauffement : barre, puis paliers croissants sous la charge',
  warm[0].w === 20 && warm.every((w, i) => i === 0 || w.w > warm[i - 1].w) && warm.at(-1).w < 100,
  JSON.stringify(warm),
);
check('échauffement : rien sans charge', ex.warmupSets(0).length === 0);
check(
  'barre olympique reconnue',
  ex.isBarbell('bench', 'Développé couché barre') && !ex.isBarbell('x', 'Rowing barre à la poulie') && !ex.isBarbell('y', 'Curl haltères'),
);

/* ---------- Aliments ---------- */
const recent = food.recentFoods(state, '2026-11-10');
check('repas récents : un par nom, le plus récent d’abord', recent.map((m) => m.label).join() === 'Poulet riz,skyr', recent.map((m) => m.label).join());
const hit = { code: '1', name: 'Skyr', per100: { kcal: 60, protein: 10, carbs: 4, fat: 0.2 } };
const g = food.forGrams(hit, 150);
check('macros pour une quantité', g.kcal === 90 && g.protein === 15);

/* ---------- Classement ---------- */
const b = profile.boardData(
  { ...state, days: { ...state.days }, settings: { ...state.settings, streakGoal: 7, goal: { workout: true, minMeals: 0 } } },
  '2026-11-08',
);
check('classement : lundi de la semaine', b.weekOf === '2026-11-02', JSON.stringify(b));
check('classement : séances de la semaine', b.week === 4);

console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
