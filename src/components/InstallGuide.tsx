// « Installe Shred sur ton écran d'accueil » : les étapes exactes selon le téléphone, un bouton direct sur
// Android, et le code d'invitation qui suit l'app installée.
import { useEffect, useState } from 'react';
import { copyText } from './form';
import { Icon } from './Icon';
import { toast } from './ui';
import { dismissInstall, installInfo, onInstallChange, promptInstall } from '../lib/install';
import { tr } from '../../shared/i18n';

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
    <section className="card install-guide stack" aria-label={tr('Installer l’app')}>
      <div className="install-head">
        <span className="install-icon" aria-hidden="true">
          <img src="/icons/icon-192.png?v=pulse" alt="" />
        </span>
        <div className="grow" style={{ minWidth: 0 }}>
          <b>{tr('Installe Shred sur ton écran d’accueil')}</b>
          <div className="small muted">{tr('Plein écran comme une vraie app, et les rappels sur ton téléphone.')}</div>
        </div>
      </div>

      {info.platform === 'android' &&
        (info.canPrompt ? (
          <button className="btn primary block" onClick={() => void promptInstall().then((ok) => ok && toast(tr('Shred est installé')))}>
            <Icon name="plus" size={18} />{' '}{tr('Installer l’app')}
          </button>
        ) : (
          <ol className="install-steps">
            <li>
              {tr('Dans Chrome, touche le menu')}{' '}<span className="key-glyph">⋮</span>{' '}{tr('en haut à droite.')}
            </li>
            <li>
              {tr('Choisis')}{' '}<b>{tr('Installer l’application')}</b>{' '}{tr('(ou « Ajouter à l’écran d’accueil »).')}
            </li>
            <li>{tr('Ouvre Shred depuis sa nouvelle icône.')}</li>
          </ol>
        ))}

      {info.platform !== 'android' && (
        <ol className="install-steps">
          <li>
            {info.platform === 'ios-safari' ? (
              <>
                {tr('Touche')}{' '}<Dots />{' '}{tr('en bas à droite de Safari, puis')}{' '}<b>{tr('Partager')}</b> <ShareGlyph />{tr('. Sur un iPhone plus ancien, touche directement')}{' '}<ShareGlyph />{' '}{tr('en bas de l’écran.')}
              </>
            ) : (
              <>
                {tr('Touche')}{' '}<b>{tr('Partager')}</b> <ShareGlyph />{' '}{tr('dans la barre de ton navigateur. Si tu ne le trouves pas, ouvre ce lien dans Safari.')}
              </>
            )}
          </li>
          <li>
            {tr('Fais défiler et choisis')}{' '}<b>{tr('Sur l’écran d’accueil')}</b>.
          </li>
          <li>
            {tr('Laisse')}{' '}<b>{tr('Ouvrir comme app web')}</b>{' '}{tr('activé, touche')}{' '}<b>{tr('Ajouter')}</b>{tr(', puis ouvre Shred depuis l’icône.')}
          </li>
        </ol>
      )}

      {invite && (
        <div className="install-code">
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="small muted">{tr('Ton code d’invitation, déjà rempli dans l’app installée')}</div>
            <b className="num">{invite}</b>
          </div>
          <button className="btn small" onClick={async () => (await copyText(invite)) && toast(tr('Code copié'))}>
            {tr('Copier')}
          </button>
        </div>
      )}

      {!compact && (
        <button className="link small" style={{ alignSelf: 'center' }} onClick={later}>
          {tr('Plus tard, continuer dans le navigateur')}
        </button>
      )}
      {compact && (
        <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={later}>
          {tr('Plus tard')}
        </button>
      )}
    </section>
  );
}
