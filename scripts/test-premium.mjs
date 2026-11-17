// Fonctions de la v0.23 : forme du jour, récupération musculaire, mode séance (séries, chrono, record à portée,
// valeurs notées = valeurs affichées) et récap du mois.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

globalThis.localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
const dir = mkdtempSync(join(tmpdir(), 'shred-premium-'));
await build({
  entryPoints: {
    rd: 'src/lib/readiness.ts',
    focus: 'src/lib/focus.ts',
    recap: 'src/lib/monthRecap.ts',
    actions: 'src/lib/actions.ts',
    store: 'src/lib/store.ts',
    cat: 'shared/catalog.ts',
    prog: 'shared/program.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outdir: dir,
  logLevel: 'error',
  // Un seul exemplaire de l'état pour actions et store : les modules sont partagés entre les entrées.
  splitting: true,
  define: { __BUILD__: '"0.23.0+test"', 'import.meta.env': '{"MODE":"test","DEV":false,"PROD":true}' },
});
const load = (n) => import(pathToFileURL(join(dir, `${n}.js`)).href);
const [rd, focus, recap, actions, store, cat, prog] = await Promise.all(['rd', 'focus', 'recap', 'actions', 'store', 'cat', 'prog'].map(load));

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;

const addDays = (k, n) => {
  const [y, m, d] = k.split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};
const base = () => {
  const s = store.initial();
  s.settings.onboarded = true;
  s.createdAt = '2026-08-01';
  return s;
};
const lift = (sets, extra = {}) => ({ sets, meals: [], habits: {}, mainDone: true, ...extra });
const bench = (w, reps) => reps.map((r) => ({ w, r, done: true }));

/* ---------- Forme du jour ---------- */

const today = '2026-11-20';
{
  check('forme : rien à lire, pas de score', rd.readiness(base(), today) === null);

  const s = base();
  for (let i = 1; i <= 14; i++) s.health[addDays(today, -i)] = { hrv: 60 + (i % 3) - 1, restingHr: 55, sleepMin: 450 };
  // Un rythme régulier : 12 séries tous les deux jours sur 4 semaines.
  for (let i = 1; i <= 28; i++) if (i % 2 === 0) s.days[addDays(today, -i)] = lift({ bench: bench(80, Array(12).fill(8)) });
  s.health[today] = { hrv: 66, restingHr: 53, sleepMin: 480 };
  const good = rd.readiness(s, today);
  check('forme : bonne nuit, VFC haute → prêt à pousser', good?.tone === 'go' && good.score >= 75, `${good?.score} ${good?.title}`);
  check('forme : quatre signaux, score complet', good?.parts.length === 4 && good.partial === false);

  s.health[today] = { hrv: 45, restingHr: 61, sleepMin: 300 };
  const bad = rd.readiness(s, today);
  check('forme : VFC −25 %, 5 h de sommeil, cœur +6 → récupère', bad?.tone === 'low' && bad.score < 55, `${bad?.score}`);
  check('forme : le conseil nomme le signal le plus bas', /VFC|Sommeil|Cœur/.test(bad?.advice ?? ''), bad?.advice);

  delete s.health[today];
  const only = rd.readiness(s, today);
  check('forme : sans Apple Santé, score sur la charge seule', only?.partial === true && only.parts.length === 1 && only.parts[0].id === 'load');

  // Charge qui explose : 3 jours d'affilée à 30 séries.
  for (let i = 1; i <= 3; i++) s.days[addDays(today, -i)] = lift({ bench: bench(80, Array(30).fill(8)) });
  const spike = rd.readiness(s, today);
  check(
    'forme : charge des 3 derniers jours bien au-dessus du rythme → score de charge bas',
    spike?.parts[0].score < 55,
    `${spike?.parts[0].score} ${spike?.parts[0].detail}`,
  );

  // Nouveau venu : 8 jours d'historique, même rythme qu'avant. La moyenne se fait sur ses 8 jours, pas sur 28.
  const n = base();
  for (let i = 1; i <= 8; i++) n.days[addDays(today, -i)] = lift({ bench: bench(80, Array(10).fill(8)) });
  const fresh = rd.readiness(n, today);
  check('forme : nouveau venu, charge jugée sur ses propres jours', fresh?.parts[0].score >= 75, `${fresh?.parts[0].score} ${fresh?.parts[0].detail}`);
  check('forme : texte de charge correct', /dans ton rythme/.test(fresh?.parts[0].detail ?? ''), fresh?.parts[0].detail);
}

/* ---------- Récupération musculaire ---------- */

{
  const pecs = rd.regionsOf(['Pecs', 'Épaules', 'Triceps']);
  const w = Object.fromEntries(pecs.map((x) => [x.region, x.weight]));
  check('muscles : principal en entier, secondaires à moitié', w.chest === 1 && w.delts === 0.5 && w.triceps === 0.5, JSON.stringify(w));
  check('muscles : arrière d’épaules ≠ épaules', rd.regionsOf(['Arrière d’épaules'])[0]?.region === 'reardelts');
  check('muscles : jambes = quadriceps et fessiers', rd.regionsOf(['Jambes']).length === 2);
  check(
    'muscles : dos (largeur) → grand dorsal, cou → cou',
    rd.regionsOf(['Dos (largeur)'])[0]?.region === 'lats' && rd.regionsOf(['Cou (avant)'])[0]?.region === 'neck',
  );

  // Tout exercice de muscu du catalogue tombe sur au moins une zone de la silhouette.
  const missing = Object.values(cat.CATALOG)
    .filter((e) => e.kind !== 'cardio' && e.kind !== 'task')
    .filter((e) => !rd.regionsOf(e.muscles).length)
    .map((e) => e.key);
  check('muscles : chaque exercice du catalogue a sa zone', missing.length === 0, missing.join(', '));

  const s = base();
  const at = new Date('2026-11-20T10:00:00').getTime();
  s.days['2026-11-20'] = lift({ bench: bench(80, Array(8).fill(8)), 'run-easy': [{ km: 8, min: 45, done: true }] }, { mainDoneAt: at });
  const now = at + 2 * 3_600_000;
  const m = Object.fromEntries(rd.muscleRecovery(s, '2026-11-20', now).map((x) => [x.region, x]));
  const benchMuscles = cat.catalogEntry('bench', {}).muscles;
  const primary = rd.regionsOf(benchMuscles)[0].region;
  check(
    'récup : 8 séries il y a 2 h → muscle principal presque à plat',
    m[primary].fatigue > 0.9 && m[primary].hours === 2,
    `${primary} ${m[primary].fatigue.toFixed(2)}`,
  );
  check('récup : la course ne fatigue pas les quadriceps ici', m.quads.hours === null && m.quads.fatigue === 0);
  const later = Object.fromEntries(rd.muscleRecovery(s, '2026-11-23', at + 74 * 3_600_000).map((x) => [x.region, x]));
  check(
    'récup : trois jours plus tard, presque frais (demi-vie 24 h)',
    near(later[primary].fatigue, Math.pow(0.5, 74 / 24), 0.01) && later[primary].recovery >= 85,
    `${later[primary].recovery} %`,
  );
  const old = rd.muscleRecovery(s, '2026-11-28', at + 8 * 24 * 3_600_000).find((x) => x.region === primary);
  check('récup : au-delà de 7 jours, plus rien', old.hours === null && old.fatigue === 0);
}

/* ---------- Mode séance ---------- */

{
  const ex = (o) => ({ key: 'x', name: 'X', sets: 3, reps: '8-10', repMin: 8, repMax: 10, rest: 90, kind: 'compound', step: 2.5, noLoad: false, ...o });
  check('chrono : « 45 s »', focus.workSeconds(ex({ reps: '45 s' })) === 45);
  check('chrono : « 3 min » et « 1:30 »', focus.workSeconds(ex({ reps: '3 min' })) === 180 && focus.workSeconds(ex({ reps: '1:30' })) === 90);
  check('chrono : pas pour des reps ni une tâche', focus.workSeconds(ex({})) === null && focus.workSeconds(ex({ kind: 'task', reps: '30 s' })) === null);
  check('chrono : bloc continu → pas de chrono d’effort', focus.workSeconds(ex({ kind: 'cardio', sets: 1, discipline: 'run', reps: '45 min' })) === null);
  const plank = focus.workSpan(ex({ reps: '30–60 s', repMin: undefined, repMax: undefined, noLoad: true }));
  check('gainage : fourchette « 30–60 s » → chrono qui monte', plank?.min === 30 && plank.max === 60 && focus.workSeconds(ex({ reps: '30–60 s' })) === null);
  check('gainage : « 2–3 min » en secondes', JSON.stringify(focus.workSpan(ex({ reps: '2–3 min' }))) === '{"min":120,"max":180}');
  check(
    'durée : « 45 min », « 1 h 30 », pas « 10 hard »',
    focus.minutesOf('45 min') === 45 && focus.minutesOf('1 h 30') === 90 && focus.minutesOf('10 hard') === undefined,
  );

  const run = ex({ key: 'run', kind: 'cardio', sets: 1, discipline: 'run', reps: '45 min' });
  const steps = focus.stepsOf([ex({ key: 'a' }), run, ex({ key: 'b', sets: 2 })]);
  check('séries : 3 + 1 bloc + 2', steps.length === 6 && steps[3].id === 'run:0' && steps[5].id === 'b:1');
  const day = {
    sets: { a: [{ done: true }, { done: true }, { done: true }], run: [{ done: false }], b: [{ done: true }, { done: false }] },
    meals: [],
    habits: {},
    mainDone: false,
  };
  check('séries : la suivante à faire, après celle-ci', focus.nextUndone(steps, day, 0)?.id === 'run:0');
  check('séries : on repart du début s’il le faut', focus.nextUndone(steps, day, 5)?.id === 'run:0');
  day.sets.run[0].done = true;
  day.sets.b[1].done = true;
  check('séries : tout est fait → rien', focus.nextUndone(steps, day, 2) === null);

  const s = base();
  s.days['2026-11-10'] = lift({ bench: bench(100, [5]) });
  check('record : sans historique, rien à viser', focus.recordReps(base(), 'bench', '2026-11-20', 100) === null);
  // 1RM estimé 100 × 5 = 116,7 : à 100 kg il faut 6 reps (120).
  check('record : 6 reps à 100 kg battent 100 × 5', focus.recordReps(s, 'bench', '2026-11-20', 100) === 6);
  check('record : hors de portée à 60 kg', focus.recordReps(s, 'bench', '2026-11-20', 60) === null);
}

/* ---------- Valeurs notées = valeurs affichées ---------- */

{
  const s = base();
  const session = prog.resolveSession(prog.findSession(s.program, s.program.sessions.find((x) => x.type === 'lifting').id));
  const exo = session.exercises.find((e) => !e.noLoad && e.kind !== 'cardio' && e.kind !== 'task');
  const date = '2026-11-20';
  s.days['2026-11-17'] = lift({ [exo.key]: Array.from({ length: exo.sets }, () => ({ w: 40, r: exo.repMin ?? 8, done: true })) });
  s.days['2026-11-13'] = lift({ [exo.key]: Array.from({ length: exo.sets }, () => ({ w: 37.5, r: exo.repMin ?? 8, done: true })) });
  s.days[date] = { sets: {}, meals: [], habits: {}, mainDone: false, session: session.id };
  store.replaceState(s);
  const def = actions.setDefaults(store.getState(), exo, date, [], 0);
  actions.toggleSet(date, exo, 0);
  const got = store.getState().days[date].sets[exo.key][0];
  check('validation : la charge notée est celle qui était affichée', got.done && got.w === def.w, `affiché ${def.w}, noté ${got.w}`);
  check('validation : les reps notées sont celles qui étaient affichées', got.r === def.r, `affiché ${def.r}, noté ${got.r}`);
}

/* ---------- Récap du mois ---------- */

{
  const s = base();
  s.settings.weightGoal = 'cut';
  // Septembre : l'historique d'avant.
  s.days['2026-09-15'] = lift({ bench: bench(80, [8, 8, 8]), squat: [{ w: 100, r: 5, done: true }] });
  // Octobre : 5 séances, dont 3 le mardi, avec deux records de développé couché.
  const oct = [
    ['2026-10-06', bench(82.5, [8, 8, 7])], // mardi, record
    ['2026-10-13', bench(85, [8, 7, 7])], // mardi, record
    ['2026-10-15', bench(80, [8, 8, 8])],
    ['2026-10-20', bench(80, [8, 8])], // mardi
    ['2026-10-29', bench(70, [10])],
  ];
  for (const [d, sets] of oct)
    s.days[d] = lift(
      { bench: sets },
      {
        mainDoneAt: new Date(`${d}T19:30:00`).getTime(),
        meals: [{ id: d, slot: 'lunch', label: 'x', kcal: 1, protein: 1, carbs: 1, fat: 1, source: 'manual', at: 1 }],
      },
    );
  s.body.weight = { '2026-10-01': 80, '2026-10-29': 78 };
  s.ui.trophies = { s1: '2026-10-06', s10: '2026-11-02' };

  const r = recap.monthRecap(s, '2026-10', '2026-11-03');
  const tonnage = oct.reduce((n, [, sets]) => n + sets.reduce((m, l) => m + l.w * l.r, 0), 0);
  check('récap : séances du mois', r.sessions === 5 && !r.partial);
  check('récap : tonnage', r.tonnage === Math.round(tonnage), `${r.tonnage} / ${tonnage}`);
  check('récap : séries de muscu', r.sets === 12, String(r.sets));
  check(
    'récap : deux records, une ligne pour le développé couché',
    r.recordCount === 2 && r.records.length === 1 && r.records[0].w === 85,
    JSON.stringify(r.records),
  );
  check(
    'récap : gain mesuré sur le meilleur d’avant le mois',
    near(r.records[0].gain, ((85 * (1 + 8 / 30)) / (80 * (1 + 8 / 30)) - 1) * 100, 0.1),
    r.records[0].gain.toFixed(2),
  );
  check('récap : exercice phare', r.top?.key === 'bench' && r.top.sets === 12);
  check('récap : jour préféré le mardi', r.weekday?.day === 2 && r.weekday.count === 3, JSON.stringify(r.weekday));
  check('récap : surtout le soir', r.moment === 'le soir');
  check('récap : poids du mois', r.weight?.from === 80 && r.weight.to === 78 && r.weight.days === 28);
  check(
    'récap : sèche à −0,5 kg/sem, pile dans le rythme',
    recap.weightVerdict(r.weight, 'cut') === 'Pile dans le rythme de ta sèche',
    recap.weightVerdict(r.weight, 'cut'),
  );
  check('récap : prise de masse, pas de faux compliment', recap.weightVerdict(r.weight, 'bulk') === null);
  check('récap : trophées gagnés ce mois-ci seulement', r.trophies.length === 1 && r.trophies[0].id === 's1');
  check('récap : comparaison avec septembre', r.prev?.name === 'septembre' && r.prev.sessions === 1);

  s.days['2026-11-02'] = lift({ bench: bench(80, [8]) });
  s.days['2026-10-02'] = lift({ bench: bench(60, [8]) });
  const cur = recap.monthRecap(s, '2026-11', '2026-11-03');
  check('récap en cours : comparé au mois d’avant à la même date', cur.partial && cur.prev?.sessions === 1, JSON.stringify(cur.prev));

  check('bandeau : la première semaine, le mois d’avant', recap.recapReady(s, '2026-11-03') === '2026-10');
  check('bandeau : plus après le 7', recap.recapReady(s, '2026-11-09') === null);
  s.ui.recapSeen = '2026-10';
  check('bandeau : plus une fois vu', recap.recapReady(s, '2026-11-03') === null);
  check('bandeau : pas pour un mois presque vide', recap.recapReady({ ...base(), days: { '2026-10-02': lift({}) } }, '2026-11-03') === null);
  check(
    'mois : « d’octobre », « de novembre », « d’août »',
    recap.ofMonth('2026-10') === 'd’octobre' && recap.ofMonth('2026-11') === 'de novembre' && recap.ofMonth('2026-08') === 'd’août',
  );
  check('mois : janvier → décembre de l’année d’avant', recap.prevMonth('2027-01') === '2026-12');
  check('tonnage : moins d’une tonne, pas de comparaison', recap.tonnageLike(900) === null);
  check('tonnage : 42 t → 7 éléphants', recap.tonnageLike(42_000) === 'Le poids de 7 éléphants d’Afrique.', recap.tonnageLike(42_000));
  check('tonnage : 1,2 t → une voiture', recap.tonnageLike(1_200) === 'Le poids d’une voiture citadine.', recap.tonnageLike(1_200));
}

console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
