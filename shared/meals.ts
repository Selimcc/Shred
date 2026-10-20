// Recettes, meal plans, meal prep et propositions de plats, calculés sans IA à partir d'une petite base
// d'aliments. Valeurs nutritionnelles moyennes pour 100 g (ou 100 ml), arrondies : des ordres de grandeur
// fiables pour suivre une sèche ou une prise, pas une étiquette au gramme près.
import type { Athlete, DietPrefs } from './athlete';
import type { Macros, MealSlot, PlannedMeal } from './types';

type Flag = 'meat' | 'fish' | 'pork' | 'dairy' | 'egg';
type Section = 'Viandes et poissons' | 'Frais' | 'Épicerie' | 'Fruits et légumes' | 'Surgelés';

interface Food extends Macros {
  name: string;
  flags?: Flag[];
  section: Section;
  /** 1 bon marché, 2 moyen, 3 cher. */
  cost: 1 | 2 | 3;
  /** Poids d'une pièce, pour écrire « 3 œufs » plutôt que « 165 g ». */
  unit?: { g: number; name: string; plural: string };
}

const f = (name: string, kcal: number, protein: number, carbs: number, fat: number, section: Section, cost: 1 | 2 | 3, extra: Partial<Food> = {}): Food => ({
  name,
  kcal,
  protein,
  carbs,
  fat,
  section,
  cost,
  ...extra,
});

export const FOODS = {
  oats: f('flocons d’avoine', 370, 13, 60, 7, 'Épicerie', 1),
  milk: f('lait demi-écrémé', 46, 3.3, 4.8, 1.6, 'Frais', 1, { flags: ['dairy'] }),
  soyMilk: f('boisson soja', 40, 3.5, 1.5, 2, 'Épicerie', 1),
  whey: f('whey', 380, 78, 6, 6, 'Épicerie', 2, { flags: ['dairy'] }),
  banana: f('banane', 90, 1.1, 20, 0.3, 'Fruits et légumes', 1, { unit: { g: 120, name: 'banane', plural: 'bananes' } }),
  skyr: f('skyr', 60, 10, 4, 0.2, 'Frais', 1, { flags: ['dairy'] }),
  cottage: f('fromage blanc 0 %', 46, 8, 4, 0.2, 'Frais', 1, { flags: ['dairy'] }),
  berries: f('fruits rouges surgelés', 45, 1, 8, 0.3, 'Surgelés', 2),
  pb: f('beurre de cacahuète', 600, 25, 12, 50, 'Épicerie', 2),
  egg: f('œufs', 140, 12.5, 0.7, 10, 'Frais', 1, { flags: ['egg'], unit: { g: 55, name: 'œuf', plural: 'œufs' } }),
  eggWhite: f('blancs d’œufs (brique)', 48, 11, 0.7, 0.2, 'Frais', 1, { flags: ['egg'] }),
  bread: f('pain complet', 240, 9, 41, 3, 'Épicerie', 1),
  chicken: f('blanc de poulet', 110, 23, 0, 1.5, 'Viandes et poissons', 2, { flags: ['meat'] }),
  turkey: f('escalope de dinde', 105, 23, 0, 1.2, 'Viandes et poissons', 1, { flags: ['meat'] }),
  beef: f('bœuf haché 5 %', 125, 21, 0, 5, 'Viandes et poissons', 2, { flags: ['meat'] }),
  salmon: f('pavé de saumon', 200, 20, 0, 13, 'Viandes et poissons', 3, { flags: ['fish'] }),
  tuna: f('thon au naturel', 115, 26, 0, 1, 'Épicerie', 2, { flags: ['fish'] }),
  sardine: f('sardines à l’huile, égouttées', 210, 24, 0, 13, 'Épicerie', 1, { flags: ['fish'] }),
  cod: f('cabillaud surgelé', 80, 18, 0, 0.7, 'Surgelés', 2, { flags: ['fish'] }),
  tofu: f('tofu ferme', 145, 15, 2, 8.5, 'Frais', 2),
  lentils: f('lentilles corail crues', 340, 24, 50, 1.5, 'Épicerie', 1),
  chickpeas: f('pois chiches en conserve', 140, 8, 20, 2.5, 'Épicerie', 1),
  kidney: f('haricots rouges en conserve', 115, 8, 16, 0.5, 'Épicerie', 1),
  rice: f('riz basmati', 355, 8, 78, 0.6, 'Épicerie', 1),
  pasta: f('pâtes complètes', 350, 13, 66, 2.5, 'Épicerie', 1),
  couscous: f('semoule complète', 355, 12, 70, 2, 'Épicerie', 1),
  quinoa: f('quinoa', 370, 14, 64, 6, 'Épicerie', 2),
  sweetPotato: f('patate douce', 86, 1.6, 20, 0.1, 'Fruits et légumes', 2),
  wrap: f('tortillas de blé', 300, 8, 50, 7, 'Épicerie', 1, { unit: { g: 60, name: 'tortilla', plural: 'tortillas' } }),
  veg: f('légumes poêlés surgelés', 35, 2, 5, 0.3, 'Surgelés', 1),
  broccoli: f('brocoli', 34, 2.8, 4, 0.4, 'Fruits et légumes', 1),
  greenBeans: f('haricots verts', 30, 2, 4, 0.2, 'Surgelés', 1),
  tomato: f('coulis de tomate', 35, 1.5, 6, 0.3, 'Épicerie', 1),
  onion: f('oignon', 40, 1.2, 8, 0.1, 'Fruits et légumes', 1),
  oil: f('huile d’olive', 900, 0, 0, 100, 'Épicerie', 2),
  avocado: f('avocat', 160, 2, 2, 15, 'Fruits et légumes', 2, { unit: { g: 140, name: 'avocat', plural: 'avocats' } }),
  cheese: f('emmental râpé', 380, 28, 0, 30, 'Frais', 2, { flags: ['dairy'] }),
  feta: f('feta', 265, 14, 1, 21, 'Frais', 2, { flags: ['dairy'] }),
  hummus: f('houmous', 300, 8, 14, 24, 'Frais', 2),
  almonds: f('amandes', 600, 21, 9, 50, 'Épicerie', 3),
  coconut: f('lait de coco léger', 120, 1, 3, 11, 'Épicerie', 2),
  soy: f('sauce soja', 60, 8, 6, 0, 'Épicerie', 1),
  apple: f('pomme', 52, 0.3, 12, 0.2, 'Fruits et légumes', 1, { unit: { g: 150, name: 'pomme', plural: 'pommes' } }),
} satisfies Record<string, Food>;

export type FoodKey = keyof typeof FOODS;

export interface Recipe {
  id: string;
  name: string;
  slots: MealSlot[];
  items: [FoodKey, number][];
  /** Se garde 3 à 4 jours au frigo : bon pour le meal prep. */
  prep: boolean;
  /** Prêt en 15 minutes ou moins. */
  quick: boolean;
  steps: string[];
}

const r = (id: string, name: string, slots: MealSlot[], items: [FoodKey, number][], opts: { prep?: boolean; quick?: boolean }, steps: string[]): Recipe => ({
  id,
  name,
  slots,
  items,
  prep: opts.prep ?? false,
  quick: opts.quick ?? false,
  steps,
});

const MAIN: MealSlot[] = ['lunch', 'dinner'];

export const RECIPES: Recipe[] = [
  // Petits-déjeuners
  r('overnight-oats', 'Overnight oats, whey et banane', ['breakfast'], [['oats', 80], ['milk', 250], ['whey', 30], ['banana', 120]], { prep: true, quick: true }, ['Mélange avoine, lait et whey dans un bocal, laisse au frigo la nuit, ajoute la banane le matin.']),
  r('omelette-toast', 'Omelette et tartines', ['breakfast', 'dinner'], [['egg', 165], ['eggWhite', 100], ['bread', 80], ['apple', 150]], { quick: true }, ['Bats les œufs et les blancs, cuis à la poêle, sers avec le pain grillé et la pomme.']),
  r('skyr-bowl', 'Bol skyr, avoine, fruits rouges et cacahuète', ['breakfast', 'snack'], [['skyr', 250], ['oats', 40], ['berries', 100], ['pb', 15]], { quick: true }, ['Verse le skyr, ajoute avoine, fruits rouges et beurre de cacahuète.']),
  r('soy-porridge', 'Porridge soja, blancs d’œufs et banane', ['breakfast'], [['oats', 80], ['soyMilk', 300], ['eggWhite', 150], ['banana', 120], ['pb', 10]], { quick: true }, ['Cuis l’avoine dans la boisson soja, ajoute les blancs en remuant 2 minutes, puis banane et cacahuète.']),
  r('pb-toast-shake', 'Tartines cacahuète banane et shake', ['breakfast', 'snack'], [['bread', 80], ['pb', 20], ['banana', 120], ['whey', 30], ['milk', 250]], { quick: true }, ['Tartine le beurre de cacahuète, coupe la banane dessus, secoue la whey dans le lait.']),

  // Plats (meal prep)
  r('chicken-rice', 'Poulet, riz et brocoli', MAIN, [['chicken', 160], ['rice', 85], ['broccoli', 200], ['oil', 10]], { prep: true }, ['Cuis le riz.', 'Coupe le poulet en dés, saisis-le 8 minutes à l’huile avec sel, poivre, paprika.', 'Cuis le brocoli 6 minutes à la vapeur ou au micro-ondes.']),
  r('bolognese', 'Bolognaise de bœuf, pâtes complètes', MAIN, [['beef', 150], ['pasta', 95], ['tomato', 150], ['onion', 50], ['veg', 100], ['oil', 8]], { prep: true }, ['Cuis les pâtes.', 'Fais revenir oignon et bœuf, ajoute coulis et légumes, laisse mijoter 15 minutes.']),
  r('chili', 'Chili con carne et riz', MAIN, [['beef', 130], ['kidney', 120], ['tomato', 150], ['onion', 50], ['rice', 70], ['oil', 8]], { prep: true }, ['Cuis le riz.', 'Fais revenir oignon et bœuf, ajoute coulis, haricots, cumin et paprika, mijote 20 minutes.']),
  r('chicken-curry', 'Curry de poulet au lait de coco, riz', MAIN, [['chicken', 160], ['coconut', 100], ['veg', 150], ['rice', 80]], { prep: true }, ['Cuis le riz.', 'Saisis le poulet, ajoute curry en poudre, légumes et lait de coco, mijote 12 minutes.']),
  r('salmon-sweet', 'Saumon, patate douce et haricots verts', MAIN, [['salmon', 130], ['sweetPotato', 250], ['greenBeans', 200]], { prep: true }, ['Rôtis la patate douce en cubes 25 minutes à 200 °C.', 'Cuis le saumon 12 minutes au four, les haricots verts 8 minutes à la vapeur.']),
  r('tuna-pasta', 'Pâtes au thon et tomate', MAIN, [['tuna', 140], ['pasta', 90], ['tomato', 150], ['oil', 8]], { prep: true, quick: true }, ['Cuis les pâtes, réchauffe coulis et thon émietté, mélange.']),
  r('turkey-couscous', 'Dinde, semoule et légumes', MAIN, [['turkey', 160], ['couscous', 85], ['veg', 200], ['oil', 10]], { prep: true, quick: true }, ['Verse la semoule dans le même volume d’eau bouillante, couvre 5 minutes.', 'Poêle la dinde en lamelles puis les légumes.']),
  r('chicken-wrap', 'Wraps poulet, avocat et crudités', MAIN, [['chicken', 140], ['wrap', 120], ['avocado', 70], ['veg', 80], ['skyr', 50]], { quick: true }, ['Poêle le poulet émincé, garnis les tortillas avec avocat, crudités et skyr citronné.']),
  r('cod-rice', 'Cabillaud, riz et légumes', MAIN, [['cod', 200], ['rice', 85], ['veg', 200], ['oil', 12]], { prep: true }, ['Cuis le riz.', 'Cuis le cabillaud 15 minutes au four avec citron, les légumes à la poêle.']),
  r('sardine-pasta', 'Pâtes aux sardines', MAIN, [['sardine', 150], ['pasta', 85], ['tomato', 120], ['veg', 100]], { quick: true }, ['Cuis les pâtes, ajoute coulis, légumes et sardines émiettées.']),
  r('dahl', 'Dahl de lentilles corail, riz', MAIN, [['lentils', 90], ['coconut', 80], ['tomato', 100], ['onion', 50], ['rice', 50], ['skyr', 100]], { prep: true }, ['Fais revenir l’oignon, ajoute lentilles, coulis, lait de coco, curry et 300 ml d’eau, cuis 20 minutes.', 'Sers avec le riz et une cuillère de skyr.']),
  r('tofu-stirfry', 'Tofu sauté, riz et légumes soja', MAIN, [['tofu', 200], ['rice', 80], ['veg', 200], ['soy', 15], ['oil', 8]], { prep: true, quick: true }, ['Cuis le riz.', 'Dore le tofu en dés, ajoute légumes et sauce soja, 6 minutes à feu vif.']),
  r('chili-veg', 'Chili sin carne, haricots et pois chiches', MAIN, [['kidney', 150], ['chickpeas', 120], ['tomato', 150], ['onion', 50], ['rice', 70], ['cheese', 20]], { prep: true }, ['Cuis le riz.', 'Mijote oignon, coulis, haricots, pois chiches et épices 20 minutes, parsème de fromage.']),
  r('feta-omelette', 'Omelette feta et légumes, pain', ['dinner', 'lunch'], [['egg', 165], ['eggWhite', 100], ['feta', 40], ['veg', 150], ['bread', 70]], { quick: true }, ['Poêle les légumes, verse les œufs battus, émiette la feta, plie l’omelette.']),
  r('quinoa-bowl', 'Bowl quinoa, pois chiches et feta', MAIN, [['quinoa', 75], ['chickpeas', 150], ['feta', 50], ['veg', 150], ['oil', 8]], { prep: true }, ['Cuis le quinoa 12 minutes.', 'Mélange avec pois chiches, légumes, feta et un filet d’huile.']),

  // Collations
  r('skyr-almonds', 'Skyr, fruits et amandes', ['snack'], [['skyr', 250], ['berries', 100], ['almonds', 15]], { quick: true }, ['Mélange le tout.']),
  r('cottage-whey', 'Fromage blanc, whey et pomme', ['snack'], [['cottage', 250], ['whey', 20], ['apple', 150]], { quick: true }, ['Mélange la whey au fromage blanc, sers avec la pomme.']),
  r('hummus-eggs', 'Tartine houmous et œufs durs', ['snack'], [['bread', 60], ['hummus', 40], ['egg', 110]], { quick: true }, ['Cuis les œufs 9 minutes, tartine le houmous.']),
  r('tuna-toast', 'Tartines au thon', ['snack', 'lunch'], [['bread', 80], ['tuna', 100], ['skyr', 40]], { quick: true }, ['Mélange thon et skyr, poivre, tartine.']),
  r('fruit-nuts', 'Banane et amandes', ['snack'], [['banana', 120], ['almonds', 25], ['soyMilk', 250]], { quick: true }, ['Rien à cuisiner.']),
];

/* ---------- Filtres selon les préférences ---------- */

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function dislikeWords(diet: DietPrefs): string[] {
  return normalize(diet.dislikes)
    .split(/[,;\n]+/)
    .map((w) => w.trim().replace(/s$/, ''))
    .filter((w) => w.length > 2);
}

/** Les mots refusés trouvés dans un texte (« saumon » dans « Poke bowl saumon »). */
function mentions(text: string, words: string[]): boolean {
  const t = normalize(text);
  return words.some((w) => t.includes(w));
}

export function allowedRecipe(rc: Recipe, diet: DietPrefs): boolean {
  const words = dislikeWords(diet);
  for (const [key] of rc.items) {
    const food: Food = FOODS[key];
    const flags = food.flags ?? [];
    if (diet.vegetarian && (flags.includes('meat') || flags.includes('fish'))) return false;
    if (diet.noPork && flags.includes('pork')) return false;
    if (diet.lactoseFree && flags.includes('dairy')) return false;
    if (diet.budget === 'tight' && food.cost === 3) return false;
    if (mentions(food.name, words)) return false;
  }
  return !mentions(rc.name, words);
}

/* ---------- Portions ---------- */

export function macrosOf(items: [FoodKey, number][]): Macros {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const [key, g] of items) {
    const food = FOODS[key];
    t.kcal += (food.kcal * g) / 100;
    t.protein += (food.protein * g) / 100;
    t.carbs += (food.carbs * g) / 100;
    t.fat += (food.fat * g) / 100;
  }
  return { kcal: Math.round(t.kcal), protein: Math.round(t.protein), carbs: Math.round(t.carbs), fat: Math.round(t.fat) };
}

/** Arrondit une quantité pour la cuisine : pièces entières, 5 g, ou 10 ml. */
function roundQty(key: FoodKey, g: number): number {
  const unit = (FOODS[key] as Food).unit;
  if (unit) return Math.max(1, Math.round(g / unit.g)) * unit.g;
  return Math.max(5, Math.round(g / 5) * 5);
}

export function qtyText(key: FoodKey, g: number): string {
  const food: Food = FOODS[key];
  if (food.unit) {
    const n = Math.round(g / food.unit.g);
    return `${n} ${n > 1 ? food.unit.plural : food.unit.name}`;
  }
  const liquid = key === 'milk' || key === 'soyMilk' || key === 'coconut';
  return `${Math.round(g)} ${liquid ? 'ml' : 'g'} de ${food.name}`;
}

export interface Portion {
  recipe: Recipe;
  items: [FoodKey, number][];
  macros: Macros;
  factor: number;
}

/** Adapte une recette à un objectif de calories (entre 0,6 et 1,8 fois la portion de base). */
export function portion(rc: Recipe, kcal: number): Portion {
  const base = macrosOf(rc.items);
  const factor = Math.min(1.8, Math.max(0.6, kcal / Math.max(1, base.kcal)));
  const items = rc.items.map(([k, g]) => [k, roundQty(k, g * factor)] as [FoodKey, number]);
  return { recipe: rc, items, macros: macrosOf(items), factor };
}

export function portionDetail(p: Portion): string {
  return p.items.map(([k, g]) => qtyText(k, g)).join(', ');
}

/* ---------- Meal plan ---------- */

export const SLOT_SHARE: Record<3 | 4, Partial<Record<MealSlot, number>>> = {
  4: { breakfast: 0.25, lunch: 0.3, snack: 0.15, dinner: 0.3 },
  3: { breakfast: 0.3, lunch: 0.35, dinner: 0.35 },
};

/** Note d'une portion : écart de calories, protéines manquantes, et un petit bonus si ça se prépare à l'avance. */
function score(p: Portion, kcal: number, protein: number, opts: { quick: boolean }): number {
  const kcalGap = Math.abs(p.macros.kcal - kcal) / kcal;
  const protGap = Math.max(0, protein - p.macros.protein) / Math.max(1, protein);
  const prepBonus = p.recipe.prep ? -0.04 : 0;
  const quickBonus = opts.quick && p.recipe.quick ? -0.05 : 0;
  return kcalGap + 1.4 * protGap + prepBonus + quickBonus;
}

export interface MealPrep {
  createdAt: string;
  /** Jours couverts par la préparation. */
  days: number;
  batches: { when: string; recipes: { name: string; portions: number; detail: string }[]; steps: string[] }[];
  shopping: { section: string; items: string[] }[];
  /** Macros d'une journée type avec ce plan. */
  day: Macros;
}

export interface GeneratedPlan {
  meals: PlannedMeal[];
  prep: MealPrep;
}

/**
 * Un meal plan qui vise les macros du jour : un petit-déjeuner, deux plats à préparer le dimanche et le mercredi
 * (pour ne pas manger la même chose 7 jours), une collation. Les repas deviennent les « repas prévus » de l'app.
 */
export function generateMealPlan(targets: Macros, athlete: Pick<Athlete, 'diet'>, opts: { seed?: number; days?: number } = {}): GeneratedPlan {
  const diet = athlete.diet;
  const share = SLOT_SHARE[diet.meals];
  const quick = diet.cook === 'quick';
  const allowed = RECIPES.filter((rc) => allowedRecipe(rc, diet));
  const seed = opts.seed ?? 0;
  const meals: PlannedMeal[] = [];
  const picked: { slot: MealSlot; p: Portion; batch: 0 | 1 }[] = [];

  for (const [slot, part] of Object.entries(share) as [MealSlot, number][]) {
    const kcal = targets.kcal * part;
    const protein = targets.protein * part;
    const ranked = allowed
      .filter((rc) => rc.slots.includes(slot))
      .map((rc) => portion(rc, kcal))
      .map((p) => ({ p, s: score(p, kcal, protein, { quick }) }))
      .sort((a, b) => a.s - b.s);
    if (!ranked.length) continue;
    // Le « seed » fait tourner les recettes à chaque nouvelle génération, parmi les meilleures.
    const pool = ranked.slice(0, Math.min(ranked.length, 5));
    const count = slot === 'lunch' || slot === 'dinner' ? 2 : 1;
    for (let i = 0; i < count && i < pool.length; i++) {
      const choice = pool[(seed + i * 2 + (slot === 'dinner' ? 1 : 0)) % pool.length];
      if (picked.some((x) => x.p.recipe.id === choice.p.recipe.id)) {
        const alt = pool.find((x) => !picked.some((y) => y.p.recipe.id === x.p.recipe.id));
        if (!alt) continue;
        picked.push({ slot, p: alt.p, batch: i as 0 | 1 });
      } else picked.push({ slot, p: choice.p, batch: i as 0 | 1 });
    }
  }

  for (const { slot, p } of picked) {
    meals.push({ id: `gen-${slot}-${p.recipe.id}`, slot, label: p.recipe.name, detail: portionDetail(p), ...p.macros });
  }

  const days = opts.days ?? 7;
  const prep = buildPrep(picked, days);
  const daySlots = Object.keys(share) as MealSlot[];
  const day = daySlots.reduce(
    (acc, slot) => {
      const m = picked.find((x) => x.slot === slot)?.p.macros;
      return m ? { kcal: acc.kcal + m.kcal, protein: acc.protein + m.protein, carbs: acc.carbs + m.carbs, fat: acc.fat + m.fat } : acc;
    },
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
  return { meals, prep: { ...prep, day } };
}

function buildPrep(picked: { slot: MealSlot; p: Portion; batch: 0 | 1 }[], days: number): Omit<MealPrep, 'day'> {
  // Déjeuners et dîners : la recette 1 du dimanche au mercredi midi, la recette 2 ensuite. Le reste chaque jour.
  const firstHalf = Math.ceil(days / 2);
  const portions = (x: { slot: MealSlot; batch: 0 | 1 }) => {
    const twoRecipes = picked.filter((y) => y.slot === x.slot).length > 1;
    if (!twoRecipes) return days;
    return x.batch === 0 ? firstHalf : days - firstHalf;
  };
  const totals = new Map<FoodKey, number>();
  for (const x of picked) {
    const n = portions(x);
    for (const [k, g] of x.p.items) totals.set(k, (totals.get(k) ?? 0) + g * n);
  }
  const sections = new Map<string, string[]>();
  for (const [k, g] of totals) {
    const food: Food = FOODS[k];
    const qty = food.unit ? `${Math.ceil(g / food.unit.g)} ${food.unit.plural}` : g >= 1000 ? `${(Math.ceil(g / 100) / 10).toLocaleString('fr-FR')} ${k === 'milk' || k === 'soyMilk' ? 'L' : 'kg'}` : `${Math.ceil(g / 10) * 10} ${k === 'milk' || k === 'soyMilk' || k === 'coconut' ? 'ml' : 'g'}`;
    sections.set(food.section, [...(sections.get(food.section) ?? []), `${food.name} : ${qty}`]);
  }
  const order: Section[] = ['Viandes et poissons', 'Fruits et légumes', 'Frais', 'Surgelés', 'Épicerie'];
  const shopping = order.filter((s) => sections.has(s)).map((s) => ({ section: s, items: sections.get(s)!.sort() }));

  const mains = picked.filter((x) => (x.slot === 'lunch' || x.slot === 'dinner') && x.p.recipe.prep);
  const batch = (b: 0 | 1, when: string) => {
    const list = mains.filter((x) => x.batch === b);
    if (!list.length) return null;
    return {
      when,
      recipes: list.map((x) => ({ name: x.p.recipe.name, portions: portions(x), detail: portionDetail(x.p) })),
      steps: [
        'Lance les féculents en premier (riz, pâtes, semoule, quinoa) : c’est le plus long.',
        ...list.flatMap((x) => x.p.recipe.steps.map((st) => `${x.p.recipe.name} : ${st}`)),
        'Répartis dans des boîtes, une par repas. Frigo 3 à 4 jours maximum.',
      ],
    };
  };
  const batches = [batch(0, 'Dimanche'), batch(1, 'Mercredi soir')].filter((b): b is NonNullable<typeof b> => b !== null);
  return { createdAt: new Date().toISOString().slice(0, 10), days, batches, shopping };
}

/* ---------- Proposer un plat ---------- */

export type SuggestMode = 'out' | 'shop' | 'cook';

export interface Suggestion {
  id: string;
  title: string;
  detail: string;
  macros: Macros;
  /** Estimation large : un plat de restaurant varie beaucoup. */
  rough?: boolean;
}

interface Dish extends Macros {
  name: string;
  detail: string;
  flags: Flag[];
}

const d = (name: string, detail: string, kcal: number, protein: number, carbs: number, fat: number, flags: Flag[] = []): Dish => ({ name, detail, kcal, protein, carbs, fat, flags });

/** Plats courants dehors, en portion standard. Estimations moyennes, à corriger si l'étiquette dit autre chose. */
const OUT: Dish[] = [
  d('Poke bowl poulet', 'Base riz, poulet, edamame, légumes, sauce à part', 600, 38, 75, 15, ['meat']),
  d('Poke bowl saumon', 'Base riz, saumon, avocat, sauce à part', 650, 30, 80, 22, ['fish']),
  d('Poke bowl tofu', 'Base riz, tofu, légumes, sauce à part', 550, 22, 75, 16),
  d('Sandwich poulet crudités', 'Demi-baguette, sans mayonnaise', 520, 30, 60, 16, ['meat']),
  d('Wrap poulet', 'Wrap de boulangerie ou fast-food', 450, 28, 45, 16, ['meat']),
  d('Sushis et makis, 12 pièces', 'Saumon et thon, sans tempura', 480, 22, 80, 8, ['fish']),
  d('Assiette kebab sans frites', 'Viande, salade, tomate, sauce blanche à part', 650, 45, 35, 35, ['meat']),
  d('Burger simple sans frites', 'Un steak, une tranche de fromage', 500, 26, 45, 24, ['meat', 'dairy']),
  d('Salade César au poulet', 'Sauce à part, croûtons en moins', 550, 35, 25, 35, ['meat', 'dairy', 'egg']),
  d('Bol riz poulet teriyaki', 'Restaurant japonais ou asiatique', 700, 40, 95, 15, ['meat']),
  d('Bo bun bœuf', 'Vermicelles, bœuf, crudités, nems à part', 600, 30, 75, 18, ['meat']),
  d('Grillade, riz et légumes', 'Brasserie : poulet ou steak, sans sauce', 700, 50, 70, 22, ['meat']),
  d('Pizza margherita, une moitié', 'Pâte fine', 550, 22, 70, 18, ['dairy']),
  d('Wrap falafels', 'Houmous, crudités', 600, 18, 70, 26),
  d('Omelette nature, salade, pain', 'Café ou brasserie', 500, 28, 35, 28, ['egg']),
];

/** Produits faciles à trouver en supermarché, sans marque. */
const SHOP: Dish[] = [
  d('Quart de poulet rôti', 'Rayon traiteur, sans la peau', 330, 45, 0, 16, ['meat']),
  d('Blanc de poulet en tranches (4)', '120 g', 125, 26, 1, 2, ['meat']),
  d('Salade de lentilles', 'Barquette de 250 g', 330, 15, 40, 10),
  d('Taboulé', 'Barquette de 250 g', 400, 8, 60, 13),
  d('Riz ou quinoa à réchauffer', 'Sachet de 250 g', 380, 8, 75, 5),
  d('Skyr nature', 'Pot de 450 g', 270, 45, 18, 1, ['dairy']),
  d('Fromage blanc 0 %', '250 g', 115, 20, 10, 0, ['dairy']),
  d('Thon au naturel', 'Boîte de 140 g égouttée', 160, 36, 0, 1, ['fish']),
  d('Saumon fumé (4 tranches)', '100 g', 180, 22, 0, 10, ['fish']),
  d('Œufs durs (2)', 'Rayon frais', 155, 13, 1, 11, ['egg']),
  d('Pain complet (2 tranches)', '80 g', 190, 7, 33, 2),
  d('Banane', 'Une moyenne', 110, 1, 25, 0),
  d('Boisson protéinée', 'Bouteille de 330 ml', 200, 25, 15, 3, ['dairy']),
  d('Barre protéinée', 'Une barre de 60 g', 200, 20, 20, 7, ['dairy']),
  d('Houmous', '100 g', 300, 8, 14, 24),
  d('Carottes râpées', 'Barquette de 200 g', 70, 2, 12, 1),
  d('Sandwich poulet préemballé', 'Pain de mie, crudités', 400, 22, 45, 14, ['meat']),
];

function dishAllowed(x: Dish, diet: DietPrefs, words: string[]): boolean {
  if (diet.vegetarian && (x.flags.includes('meat') || x.flags.includes('fish'))) return false;
  if (diet.noPork && x.flags.includes('pork')) return false;
  if (diet.lactoseFree && x.flags.includes('dairy')) return false;
  return !mentions(`${x.name} ${x.detail}`, words);
}

const sum = (list: Macros[]): Macros =>
  list.reduce((a, m) => ({ kcal: a.kcal + m.kcal, protein: a.protein + m.protein, carbs: a.carbs + m.carbs, fat: a.fat + m.fat }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });

function fit(m: Macros, kcal: number, protein: number): number {
  const over = Math.max(0, m.kcal - kcal * 1.08) / kcal;
  const under = Math.max(0, kcal * 0.85 - m.kcal) / kcal;
  const prot = Math.max(0, protein - m.protein) / Math.max(20, protein);
  return 3 * over + under + prot;
}

/**
 * Trois idées de repas pour ce qui reste dans la journée. Au-delà de 1 100 kcal restantes, on vise un repas
 * normal (le reste ira au repas suivant) ; en dessous de 250, une collation.
 */
export function suggestMeals(remaining: Macros, mode: SuggestMode, diet: DietPrefs, seed = 0): { aim: Macros; items: Suggestion[] } {
  const kcal = Math.max(200, Math.min(1100, remaining.kcal));
  const protein = Math.max(10, Math.min(70, remaining.protein));
  const aim = { kcal: Math.round(kcal), protein: Math.round(protein), carbs: Math.max(0, Math.round(remaining.carbs)), fat: Math.max(0, Math.round(remaining.fat)) };
  const words = dislikeWords(diet);

  if (mode === 'cook') {
    const snack = kcal < 400;
    const ranked = RECIPES.filter((rc) => allowedRecipe(rc, diet) && rc.slots.some((s) => (snack ? s === 'snack' : s === 'lunch' || s === 'dinner')))
      .map((rc) => portion(rc, kcal))
      .map((p) => ({ p, s: fit(p.macros, kcal, protein) + (p.recipe.quick ? -0.05 : 0) }))
      .sort((a, b) => a.s - b.s);
    const items = rotate(ranked, seed, 3).map(({ p }) => ({ id: p.recipe.id, title: p.recipe.name, detail: `${portionDetail(p)}. ${p.recipe.steps.join(' ')}`, macros: p.macros }));
    return { aim, items };
  }

  if (mode === 'out') {
    const ranked = OUT.filter((x) => dishAllowed(x, diet, words))
      .map((x) => ({ x, s: fit(x, kcal, protein) }))
      .sort((a, b) => a.s - b.s);
    const items = rotate(ranked, seed, 3).map(({ x }) => ({
      id: x.name,
      title: x.name,
      detail: x.detail,
      macros: { kcal: x.kcal, protein: x.protein, carbs: x.carbs, fat: x.fat },
      rough: true,
    }));
    return { aim, items };
  }

  // Supermarché : une protéine, et de quoi compléter (1 à 3 produits).
  const pool = SHOP.filter((x) => dishAllowed(x, diet, words));
  const combos: { list: Dish[]; m: Macros; s: number }[] = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i; j < pool.length; j++) {
      for (let k = j; k < pool.length; k++) {
        const list = [pool[i], pool[j], pool[k]].filter((x, n, arr) => arr.indexOf(x) === n);
        const m = sum(list);
        combos.push({ list, m, s: fit(m, kcal, protein) + list.length * 0.02 });
      }
    }
  }
  combos.sort((a, b) => a.s - b.s);
  // Le produit le plus protéiné fait la proposition : pas deux propositions autour du même.
  const main = (list: Dish[]) => list.reduce((a, b) => (b.protein > a.protein ? b : a));
  const distinct: typeof combos = [];
  for (const c of combos) {
    if (c.m.kcal < kcal * 0.7 || c.m.kcal > kcal * 1.12) continue;
    if (distinct.some((x) => main(x.list) === main(c.list))) continue;
    distinct.push(c);
    if (distinct.length >= 9) break;
  }
  if (!distinct.length) distinct.push(...combos.slice(0, 3));
  const items = rotate(distinct, seed, 3).map((c) => ({
    id: c.list.map((x) => x.name).join('+'),
    title: c.list.map((x) => x.name).join(' + '),
    detail: c.list.map((x) => `${x.name.toLowerCase()} : ${x.detail}`).join(' ; '),
    macros: c.m,
  }));
  return { aim, items };
}

/** Prend 3 éléments parmi les meilleurs, décalés à chaque « Autres idées ». */
function rotate<T>(ranked: T[], seed: number, n: number): T[] {
  const pool = ranked.slice(0, Math.max(n, Math.min(ranked.length, 9)));
  if (pool.length <= n) return pool;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(pool[(seed * n + i) % pool.length]);
  return out.filter((x, i) => out.indexOf(x) === i);
}
