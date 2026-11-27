// Corps estimé : masse grasse (tour de taille, profil, IMC), évolution d'après le poids et les charges, forme du
// corps 3D (poids des sommets, déformation) et portions des aliments (ml, pièces, mesures).
import { build } from 'esbuild';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'shred-body-'));
await build({
  stdin: {
    contents: `
      export * from './src/lib/bodyComp';
      export { initial } from './src/lib/store';
      export { parseMesh } from './src/lib/body3d/viewer';
      export { morph, morphWeights } from './src/lib/body3d/morph';
      export { NEUTRAL, CHANNELS } from './src/lib/body3d/shape';
      export { amountOf, defaultPortion, measuresOf, unitOf } from './src/lib/portions';
      export { searchGeneric } from './src/lib/genericFoods';
      export { offUnit, toFoodHit, cleanHit } from './shared/food';
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: join(dir, 'b.mjs'),
  logLevel: 'error',
  define: { 'import.meta.env': '{"MODE":"test"}' },
});
const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const k = await import(pathToFileURL(join(dir, 'b.mjs')).href);

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* Formules */
check('RFM homme : 178 cm, 84 cm de tour de taille → ~21,6 %', near(k.rfm(178, 84, 'male'), 21.62, 0.05), k.rfm(178, 84, 'male').toFixed(2));
check('RFM femme : +12 points à mesures égales', near(k.rfm(165, 75, 'female') - k.rfm(165, 75, 'male'), 12, 1e-9));
check('Deurenberg : IMC 24, 30 ans, homme → ~19,5 %', near(k.deurenberg(24, 30, 'male'), 19.5, 0.01), k.deurenberg(24, 30, 'male').toFixed(2));

const day = (sets = {}) => ({ sets, meals: [], habits: {} });
const base = () => {
  const s = structuredClone(k.initial());
  s.days = {};
  s.body = { weight: {}, waist: {} };
  s.settings.height = 178;
  s.settings.age = 30;
  return s;
};

/* Sans pesée : rien */
check('sans pesée : pas d’estimation', k.estimateBody(base(), '2026-11-27') === null);

/* Avec tour de taille */
let s = base();
s.body.weight['2026-11-26'] = 80;
s.body.waist['2026-11-20'] = 86;
let e = k.estimateBody(s, '2026-11-27');
check('tour de taille + taille : méthode RFM', e?.method === 'waist' && near(e.fat, k.rfm(178, 86, 'male'), 0.01), `${e?.method} ${e?.fat.toFixed(1)}`);
check('masse maigre + masse grasse = poids', near(e.leanKg + e.fatKg, 80, 1e-9));
check(
  'tour de taille trop vieux (plus de 6 semaines) : ignoré',
  k.estimateBody(s, '2027-01-15') === null || k.estimateBody(s, '2027-01-15')?.method !== 'waist',
);

/* Sans taille : supposée, et pas de RFM */
s = base();
delete s.settings.height;
s.body.weight['2026-11-26'] = 80;
s.body.waist['2026-11-20'] = 86;
e = k.estimateBody(s, '2026-11-27');
check('sans taille : IMC sur une taille supposée, signalé', e.method === 'bmi' && !e.heightKnown, `${e.method} ${e.height}`);

/* Masse grasse du profil */
s = base();
s.body.weight['2026-11-26'] = 80;
s.settings.athlete.bodyFat = 15;
e = k.estimateBody(s, '2026-11-27');
check('masse grasse du profil reprise', e.method === 'declared' && e.fat === 15);

/* Les charges corrigent l'IMC */
s = base();
s.body.weight['2026-11-26'] = 90;
const weak = k.estimateBody(s, '2026-11-27');
for (const d of ['2026-11-10', '2026-11-17', '2026-11-24'])
  s.days[d] = day({
    bench: [{ w: 115, r: 5, done: true }],
    squat: [{ w: 150, r: 5, done: true }],
    deadlift: [{ w: 190, r: 5, done: true }],
    'barbell-row': [{ w: 100, r: 8, done: true }],
    'db-shoulder-press': [{ w: 34, r: 8, done: true }],
    'barbell-curl': [{ w: 50, r: 8, done: true }],
  });
const strong = k.estimateBody(s, '2026-11-27');
check('à IMC égal, un pratiquant fort a moins de gras', strong.fat < weak.fat - 2, `${strong.fat.toFixed(1)} < ${weak.fat.toFixed(1)}`);
check(
  'muscles : niveau élevé quand les charges sont fortes',
  k.CHANNELS.every((c) => strong.muscle[c] > 0.45) && strong.rated === 6,
  JSON.stringify(strong.muscle),
);

/* Évolution : une sèche de 6 kg, charges tenues */
s = base();
for (let i = 0; i <= 84; i++) {
  const d = new Date(Date.UTC(2026, 8, 4 + i)).toISOString().slice(0, 10);
  s.body.weight[d] = Math.round((86 - (i * 6) / 84) * 10) / 10;
}
s.body.waist['2026-11-25'] = 84;
const tl = k.bodyTimeline(s, '2026-11-27');
check('comparaison il y a 12 semaines', tl?.then && tl.weeks === 12, `${tl?.weeks}`);
const dFat = tl.now.fatKg - tl.then.fatKg;
const dLean = tl.now.leanKg - tl.then.leanKg;
check('sèche : surtout du gras perdu (80 %)', dFat < -4 && dLean < 0 && dLean > -1.6, `gras ${dFat.toFixed(1)}, maigre ${dLean.toFixed(1)}`);
check('même méthode à l’époque : on remonte depuis aujourd’hui', tl.then.method === tl.now.method && tl.then.fat > tl.now.fat);

/* Forme */
const lean = k.shapeOf({ ...tl.now, fat: 9, muscle: Object.fromEntries(k.CHANNELS.map((c) => [c, 0.9])) });
const soft = k.shapeOf({ ...tl.now, fat: 30, muscle: Object.fromEntries(k.CHANNELS.map((c) => [c, 0.2])) });
check('forme : sec et musclé → muscles en plus, gras en moins', lean.muscle.every((m) => m > 0) && lean.fat < 0);
check('forme : plus de gras → plus d’épaisseur, muscles plus fins', soft.fat > 0.02 && soft.muscle.every((m) => m < 0));
check('séparations nettes sec, effacées avec du gras', k.definitionOf({ ...tl.now, fat: 9 }) > k.definitionOf({ ...tl.now, fat: 28 }));
check('femme : silhouette féminine', k.shapeOf({ ...tl.now, sex: 'female' }).female === 1 && k.shapeOf(tl.now).female === 0);

/* Maillage déformé */
const buf = readFileSync('src/assets/body3d.bin');
const mesh = k.parseMesh(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const t0 = Date.now();
const wt = k.morphWeights(mesh);
const ms = Date.now() - t0;
const n = wt.ao.length;
check('poids des sommets calculés vite', ms < 1500, `${ms} ms pour ${n} sommets`);
let okW = true;
for (let i = 0; i < n * 8; i++) if (!(wt.muscle[i] >= 0 && wt.muscle[i] <= 1.0001)) okW = false;
let sumOk = true;
for (let i = 0; i < n; i++) {
  let sum = 0;
  for (let c = 0; c < 8; c++) sum += wt.muscle[i * 8 + c];
  if (sum > 1.0001) sumOk = false;
}
check('poids des muscles entre 0 et 1, partagés aux jonctions', okW && sumOk);
const flat = k.morph(wt, k.NEUTRAL, mesh.indices);
let maxDiff = 0;
for (let i = 0; i < n * 3; i++) maxDiff = Math.max(maxDiff, Math.abs(flat.positions[i] - wt.rest[i]));
check('forme neutre : le corps de départ', maxDiff < 1e-6, maxDiff.toExponential(1));
const belly = (pos) => {
  let z = -1;
  for (let i = 0; i < n; i++) if (Math.abs(wt.rest[i * 3]) < 0.05 && Math.abs(wt.rest[i * 3 + 1] - 1.0) < 0.04) z = Math.max(z, pos[i * 3 + 2]);
  return z;
};
const fat = k.morph(wt, { ...k.NEUTRAL, fat: 0.04 }, mesh.indices);
check(
  'plus de gras : le ventre avance',
  belly(fat.positions) > belly(flat.positions) + 0.03,
  `${(belly(flat.positions) * 100).toFixed(1)} → ${(belly(fat.positions) * 100).toFixed(1)} cm`,
);
let finite = true;
for (const v of fat.positions) if (!Number.isFinite(v)) finite = false;
for (const v of fat.normals) if (!Number.isFinite(v)) finite = false;
check('positions et normales valides', finite);
const width = (pos, lo, hi) => {
  let x = 0;
  for (let i = 0; i < n; i++) if (wt.rest[i * 3 + 1] > lo && wt.rest[i * 3 + 1] < hi && Math.abs(wt.rest[i * 3 + 2]) < 0.05) x = Math.max(x, pos[i * 3]);
  return x;
};
const big = k.morph(wt, { ...k.NEUTRAL, muscle: k.CHANNELS.map(() => 0.02) }, mesh.indices);
check('muscles plus développés : épaules plus larges', width(big.positions, 1.3, 1.5) > width(flat.positions, 1.3, 1.5) + 0.005);

/* Portions */
const cafe = k.searchGeneric('café au lait')[0];
check('café au lait : un aliment de base, en ml', cafe?.name === 'Café au lait' && k.unitOf(cafe) === 'ml', JSON.stringify(cafe));
check(
  'café au lait : une tasse d’abord, puis mug et bol',
  k
    .measuresOf(cafe)
    .map((m) => m.name)
    .join(',') === 'Tasse,Mug,Bol',
);
check('2 bols de café au lait = 700 ml', k.amountOf(cafe, { measure: 2, qty: 2 }) === 700);
const coca = k.searchGeneric('coca').map((h) => h.name);
check('« coca » trouve le soda au cola d’abord', coca[0] === 'Soda au cola', coca.join(','));
check('« lait » : les laits d’abord, le café au lait ensuite', k.searchGeneric('lait')[0]?.name.startsWith('Lait'));
const egg = k.searchGeneric('oeuf')[0];
check('œuf à la pièce', egg?.name === 'Œuf' && k.measuresOf(egg)[0].amount === 50 && k.amountOf(egg, { measure: 0, qty: 3 }) === 150);
const rice = k.searchGeneric('riz blanc cuit')[0];
check('riz : portion habituelle en grammes', k.unitOf(rice) === 'g' && k.measuresOf(rice)[0].amount === 150);
check('en grammes : la quantité telle quelle', k.amountOf(rice, { measure: -1, qty: 80 }) === 80);

/* Produits d'Open Food Facts : boissons en ml */
check('unité de portion en ml', k.offUnit({ serving_quantity_unit: 'ml' }) === 'ml');
check(
  '« 33 cl » sur l’emballage',
  k.offUnit({ quantity: '33 cl' }) === 'ml' && k.offUnit({ quantity: '1 L' }) === 'ml' && k.offUnit({ quantity: '6 x 25 cl' }) === 'ml',
);
check('« 500 g » : en grammes', k.offUnit({ quantity: '500 g' }) === undefined && k.offUnit({ product_quantity_unit: 'g', quantity: '1 l' }) === undefined);
const coke = k.toFoodHit(
  {
    code: '5449000000996',
    product_name: 'Coca-Cola',
    nutriments: { 'energy-kcal_100g': 42 },
    quantity: '33 cl',
    product_quantity: '330',
    serving_quantity: '330',
  },
  'fr',
);
check('canette : ml, produit entier gardé', coke.unit === 'ml' && coke.pack === 330, JSON.stringify(coke));
check(
  'canette : une seule mesure pour 330 ml, plus verre et mug',
  k
    .measuresOf(coke)
    .map((m) => `${m.name} ${m.amount}`)
    .join(',') === 'Portion 330,Verre 200,Mug 250',
  k
    .measuresOf(coke)
    .map((m) => `${m.name} ${m.amount}`)
    .join(','),
);
const pasta = k.toFoodHit({ product_name: 'Pâtes', nutriments: { 'energy-kcal_100g': 360 }, quantity: '1 kg', product_quantity: '1000' }, 'fr');
check('paquet de 1 kg : pas de « tout le produit »', pasta.pack === undefined && k.measuresOf(pasta).length === 0 && k.defaultPortion(pasta).qty === 100);
check(
  'résultat du serveur : unité et contenance revérifiées',
  k.cleanHit({ name: 'Jus', per100: { kcal: 45 }, unit: 'ml', pack: 99999 })?.unit === 'ml' &&
    k.cleanHit({ name: 'X', per100: { kcal: 45 }, unit: 'litre' }).unit === undefined,
);

console.log(failures ? `\n${failures} échec(s).` : '\nCorps estimé et portions : tout est bon.');
process.exit(failures ? 1 : 0);
