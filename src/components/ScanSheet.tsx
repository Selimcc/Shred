// Scanner un code-barres : la caméra lit l'EAN, Open Food Facts donne les valeurs pour 100 g,
// tu choisis la quantité et le repas. Les produits déjà scannés restent à portée de main.
import { type TouchEvent, useEffect, useRef, useState } from 'react';
import { addMeal } from '../lib/actions';
import { codeVariants, confirmer, offImage, offText, scanRegion, sharpenBars, validBarcode } from '../lib/barcode';
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
  const variants = codeVariants(ean);
  const cached = readCache().find((p) => variants.includes(p.ean));
  if (cached) return cached;
  // Un UPC à 12 chiffres est souvent rangé avec un 0 devant chez Open Food Facts (et inversement).
  for (const code of variants) {
    const p = await fetchProduct(code);
    if (p) return p;
  }
  return null;
}

const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));

async function fetchProduct(ean: string): Promise<Product | null> {
  const fields = 'product_name,product_name_fr,brands,nutriments,serving_quantity,image_front_small_url';
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(ean)}.json?fields=${fields}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Open Food Facts ${res.status}`);
  const data = (await res.json()) as { status?: number; product?: Record<string, unknown> };
  const p = data.product;
  if (!p || data.status === 0) return null;
  const n = (p.nutriments ?? {}) as Record<string, unknown>;
  const kcal = num(n['energy-kcal_100g']) || Math.round(num(n['energy_100g']) / 4.184);
  const product: Product = {
    ean,
    name: offText(p.product_name_fr || p.product_name, 80) || 'Produit sans nom',
    brand: p.brands ? offText(String(p.brands).split(',')[0], 40) || undefined : undefined,
    image: offImage(p.image_front_small_url),
    per100: {
      kcal: clamp(Math.round(kcal), 950),
      protein: clamp(num(n.proteins_100g), 100),
      carbs: clamp(num(n.carbohydrates_100g), 100),
      fat: clamp(num(n.fat_100g), 100),
    },
    serving: clamp(num(p.serving_quantity), 5000) || undefined,
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

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type Track = MediaStreamTrack;
type Caps = MediaTrackCapabilities & { zoom?: { min: number; max: number; step?: number }; torch?: boolean };

const ZOOMS = [1, 2, 3];

/** Ouvre la caméra arrière en haute définition, mise au point continue quand le téléphone le permet. */
async function openCamera(): Promise<MediaStream> {
  const base = { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } };
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { ...base, advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] },
      audio: false,
    });
  } catch {
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  }
}

/**
 * La caméra et la lecture. Le zoom passe par l'objectif quand le téléphone l'expose (Android), sinon il
 * agrandit l'image et ne décode que le centre : on peut tenir le téléphone à 20 cm, là où la mise au point
 * est nette, et le code-barres reste assez grand pour être lu. Un code n'est accepté qu'après deux lectures
 * identiques avec une clé de contrôle juste.
 */
function ScanCamera({ onCode, onFail }: { onCode: (code: string) => void; onFail: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const track = useRef<Track | null>(null);
  const zoomRef = useRef(1);
  const hw = useRef<{ min: number; max: number } | null>(null);
  const [zoom, setZoomState] = useState(1);
  const [torch, setTorch] = useState<boolean | null>(null);
  const [slow, setSlow] = useState(false);
  const pinch = useRef<{ d: number; z: number } | null>(null);

  const setZoom = (z: number) => {
    const v = Math.min(4, Math.max(1, Math.round(z * 10) / 10));
    zoomRef.current = v;
    setZoomState(v);
    const t = track.current;
    if (t && hw.current) {
      const target = Math.min(hw.current.max, Math.max(hw.current.min, hw.current.min * v));
      void t.applyConstraints({ advanced: [{ zoom: target } as MediaTrackConstraintSet] }).catch(() => undefined);
    }
  };

  useEffect(() => {
    let alive = true;
    let stream: MediaStream | null = null;
    const slowTimer = setTimeout(() => alive && setSlow(true), 7000);
    (async () => {
      try {
        const el = video.current;
        if (!el || !navigator.mediaDevices?.getUserMedia) throw new Error('nocam');
        stream = await openCamera();
        if (!alive) return stream.getTracks().forEach((t) => t.stop());
        el.srcObject = stream;
        await el.play();
        const t = stream.getVideoTracks()[0] as Track;
        track.current = t;
        const caps = t.getCapabilities?.() as Caps | undefined;
        if (caps?.zoom && caps.zoom.max > caps.zoom.min) hw.current = { min: caps.zoom.min, max: caps.zoom.max };
        if (caps?.torch) setTorch(false);

        // Détecteur du système quand il existe (Android, Chrome), sinon ZXing (iPhone).
        const Native = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
        let decode: (c: HTMLCanvasElement) => Promise<string | null>;
        if (Native) {
          const det = new Native({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
          decode = async (c) => (await det.detect(c).catch(() => []))[0]?.rawValue ?? null;
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          const { BarcodeFormat, DecodeHintType } = await import('@zxing/library');
          const hints = new Map();
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]);
          hints.set(DecodeHintType.TRY_HARDER, true);
          const reader = new BrowserMultiFormatReader(hints);
          decode = async (c) => {
            try {
              return reader.decodeFromCanvas(c).getText();
            } catch {
              return null;
            }
          };
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const ok = confirmer();
        let pass = 0;
        let hold = false;
        const tick = async () => {
          if (!alive) return;
          const v = video.current;
          const b = box.current;
          if (v && b && ctx && v.videoWidth) {
            // Zoom de l'objectif : l'image est déjà agrandie, on décode le cadre tel quel.
            const r = scanRegion({ w: v.videoWidth, h: v.videoHeight }, { w: b.clientWidth, h: b.clientHeight }, hw.current ? 1 : zoomRef.current);
            // On alterne trois lectures de la même zone : telle quelle, agrandie quand elle est petite (zoom)
            // pour mieux séparer les barres, et rendue plus nette pour une image un peu floue.
            // Une lecture à confirmer garde la même méthode pour l'image suivante.
            if (!hold) pass = (pass + 1) % 3;
            const scale = pass === 1 && r.w < 700 ? 1000 / r.w : Math.min(1, 1100 / r.w);
            canvas.width = Math.round(r.w * scale);
            canvas.height = Math.round(r.h * scale);
            ctx.drawImage(v, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
            if (pass === 2) {
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              sharpenBars(img.data, canvas.width, canvas.height);
              ctx.putImageData(img, 0, 0);
            }
            const code = await decode(canvas);
            if (code && ok(code)) {
              alive = false;
              return onCode(code);
            }
            hold = Boolean(code && validBarcode(code));
          }
          setTimeout(tick, hold ? 30 : 70);
        };
        void tick();
      } catch {
        if (alive) onFail();
      }
    })();
    return () => {
      alive = false;
      clearTimeout(slowTimer);
      stream?.getTracks().forEach((t) => t.stop());
      track.current = null;
    };
  }, []);

  const toggleTorch = () => {
    const t = track.current;
    if (!t || torch === null) return;
    void t
      .applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] })
      .then(() => setTorch(!torch))
      .catch(() => setTorch(null));
  };

  const dist = (e: TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div
        ref={box}
        className="scan-view"
        onTouchStart={(e) => {
          if (e.touches.length === 2) pinch.current = { d: dist(e), z: zoomRef.current };
        }}
        onTouchMove={(e) => {
          if (e.touches.length === 2 && pinch.current) setZoom(pinch.current.z * (dist(e) / pinch.current.d));
        }}
        onTouchEnd={() => (pinch.current = null)}
      >
        <video ref={video} playsInline muted style={hw.current ? undefined : { transform: `scale(${zoom})` }} />
        <span className="scan-frame" aria-hidden="true" />
        <div className="scan-tools">
          <div className="scan-zoom" role="group" aria-label="Zoom">
            {ZOOMS.map((z) => (
              <button key={z} type="button" className={Math.abs(zoom - z) < 0.25 ? 'on' : ''} onClick={() => setZoom(z)} aria-pressed={Math.abs(zoom - z) < 0.25}>
                {z === 1 ? '1' : `${z}×`}
              </button>
            ))}
          </div>
          {torch !== null && (
            <button type="button" className={`scan-torch ${torch ? 'on' : ''}`} onClick={toggleTorch} aria-pressed={torch} aria-label="Lampe">
              <Icon name="bolt" size={18} />
            </button>
          )}
        </div>
      </div>
      <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>
        {slow
          ? 'Toujours rien ? Recule un peu, passe en 2× ou 3×, et garde le code bien droit dans le cadre.'
          : 'Tiens le téléphone à une vingtaine de centimètres et zoome : de trop près, l’image est floue.'}
      </p>
    </div>
  );
}

export function ScanSheet({ today, slot: initialSlot, onClose }: { today: string; slot: MealSlot; onClose: () => void }) {
  const [status, setStatus] = useState<'camera' | 'looking' | 'found' | 'missing' | 'nocam' | 'manual'>('camera');
  const [product, setProduct] = useState<Product | null>(null);
  const [grams, setGrams] = useState('100');
  const [slot, setSlot] = useState<MealSlot>(initialSlot);
  const [manual, setManual] = useState('');
  const recent = readCache().slice(0, 8);

  const found = async (ean: string) => {
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
        <>
          <ScanCamera onCode={(c) => void found(c)} onFail={() => setStatus('nocam')} />
          <button className="link small" style={{ display: 'block', margin: '12px auto 0' }} onClick={() => setStatus('manual')}>
            Taper le code à la main
          </button>
        </>
      )}

      {status === 'looking' && (
        <div className="empty">
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          Recherche du produit…
        </div>
      )}

      {(status === 'nocam' || status === 'missing' || status === 'manual') && (
        <div className="stack" style={{ gap: 12 }}>
          <p className="muted" style={{ margin: 0 }}>
            {status === 'nocam'
              ? 'La caméra n’est pas disponible. Autorise-la dans les réglages du navigateur, ou tape le code sous le code-barres.'
              : status === 'manual'
                ? 'Tape les chiffres écrits sous le code-barres (8, 12 ou 13).'
                : `Le code ${manual} est bien lu, mais ce produit n’est pas dans Open Food Facts. Note le repas à la main, ou ajoute le produit sur openfoodfacts.org.`}
          </p>
          <form
            style={{ display: 'flex', gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (validBarcode(manual)) void found(manual.trim());
            }}
          >
            <input className="input num" inputMode="numeric" placeholder="3017620422003" value={manual} onChange={(e) => setManual(e.target.value.replace(/\D/g, '').slice(0, 13))} aria-label="Code-barres" />
            <button className="btn primary" disabled={!validBarcode(manual)}>
              Chercher
            </button>
          </form>
          {[8, 12, 13].includes(manual.length) && !validBarcode(manual) && (
            <p className="small" style={{ margin: 0, color: 'var(--red)' }}>
              Ce code ne passe pas la vérification : un chiffre est sans doute mal tapé.
            </p>
          )}
          {status !== 'nocam' && (
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
              <div className="small faint num">Code {product.ean}</div>
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

      {(status === 'camera' || status === 'nocam' || status === 'manual') && recent.length > 0 && (
        <section className="stack" style={{ gap: 10, marginTop: 20 }}>
          <h2 style={{ fontSize: '1rem' }}>Déjà scannés</h2>
          <div className="group">
            {recent.map((p) => (
              <button
                key={p.ean}
                className="row"
                style={{ width: '100%', border: 0, background: 'none', textAlign: 'left' }}
                onClick={() => {
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
