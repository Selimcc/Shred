// Lecture des codes-barres produits (EAN-13, EAN-8, UPC-A, UPC-E) : vérification de la clé de contrôle,
// confirmation sur deux lectures identiques, variantes du code pour Open Food Facts, zone de l'image à décoder.

/** Code UPC-E (8 chiffres, commence par 0 ou 1) développé en UPC-A (12 chiffres). */
export function upcEtoA(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const [s, d1, d2, d3, d4, d5, d6, check] = code;
  const body =
    d6 === '0' || d6 === '1' || d6 === '2'
      ? `${d1}${d2}${d6}0000${d3}${d4}${d5}`
      : d6 === '3'
        ? `${d1}${d2}${d3}00000${d4}${d5}`
        : d6 === '4'
          ? `${d1}${d2}${d3}${d4}00000${d5}`
          : `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  return `${s}${body}${check}`;
}

/** Clé de contrôle GS1 : valable pour EAN-8, UPC-A (12) et EAN-13. */
function gs1Ok(code: string): boolean {
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((n, d, i) => n + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** Le code lu ou tapé est-il un code produit valable (bonne longueur, bonne clé de contrôle) ? */
export function validBarcode(raw: string): boolean {
  const code = raw.trim();
  if (!/^\d+$/.test(code)) return false;
  if (code.length === 13 || code.length === 12) return gs1Ok(code);
  if (code.length === 8) {
    // Un code à 8 chiffres peut être un EAN-8 ou un UPC-E.
    if (gs1Ok(code)) return true;
    const a = upcEtoA(code);
    return Boolean(a && gs1Ok(a));
  }
  return false;
}

/** Les écritures du même produit à essayer dans Open Food Facts, la plus probable d'abord. */
export function codeVariants(raw: string): string[] {
  const code = raw.trim();
  const out = [code];
  if (code.length === 12) out.push(`0${code}`);
  if (code.length === 13 && code.startsWith('0')) out.push(code.slice(1));
  if (code.length === 8 && !gs1Ok(code)) {
    const a = upcEtoA(code);
    if (a) out.push(`0${a}`, a);
  }
  return [...new Set(out)];
}

/**
 * Valide une lecture seulement quand le même code valable sort deux fois de suite en peu de temps :
 * une image floue peut donner un code faux, rarement deux fois le même.
 */
export function confirmer(times = 2, windowMs = 1500) {
  let last = '';
  let count = 0;
  let at = 0;
  return (code: string, now = Date.now()): boolean => {
    if (!validBarcode(code)) return false;
    if (code === last && now - at <= windowMs) count += 1;
    else count = 1;
    last = code;
    at = now;
    return count >= times;
  };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Partie de l'image de la caméra à décoder : ce qui est visible dans le cadre (vidéo en object-fit: cover),
 * agrandi par le zoom numérique. Une bande horizontale centrée, là où l'on vise.
 */
export function scanRegion(video: { w: number; h: number }, box: { w: number; h: number }, zoom = 1): Rect {
  const s = Math.max(box.w / video.w, box.h / video.h) * Math.max(1, zoom);
  const visW = Math.min(video.w, box.w / s);
  const visH = Math.min(video.h, box.h / s);
  const w = visW * 0.92;
  const h = visH * 0.56;
  return { x: (video.w - w) / 2, y: (video.h - h) / 2, w, h };
}

/**
 * Netteté pour une image un peu floue (masque flou) : niveaux de gris, puis chaque pixel s'éloigne de la
 * moyenne de son voisinage horizontal. Les barres d'un code-barres étant verticales, un flou horizontal suffit.
 * Travaille en place sur des pixels RGBA (ImageData).
 */
export function sharpenBars(px: Uint8ClampedArray, w: number, h: number, radius = 3, amount = 2.2): void {
  const gray = new Float32Array(w * h);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = px[j] * 0.299 + px[j + 1] * 0.587 + px[j + 2] * 0.114;
  const row = new Float32Array(w + 1);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    row[0] = 0;
    for (let x = 0; x < w; x++) row[x + 1] = row[x] + gray[o + x];
    for (let x = 0; x < w; x++) {
      const a = Math.max(0, x - radius);
      const b = Math.min(w, x + radius + 1);
      const mean = (row[b] - row[a]) / (b - a);
      const v = gray[o + x] + amount * (gray[o + x] - mean);
      const k = (o + x) * 4;
      px[k] = px[k + 1] = px[k + 2] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
}

/** Textes et images d'Open Food Facts : le même nettoyage côté serveur et côté app. */
export { offImage, offText } from '../../shared/food';
