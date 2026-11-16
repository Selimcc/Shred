// Démo publique : rien ne part vers le serveur. Les photos, les profils et le club sont réservés
// à la vraie app, sur invitation ; au bout de quelques minutes, la démo propose d'en demander une.
import { useEffect, useState } from 'react';
import { Sheet } from './ui';

const INVITE_URL = `mailto:selimjabnoun039@gmail.com?subject=${encodeURIComponent('Invitation Shred')}&body=${encodeURIComponent(
  'Salut Selim, j’ai testé la démo de Shred et j’aimerais une invitation pour la vraie app.',
)}`;
const AFTER_MS = 3 * 60_000;
const SEEN = 'shred-demo-invite-seen';

let show: (reason: string) => void = () => {};

/** Ouvre l'invitation ; `reason` dit ce qui n'est pas disponible dans la démo. */
export function demoInvite(reason = '') {
  show(reason);
}

export function DemoInviteHost() {
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    show = setReason;
    // Toutes les photos (repas, corps, profil, import) passent par un <input type="file"> : on bloque l'ouverture.
    const onClick = (e: MouseEvent) => {
      const t = e.target;
      if (t instanceof HTMLInputElement && t.type === 'file') {
        e.preventDefault();
        e.stopPropagation();
        setReason('Les photos ne sont pas disponibles dans la démo.');
      }
    };
    document.addEventListener('click', onClick, true);
    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN) === '1';
    } catch {
      // Stockage indisponible : l'invitation reviendra à la prochaine visite, rien de grave.
    }
    const timer = seen ? undefined : window.setTimeout(() => setReason(''), AFTER_MS);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.clearTimeout(timer);
    };
  }, []);

  if (reason === null) return null;
  const close = () => {
    try {
      sessionStorage.setItem(SEEN, '1');
    } catch {
      // Voir plus haut.
    }
    setReason(null);
  };
  return (
    <Sheet title="Envie de l’utiliser pour de vrai ?" onClose={close}>
      <div className="stack">
        {reason && <p className="title">{reason}</p>}
        <p>Ici, c’est une démo avec des données d’exemple : rien n’est enregistré ni envoyé à un serveur.</p>
        <p className="muted">
          La vraie app garde ta série, tes séances et tes repas, t’envoie des rappels, et son coach connaît ton programme. Elle est privée, sur
          invitation.
        </p>
        <a className="btn primary" href={INVITE_URL}>
          Demander une invitation
        </a>
        <button className="btn" onClick={close}>
          Continuer la démo
        </button>
      </div>
    </Sheet>
  );
}
