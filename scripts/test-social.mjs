// Côté app : import des sorties (Strava, montre), validation des séances, stats, résumé publié au club, mentions.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'shred-social-'));
await build({
  stdin: {
    contents: `
      export { importActivities } from './src/lib/activities';
      export { sessionSummary, shareableDays, mentionQuery, matchMembers, splitMentions, keptMentions } from './src/lib/club';
      export { dayTraining } from './src/lib/training';
      export { sessionFor, workoutOk } from './src/lib/logic';
      export { mergeStates } from './src/lib/merge';
      export { getState, setState, initial } from './src/lib/store';
      export { programFor, applyProgram } from './src/lib/coaching';
      export { DEFAULT_ATHLETE, DEFAULT_GYM } from './shared/athlete';
      export { scheduleFor, findSession } from './shared/program';
      export { addDays, dayKey, weekdayOf } from './src/lib/date';
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: join(dir, 's.mjs'),
  logLevel: 'error',
  define: { 'import.meta.env': '{"MODE":"test"}' },
});
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.navigator ??= { userAgent: 'node' };
const k = await import(pathToFileURL(join(dir, 's.mjs')).href);

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

const today = k.dayKey();
// Un coureur, 5 jours : on cherche dans la semaine un jour de course et un jour de renfo.
const athlete = { ...k.DEFAULT_ATHLETE, sport: 'running', days: 5 };
k.applyProgram(k.programFor(athlete, k.DEFAULT_GYM, today, k.getState()).program);
k.setState((d) => void (d.createdAt = k.addDays(today, -30)));
const week = Array.from({ length: 7 }, (_, i) => k.addDays(today, -i));
const runDay = week.find((d) => k.sessionFor(k.getState(), d).exercises.some((x) => x.discipline === 'run' && x.key === 'run-long'));
const liftDay = week.find((d) => k.sessionFor(k.getState(), d).type === 'lifting');
check('jours de test trouvés', Boolean(runDay && liftDay), `${runDay} / ${liftDay}`);

/* ---------- Import et validation ---------- */

const run = { id: 'strava:1', source: 'strava', sport: 'run', name: 'Sortie longue', start: `${runDay}T09:12:00`, min: 72.5, km: 12.3, hr: 145 };
let r = k.importActivities([run]);
let day = k.getState().days[runDay];
check('sortie importée au bon jour', r.added === 1 && day.activities.length === 1);
check('même sport que la séance : séance validée', day.mainDone && day.activities[0].linked.includes('run-long') && r.validated[0].date === runDay);
check('flamme assurée côté sport', k.workoutOk(k.getState(), runDay));
r = k.importActivities([run]);
check('pas de doublon au second import', r.added === 0 && k.getState().days[runDay].activities.length === 1);
r = k.importActivities([{ ...run, id: 'health:abc', source: 'health', start: `${runDay}T09:15:00` }]);
check('la même sortie vue par la montre n’est pas comptée deux fois', r.added === 0);

// Une deuxième sortie de course le même jour ne reprend pas le bloc déjà représenté.
r = k.importActivities([{ id: 'strava:9', source: 'strava', sport: 'run', name: 'Footing du soir', start: `${runDay}T19:30:00`, min: 25, km: 4.5 }]);
check('deuxième sortie du jour : comptée à part, sans doublon de bloc', r.added === 1 && !k.getState().days[runDay].activities[1].linked);
k.setState((d) => void d.days[runDay].activities.pop());
const t = k.dayTraining(k.getState(), runDay);
check('stats : les vrais chiffres de la sortie, pas l’estimation du plan', Math.abs(t.km.run - 12.3) < 0.01 && Math.abs(t.min.run - 72.5) < 0.01, `${t.km.run} km, ${t.min.run} min`);

r = k.importActivities([{ id: 'health:w1', source: 'health', sport: 'lift', name: 'Musculation, Apple Watch', start: `${liftDay}T18:00:00`, min: 52 }]);
check('muscu de la montre : pas de séries cochées à sa place', r.validated.length === 0 && !k.getState().days[liftDay].mainDone);
check('mais elle compte comme un passage à la salle pour la flamme', k.workoutOk(k.getState(), liftDay));

const extra = k.addDays(today, -40);
r = k.importActivities([{ id: 'strava:2', source: 'strava', sport: 'bike', name: 'Vélo', start: `${extra}T10:00:00`, min: 95, km: 41 }]);
check('sortie un jour sans séance prévue : rangée, comptée dans les stats', r.added === 1 && Math.abs(k.dayTraining(k.getState(), extra).km.bike - 41) < 0.01);

/* ---------- Résumé publié au club ---------- */

const sumRun = k.sessionSummary(k.getState(), runDay);
check('résumé d’une séance validée par Strava', sumRun?.title === 'Sortie longue' && sumRun.kind === 'cardio' && sumRun.sports.includes('run'));
check('règle Strava : la distance de Strava n’est pas publiée', !sumRun.stats.some((x) => x.label === 'Distance'));
check('profil d’intensité joint', Array.isArray(sumRun.profile) && sumRun.profile.length > 0);

const liftSession = k.sessionFor(k.getState(), liftDay);
const ex = liftSession.exercises.find((x) => !x.noLoad && x.kind !== 'cardio');
k.setState((d) => {
  d.days[k.addDays(liftDay, -7)] = { sets: { [ex.key]: [{ done: true, w: 60, r: 8 }] }, mainDone: true, meals: [], habits: {} };
  d.days[liftDay].sets[ex.key] = [{ done: true, w: 70, r: 8 }, { done: true, w: 70, r: 7 }];
});
const sumLift = k.sessionSummary(k.getState(), liftDay);
check('résumé muscu : séries, volume en tonnes, exercices', sumLift.kind === 'lifting' && sumLift.stats.find((x) => x.label === 'Séries').value === '2' && sumLift.stats.find((x) => x.label === 'Volume').value === '1,1 t', JSON.stringify(sumLift.stats));
check('muscu de la montre et séries notées : pas de temps compté deux fois', sumLift.stats.find((x) => x.label === 'Durée').value === '52 min', JSON.stringify(sumLift.stats));
check('record du jour mis en avant', sumLift.records?.length === 1 && sumLift.records[0].includes('70'), sumLift.records?.join());
check('journées à partager, la plus récente d’abord', k.shareableDays(k.getState(), today, 7).length >= 2);
check('jour sans rien : rien à publier', k.sessionSummary(k.getState(), k.addDays(today, -100)) === null);

/* ---------- Mentions ---------- */

const members = [
  { id: 'me', name: 'Selim', me: true },
  { id: 'a', name: 'Inès', me: false },
  { id: 'b', name: 'Ines-Marie', me: false },
  { id: 'c', name: 'Yanis', me: false },
];
const q = k.mentionQuery('Bravo @in', 9);
check('mot @ en cours de frappe', q?.query === 'in' && q.start === 6);
check('pas de mention au milieu d’un email', k.mentionQuery('selim@exemple', 13) === null);
check('recherche sans accents, sans soi-même', k.matchMembers(members, 'ine').map((m) => m.id).join() === 'a,b' && k.matchMembers(members, 'sel').length === 0);
const parts = k.splitMentions('Merci @Inès et @Yanis !', [{ id: 'a', name: 'Inès' }, { id: 'c', name: 'Yanis' }]);
check('texte découpé autour des mentions', parts.filter((p) => p.mention).length === 2 && parts.map((p) => p.text).join('') === 'Merci @Inès et @Yanis !');
check('mention effacée du texte : pas envoyée', k.keptMentions('Merci @Yanis', [{ id: 'a', name: 'Inès' }, { id: 'c', name: 'Yanis' }]).map((m) => m.id).join() === 'c');

/* ---------- Fusion entre appareils ---------- */

const a = structuredClone(k.getState());
const b = structuredClone(k.getState());
b.days[runDay].activities.push({ id: 'strava:3', source: 'strava', sport: 'run', name: 'Footing', start: `${runDay}T19:00:00`, min: 30, km: 5 });
const merged = k.mergeStates(a, b, true);
check('sorties fusionnées entre deux appareils', merged.days[runDay].activities.length === 2);

console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
