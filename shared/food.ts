// Produits d'Open Food Facts (base modifiable par tous) ramenés à ce que l'app affiche : nom, marque, image et
// macros pour 100 g. Le même code sert au serveur (recherche relayée, mise en cache) et à l'app (recherche directe,
// code-barres). Textes nettoyés et bornés, images acceptées seulement depuis Open Food Facts.

export interface FoodHit {
  code: string;
  name: string;
  brand?: string;
  image?: string;
  per100: { kcal: number; protein: number; carbs: number; fat: number };
  serving?: number;
  /** Aliment de base de l'app (valeurs moyennes), pas un produit d'Open Food Facts. */
  generic?: boolean;
}

/** Texte d'Open Food Facts : sans caractères de contrôle ni balises, longueur bornée. */
export function offText(v: unknown, max: number): string {
  return String(v ?? '')
    .replace(/[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Seules les images servies par Open Food Facts lui-même. */
export function offImage(v: unknown): string | undefined {
  try {
    const u = new URL(String(v ?? ''));
    return u.protocol === 'https:' && /(^|\.)openfoodfacts\.(org|net)$/.test(u.hostname) ? u.href : undefined;
  } catch {
    return undefined;
  }
}

const num = (v: unknown, max: number) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n * 10) / 10)) : 0;
};

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const record = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/**
 * Le nom dans la langue demandée. L'ancienne recherche donne product_name_xx ; Search-a-licious peut donner un
 * objet par langue ({ fr: …, main: … }). À défaut, le nom principal, puis l'anglais.
 */
export function productName(p: Record<string, unknown>, lang: string): string {
  const byLang = record(p.product_name);
  const first = byLang ? Object.values(byLang).find((x) => typeof x === 'string' && x.trim()) : undefined;
  return offText(
    text(p[`product_name_${lang}`]) || text(byLang?.[lang]) || text(byLang?.main) || text(p.product_name) || text(p.product_name_en) || text(first) || text(p.generic_name),
    80,
  );
}

/** La marque principale : « Danone, Activia » ou [« Danone », « Activia »] donnent « Danone ». */
export function productBrand(p: Record<string, unknown>): string {
  const b = Array.isArray(p.brands) ? text(p.brands[0]) : text(p.brands).split(',')[0];
  return offText(b, 40);
}

/** Dossier d'un produit sur le serveur d'images : 3017620422003 donne 301/762/042/2003. */
export function productFolder(code: string): string | null {
  if (/^\d{1,8}$/.test(code)) return code;
  const m = code.match(/^(\d{3})(\d{3})(\d{3})(\d{1,5})$/);
  return m ? `${m[1]}/${m[2]}/${m[3]}/${m[4]}` : null;
}

const IMAGE_FIELDS = ['image_front_small_url', 'image_small_url', 'image_front_thumb_url', 'image_thumb_url', 'image_front_url', 'image_url'];

/**
 * La photo du produit : la vignette de face, sinon n'importe quelle autre vignette, sinon l'adresse reconstruite
 * depuis la photo de face choisie (images.front_xx.rev), comme le site d'Open Food Facts la construit.
 */
export function productImage(p: Record<string, unknown>, code: string, lang: string): string | undefined {
  for (const f of IMAGE_FIELDS) {
    const u = offImage(p[f]);
    if (u) return u;
  }
  const images = record(p.images);
  const folder = productFolder(code);
  if (!images || !folder) return undefined;
  const keys = [`front_${lang}`, 'front_en', 'front_fr', ...Object.keys(images).filter((k) => /^front_[a-z]{2}$/.test(k))];
  for (const k of keys) {
    const rev = String(record(images[k])?.rev ?? '').replace(/\D/g, '');
    if (rev && /^front_[a-z]{2}$/.test(k)) return `https://images.openfoodfacts.org/images/products/${folder}/${k}.${rev}.200.jpg`;
  }
  return undefined;
}

/** Calories pour 100 g : en kcal, sinon converties depuis les kJ. */
export function kcalPer100(n: Record<string, unknown>): number {
  const kcal = num(n['energy-kcal_100g'], 950);
  return kcal || num((num(n['energy_100g'], 4000) || num(n['energy-kj_100g'], 4000)) / 4.184, 950);
}

/** Un produit d'Open Food Facts (ancienne recherche ou Search-a-licious) ; null sans nom ou sans calories. */
export function toFoodHit(p: unknown, lang: string): FoodHit | null {
  const r = record(p);
  if (!r) return null;
  const n = record(r.nutriments) ?? {};
  const kcal = kcalPer100(n);
  const name = productName(r, lang);
  if (!name || !kcal) return null;
  const code = offText(r.code, 20).replace(/\D/g, '');
  const brand = productBrand(r);
  const image = productImage(r, code, lang);
  const serving = num(r.serving_quantity, 5000);
  return {
    code,
    name,
    ...(brand ? { brand } : {}),
    ...(image ? { image } : {}),
    per100: { kcal, protein: num(n.proteins_100g, 100), carbs: num(n.carbohydrates_100g, 100), fat: num(n.fat_100g, 100) },
    ...(serving ? { serving } : {}),
  };
}

/** Liste de produits : les inutilisables écartés, un seul par code et par nom de marque, 16 au plus. */
export function toFoodHits(products: unknown[], lang: string, max = 16): FoodHit[] {
  const out: FoodHit[] = [];
  const seen = new Set<string>();
  for (const p of products) {
    const h = toFoodHit(p, lang);
    if (!h) continue;
    const k = `${h.name}|${h.brand ?? ''}`.toLowerCase();
    if (seen.has(k) || (h.code && seen.has(h.code))) continue;
    seen.add(k);
    if (h.code) seen.add(h.code);
    out.push(h);
    if (out.length >= max) break;
  }
  return out;
}

/** Un résultat reçu du serveur, revérifié avant d'être affiché. */
export function cleanHit(v: unknown): FoodHit | null {
  const h = record(v);
  const per100 = record(h?.per100);
  if (!h || !per100) return null;
  const name = offText(h.name, 80);
  const kcal = num(per100.kcal, 950);
  if (!name || !kcal) return null;
  const brand = offText(h.brand, 40);
  const image = offImage(h.image);
  const serving = num(h.serving, 5000);
  return {
    code: offText(h.code, 20).replace(/\D/g, ''),
    name,
    ...(brand ? { brand } : {}),
    ...(image ? { image } : {}),
    per100: { kcal, protein: num(per100.protein, 100), carbs: num(per100.carbs, 100), fat: num(per100.fat, 100) },
    ...(serving ? { serving } : {}),
  };
}

/** Requête nettoyée : espaces simples, 60 caractères au plus. */
export function foodQuery(q: unknown): string {
  return offText(q, 60);
}
