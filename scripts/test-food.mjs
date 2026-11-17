// Recherche d'aliments : lecture des produits d'Open Food Facts (ancienne recherche et Search-a-licious), images,
// recherche relayée par le serveur (moteur de secours, User-Agent), aliments de base de l'app.
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'shred-food-'));
const entry = join(dir, 'entry.ts');
writeFileSync(
  entry,
  `export * from '${process.cwd()}/shared/food.ts';\nexport { searchProducts } from '${process.cwd()}/worker/food.ts';\nexport { searchGeneric, fold } from '${process.cwd()}/src/lib/genericFoods.ts';\n`,
);
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', outfile: join(dir, 'f.mjs'), logLevel: 'error', loader: { '.json': 'json' } });
const f = await import(pathToFileURL(join(dir, 'f.mjs')).href);

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

// Ancienne recherche (cgi/search.pl)
const nutella = {
  code: '3017620422003',
  product_name_fr: 'Nutella',
  product_name: 'Nutella hazelnut spread',
  brands: 'Ferrero,Nutella',
  nutriments: { 'energy-kcal_100g': 539, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9 },
  serving_quantity: '15',
  image_front_small_url: 'https://images.openfoodfacts.org/images/products/301/762/042/2003/front_fr.248.200.jpg',
};
let h = f.toFoodHit(nutella, 'fr');
check('produit lu : nom dans la langue, marque principale, macros, portion', h?.name === 'Nutella' && h.brand === 'Ferrero' && h.per100.kcal === 539 && h.per100.fat === 30.9 && h.serving === 15, JSON.stringify(h));
check('nom anglais pour une app en anglais (champ principal)', f.toFoodHit(nutella, 'en')?.name === 'Nutella hazelnut spread');
check('image d’Open Food Facts gardée', h?.image?.startsWith('https://images.openfoodfacts.org/'));

// Search-a-licious : nom par langue, marques en liste, image reconstruite depuis la photo de face choisie
const sal = { code: '3033490506629', product_name: { main: 'Skyr', fr: 'Skyr nature' }, brands: ['Siggi’s', 'Autre'], images: { front_fr: { rev: 12 } }, nutriments: { 'energy-kcal_100g': '63', proteins_100g: 11 } };
h = f.toFoodHit(sal, 'fr');
check('Search-a-licious : nom par langue, marque en liste', h?.name === 'Skyr nature' && h.brand === 'Siggi’s' && h.per100.kcal === 63, JSON.stringify(h));
check('image reconstruite depuis la photo de face', h?.image === 'https://images.openfoodfacts.org/images/products/303/349/050/6629/front_fr.12.200.jpg', h?.image);
check('une autre vignette si pas de face', f.toFoodHit({ ...nutella, image_front_small_url: undefined, image_small_url: 'https://images.openfoodfacts.org/x/small.jpg' }, 'fr')?.image === 'https://images.openfoodfacts.org/x/small.jpg');
check('image d’un autre site refusée', f.toFoodHit({ ...nutella, image_front_small_url: 'https://evil.example.com/a.jpg' }, 'fr')?.image === undefined);
check('calories en kJ seulement : converties', f.toFoodHit({ product_name: 'Riz', nutriments: { energy_100g: 1000 } }, 'fr')?.per100.kcal === 239);
check('sans calories ou sans nom : écarté', f.toFoodHit({ product_name: 'Eau', nutriments: {} }, 'fr') === null && f.toFoodHit({ nutriments: { 'energy-kcal_100g': 100 } }, 'fr') === null);
check('balises retirées du nom', f.toFoodHit({ product_name: '<b>Pain</b> complet', nutriments: { 'energy-kcal_100g': 240 } }, 'fr')?.name === 'bPain/b complet');
check('doublons (même nom, même marque) retirés', f.toFoodHits([nutella, { ...nutella, code: '1' }, sal], 'fr').length === 2);
check('dossier d’images : 8 chiffres sans découpe, 13 en quatre', f.productFolder('96385074') === '96385074' && f.productFolder('3017620422003') === '301/762/042/2003' && f.productFolder('abc') === null);
check('résultat du serveur revérifié', f.cleanHit({ code: '12a', name: 'X', image: 'https://evil.example.com/a.jpg', per100: { kcal: 5000, protein: 3 } })?.per100.kcal === 950 && f.cleanHit({ name: 'X', image: 'https://evil.example.com/a.jpg', per100: { kcal: 10 } }).image === undefined);

// Recherche relayée : Search-a-licious d'abord, l'ancienne recherche en secours, User-Agent de l'app
const calls = [];
const fetcher = (plan) => async (url, init) => {
  calls.push({ url: String(url), ua: init?.headers?.['user-agent'] });
  const step = plan.shift();
  if (step === 'down') throw new TypeError('Load failed');
  if (typeof step === 'number') return new Response('', { status: step });
  return new Response(JSON.stringify(step), { status: 200, headers: { 'content-type': 'application/json' } });
};
let hits = await f.searchProducts(fetcher([{ hits: [sal] }]), 'Shred/test', 'skyr', 'fr');
check('Search-a-licious répond : une seule requête', hits.length === 1 && calls.length === 1 && calls[0].url.startsWith('https://search.openfoodfacts.org/search?') && calls[0].ua === 'Shred/test', calls[0]?.url);
calls.length = 0;
hits = await f.searchProducts(fetcher([503, { products: [nutella] }]), 'Shred/test', 'nutella', 'fr');
check('Search-a-licious en panne : ancienne recherche, en français', hits[0]?.name === 'Nutella' && calls.length === 2 && /cgi\/search\.pl\?.*lc=fr/.test(calls[1].url), calls[1]?.url);
calls.length = 0;
hits = await f.searchProducts(fetcher([{ hits: [] }, { products: [] }]), 'Shred/test', 'zzzz', 'fr');
check('rien nulle part : liste vide', hits.length === 0 && calls.length === 2);
let err = null;
try {
  await f.searchProducts(fetcher(['down', 429]), 'Shred/test', 'pain', 'fr');
} catch (e) {
  err = e;
}
check('les deux moteurs muets : erreur 502 (jamais « rien trouvé »)', err?.status === 502, String(err?.message));

// Aliments de base
const names = (q) => f.searchGeneric(q).map((x) => x.name);
check('« pomme » : la pomme avant la pomme de terre', names('pomme')[0] === 'Pomme' && names('pomme').includes('Pomme de terre, cuite à l’eau'), names('pomme').join(' | '));
check('« oeuf » trouve l’œuf, « boeuf » le bœuf', names('oeuf')[0] === 'Œuf' && names('boeuf').length >= 2);
check('plusieurs mots : « poulet cuit »', names('poulet cuit')[0] === 'Blanc de poulet, cuit', names('poulet cuit').join(' | '));
check('« riz » : trois riz', names('riz').filter((n) => n.startsWith('Riz')).length === 3);
check('une lettre : rien', names('p').length === 0);
check('aliment de base : marqué comme tel, avec une portion', f.searchGeneric('banane')[0]?.generic === true && f.searchGeneric('banane')[0]?.serving === 120);

console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent.');
process.exit(failures ? 1 : 0);
