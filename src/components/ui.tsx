import { type ReactNode, useEffect, useState } from 'react';
import { loadPhoto } from '../lib/photos';
import { Icon } from './Icon';

let openSheets = 0;

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
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
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="grip" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
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
  useEffect(() => {
    pushToast = setMsg;
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.error ? 4500 : 2600);
    return () => clearTimeout(t);
  }, [msg]);
  if (!msg) return null;
  return (
    <div className={`toast ${msg.error ? 'error' : ''}`} role="status" key={msg.id}>
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
