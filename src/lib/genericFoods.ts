// Aliments de base, sans marque : ceux qu'on cuisine soi-même et que la recherche d'Open Food Facts noie sous
// les produits emballés. Valeurs moyennes pour 100 g (pour 100 ml pour les boissons), arrondies (ordre de grandeur
// des tables de composition Ciqual et USDA ; glucides hors fibres, comme sur les étiquettes européennes). Ils
// s'affichent tout de suite, même hors ligne, avant les produits du commerce.
// Chacun vient avec les mesures de tous les jours : une tasse de café au lait, un œuf, une tranche de pain, une
// cuillère d'huile. On ne demande des grammes que pour ce qui se pèse vraiment (riz, viande, légumes).
import type { FoodHit, Measure } from '../../shared/food';
import { tr } from '../../shared/i18n';

interface Extra {
  /** Boisson : valeurs pour 100 ml, quantités en ml. */
  ml?: true;
  /** Mesures [nom, quantité en g ou en ml], la première proposée d'abord. Sans mesure : la portion habituelle. */
  m?: [name: string, amount: number][];
  /** Autres mots qui doivent le trouver (marques devenues des noms communs, mots d'autres langues). */
  also?: string;
}

/** Nom, kcal, protéines, glucides, lipides (pour 100 g ou 100 ml), portion habituelle, mesures. */
type Row = [name: string, kcal: number, protein: number, carbs: number, fat: number, serving: number, extra?: Extra];

// Les mesures qui reviennent.
const PIECE = tr('Pièce');
const SLICE = tr('Tranche');
const POT = tr('Pot');
const TSP = tr('Cuillère à café');
const TBSP = tr('Cuillère à soupe');
const CUP = tr('Tasse');
const MUG = tr('Mug');
const BOWL = tr('Bol');
const GLASS = tr('Verre');
const CAN = tr('Canette');
const BOTTLE = tr('Bouteille');

const ROWS: Row[] = [
  // Féculents
  [tr('Riz blanc, cuit'), 130, 2.7, 28, 0.3, 150],
  [tr('Riz blanc, cru'), 360, 7, 79, 0.6, 60],
  [tr('Riz complet, cuit'), 123, 2.7, 24, 1, 150],
  [tr('Pâtes, cuites'), 155, 5.8, 30, 0.9, 200],
  [tr('Pâtes, crues'), 360, 12.5, 72, 1.5, 80],
  [tr('Quinoa, cuit'), 120, 4.4, 18.5, 1.9, 150],
  [tr('Semoule, cuite'), 112, 3.8, 22, 0.2, 150],
  [tr('Flocons d’avoine'), 375, 13.5, 58, 7, 50, { m: [[tr('Portion'), 50], [TBSP, 10]] }],
  [tr('Céréales type corn flakes'), 375, 7, 84, 1, 40, { m: [[BOWL, 40]], also: 'cornflakes' }],
  [tr('Muesli'), 370, 10, 60, 7.5, 50, { m: [[BOWL, 50]], also: 'granola' }],
  [tr('Pain (baguette)'), 270, 9, 55, 1.5, 50, { m: [[tr('Quart de baguette'), 60], [SLICE, 25]] }],
  [tr('Pain complet'), 245, 9, 43, 2.5, 35, { m: [[SLICE, 35]] }],
  [tr('Pain de mie'), 265, 8.5, 47, 4, 25, { m: [[SLICE, 25]] }],
  [tr('Tortilla de blé'), 300, 8.5, 49, 7, 60, { m: [[tr('Galette'), 60]], also: 'wrap' }],
  [tr('Galette de riz'), 385, 8, 81, 2.8, 8, { m: [[PIECE, 8]] }],
  [tr('Croissant'), 406, 8.2, 43, 21, 60, { m: [[PIECE, 60]] }],
  [tr('Pain au chocolat'), 420, 7.5, 46, 22, 65, { m: [[PIECE, 65]], also: 'chocolatine' }],
  [tr('Pomme de terre, cuite à l’eau'), 86, 1.7, 18, 0.1, 200],
  [tr('Patate douce, cuite'), 90, 2, 17, 0.2, 200],
  [tr('Frites'), 312, 3.4, 37, 15, 150],
  [tr('Lentilles, cuites'), 116, 9, 14, 0.4, 150],
  [tr('Pois chiches, cuits'), 160, 8.9, 20, 2.6, 150],

  // Viandes, poissons, œufs
  [tr('Blanc de poulet, cuit'), 165, 31, 0, 3.6, 150],
  [tr('Blanc de poulet, cru'), 120, 22.5, 0, 2.6, 150],
  [tr('Escalope de dinde, crue'), 110, 23.5, 0, 1.5, 150],
  [tr('Steak de bœuf, cuit'), 190, 29, 0, 8, 150],
  [tr('Bœuf haché 5 %, cru'), 130, 21, 0, 5, 100, { m: [[tr('Steak haché'), 100]] }],
  [tr('Bœuf haché 15 %, cru'), 215, 18.6, 0, 15, 100, { m: [[tr('Steak haché'), 100]] }],
  [tr('Jambon blanc'), 115, 20.5, 1, 3.5, 40, { m: [[SLICE, 40]] }],
  [tr('Saumon, cuit'), 206, 22, 0, 12.4, 125],
  [tr('Cabillaud, cuit'), 105, 22.8, 0, 0.9, 150],
  [tr('Thon au naturel, égoutté'), 116, 26, 0, 0.8, 100],
  [tr('Crevettes, cuites'), 99, 24, 0.2, 0.3, 100],
  [tr('Œuf'), 143, 12.6, 0.7, 9.5, 50, { m: [[PIECE, 50]] }],
  [tr('Tofu nature'), 130, 13.5, 1.5, 8, 100],

  // Produits laitiers
  [tr('Yaourt nature'), 62, 4, 4.5, 3.3, 125, { m: [[POT, 125]] }],
  [tr('Yaourt grec 5 %'), 95, 9, 3.5, 5, 150, { m: [[POT, 150]] }],
  [tr('Skyr nature'), 63, 11, 4, 0.2, 150, { m: [[POT, 150]] }],
  [tr('Fromage blanc 0 %'), 47, 7.4, 4.2, 0.1, 100, { m: [[POT, 100]] }],
  [tr('Cottage cheese'), 98, 11, 3.4, 4.3, 200, { m: [[POT, 200]] }],
  [tr('Emmental'), 375, 28.5, 0, 28.5, 30, { m: [[tr('Portion'), 30]], also: 'gruyere rape' }],
  [tr('Mozzarella'), 250, 18, 1, 19, 125, { m: [[tr('Boule'), 125]] }],
  [tr('Beurre'), 740, 0.7, 0.6, 82, 10, { m: [[tr('Noisette'), 5], [TBSP, 15]] }],

  // Boissons (pour 100 ml)
  [tr('Café au lait'), 23, 1.7, 2.4, 0.8, 250, { ml: true, m: [[CUP, 150], [MUG, 250], [BOWL, 350]], also: 'creme' }],
  [tr('Café noir'), 2, 0.1, 0, 0, 150, { ml: true, m: [[tr('Expresso'), 40], [CUP, 150], [MUG, 250]], also: 'expresso espresso allonge americano' }],
  [tr('Cappuccino'), 35, 2.4, 3.4, 1.2, 180, { ml: true, m: [[CUP, 180], [MUG, 250]] }],
  [tr('Café latte'), 42, 2.9, 4.3, 1.5, 250, { ml: true, m: [[MUG, 250], [BOWL, 350]], also: 'latte' }],
  [tr('Chocolat chaud'), 75, 3.4, 10.5, 1.8, 250, { ml: true, m: [[MUG, 250], [BOWL, 350]], also: 'cacao' }],
  [tr('Thé ou infusion'), 1, 0, 0.2, 0, 250, { ml: true, m: [[CUP, 150], [MUG, 250]], also: 'tisane the' }],
  [tr('Lait demi-écrémé'), 46, 3.3, 4.8, 1.6, 200, { ml: true, m: [[GLASS, 200], [BOWL, 250]] }],
  [tr('Lait entier'), 65, 3.2, 4.7, 3.6, 200, { ml: true, m: [[GLASS, 200], [BOWL, 250]] }],
  [tr('Lait écrémé'), 34, 3.4, 4.9, 0.1, 200, { ml: true, m: [[GLASS, 200], [BOWL, 250]] }],
  [tr('Boisson à l’avoine'), 45, 1, 6.5, 1.5, 200, { ml: true, m: [[GLASS, 200], [BOWL, 250]], also: 'lait avoine oat' }],
  [tr('Boisson au soja'), 39, 3.3, 2.5, 1.8, 200, { ml: true, m: [[GLASS, 200], [BOWL, 250]], also: 'lait soja' }],
  [tr('Jus d’orange'), 44, 0.7, 9.5, 0.1, 200, { ml: true, m: [[GLASS, 200], [BOTTLE, 330]] }],
  [tr('Soda au cola'), 42, 0, 10.6, 0, 330, { ml: true, m: [[CAN, 330], [GLASS, 200], [BOTTLE, 500]], also: 'coca coke pepsi' }],
  [tr('Soda zéro'), 0.3, 0, 0, 0, 330, { ml: true, m: [[CAN, 330], [BOTTLE, 500]], also: 'coca coke light pepsi max cola' }],
  [tr('Bière blonde'), 43, 0.4, 3.5, 0, 250, { ml: true, m: [[tr('Demi'), 250], [BOTTLE, 330], [tr('Pinte'), 500]], also: 'biere' }],
  [tr('Vin rouge'), 85, 0.1, 2.6, 0, 125, { ml: true, m: [[GLASS, 125]] }],

  // Matières grasses, fruits à coque, sucré
  [tr('Huile d’olive'), 900, 0, 0, 100, 10, { m: [[TSP, 4.5], [TBSP, 13]] }],
  [tr('Beurre de cacahuète'), 600, 25, 13, 50, 15, { m: [[TSP, 6], [TBSP, 16]] }],
  [tr('Amandes'), 580, 21, 9, 50, 30, { m: [[tr('Poignée'), 30]] }],
  [tr('Miel'), 320, 0.3, 80, 0, 10, { m: [[TSP, 7], [TBSP, 20]] }],
  [tr('Sucre'), 400, 0, 100, 0, 5, { m: [[tr('Morceau'), 5], [TSP, 5], [TBSP, 12]] }],
  [tr('Confiture'), 245, 0.4, 60, 0.1, 20, { m: [[TSP, 8], [TBSP, 20]] }],
  [tr('Chocolat noir 70 %'), 590, 8, 35, 42, 20, { m: [[tr('Carré'), 5]] }],
  [tr('Protéine whey (poudre)'), 380, 78, 7, 5, 30, { m: [[tr('Dose'), 30]] }],
  [tr('Barre protéinée'), 370, 33, 35, 13, 55, { m: [[tr('Barre'), 55]] }],

  // Fruits et légumes
  [tr('Avocat'), 160, 2, 2, 14.7, 70, { m: [[tr('Demi-avocat'), 70], [PIECE, 140]] }],
  [tr('Banane'), 89, 1.1, 20, 0.3, 120, { m: [[PIECE, 120]] }],
  [tr('Pomme'), 52, 0.3, 11.4, 0.2, 150, { m: [[PIECE, 150]] }],
  [tr('Orange'), 47, 0.9, 9.4, 0.1, 140, { m: [[PIECE, 140]] }],
  [tr('Kiwi'), 61, 1.1, 11.7, 0.5, 75, { m: [[PIECE, 75]] }],
  [tr('Fraises'), 32, 0.7, 5.7, 0.3, 150],
  [tr('Myrtilles'), 57, 0.7, 12, 0.3, 100],
  [tr('Compote sans sucre ajouté'), 55, 0.3, 12, 0.1, 90, { m: [[tr('Gourde'), 90], [POT, 100]] }],
  [tr('Brocoli, cuit'), 35, 2.4, 4, 0.4, 150],
  [tr('Haricots verts, cuits'), 35, 1.9, 4.7, 0.3, 150],
  [tr('Carotte, crue'), 41, 0.9, 6.8, 0.2, 80, { m: [[PIECE, 80]] }],
  [tr('Tomate'), 18, 0.9, 2.7, 0.2, 120, { m: [[PIECE, 120]] }],

  // Plats sur le pouce
  [tr('Pizza margherita'), 250, 10.5, 30, 9, 100, { m: [[tr('Part'), 100], [tr('Pizza entière'), 400]] }],
  [tr('Sandwich jambon-beurre'), 275, 11, 38.5, 8.7, 180, { m: [[PIECE, 180]] }],
];

/** Sans accents ni majuscules, ligatures dépliées : « Œuf » se trouve en tapant « oeuf ». */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

const words = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export const GENERIC_FOODS: FoodHit[] = ROWS.map(([name, kcal, protein, carbs, fat, serving, x]) => ({
  code: '',
  name,
  per100: { kcal, protein, carbs, fat },
  serving,
  ...(x?.ml ? { unit: 'ml' as const } : {}),
  ...(x?.m ? { measures: x.m.map(([n, amount]): Measure => ({ name: n, amount })) } : {}),
  generic: true,
}));

const INDEX = ROWS.map((r) => words(`${r[0]} ${r[6]?.also ?? ''}`));
/** Les mots du nom seul (sans les autres mots) : un nom exact passe devant. */
const NAMES = ROWS.map((r) => words(r[0]));

/**
 * Chaque mot tapé doit commencer un mot du nom (ou d'un autre mot qui le désigne). Devant : le nom exact, puis
 * ceux qui commencent par la recherche, les plus courts d'abord (« pomme » donne la pomme avant la pomme de terre).
 */
export function searchGeneric(query: string, max = 6): FoodHit[] {
  const q = words(query);
  if (!q.length || q.join('').length < 2) return [];
  const found: { h: FoodHit; exact: boolean; first: boolean; n: number; i: number }[] = [];
  GENERIC_FOODS.forEach((h, i) => {
    const w = INDEX[i];
    if (!q.every((x) => w.some((y) => y.startsWith(x)))) return;
    const name = NAMES[i];
    // Trouvé par un autre mot (« coca ») : dans l'ordre de la liste, après ceux trouvés par leur nom.
    const byName = q.every((x) => name.some((y) => y.startsWith(x)));
    found.push({ h, exact: name.join(' ') === q.join(' '), first: name[0].startsWith(q[0]), n: byName ? name.length : 99, i });
  });
  return found
    .sort((a, b) => Number(b.exact) - Number(a.exact) || Number(b.first) - Number(a.first) || a.n - b.n || a.i - b.i)
    .slice(0, max)
    .map((f) => f.h);
}
