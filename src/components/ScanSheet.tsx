// Scanner un code-barres : la caméra lit l'EAN, Open Food Facts donne les valeurs pour 100 g,
// tu choisis la quantité et le repas. Les produits déjà scannés restent à portée de main.
import { useEffect, useRef, useState } from 'react';
import { addMeal } from '../lib/actions';
import { formatNumber } from '../lib/date';
import type { MealSlot } from '../../shared/types';
import { Icon } from './Icon';
import { Sheet, toast } from './ui';

export interface Product {
  ean: string;
  name: string;
  brand?: string;
  image?: string;
  /** Valeurs pour 100 g (ou 100 ml). */
  per100: { kcal: number; protein: number; carbs: number; fat: number };
  serving?: number;
}

const CACHE_KEY = 'shred:products';

function readCache(): Product[] {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function remember(p: Product) {
  try {
    const list = [p, ...readCache().filter((x) => x.ean !== p.ean)].slice(0, 40);
    localStorage.setItem(CACHE_KEY, JSON.stringify(list));
  } catch {
    // Mémoire pleine : le produit sera simplement redemandé la prochaine fois.
  }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() ? Number(v.replace(',', '.')) || 0 : 0);

/** Cherche un produit par son code-barres : d'abord ceux déjà scannés, puis Open Food Facts. */
export async function lookupProduct(ean: string): Promise<Product | null> {
  const cached = readCache().find((p) => p.ean === ean);
  if (cached) return cached;
  const fields = 'product_name,product_name_fr,brands,nutriments,serving_quantity,image_front_small_url';
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(ean)}.json?fields=${fields}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { status?: number; product?: Record<string, unknown> };
  const p = data.product;
  if (!p || data.status === 0) return null;
  const n = (p.nutriments ?? {}) as Record<string, unknown>;
  const kcal = num(n['energy-kcal_100g']) || Math.round(num(n['energy_100g']) / 4.184);
  const product: Product = {
    ean,
    name: String(p.product_name_fr || p.product_name || 'Produit sans nom'),
    brand: p.brands ? String(p.brands).split(',')[0].trim() : undefined,
    image: p.image_front_small_url ? String(p.image_front_small_url) : undefined,
    per100: { kcal: Math.round(kcal), protein: num(n.proteins_100g), carbs: num(n.carbohydrates_100g), fat: num(n.fat_100g) },
    serving: num(p.serving_quantity) || undefined,
  };
  remember(product);
  return product;
}

export function macrosFor(p: Product, grams: number) {
  const f = grams / 100;
  return {
    kcal: Math.round(p.per100.kcal * f),
    protein: Math.round(p.per100.protein * f * 10) / 10,
    carbs: Math.round(p.per100.carbs * f * 10) / 10,
    fat: Math.round(p.per100.fat * f * 10) / 10,
  };
}

const SLOT_NAMES: Record<MealSlot, string> = { breakfast: 'Petit-déj', lunch: 'Déjeuner', snack: 'Collation', dinner: 'Dîner', extra: 'Extra' };

type Controls = { stop: () => void };

export function ScanSheet({ today, slot: initialSlot, onClose }: { today: string; slot: MealSlot; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'camera' | 'looking' | 'found' | 'missing' | 'nocam'>('camera');
  const [product, setProduct] = useState<Product | null>(null);
  const [grams, setGrams] = useState('100');
  const [slot, setSlot] = useState<MealSlot>(initialSlot);
  const [manual, setManual] = useState('');
  const recent = readCache().slice(0, 8);
  const stopRef = useRef<Controls | null>(null);

  const found = async (ean: string) => {
    stopRef.current?.stop();
    stopRef.current = null;
    try {
      navigator.vibrate?.(30);
    } catch {
      // Pas de vibration sur iPhone.
    }
    setStatus('looking');
    try {
      const p = await lookupProduct(ean);
      if (!p) {
        setStatus('missing');
        setManual(ean);
        return;
      }
      setProduct(p);
      setGrams(String(p.serving ?? 100));
      setStatus('found');
    } catch {
      toast('Pas de réseau pour chercher le produit. Réessaie, ou note-le à la main.', true);
      setStatus('missing');
      setManual(ean);
    }
  };

  useEffect(() => {
    if (status !== 'camera') return;
    let cancelled = false;
    (async () => {
      try {
        const el = video.current;
        if (!el || !navigator.mediaDevices?.getUserMedia) throw new Error('nocam');
        // Détecteur natif quand il existe (Android, Chrome), sinon ZXing (iPhone).
        const Native = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
        if (Native) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          if (cancelled) return stream.getTracks().forEach((t) => t.stop());
          el.srcObject = stream;
          await el.play();
          const det = new Native({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
          let alive = true;
          stopRef.current = {
            stop: () => {
              alive = false;
              stream.getTracks().forEach((t) => t.stop());
            },
          };
          const tick = async () => {
            if (!alive) return;
            const codes = await det.detect(el).catch(() => []);
            if (codes[0]?.rawValue) return found(codes[0].rawValue);
            setTimeout(tick, 180);
          };
          void tick();
          return;
        }
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const { BarcodeFormat, DecodeHintType } = await import('@zxing/library');
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]);
        const reader = new BrowserMultiFormatReader(hints);
        const controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, el, (result) => {
          if (result) void found(result.getText());
        });
        if (cancelled) return controls.stop();
        stopRef.current = controls;
      } catch {
        if (!cancelled) setStatus('nocam');
      }
    })();
    return () => {
      cancelled = true;
      stopRef.current?.stop();
      stopRef.current = null;
    };
  }, [status]);

  const g = Math.max(0, Number(grams.replace(',', '.')) || 0);
  const m = product ? macrosFor(product, g) : null;

  const add = () => {
    if (!product || !m || g <= 0) return;
    addMeal(today, {
      slot,
      label: `${product.name}${product.brand ? `, ${product.brand}` : ''} (${formatNumber(g)} g)`,
      ...m,
      source: 'scan',
      items: [{ name: product.name, grams: g, ...m }],
    });
    toast(`${product.name} ajouté`);
    onClose();
  };

  return (
    <Sheet title="Scanner un produit" onClose={onClose}>
      {status === 'camera' && (
        <div className="stack" style={{ gap: 14 }}>
          <div className="scan-view">
            <video ref={video} playsInline muted />
            <span className="scan-frame" aria-hidden="true" />
          </div>
          <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>
            Vise le code-barres, il se lit tout seul.
          </p>
        </div>
      )}

      {status === 'looking' && (
        <div className="empty">
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          Recherche du produit…
        </div>
      )}

      {(status === 'nocam' || status === 'missing') && (
        <div className="stack" style={{ gap: 12 }}>
          <p className="muted" style={{ margin: 0 }}>
            {status === 'nocam'
              ? 'La caméra n’est pas disponible. Autorise-la dans les réglages du navigateur, ou tape le code sous le code-barres.'
              : 'Produit introuvable dans Open Food Facts. Vérifie le code, ou note le repas à la main.'}
          </p>
          <form
            style={{ display: 'flex', gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (manual.trim().length >= 8) void found(manual.trim());
            }}
          >
            <input className="input num" inputMode="numeric" placeholder="3017620422003" value={manual} onChange={(e) => setManual(e.target.value.replace(/\D/g, ''))} aria-label="Code-barres" />
            <button className="btn primary" disabled={manual.length < 8}>
              Chercher
            </button>
          </form>
          {status === 'missing' && (
            <button className="btn" onClick={() => setStatus('camera')}>
              <Icon name="camera" size={18} /> Scanner à nouveau
            </button>
          )}
        </div>
      )}

      {status === 'found' && product && m && (
        <div className="stack" style={{ gap: 16 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            {product.image ? <img src={product.image} alt="" className="product-img" /> : <span className="product-img" />}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 650, lineHeight: 1.25 }}>{product.name}</div>
              <div className="small muted">
                {product.brand ? `${product.brand}, ` : ''}
                {product.per100.kcal} kcal pour 100 g
              </div>
            </div>
          </div>

          <div className="builder-row">
            <span className="small muted">Quantité (g)</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input className="input num center" style={{ width: 96 }} inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} aria-label="Quantité en grammes" />
              <div className="chips">
                {[...new Set([product.serving, 50, 100, 150, 200].filter((x): x is number => Boolean(x)))].slice(0, 4).map((x) => (
                  <button key={x} type="button" className={`chip ${g === x ? 'on' : ''}`} onClick={() => setGrams(String(x))}>
                    {x}
                    {x === product.serving ? ' (portion)' : ''}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="macro-grid card" style={{ padding: 16 }}>
            <div className="macro">
              <b>
                {formatNumber(m.kcal)}
                <small>kcal</small>
              </b>
              <span>pour {formatNumber(g)} g</span>
            </div>
            <div className="macro">
              <b>
                {formatNumber(m.protein, 1)}
                <small>g</small>
              </b>
              <span>
                protéines, {formatNumber(m.carbs, 0)} g glucides, {formatNumber(m.fat, 0)} g lipides
              </span>
            </div>
          </div>

          <div className="chips" role="group" aria-label="Repas">
            {(Object.keys(SLOT_NAMES) as MealSlot[]).map((x) => (
              <button key={x} type="button" className={`chip ${slot === x ? 'on' : ''}`} onClick={() => setSlot(x)}>
                {SLOT_NAMES[x]}
              </button>
            ))}
          </div>

          <button className="btn primary block" onClick={add} disabled={g <= 0}>
            Ajouter au {SLOT_NAMES[slot].toLowerCase()}
          </button>
          <button className="link small" style={{ alignSelf: 'center' }} onClick={() => setStatus('camera')}>
            Scanner un autre produit
          </button>
        </div>
      )}

      {(status === 'camera' || status === 'nocam') && recent.length > 0 && (
        <section className="stack" style={{ gap: 10, marginTop: 20 }}>
          <h2 style={{ fontSize: '1rem' }}>Déjà scannés</h2>
          <div className="group">
            {recent.map((p) => (
              <button
                key={p.ean}
                className="row"
                style={{ width: '100%', border: 0, background: 'none', textAlign: 'left' }}
                onClick={() => {
                  stopRef.current?.stop();
                  setProduct(p);
                  setGrams(String(p.serving ?? 100));
                  setStatus('found');
                }}
              >
                <div className="grow">
                  <div className="title">{p.name}</div>
                  <div className="small muted">
                    {p.brand ? `${p.brand}, ` : ''}
                    {p.per100.kcal} kcal et {formatNumber(p.per100.protein, 1)} g de protéines pour 100 g
                  </div>
                </div>
                <Icon name="chevron" />
              </button>
            ))}
          </div>
        </section>
      )}
    </Sheet>
  );
}
