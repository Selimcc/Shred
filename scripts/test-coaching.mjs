// Profil sportif, programmes course et Hyrox, adaptation à la salle, meal plans, propositions de plats, bilan, mail.
import { build } from 'esbuild';
import { workerShims } from './worker-shims.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'shred-coaching-'));
await build({
  stdin: {
    contents: `
      export * from './shared/athlete';
      export * from './shared/plans';
      export { generateMealPlan, suggestMeals, RECIPES, allowedRecipe, macrosOf } from './shared/meals';
      export { initial } from './src/lib/store';
      export { weeklyReport, reportHtml, reportText } from './src/lib/report';
      export { dayKey, addDays, mondayOf } from './src/lib/date';
      export { sessionFor } from './src/lib/logic';
      export { programFor } from './src/lib/coaching';
      export { programTweaks } from './src/lib/tweaks';
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: join(dir, 'c.mjs'),
  logLevel: 'error',
  define: { 'import.meta.env': '{"MODE":"test"}' },
});
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const k = await import(pathToFileURL(join(dir, 'c.mjs')).href);
const w = await build({ entryPoints: ['worker/index.ts'], bundle: true, format: 'esm', platform: 'neutral', outdir: join(dir, 'w'), logLevel: 'error', external: ['cloudflare:*'], ...workerShims });
void w;
const worker = (await import(pathToFileURL(join(dir, 'w', 'index.js')).href)).default;

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

/* Besoins */
const a = { ...k.DEFAULT_ATHLETE, sex: 'male', bodyFat: 18, targetBodyFat: 12, days: 5 };
const cut = k.nutritionPlan({ weight: 75, height: 179, age: 22, goal: 'cut', athlete: a });
check('sèche : déficit raisonnable', cut.targets.kcal < cut.maintenance - 300 && cut.targets.kcal > cut.maintenance - 800, `${cut.targets.kcal} / maintien ${cut.maintenance}`);
check('sèche : protéines ≥ 2 g/kg', cut.targets.protein >= 150, `${cut.targets.protein} g`);
check('projection vers 12 % de masse grasse', cut.projection && cut.projection.targetWeight > 68 && cut.projection.targetWeight < 71 && cut.projection.weeks > 6, JSON.stringify(cut.projection));
const bulk = k.nutritionPlan({ weight: 75, height: 179, age: 22, goal: 'bulk', athlete: a });
const recomp = k.nutritionPlan({ weight: 75, height: 179, age: 22, goal: 'recomp', athlete: a });
check('prise > recompo > sèche', bulk.targets.kcal > recomp.targets.kcal && recomp.targets.kcal > cut.targets.kcal, `${bulk.targets.kcal} / ${recomp.targets.kcal} / ${cut.targets.kcal}`);
const macroKcal = cut.targets.protein * 4 + cut.targets.carbs * 4 + cut.targets.fat * 9;
check('les macros font les calories (±3 %)', Math.abs(macroKcal - cut.targets.kcal) / cut.targets.kcal < 0.03, `${macroKcal}`);

/* Course */
const half = k.runningPlan({ distance: 'half', date: '2027-03-21', athlete: { experience: 'intermediate', days: 4 }, ref: { sec: 50 * 60, km: 10 }, today: '2026-10-20' });
check('semi : 12 semaines finissant la semaine de la course', half.weeks.length === 12 && half.start === k.addDays(k.mondayOf('2027-03-21'), -77), half.start);
const raceDay = half.weeks[11][new Date('2027-03-21T12:00:00Z').getUTCDay()];
check('le jour J est la course', half.sessions.find((x) => x.id === raceDay)?.name === 'Semi-marathon');
const longs = half.weeks.map((wk) => half.sessions.find((x) => x.id === wk[0])).filter((x) => x?.name === 'Sortie longue').map((x) => Number(x.exercises[0].reps.split(' ')[0]));
check('sortie longue qui monte jusqu’à ~19 km', Math.max(...longs) >= 18 && longs[0] <= 10, longs.join(','));
check('dernières semaines allégées (affûtage)', half.phases.at(-1) === 'Affûtage');
const p = k.paces('half', 'intermediate', { sec: 50 * 60, km: 10 });
check('allure semi cohérente avec 50 min au 10 km', p.predicted > 105 * 60 && p.predicted < 115 * 60, k.fmtDuration(p.predicted));
const short = k.runningPlan({ distance: 'marathon', date: k.addDays('2026-10-20', 30), athlete: { experience: 'beginner', days: 3 }, today: '2026-10-20' });
check('course proche : plan raccourci, pas avant aujourd’hui', short.weeks.length <= 6 && short.start >= k.mondayOf('2026-10-20'), `${short.weeks.length} semaines`);

/* Hyrox et salle */
const hx = k.hyroxPlan({ date: '2027-01-17', athlete: { experience: 'intermediate', days: 4 }, today: '2026-10-20' });
const keys = new Set(hx.sessions.flatMap((x) => x.exercises.map((e) => e.key)));
check('Hyrox : stations dans le plan', ['sled-push', 'ski-erg', 'wall-ball', 'run-intervals'].every((x) => keys.has(x)));

// Hyrox sans date (0.32) : un bloc de 8 semaines avec les stations, pas un programme de muscu seul.
const hb = k.hyroxPlan({ athlete: { experience: 'intermediate', days: 4 }, today: '2026-10-20' });
const hbKeys = new Set(hb.sessions.flatMap((x) => x.exercises.map((e) => e.key)));
check('Hyrox sans date : 8 semaines, stations et course', hb.weeks.length === 8 && !hb.event && ['sled-push', 'wall-ball', 'run-intervals', 'ski-erg'].every((x) => hbKeys.has(x)));
check('Hyrox sans date : semaines 4 et 8 allégées, simulation en semaine 7', /allégée/.test(hb.phases[3]) && /allégée/.test(hb.phases[7]) && hb.weeks[6].some((id) => id === 'hx-comp-peak'), hb.phases.join(' | '));
check('Hyrox sans date : pas de jour de course', !hb.sessions.some((x) => x.id === 'hx-race'));
const athleteHx = { ...k.DEFAULT_ATHLETE, sport: 'hyrox', days: 4, race: { distance: 'hyrox' } };
const pHx = k.programFor(athleteHx, k.DEFAULT_GYM, '2026-10-20', k.initial());
check('profil Hyrox sans date : bloc renouvelable', pHx.program.meta?.block === 1 && pHx.program.weeks?.length === 8 && pHx.notes.length > 0);
const pHx2 = k.programFor(athleteHx, k.DEFAULT_GYM, '2026-12-15', k.initial(), 3);
const vol = (p, i) => p.sessions.find((x) => x.id === p.weeks[i][1])?.exercises.find((e) => e.key === 'sled-push' || e.key === 'walking-lunge')?.sets ?? 0;
check('Hyrox, bloc 3 : un cran plus fort', pHx2.program.meta?.block === 3 && /3/.test(pHx2.program.name) && vol(pHx2.program, 5) >= vol(pHx.program, 5), `${vol(pHx2.program, 5)} vs ${vol(pHx.program, 5)}`);

// Sport de combat (0.32) : le cardio change chaque semaine, avec des semaines allégées.
const athleteFight = { ...k.DEFAULT_ATHLETE, sport: 'combat', days: 5, physique: 'athletic' };
const pf = k.programFor(athleteFight, k.DEFAULT_GYM, '2026-10-20', k.initial()).program;
const cardioOf = (i) => pf.weeks[i].map((id) => pf.sessions.find((x) => x.id === id)).filter((x) => x?.type === 'cardio');
const roundsOf = (i) => cardioOf(i).find((x) => x.name === 'Rounds de combat')?.exercises.find((e) => e.key === 'bag-rounds' || e.key === 'shadow-boxing');
check('combat : bloc de 8 semaines, deux cardios par semaine', pf.weeks?.length === 8 && cardioOf(0).length === 2 && pf.meta?.block === 1, cardioOf(0).map((x) => x.name).join(', '));
check('combat : les rounds changent chaque semaine', new Set([0, 1, 2, 4, 5, 6].map((i) => `${roundsOf(i)?.sets}/${roundsOf(i)?.rest}/${roundsOf(i)?.note}`)).size >= 5, [0, 1, 2, 4, 5, 6].map((i) => `${roundsOf(i)?.sets}×${roundsOf(i)?.rest}`).join(' '));
check('combat : endurance continue au début, intervalles ensuite', cardioOf(0).some((x) => x.name === 'Moteur aérobie') && cardioOf(5).some((x) => x.name === 'Intervalles'));
check('combat : semaines 4 et 8 allégées, muscu comprise', /allégée/.test(pf.phases[3]) && /allégée/.test(pf.phases[7]) && pf.weeks[3].some((id) => id.endsWith('-light')) && roundsOf(3).sets < roundsOf(2).sets);
check('combat : sans sac de frappe, shadow boxing', !pf.sessions.some((x) => x.exercises.some((e) => e.key === 'bag-rounds')) && pf.sessions.some((x) => x.exercises.some((e) => e.key === 'shadow-boxing')));
const fightGym = { ...k.DEFAULT_GYM, equipment: { ...k.DEFAULT_GYM.equipment, heavybag: true } };
check('combat : sac de frappe coché, rounds au sac', k.programFor(athleteFight, fightGym, '2026-10-20', k.initial()).program.sessions.some((x) => x.exercises.some((e) => e.key === 'bag-rounds')));
const s6 = { ...k.initial(), program: pf, settings: { ...k.initial().settings, athlete: athleteFight } };
check('combat : bloc fini, Pulse propose le suivant', k.programTweaks(s6, '2026-12-22').some((t) => t.action.kind === 'next-block' && t.action.block === 2));

const basic = k.gymDefaults('basic-fit');
const adapted = k.adaptToGym(hx, basic);
const after = new Set(adapted.program.sessions.flatMap((x) => x.exercises.map((e) => e.key)));
check('sans traîneau ni SkiErg : remplacés', !after.has('sled-push') && !after.has('ski-erg') && adapted.swaps.length > 0, adapted.swaps.map((x) => `${x.from}→${x.to}`).slice(0, 3).join(', '));
basic.equipment.sled = true;
check('traîneau coché : gardé', k.adaptToGym(hx, basic).program.sessions.some((x) => x.exercises.some((e) => e.key === 'sled-push')));
const home = k.gymDefaults('home');
const st = k.adaptToGym({ name: 'x', sessions: [{ id: 'a', name: 'A', focus: '', type: 'lifting', exercises: [{ key: 'bench' }, { key: 'leg-press' }, { key: 'seated-cable-row' }] }], schedule: Array(7).fill('a') }, home);
check('maison : barre et machines remplacées par des haltères', st.program.sessions[0].exercises.map((e) => e.key).join(',') === 'db-bench,goblet-squat,db-row', st.program.sessions[0].exercises.map((e) => e.key).join(','));

/* Meal plan */
const plan = k.generateMealPlan(cut.targets, { diet: k.DEFAULT_ATHLETE.diet });
const day = plan.prep.day;
check('meal plan proche des calories (±8 %)', Math.abs(day.kcal - cut.targets.kcal) / cut.targets.kcal < 0.08, `${day.kcal} kcal`);
check('meal plan : protéines au rendez-vous', day.protein >= cut.targets.protein * 0.95, `${day.protein} g`);
check('deux plats différents midi et soir', plan.meals.filter((m) => m.slot === 'lunch').length === 2 && plan.meals.filter((m) => m.slot === 'dinner').length === 2);
check('préparation dimanche et mercredi, liste de courses', plan.prep.batches.length === 2 && plan.prep.shopping.length >= 3);
const veg = { ...k.DEFAULT_ATHLETE.diet, vegetarian: true, lactoseFree: true, dislikes: 'pois chiches' };
const vplan = k.generateMealPlan(cut.targets, { diet: veg });
const vtext = JSON.stringify(vplan.meals).toLowerCase();
check('végétarien sans lactose : ni viande, ni poisson, ni skyr', !/poulet|bœuf|dinde|thon|saumon|cabillaud|sardine|skyr|whey|feta|emmental/.test(vtext), vplan.meals.map((m) => m.label).join(' / '));
check('aliments refusés exclus', !vtext.includes('pois chiches'));

/* Proposer un plat */
const rest = { kcal: 800, protein: 50, carbs: 80, fat: 25 };
for (const mode of ['out', 'shop', 'cook']) {
  const r = k.suggestMeals(rest, mode, k.DEFAULT_ATHLETE.diet);
  check(`proposer un plat (${mode}) : 3 idées autour de 800 kcal`, r.items.length === 3 && r.items.every((i) => i.macros.kcal > 550 && i.macros.kcal < 950), r.items.map((i) => `${i.title} ${i.macros.kcal}`).join(' | '));
}
const again = k.suggestMeals(rest, 'out', k.DEFAULT_ATHLETE.diet, 1);
check('« Autres idées » change les propositions', again.items[0].title !== k.suggestMeals(rest, 'out', k.DEFAULT_ATHLETE.diet, 0).items[0].title);
const vegOut = k.suggestMeals(rest, 'out', { ...k.DEFAULT_ATHLETE.diet, vegetarian: true });
check('dehors, végétarien : pas de viande', vegOut.items.every((i) => !/poulet|kebab|bœuf|saumon|burger|grillade/i.test(i.title)), vegOut.items.map((i) => i.title).join(' | '));
const snack = k.suggestMeals({ kcal: 250, protein: 20, carbs: 20, fat: 5 }, 'cook', k.DEFAULT_ATHLETE.diet);
check('peu de calories restantes : une collation', snack.items.every((i) => i.macros.kcal < 450), snack.items.map((i) => `${i.title} ${i.macros.kcal}`).join(' | '));

/* Bilan */
const today = '2026-10-20';
const s = k.initial();
s.createdAt = '2026-09-01';
s.settings.height = 179;
s.settings.age = 22;
s.settings.weightGoal = 'cut';
s.settings.goal = { workout: true, minMeals: 2 };
const lastMonday = k.addDays(k.mondayOf(today), -7);
for (let i = 0; i < 14; i++) {
  const d = k.addDays(lastMonday, i - 7);
  s.body.weight[d] = i < 7 ? 76 : 75.9; // presque stable : trop lent pour une sèche
}
for (let i = 0; i < 7; i++) {
  const d = k.addDays(lastMonday, i);
  const sess = k.sessionFor(s, d);
  s.days[d] = {
    sets: { bench: [{ w: 70, r: 6, done: true }] },
    mainDone: sess.type !== 'rest' && i !== 1,
    meals: [
      { id: `${d}a`, slot: 'lunch', label: 'x', source: 'manual', kcal: 1100, protein: 60, carbs: 100, fat: 30, at: 0 },
      { id: `${d}b`, slot: 'dinner', label: 'y', source: 'manual', kcal: 1100, protein: 60, carbs: 100, fat: 30, at: 0 },
    ],
    habits: {},
  };
}
const rep = k.weeklyReport(s, lastMonday, today);
check('bilan : séances comptées (une manquée)', rep.sessions.planned >= 4 && rep.sessions.done === rep.sessions.planned - 1, `${rep.sessions.done}/${rep.sessions.planned}`);
check('bilan : moyenne kcal et protéines', rep.nutrition.kcal === 2200 && rep.nutrition.protein === 120);
check('bilan : poids trop lent pour une sèche → −150 kcal', rep.advice.some((x) => x.action?.kind === 'kcal' && x.action.delta === -150), rep.advice.map((x) => x.id).join(','));
check('bilan : protéines trop basses signalées', rep.advice.some((x) => x.id === 'protein'));
const html = k.reportHtml(s, rep, 'https://shred.test');
check('mail HTML lisible, sans balise injectée', html.includes('BILAN DE LA SEMAINE') && html.includes('https://shred.test') && !html.includes('<script'));
check('version texte du bilan', k.reportText(s, rep).includes('Pour la semaine qui vient'));

/* Mail côté serveur */
const kv = new Map();
const KV = {
  get: async (key) => kv.get(key)?.value ?? null,
  getWithMetadata: async (key) => ({ value: kv.get(key)?.value ?? null, metadata: kv.get(key)?.metadata ?? null }),
  put: async (key, value, o = {}) => void kv.set(key, { value, metadata: o.metadata ?? null }),
  delete: async (key) => void kv.delete(key),
  list: async ({ prefix = '' } = {}) => ({ keys: [...kv.keys()].filter((x) => x.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
};
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.resend.com')) {
    sent.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: 'x' }), { status: 200 });
  }
  return realFetch(url, init);
};
const crypto = (await import('node:crypto')).webcrypto;
const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const env = { ADMIN_CODE: 'admin-code-123', MOCK_AI: '1', KV, ASSETS: { fetch: async () => new Response('app') } };
const call = async (path, token, body, e = env) => {
  const res = await worker.fetch(new Request(`https://shred.test${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }), e);
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
const reg = await call('/api/auth/register', null, { email: 'selim@exemple.com', name: 'Selim', invite: 'admin-code-123', key });
const token = reg.data.token;
let r = await call('/api/health', token);
check('serveur sans clé Resend : mail désactivé', r.data.email === false);
r = await call('/api/report/email', token, { week: lastMonday, subject: 's', html: html, text: 't' });
check('envoi refusé tant que ce n’est pas configuré', r.status === 503);
const envMail = { ...env, RESEND_API_KEY: 're_test', EMAIL_FROM: 'Shred <bilan@exemple.fr>' };
r = await call('/api/health', token, undefined, envMail);
check('avec la clé : mail activé', r.data.email === true);
r = await call('/api/report/email', token, { week: lastMonday, subject: 'Ton bilan', html, text: 't' }, envMail);
check('mail envoyé à l’adresse du compte', r.status === 200 && sent[0]?.body.to[0] === 'selim@exemple.com' && sent[0].body.from === 'Shred <bilan@exemple.fr>', JSON.stringify(sent[0]?.body.to));
await call('/api/report/email', token, { week: lastMonday, subject: 'Ton bilan', html, text: 't' }, envMail);
r = await call('/api/report/email', token, { week: lastMonday, subject: 'Ton bilan', html, text: 't' }, envMail);
check('pas de spam : 2 renvois par jour maximum', r.status === 429 && sent.length === 2);
globalThis.fetch = realFetch;

console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent.');
process.exit(failures ? 1 : 0);
