// Fusion des sauvegardes (rien ne se perd entre deux appareils), récupération (décharge, forme du jour),
// minuteur de repos côté serveur, et version du Worker alignée sur package.json.
import { build } from 'esbuild';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'shred-sync-'));
await build({
  stdin: {
    contents: `
      export { mergeStates, mergeDay } from './src/lib/merge';
      export { initial, replaceState, getState } from './src/lib/store';
      export * from './src/lib/recovery';
      export { startDeload, stopDeload } from './src/lib/workoutActions';
      export { sessionFor } from './src/lib/logic';
      export { adviseLoad } from './src/lib/advisor';
      export { programTweaks } from './src/lib/tweaks';
      export { addDays, mondayOf } from './src/lib/date';
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', outfile: join(dir, 's.mjs'), logLevel: 'error',
  define: { 'import.meta.env': '{"MODE":"test"}' },
});
await build({ entryPoints: ['worker/timers.ts'], bundle: true, format: 'esm', platform: 'neutral', outfile: join(dir, 't.mjs'), logLevel: 'error' });
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const k = await import(pathToFileURL(join(dir, 's.mjs')).href);
const t = await import(pathToFileURL(join(dir, 't.mjs')).href);

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};
const meal = (id, slot) => ({ id, slot, label: id, kcal: 500, protein: 30, carbs: 50, fat: 15, source: 'manual', at: Number(id.replace(/\D/g, '')) || 1 });
const set = (w, r, done = true) => ({ w, r, done });

/* ---------- Fusion ---------- */
const phone = k.initial();
const cloud = k.initial();
phone.days['2026-11-10'] = { sets: { bench: [set(80, 8), set(80, 8)] }, mainDone: true, meals: [meal('m1', 'lunch')], habits: { creatine: true } };
cloud.days['2026-11-10'] = { sets: { bench: [set(80, 8)], squat: [set(100, 5)] }, mainDone: false, meals: [meal('m2', 'dinner')], habits: { steps: true } };
cloud.days['2026-11-11'] = { sets: { rdl: [set(90, 8)] }, mainDone: true, meals: [], habits: {} };
phone.body.weight['2026-11-10'] = 74.2;
cloud.body.weight['2026-11-11'] = 73.9;
phone.body.photos = [{ id: 'p1', date: '2026-11-09', pose: 'front' }];
cloud.body.photos = [{ id: 'p2', date: '2026-11-16', pose: 'front' }];
phone.settings.name = 'Selim (téléphone)';
cloud.settings.name = 'Selim (portable)';
phone.health['2026-11-10'] = { steps: 6000, at: '2026-11-10T10:00:00Z' };
cloud.health['2026-11-10'] = { steps: 9000, sleepMin: 420, at: '2026-11-10T20:00:00Z' };

const m = k.mergeStates(phone, cloud, true);
const d10 = m.days['2026-11-10'];
check('fusion : les deux jours sont gardés', Boolean(m.days['2026-11-11']));
check('fusion : séries des deux appareils', d10.sets.bench.length === 2 && d10.sets.squat?.length === 1);
check('fusion : repas des deux appareils', d10.meals.map((x) => x.id).sort().join() === 'm1,m2');
check('fusion : habitudes des deux appareils', d10.habits.creatine && d10.habits.steps);
check('fusion : séance faite si faite d’un côté', d10.mainDone);
check('fusion : pesées des deux appareils', m.body.weight['2026-11-10'] === 74.2 && m.body.weight['2026-11-11'] === 73.9);
check('fusion : photos des deux appareils', m.body.photos.length === 2);
check('fusion : réglages de l’appareil le plus récent', m.settings.name === 'Selim (téléphone)');
check('fusion : santé, la valeur la plus récente', m.health['2026-11-10'].steps === 9000 && m.health['2026-11-10'].sleepMin === 420);
check('fusion : rien de perdu dans l’autre sens', k.mergeStates(cloud, phone, false).days['2026-11-10'].meals.length === 2);

/* ---------- Forme du jour ---------- */
const s = k.initial();
const today = '2026-11-16';
for (let i = 1; i <= 14; i++) s.health[k.addDays(today, -i)] = { sleepMin: 450, hrv: 65, restingHr: 58 };
s.health[today] = { sleepMin: 320, hrv: 48, restingHr: 59 };
const low = k.formHint(s, today);
check('forme : nuit courte et VFC basse → Fatigué', low?.form === 'low' && low.reasons.length === 2, low?.reasons.join(' | '));
s.health[today] = { sleepMin: 480, hrv: 70, restingHr: 57 };
check('forme : bonne nuit et VFC haute → En forme', k.formHint(s, today)?.form === 'high');
s.health[today] = { steps: 3000 };
check('forme : rien sans sommeil ni cœur', k.formHint(s, today) === null);

/* ---------- Décharge ---------- */
const st = k.initial();
const start = k.addDays(today, -7 * 8);
for (let w = 0; w < 8; w++) st.days[k.addDays(start, w * 7)] = { sets: { bench: [set(80 + w, 8)] }, mainDone: true, meals: [], habits: {} };
check('décharge : 8 semaines comptées', k.weeksInBlock(st, today) === 8);
check('décharge : proposée après 8 semaines', k.programTweaks(st, today).some((x) => x.action.kind === 'deload'));
k.replaceState(st);
k.startDeload(today);
const s2 = k.getState();
check('décharge : semaine active', k.isDeload(s2, today) && k.isDeload(s2, k.addDays(k.mondayOf(today), 6)) && !k.isDeload(s2, k.addDays(k.mondayOf(today), 7)));
const train = s2.program.sessions.find((x) => x.type === 'lifting');
s2.days[today] = { sets: {}, mainDone: false, meals: [], habits: {}, session: train.id };
const normal = { ...s2, deload: undefined };
const setsOf = (x) => x.exercises.reduce((n, e) => n + e.sets, 0);
check('décharge : un tiers de séries en moins environ', setsOf(k.sessionFor(s2, today)) < setsOf(k.sessionFor(normal, today)) * 0.75, `${setsOf(k.sessionFor(normal, today))} → ${setsOf(k.sessionFor(s2, today))}`);
const ex = k.sessionFor(s2, today).exercises[0];
s2.days[k.addDays(today, -3)] = { sets: { [ex.key]: [set(100, 8), set(100, 8), set(100, 8)] }, mainDone: true, meals: [], habits: {} };
const adv = k.adviseLoad(s2, ex, today);
check('décharge : charge conseillée −10 %', adv && adv.weight <= 90, adv?.text);
const closed = structuredClone(s2);
k.closeDeload(closed, k.addDays(k.mondayOf(today), 8));
check('décharge : finie, elle redémarre le bloc', !closed.deload.week && closed.deload.lastEnd === k.addDays(k.mondayOf(today), 6));
check('décharge : pas reproposée juste après', !k.programTweaks(closed, k.addDays(k.mondayOf(today), 8)).some((x) => x.action.kind === 'deload'));

/* ---------- Minuteur de repos (Durable Object) ---------- */
{
  const storage = new Map();
  let alarm = null;
  const state = {
    storage: {
      put: async (key, v) => storage.set(key, v),
      get: async (key) => storage.get(key),
      delete: async (key) => storage.delete(key),
      setAlarm: async (at) => (alarm = at),
      deleteAlarm: async () => (alarm = null),
    },
  };
  const kv = new Map();
  const env = { KV: { get: async (key) => kv.get(key) ?? null, put: async (key, v) => kv.set(key, v), delete: async (key) => kv.delete(key) } };
  const timer = new t.RestTimer(state, env);
  const at = Date.now() + 90_000;
  await timer.fetch(new Request('https://timer/start', { method: 'POST', body: JSON.stringify({ userId: 'u1', at, title: 'Repos terminé', body: 'x' }) }));
  check('minuteur : alarme programmée à la fin du repos', alarm === at && storage.has('job'));
  await timer.fetch(new Request('https://timer/cancel', { method: 'POST' }));
  check('minuteur : annulé', alarm === null && !storage.has('job'));
  await timer.fetch(new Request('https://timer/start', { method: 'POST', body: JSON.stringify({ userId: 'u1', at, title: 'Repos terminé', body: 'x' }) }));
  await timer.alarm();
  check('minuteur : sans abonnement push, l’alarme se termine sans erreur', !storage.has('job'));
}

/* ---------- Version ---------- */
const pkg = JSON.parse(readFileSync('package.json', 'utf8')).version;
const worker = readFileSync('worker/version.ts', 'utf8').match(/const VERSION = '([^']+)'/)?.[1];
check('version du Worker = package.json', worker === pkg, `${worker} / ${pkg}`);

console.log(failures ? `\n${failures} échec(s).` : '\nTous les tests passent.');
process.exit(failures ? 1 : 0);
