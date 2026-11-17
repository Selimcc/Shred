import { createPortal } from 'react-dom';
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { leave, leaveInPlace } from '../lib/leave';
import { loadPhoto } from '../lib/photos';
import { Icon } from './Icon';

let openSheets = 0;

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
  useEffect(() => {
    openSheets += 1;
    document.body.style.overflow = 'hidden';
    return () => {
      openSheets -= 1;
      if (openSheets === 0) document.body.style.overflow = '';
    };
  }, []);
}

/** `footer` : barre fixée en bas de la feuille (champ de commentaire…), hors de la zone qui défile. */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    openSheets += 1;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      openSheets -= 1;
      if (openSheets === 0) document.body.style.overflow = '';
    };
  }, [onClose]);
  const view = useKeyboardView();
  const root = useRef<HTMLDivElement>(null);
  const scroll = useRef(0);
  // En partant, la feuille glisse vers le bas et le fond s'efface (même si c'est le programme qui la ferme).
  useLayoutEffect(() => {
    const el = root.current;
    return () => leave(el, 'sheet-out', 220, [{ selector: footer ? '.sheet-scroll' : '.sheet', top: scroll.current }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Rendue à la racine du document : une carte animée (transformée) plus haut ne peut pas l'enfermer sous la
  // barre d'onglets ni la décaler.
  return createPortal(
    <div ref={root} className="sheet-backdrop" onClick={onClose} style={view ? { top: view.top, height: view.height, bottom: 'auto', '--sheet-max': `${view.height - 12}px` } as CSSProperties : undefined}>
      <div
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
