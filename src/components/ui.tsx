import { createPortal } from 'react-dom';
import { type CSSProperties, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { leave, leaveInPlace } from '../lib/leave';
import { holdOverlay } from '../lib/motion';
import { loadPhoto } from '../lib/photos';
import { Icon } from './Icon';

/**
 * Clavier ouvert sur iPhone : la partie visible de l'écran rétrécit, mais les éléments « fixed » restent
 * calés sur tout l'écran, et le clavier recouvre le bas de la feuille. On suit la zone visible pour que la
 * feuille reste au-dessus du clavier.
 */
function useKeyboardView(): { top: number; height: number } | null {
  const [view, setView] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const open = window.innerHeight - vv.height > 120;
      setView(open ? { top: Math.round(vv.offsetTop), height: Math.round(vv.height) } : null);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return view;
}

/** Bloque le défilement de la page derrière une feuille ou un plein écran (compteur partagé avec les feuilles). */
export function useScrollLock() {
  useEffect(() => holdOverlay(), []);
}

/** Un élément entre le doigt et la feuille fait défiler son contenu : le geste est pour lui, pas pour la feuille. */
function scrolledBetween(target: Element | null, sheet: HTMLElement): boolean {
  for (let n = target; n && n !== sheet.parentElement; n = n.parentElement) {
    if (n instanceof HTMLElement && n.scrollTop > 0) return true;
  }
  return false;
}

/**
 * Glisser la feuille vers le bas pour la fermer, comme sur iPhone : depuis la poignée, le titre, ou le contenu
 * quand il est tout en haut. Lâchée assez bas (ou d'un geste vif), elle part ; sinon elle remonte en ressort.
 * Les gestes de côté (carrousels, curseurs) et le défilement normal ne sont pas touchés.
 */
function useSheetDrag(sheetRef: RefObject<HTMLDivElement | null>, rootRef: RefObject<HTMLDivElement | null>, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const sheet = sheetRef.current;
    const root = rootRef.current;
    if (!sheet || !root) return;
    let start: { x: number; y: number } | null = null;
    let owned = false;
    let dy = 0;
    let lastY = 0;
    let lastT = 0;
    let speed = 0;
    const reset = () => {
      sheet.classList.remove('dragging');
      sheet.style.transform = '';
      root.style.removeProperty('--sheet-fade');
    };
    const onStart = (e: TouchEvent) => {
      start = null;
      owned = false;
      if (e.touches.length !== 1) return;
      const target = e.target as Element;
      // Pas depuis un champ (sélection de texte, curseur) ni un curseur de réglage.
      if (target.closest('input, textarea, select, [contenteditable="true"], [data-no-drag]') || scrolledBetween(target, sheet)) return;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY };
      dy = 0;
      speed = 0;
      lastY = t.clientY;
      lastT = e.timeStamp;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      const mx = t.clientX - start.x;
      const my = t.clientY - start.y;
      if (!owned) {
        if (Math.abs(mx) < 7 && Math.abs(my) < 7) return;
        // Vers le haut ou de côté : ce n'est pas pour la feuille.
        if (my <= 0 || Math.abs(mx) > Math.abs(my)) {
          start = null;
          return;
        }
        owned = true;
        sheet.classList.add('dragging');
      }
      if (e.cancelable) e.preventDefault();
      dy = Math.max(0, my);
      const dt = Math.max(1, e.timeStamp - lastT);
      speed = 0.7 * speed + 0.3 * ((t.clientY - lastY) / dt);
      lastY = t.clientY;
      lastT = e.timeStamp;
      sheet.style.transform = `translate3d(0, ${dy}px, 0)`;
      root.style.setProperty('--sheet-fade', Math.max(0, 1 - dy / Math.max(240, sheet.offsetHeight)).toFixed(3));
    };
    const onEnd = () => {
      if (!start || !owned) {
        start = null;
        return;
      }
      start = null;
      owned = false;
      sheet.classList.remove('dragging');
      if (dy > Math.min(150, sheet.offsetHeight * 0.3) || (speed > 0.6 && dy > 24)) {
        // La copie qui s'en va part de là où le doigt l'a laissée.
        closeRef.current();
      } else {
        reset();
      }
    };
    sheet.addEventListener('touchstart', onStart, { passive: true });
    sheet.addEventListener('touchmove', onMove, { passive: false });
    sheet.addEventListener('touchend', onEnd);
    sheet.addEventListener('touchcancel', onEnd);
    return () => {
      sheet.removeEventListener('touchstart', onStart);
      sheet.removeEventListener('touchmove', onMove);
      sheet.removeEventListener('touchend', onEnd);
      sheet.removeEventListener('touchcancel', onEnd);
    };
  }, [sheetRef, rootRef]);
}

/** `footer` : barre fixée en bas de la feuille (champ de commentaire…), hors de la zone qui défile. */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useScrollLock();
  const view = useKeyboardView();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const scroll = useRef(0);
  useSheetDrag(panel, root, onClose);
  // En partant, la feuille glisse vers le bas et le fond s'efface (même si c'est le programme qui la ferme).
  useLayoutEffect(() => {
    const el = root.current;
    return () => leave(el, 'sheet-out', 300, [{ selector: footer ? '.sheet-scroll' : '.sheet', top: scroll.current }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Rendue à la racine du document : une carte animée (transformée) plus haut ne peut pas l'enfermer sous la
  // barre d'onglets ni la décaler.
  return createPortal(
    <div ref={root} className="sheet-backdrop" onClick={onClose} style={view ? { top: view.top, height: view.height, bottom: 'auto', '--sheet-max': `${view.height - 12}px` } as CSSProperties : undefined}>
      <div
        ref={panel}
        className={`sheet${footer ? ' has-foot' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onScroll={footer ? undefined : (e) => (scroll.current = e.currentTarget.scrollTop)}
      >
        <div className="grip" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <Icon name="x" />
          </button>
        </div>
        {footer ? (
          <>
            <div className="sheet-scroll" onScroll={(e) => (scroll.current = e.currentTarget.scrollTop)}>
              {children}
            </div>
            <div className="sheet-foot">{footer}</div>
          </>
        ) : (
          children
        )}
      </div>
    </div>,
    document.body,
  );
}

export function Bar({ value, max, tone }: { value: number; max: number; tone?: 'yellow' | 'green' | 'red' | 'blue' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={`bar ${tone ?? ''}`} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemax={max}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Check({
  on,
  onClick,
  label,
  tone,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  tone?: 'blue' | 'yellow';
}) {
  return (
    <button
      className={`check ${on ? 'on' : ''} ${tone ?? ''}`}
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
    >
      <Icon name="check" size={18} />
    </button>
  );
}

export function PhotoThumb({ id, size = 48 }: { id: string; size?: number }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let revoked = false;
    let objectUrl: string | undefined;
    loadPhoto(id)
      .then((blob) => {
        if (blob && !revoked) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      })
      .catch(() => undefined);
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        flex: 'none',
        background: url ? `center / cover url(${url})` : 'var(--surface-2)',
      }}
    />
  );
}

/* ---------- Toasts ---------- */

type ToastMsg = { text: string; error?: boolean; id: number };
let pushToast: (t: ToastMsg) => void = () => undefined;

export function toast(text: string, error = false) {
  pushToast({ text, error, id: Date.now() });
}

export function ToastHost() {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    pushToast = setMsg;
  }, []);
  // Le toast qui s'en va glisse et s'efface au lieu de disparaître d'un coup.
  useLayoutEffect(() => {
    const node = el.current;
    return () => leaveInPlace(node, 'toast-out');
  }, [msg?.id]);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.error ? 4500 : 2600);
    return () => clearTimeout(t);
  }, [msg]);
  if (!msg) return null;
  return (
    <div ref={el} className={`toast ${msg.error ? 'error' : ''}`} role="status" key={msg.id}>
      {msg.text}
    </div>
  );
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : 'Une erreur est survenue';
}

/* ---------- Confirmation dans la page (pas de window.confirm) ---------- */

type Choice = { label: string; tone?: 'primary' | 'danger' };
type Ask = { title: string; message: string; choices: Choice[]; resolve: (i: number | null) => void };
let pushAsk: (a: Ask) => void = (a) => a.resolve(null);

/** Question à plusieurs réponses ; null si la feuille est fermée sans choisir. */
export function choose(message: string, choices: Choice[], title = 'Confirmer'): Promise<number | null> {
  return new Promise((resolve) => pushAsk({ title, message, choices, resolve }));
}

export async function ask(message: string, confirm: string, danger = false): Promise<boolean> {
  return (await choose(message, [{ label: 'Annuler' }, { label: confirm, tone: danger ? 'danger' : 'primary' }])) === 1;
}

export function AskHost() {
  const [a, setA] = useState<Ask | null>(null);
  useEffect(() => {
    pushAsk = setA;
  }, []);
  if (!a) return null;
  const close = (i: number | null) => {
    a.resolve(i);
    setA(null);
  };
  const stacked = a.choices.some((c) => c.label.length > 14);
  return (
    <Sheet title={a.title} onClose={() => close(null)}>
      <p style={{ marginTop: 0 }}>{a.message}</p>
      <div style={{ display: 'flex', flexDirection: stacked ? 'column-reverse' : 'row', gap: 10 }}>
        {a.choices.map((c, i) => (
          <button key={c.label} className={`btn ${c.tone ?? ''}`} style={{ flex: 1 }} onClick={() => close(i)}>
            {c.label}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
