// Recherche d'aliments par nom, relayée par le serveur. Open Food Facts limite sa recherche à 10 requêtes par
// minute et par adresse, et la refuse sans en-têtes CORS quand on dépasse : Safari affichait « Load failed ».
// Ici, chaque réponse reste une semaine dans le cache de Cloudflare (partagé entre tous, sans écriture KV),
// le serveur s'annonce comme Open Food Facts le demande (User-Agent), et Search-a-licious, le nouveau moteur
// de recherche d'Open Food Facts, passe avant l'ancienne recherche.
import { type Env, HttpError, json } from './env';
import { cached } from './places';
import { capDaily } from './usage';
import { VERSION } from './version';
import type { Lang } from './i18n';
import { type FoodHit, foodQuery, toFoodHits } from '../shared/food';

type Fetcher = typeof fetch;

const FIELDS = (lang: Lang) => ['code', 'product_name', `product_name_${lang}`, 'product_name_en', 'brands', 'nutriments', 'serving_quantity', 'image_front_small_url', 'image_small_url'];

/** Search-a-licious : null si le moteur ne répond pas ou si sa réponse ne se lit pas. */
async function searchALicious(fetcher: Fetcher, ua: string, q: string, lang: Lang): Promise<FoodHit[] | null> {
  const params = new URLSearchParams({ q, langs: lang, page_size: '30', fields: [...FIELDS(lang), 'images'].join(','), boost_phrase: 'true' });
  const res = await fetcher(`https://search.openfoodfacts.org/search?${params}`, { headers: { 'user-agent': ua, accept: 'application/json' }, signal: AbortSignal.timeout(4000) }).catch(() => null);
  if (!res?.ok) return null;
  const data = (await res.json().catch(() => null)) as { hits?: unknown[] } | null;
  return Array.isArray(data?.hits) ? toFoodHits(data.hits, lang) : null;
}

/** L'ancienne recherche (cgi/search.pl), triée par nombre de scans : null si elle refuse ou ne répond pas. */
async function legacySearch(fetcher: Fetcher, ua: string, q: string, lang: Lang): Promise<FoodHit[] | null> {
  const params = new URLSearchParams({
    search_terms: q,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '30',
    lc: lang,
    sort_by: 'unique_scans_n',
    fields: FIELDS(lang).join(','),
  });
  const res = await fetcher(`https://world.openfoodfacts.org/cgi/search.pl?${params}`, { headers: { 'user-agent': ua, accept: 'application/json' }, signal: AbortSignal.timeout(7000) }).catch(() => null);
  if (!res?.ok) return null;
  const data = (await res.json().catch(() => null)) as { products?: unknown[] } | null;
  return Array.isArray(data?.products) ? toFoodHits(data.products, lang) : null;
}

/**
 * Les deux moteurs l'un après l'autre : le second ne sert que si le premier ne donne rien d'utilisable.
 * Sans réponse du second, c'est une erreur (jamais gardée en cache), pas un « rien trouvé ».
 */
export async function searchProducts(fetcher: Fetcher, ua: string, q: string, lang: Lang): Promise<FoodHit[]> {
  const first = await searchALicious(fetcher, ua, q, lang);
  if (first?.length) return first;
  const second = await legacySearch(fetcher, ua, q, lang);
  if (second) return second;
  throw new HttpError(502, 'Open Food Facts ne répond pas, réessaie dans un instant');
}

export async function foodRoutes(req: Request, env: Env, url: URL, userId: string, lang: Lang): Promise<Response | null> {
  if (url.pathname !== '/api/food/search' || req.method !== 'GET') return null;
  const q = foodQuery(url.searchParams.get('q'));
  if (q.length < 2) return json({ hits: [] });
  await capDaily(env, userId, 'food');
  const fetcher = (env as Env & { FETCH?: Fetcher }).FETCH ?? fetch;
  const ua = `Shred/${VERSION} (+${url.origin})`;
  // Une semaine pour une recherche qui trouve, un jour pour une recherche vide (la base grandit).
  const hits = await cached(`food1:${lang}:${q.toLowerCase()}`, (h: FoodHit[]) => (h.length ? 7 * 86_400 : 86_400), () => searchProducts(fetcher, ua, q, lang));
  return json({ hits });
}
