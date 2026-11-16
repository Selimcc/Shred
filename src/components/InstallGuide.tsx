// « Installe Shred sur ton écran d'accueil » : les étapes exactes selon le téléphone, un bouton direct sur
// Android, et le code d'invitation qui suit l'app installée.
import { useEffect, useState } from 'react';
import { copyText } from './form';
import { Icon } from './Icon';
import { toast } from './ui';
import { dismissInstall, installInfo, onInstallChange, promptInstall } from '../lib/install';

function Dots() {
  return (
    <span className="key-glyph" aria-hidden="true">
      ⋯
    </span>
  );
}

function ShareGlyph() {
  return (
    <span className="key-glyph" aria-hidden="true">
      <Icon name="share" size={14} />
    </span>
  );
}

export function InstallGuide({ invite, compact = false, onLater }: { invite?: string; compact?: boolean; onLater?: () => void }) {
  const [info, setInfo] = useState(installInfo);
  useEffect(() => onInstallChange(() => setInfo(installInfo())), []);
  if (info.standalone || info.platform === 'other') return null;

  const later = () => {
    dismissInstall();
    onLater?.();
  };

  return (
    <section className="card install-guide stack" aria-label="Installer l’app">
      <div className="install-head">
        <span className="install-icon" aria-hidden="true">
          <img src="/icons/icon-192.png?v=pulse" alt="" />
        </span>
        <div className="grow" style={{ minWidth: 0 }}>
          <b>Installe Shred sur ton écran d’accueil</b>
          <div className="small muted">Plein écran comme une vraie app, et les rappels sur ton téléphone.</div>
        </div>
      </div>

      {info.platform === 'android' &&
        (info.canPrompt ? (
          <button className="btn primary block" onClick={() => void promptInstall().then((ok) => ok && toast('Shred est installé'))}>
            <Icon name="plus" size={18} /> Installer l’app
          </button>
        ) : (
          <ol className="install-steps">
            <li>
              Dans Chrome, touche le menu <span className="key-glyph">⋮</span> en haut à droite.
            </li>
            <li>
              Choisis <b>Installer l’application</b> (ou « Ajouter à l’écran d’accueil »).
            </li>
            <li>Ouvre Shred depuis sa nouvelle icône.</li>
          </ol>
        ))}

      {info.platform !== 'android' && (
        <ol className="install-steps">
          <li>
            {info.platform === 'ios-safari' ? (
              <>
                Touche <Dots /> en bas à droite de Safari, puis <b>Partager</b> <ShareGlyph />. Sur un iPhone plus ancien, touche directement <ShareGlyph />{' '}
                en bas de l’écran.
              </>
            ) : (
              <>
                Touche <b>Partager</b> <ShareGlyph /> dans la barre de ton navigateur. Si tu ne le trouves pas, ouvre ce lien dans Safari.
              </>
            )}
          </li>
          <li>
            Fais défiler et choisis <b>Sur l’écran d’accueil</b>.
          </li>
          <li>
            Laisse <b>Ouvrir comme app web</b> activé, touche <b>Ajouter</b>, puis ouvre Shred depuis l’icône.
          </li>
        </ol>
      )}

      {invite && (
        <div className="install-code">
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="small muted">Ton code d’invitation, déjà rempli dans l’app installée</div>
            <b className="num">{invite}</b>
          </div>
          <button className="btn small" onClick={async () => (await copyText(invite)) && toast('Code copié')}>
            Copier
          </button>
        </div>
      )}

      {!compact && (
        <button className="link small" style={{ alignSelf: 'center' }} onClick={later}>
          Plus tard, continuer dans le navigateur
        </button>
      )}
      {compact && (
        <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={later}>
          Plus tard
        </button>
      )}
    </section>
  );
}
