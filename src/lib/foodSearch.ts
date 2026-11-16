// Recherche d'aliments par nom dans Open Food Facts (comme MyFitnessPal), et repas récents à ressaisir d'un geste.
// Les textes viennent d'une base modifiable par tous : nettoyés et bornés (offText, offImage).
import { offImage, offText } from './barcode';
import { addDays } from './date';
import type { AppState, MealEntry } from './store';

export interface FoodHit {
  code: string;
  name: string;
  brand?: string;
  image?: string;
  per100: { kcal: number; protein: number; carbs: number; fat: number };
  serving?: number;
}

const num = (v: unknown, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n * 10) / 10)) : 0;
};

const cache = new Map<string, FoodHit[]>();

export async function searchFoods(query: string): Promise<FoodHit[]> {
  const q = query.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (q.length < 2) return [];
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const params = new URLSearchParams({
    search_terms: q,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '20',
    lc: 'fr',
    sort_by: 'unique_scans_n',
    fields: 'code,product_name,product_name_fr,brands,nutriments,serving_quantity,image_front_small_url',
  });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const res = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?${params}`, { signal: ctl.signal });
    if (!res.ok) throw new Error('Open Food Facts ne répond pas, réessaie dans un instant');
    const data = (await res.json()) as { products?: Record<string, unknown>[] };
    const out: FoodHit[] = [];
    for (const p of data.products ?? []) {
      const n = (p.nutriments ?? {}) as Record<string, unknown>;
      const kcal = num(n['energy-kcal_100g'] ?? (Number(n.energy_100g) || 0) / 4.184, 950);
      const name = offText(p.product_name_fr || p.product_name, 80);
      if (!name || !kcal) continue;
      out.push({
        code: offText(p.code, 20).replace(/\D/g, ''),
        name,
        brand: p.brands ? offText(String(p.brands).split(',')[0], 40) || undefined : undefined,
        image: offImage(p.image_front_small_url),
        per100: { kcal, protein: num(n.proteins_100g, 100), carbs: num(n.carbohydrates_100g, 100), fat: num(n.fat_100g, 100) },
        serving: num(p.serving_quantity, 5000) || undefined,
      });
      if (out.length >= 12) break;
    }
    cache.set(key, out);
    return out;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('Recherche trop longue, réessaie');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Macros pour une quantité en grammes. */
export function forGrams(h: FoodHit, grams: number) {
  const f = grams / 100;
  return {
    kcal: Math.round(h.per100.kcal * f),
    protein: Math.round(h.per100.protein * f),
    carbs: Math.round(h.per100.carbs * f),
    fat: Math.round(h.per100.fat * f),
  };
}

/** Les repas notés ces 45 derniers jours, les plus récents d'abord, un par nom. */
export function recentFoods(s: AppState, today: string, max = 8): MealEntry[] {
  const from = addDays(today, -45);
  const seen = new Set<string>();
  const out: MealEntry[] = [];
  const meals = Object.entries(s.days)
    .filter(([d]) => d >= from && d <= today)
    .flatMap(([, d]) => d.meals)
    .sort((a, b) => b.at - a.at);
  for (const m of meals) {
    const k = m.label.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(m);
    if (out.length >= max) break;
  }
  return out;
}
