// Aliments de base, sans marque : ceux qu'on cuisine soi-même et que la recherche d'Open Food Facts noie sous
// les produits emballés. Valeurs moyennes pour 100 g, arrondies (ordre de grandeur des tables de composition
// Ciqual et USDA ; glucides hors fibres, comme sur les étiquettes européennes). Ils s'affichent tout de suite,
// même hors ligne, avant les produits du commerce.
import type { FoodHit } from '../../shared/food';
import { tr } from '../../shared/i18n';

/** Nom, kcal, protéines, glucides, lipides (pour 100 g), portion habituelle en grammes. */
type Row = [name: string, kcal: number, protein: number, carbs: number, fat: number, serving: number];

const ROWS: Row[] = [
  [tr('Riz blanc, cuit'), 130, 2.7, 28, 0.3, 150],
  [tr('Riz blanc, cru'), 360, 7, 79, 0.6, 60],
  [tr('Riz complet, cuit'), 123, 2.7, 24, 1, 150],
  [tr('Pâtes, cuites'), 155, 5.8, 30, 0.9, 200],
  [tr('Pâtes, crues'), 360, 12.5, 72, 1.5, 80],
  [tr('Quinoa, cuit'), 120, 4.4, 18.5, 1.9, 150],
  [tr('Semoule, cuite'), 112, 3.8, 22, 0.2, 150],
  [tr('Flocons d’avoine'), 375, 13.5, 58, 7, 50],
  [tr('Pain (baguette)'), 270, 9, 55, 1.5, 50],
  [tr('Pain complet'), 245, 9, 43, 2.5, 50],
  [tr('Croissant'), 406, 8.2, 43, 21, 60],
  [tr('Pomme de terre, cuite à l’eau'), 86, 1.7, 18, 0.1, 200],
  [tr('Patate douce, cuite'), 90, 2, 17, 0.2, 200],
  [tr('Frites'), 312, 3.4, 37, 15, 150],
  [tr('Lentilles, cuites'), 116, 9, 14, 0.4, 150],
  [tr('Pois chiches, cuits'), 160, 8.9, 20, 2.6, 150],
  [tr('Blanc de poulet, cuit'), 165, 31, 0, 3.6, 150],
  [tr('Blanc de poulet, cru'), 120, 22.5, 0, 2.6, 150],
  [tr('Escalope de dinde, crue'), 110, 23.5, 0, 1.5, 150],
  [tr('Steak de bœuf, cuit'), 190, 29, 0, 8, 150],
  [tr('Bœuf haché 5 %, cru'), 130, 21, 0, 5, 125],
  [tr('Bœuf haché 15 %, cru'), 215, 18.6, 0, 15, 125],
  [tr('Jambon blanc'), 115, 20.5, 1, 3.5, 40],
  [tr('Saumon, cuit'), 206, 22, 0, 12.4, 125],
  [tr('Cabillaud, cuit'), 105, 22.8, 0, 0.9, 150],
  [tr('Thon au naturel, égoutté'), 116, 26, 0, 0.8, 100],
  [tr('Crevettes, cuites'), 99, 24, 0.2, 0.3, 100],
  [tr('Œuf'), 143, 12.6, 0.7, 9.5, 50],
  [tr('Tofu nature'), 130, 13.5, 1.5, 8, 100],
  [tr('Lait demi-écrémé'), 46, 3.3, 4.8, 1.6, 250],
  [tr('Yaourt nature'), 62, 4, 4.5, 3.3, 125],
  [tr('Yaourt grec 5 %'), 95, 9, 3.5, 5, 150],
  [tr('Skyr nature'), 63, 11, 4, 0.2, 150],
  [tr('Fromage blanc 0 %'), 47, 7.4, 4.2, 0.1, 100],
  [tr('Cottage cheese'), 98, 11, 3.4, 4.3, 100],
  [tr('Emmental'), 375, 28.5, 0, 28.5, 30],
  [tr('Mozzarella'), 250, 18, 1, 19, 60],
  [tr('Beurre'), 740, 0.7, 0.6, 82, 10],
  [tr('Huile d’olive'), 900, 0, 0, 100, 10],
  [tr('Beurre de cacahuète'), 600, 25, 13, 50, 15],
  [tr('Amandes'), 580, 21, 9, 50, 30],
  [tr('Avocat'), 160, 2, 2, 14.7, 70],
  [tr('Banane'), 89, 1.1, 20, 0.3, 120],
  [tr('Pomme'), 52, 0.3, 11.4, 0.2, 150],
  [tr('Orange'), 47, 0.9, 9.4, 0.1, 150],
  [tr('Kiwi'), 61, 1.1, 11.7, 0.5, 75],
  [tr('Fraises'), 32, 0.7, 5.7, 0.3, 150],
  [tr('Myrtilles'), 57, 0.7, 12, 0.3, 100],
  [tr('Brocoli, cuit'), 35, 2.4, 4, 0.4, 150],
  [tr('Haricots verts, cuits'), 35, 1.9, 4.7, 0.3, 150],
  [tr('Carotte, crue'), 41, 0.9, 6.8, 0.2, 100],
  [tr('Tomate'), 18, 0.9, 2.7, 0.2, 120],
  [tr('Miel'), 320, 0.3, 80, 0, 10],
  [tr('Chocolat noir 70 %'), 590, 8, 35, 42, 20],
  [tr('Protéine whey (poudre)'), 380, 78, 7, 5, 30],
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

export const GENERIC_FOODS: FoodHit[] = ROWS.map(([name, kcal, protein, carbs, fat, serving]) => ({
  code: '',
  name,
  per100: { kcal, protein, carbs, fat },
  serving,
  generic: true,
}));

const INDEX = GENERIC_FOODS.map((h) => words(h.name));

/**
 * Chaque mot tapé doit commencer un mot du nom. Devant : le nom exact, puis ceux qui commencent par la recherche,
 * les plus courts d'abord (« pomme » donne la pomme avant la pomme de terre).
 */
export function searchGeneric(query: string, max = 6): FoodHit[] {
  const q = words(query);
  if (!q.length || q.join('').length < 2) return [];
  const found: { h: FoodHit; exact: boolean; first: boolean; n: number; i: number }[] = [];
  GENERIC_FOODS.forEach((h, i) => {
    const w = INDEX[i];
    if (!q.every((x) => w.some((y) => y.startsWith(x)))) return;
    found.push({ h, exact: w.join(' ') === q.join(' '), first: w[0].startsWith(q[0]), n: w.length, i });
  });
  return found
    .sort((a, b) => Number(b.exact) - Number(a.exact) || Number(b.first) - Number(a.first) || a.n - b.n || a.i - b.i)
    .slice(0, max)
    .map((f) => f.h);
}
