import { type ReactNode, useState } from 'react';
import { parseDecimal } from '../lib/actions';
import { Icon } from './Icon';
import { toast } from './ui';
import { tr } from '../../shared/i18n';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="faint">{hint}</small>}
    </label>
  );
}

export function Toggle({ title, text, on, onChange }: { title: string; text: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="row" style={{ cursor: 'pointer' }}>
      <div className="grow">
        <div className="title">{title}</div>
        <div className="small muted">{text}</div>
      </div>
      <input type="checkbox" className="switch" checked={on} onChange={(e) => onChange(e.target.checked)} aria-label={title} />
    </label>
  );
}

export function NumberSetting({ value, onChange, label }: { value?: number; onChange: (v: number | undefined) => void; label?: string }) {
  const [text, setText] = useState(value?.toString() ?? '');
  return (
    <input
      className="input num"
      inputMode="decimal"
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onChange(parseDecimal(text))}
    />
  );
}

export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    toast(tr('Copie impossible : sélectionne le texte à la main'), true);
    return false;
  }
}

export function CopyRow({ label, value, display }: { label: string; value: string; display?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyText(value)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <div className="row" style={{ minHeight: 56 }}>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="small muted">{label}</div>
        <div className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'all' }}>
          {display ?? value}
        </div>
      </div>
      <button className="btn small" onClick={copy}>
        {copied ? tr('Copié') : tr('Copier')}
      </button>
    </div>
  );
}

/** Carte à choix unique (mode IA, objectif, programme). */
export function ChoiceCard({
  on,
  title,
  text,
  onClick,
  disabled,
  badge,
}: {
  on: boolean;
  title: string;
  text: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <button
      type="button"
      className="card"
      disabled={disabled}
      style={{
        border: `2px solid ${on ? 'var(--blue)' : 'transparent'}`,
        textAlign: 'left',
        color: 'inherit',
        display: 'flex',
        gap: 12,
        width: '100%',
        opacity: disabled ? 0.5 : 1,
      }}
      onClick={onClick}
      aria-pressed={on}
    >
      <span className={`check ${on ? 'on blue' : ''}`} aria-hidden style={{ width: 28, height: 28 }}>
        <Icon name="check" size={15} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 850 }}>
          {title}
          {badge && <span className="tag blue">{badge}</span>}
        </span>
        <span className="small muted" style={{ display: 'block' }}>
          {text}
        </span>
      </span>
    </button>
  );
}

/** Champ mot de passe avec bouton Afficher. */
export function PasswordInput({
  value,
  onChange,
  autoComplete,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: 'current-password' | 'new-password';
  label: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        className="input"
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ paddingRight: 84 }}
      />
      <button
        type="button"
        className="link small"
        style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}
        onClick={() => setShow(!show)}
      >
        {show ? tr('Masquer') : tr('Afficher')}
      </button>
    </div>
  );
}
