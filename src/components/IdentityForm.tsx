// Prénom, @pseudo, surnom et bio : ce que les autres membres voient de toi.
// Le pseudo est vérifié pendant la saisie (règles sur le téléphone, disponibilité sur le serveur), avec des
// propositions libres quand il est pris.
import { useEffect, useRef, useState } from 'react';
import { BIO_MAX, handleProblem, NICK_MAX, normHandle } from '../../shared/handle';
import { checkHandle, getIdentity, type HandleCheck, type Identity, saveIdentity } from '../lib/identity';
import { copyText, Field } from './form';
import { Icon } from './Icon';
import { errorText, toast } from './ui';

type Status = {
  kind: 'idle' | 'checking' | 'ok' | 'mine' | 'bad';
  text?: string;
  suggestions?: string[];
};

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

export function profileLink(handle: string) {
  return `${location.origin}/?member=${encodeURIComponent(handle)}`;
}

export function IdentityForm({ onSaved }: { onSaved?: (i: Identity) => void }) {
  const [id, setId] = useState<Identity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [nick, setNick] = useState('');
  const [bio, setBio] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const load = () => {
    setError(null);
    getIdentity().then(
      (i) => {
        setId(i);
        setName(i.name);
        setHandle(i.handle);
        setNick(i.nick);
        setBio(i.bio);
        setStatus({ kind: 'mine' });
      },
      (e) => setError(errorText(e)),
    );
  };
  useEffect(load, []);

  // Vérification du pseudo : règles tout de suite, disponibilité après une courte pause dans la frappe.
  useEffect(() => {
    if (!id) return;
    const h = normHandle(handle);
    if (h === id.handle) return setStatus({ kind: 'mine' });
    const problem = handleProblem(h);
    if (problem) return setStatus({ kind: 'bad', text: problem });
    setStatus({ kind: 'checking' });
    const n = ++seq.current;
    const t = setTimeout(() => {
      checkHandle(h).then(
        (r: HandleCheck) => {
          if (n !== seq.current) return;
          setStatus(r.ok ? { kind: r.mine ? 'mine' : 'ok' } : { kind: 'bad', text: r.reason, suggestions: r.suggestions });
        },
        (e) => n === seq.current && setStatus({ kind: 'bad', text: errorText(e) }),
      );
    }, 450);
    return () => clearTimeout(t);
  }, [handle, id]);

  if (error) {
    return (
      <div className="stack" style={{ gap: 8 }}>
        <p className="small muted" style={{ margin: 0 }}>
          {error}
        </p>
        <button className="btn block" onClick={load}>
          Réessayer
        </button>
      </div>
    );
  }
  if (!id) return <div className="spinner" />;

  const h = normHandle(handle);
  const handleChanged = h !== id.handle;
  const locked = id.handleChangesLeft === 0;
  const dirty = name.trim() !== id.name || handleChanged || nick.trim() !== id.nick || bio.trim() !== id.bio;
  const valid = name.trim().length > 0 && (!handleChanged || status.kind === 'ok');

  const save = async () => {
    setBusy(true);
    try {
      const next = await saveIdentity({
        name: name.trim(),
        nick: nick.trim(),
        bio: bio.trim(),
        ...(handleChanged ? { handle: h } : {}),
      });
      setId(next);
      setHandle(next.handle);
      onSaved?.(next);
      toast(handleChanged ? `Tu es maintenant @${next.handle}` : 'Profil enregistré');
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(false);
    }
  };

  const bioLeft = BIO_MAX - [...bio].length;

  return (
    <div className="stack" style={{ gap: 14 }}>
      <Field label="Prénom">
        <input className="input" value={name} maxLength={30} placeholder="Ton prénom" onChange={(e) => setName(e.target.value)} />
      </Field>

      <Field label="Nom d’utilisateur">
        <div className={`handle-input ${status.kind}`}>
          <span aria-hidden="true">@</span>
          <input
            className="input"
            value={handle}
            maxLength={24}
            disabled={locked}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby="handle-status"
            onChange={(e) => setHandle(e.target.value.replace(/\s/g, '').toLowerCase())}
          />
          {status.kind === 'checking' && <span className="handle-spin" />}
          {(status.kind === 'ok' || status.kind === 'mine') && handleChanged && <Icon name="check" size={18} />}
        </div>
      </Field>
      <div id="handle-status" className="handle-status small" aria-live="polite">
        {status.kind === 'ok' && <span className="ok">@{h} est libre</span>}
        {status.kind === 'checking' && <span className="muted">Vérification…</span>}
        {status.kind === 'bad' && <span className="bad">{status.text}</span>}
        {status.kind === 'mine' && (
          <span className="muted">
            {locked && id.nextHandleChange
              ? `Pseudo changé deux fois ces 14 jours : prochain changement le ${dateFr(id.nextHandleChange)}.`
              : `Unique dans le club. ${id.handleChangesLeft === 1 ? 'Encore 1 changement possible' : '2 changements possibles'} sur 14 jours.`}
          </span>
        )}
      </div>
      {status.kind === 'bad' && status.suggestions && status.suggestions.length > 0 && (
        <div className="chips" aria-label="Pseudos libres">
          {status.suggestions.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => setHandle(s)}>
              @{s}
            </button>
          ))}
        </div>
      )}

      <Field label="Surnom (facultatif)" hint="Affiché sous ton prénom, comme « La fusée » ou « Coach du dimanche ».">
        <input className="input" value={nick} maxLength={NICK_MAX} placeholder="Ton surnom au club" onChange={(e) => setNick(e.target.value)} />
      </Field>

      <Field label="Bio (facultatif)">
        <textarea
          className="input"
          rows={3}
          style={{ resize: 'vertical' }}
          value={bio}
          placeholder="Ton sport, ton objectif, ta salle…"
          onChange={(e) => setBio([...e.target.value].slice(0, BIO_MAX).join(''))}
        />
      </Field>
      <div className={`small ${bioLeft < 20 ? '' : 'faint'}`} style={{ marginTop: -8, textAlign: 'right' }}>
        {bioLeft} caractère{bioLeft > 1 ? 's' : ''} restant
        {bioLeft > 1 ? 's' : ''}
      </div>

      <button className="btn primary block" disabled={!dirty || !valid || busy} onClick={save}>
        {busy ? 'Enregistrement…' : 'Enregistrer'}
      </button>
      <button
        className="btn block"
        type="button"
        onClick={async () => {
          if (await copyText(profileLink(id.handle))) toast('Lien de ton profil copié');
        }}
      >
        <Icon name="share" size={17} /> Copier le lien de mon profil
      </button>
    </div>
  );
}
