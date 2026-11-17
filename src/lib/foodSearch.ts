// Recherche d'aliments par nom (comme MyFitnessPal), et repas récents à ressaisir d'un geste.
// Les aliments de base de l'app s'affichent tout de suite (genericFoods.ts) ; les produits viennent d'Open Food
// Facts. Avec un compte, la recherche passe par le serveur (cache partagé, limite d'Open Food Facts respectée) ;
// sans compte, ou si le serveur ne répond pas, l'app interroge Open Food Facts directement.
import { api, DEMO } from './api';
import { addDays } from './date';
import { signedIn } from './session';
import type { AppState, MealEntry } from './store';
import { cleanHit, type FoodHit, foodQuery, toFoodHits } from '../../shared/food';
import { lang, tr } from '../../shared/i18n';

export type { FoodHit };

const cache = new Map<string, FoodHit[]>();

/** Open Food Facts en direct (ancienne recherche, la seule ouverte aux navigateurs). */
async function direct(q: string): Promise<FoodHit[]> {
  const l = lang();
  const params = new URLSearchParams({
    search_terms: q,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '30',
    lc: l,
    sort_by: 'unique_scans_n',
    fields: `code,product_name,product_name_${l},product_name_en,brands,nutriments,serving_quantity,image_front_small_url,image_small_url`,
  });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const res = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?${params}`, { signal: ctl.signal });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { products?: unknown[] };
    return toFoodHits(data.products ?? [], l);
  } catch (e) {
    // Trop de recherches d'affilée, Open Food Facts répond sans en-têtes CORS : Safari dit seulement « Load failed ».
    throw new Error((e as Error).name === 'AbortError' ? tr('Recherche trop longue, réessaie') : tr('Open Food Facts ne répond pas, réessaie dans un instant'));
  } finally {
    clearTimeout(timer);
  }
}

export async function searchFoods(query: string): Promise<FoodHit[]> {
  const q = foodQuery(query);
  if (q.length < 2) return [];
  const key = `${lang()}:${q.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let out: FoodHit[] | null = null;
  if (!DEMO && signedIn()) {
    out = await api<{ hits?: unknown[] }>(`/api/food/search?q=${encodeURIComponent(q)}`).then(
      (r) => (r.hits ?? []).map(cleanHit).filter((h): h is FoodHit => h !== null),
      // Serveur injoignable, limite du jour atteinte ou Open Food Facts muet côté serveur : on tente en direct.
      () => null,
    );
  }
  out ??= await direct(q);
  cache.set(key, out);
  return out;
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
