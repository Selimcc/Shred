// Recadrer une photo de profil : on la fait glisser au doigt, on zoome (curseur ou pincement), le cercle
// montre ce qui sera gardé. Sortie : un carré de 400 px en JPEG.
import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { Sheet } from './ui';

const VIEW = 280;
const OUT = 400;

export function AvatarCrop({ file, onCancel, onDone }: { file: File; onCancel: () => void; onDone: (dataUrl: string) => void | Promise<void> }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ x: number; y: number; px: number; py: number; d: number; z: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => setImg(im);
    im.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Taille de l'image à zoom 1 : elle couvre juste le cercle.
  const base = img ? VIEW / Math.min(img.naturalWidth, img.naturalHeight) : 1;
  const w = img ? img.naturalWidth * base * zoom : VIEW;
  const h = img ? img.naturalHeight * base * zoom : VIEW;
  /** On ne laisse jamais de vide dans le cercle. */
  const clamp = (p: { x: number; y: number }, z = zoom) => {
    const mx = img ? Math.max(0, (img.naturalWidth * base * z - VIEW) / 2) : 0;
    const my = img ? Math.max(0, (img.naturalHeight * base * z - VIEW) / 2) : 0;
    return { x: Math.max(-mx, Math.min(mx, p.x)), y: Math.max(-my, Math.min(my, p.y)) };
  };
  const setZoomClamped = (z: number) => {
    const v = Math.max(1, Math.min(4, z));
    setZoom(v);
    setPos((p) => clamp(p, v));
  };

  const dist = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const down = (e: PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    start.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y, d: dist(), z: zoom };
  };
  const move = (e: PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !start.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && start.current.d) {
      setZoomClamped(start.current.z * (dist() / start.current.d));
    } else if (pointers.current.size === 1) {
      setPos(clamp({ x: start.current.px + e.clientX - start.current.x, y: start.current.py + e.clientY - start.current.y }));
    }
  };
  const up = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    start.current = pointers.current.size ? { ...start.current!, x: [...pointers.current.values()][0].x, y: [...pointers.current.values()][0].y, px: pos.x, py: pos.y, d: dist(), z: zoom } : null;
  };

  const save = async () => {
    if (!img) return;
    const c = document.createElement('canvas');
    c.width = c.height = OUT;
    const ctx = c.getContext('2d')!;
    // Ce qui est dans le cercle, en pixels de l'image d'origine.
    const scale = base * zoom;
    const size = VIEW / scale;
    const sx = img.naturalWidth / 2 - (VIEW / 2 + pos.x) / scale;
    const sy = img.naturalHeight / 2 - (VIEW / 2 + pos.y) / scale;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, size, size, 0, 0, OUT, OUT);
    setBusy(true);
    try {
      await onDone(c.toDataURL('image/jpeg', 0.86));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Recadrer ta photo" onClose={onCancel}>
      <div className="stack" style={{ gap: 16, alignItems: 'center' }}>
        <div className="crop-view" style={{ width: VIEW, height: VIEW }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          {img ? (
            <img src={img.src} alt="" draggable={false} style={{ width: w, height: h, transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))` }} />
          ) : (
            <div className="spinner" />
          )}
          <span className="crop-mask" aria-hidden="true" />
        </div>
        <label className="crop-zoom">
          <span className="small muted">Zoom</span>
          <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoomClamped(Number(e.target.value))} aria-label="Zoom" />
        </label>
        <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>
          Fais glisser la photo, pince pour zoomer.
        </p>
        <button className="btn primary block" disabled={!img || busy} onClick={save}>
          {busy ? 'Envoi…' : 'Utiliser cette photo'}
        </button>
      </div>
    </Sheet>
  );
}
