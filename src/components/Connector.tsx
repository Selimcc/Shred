// Le connecteur Shred dans Claude : la carte de Réglages (comment l'ajouter, qui est connecté) et la demande
// d'accès qu'ouvre Claude quand la personne ajoute le connecteur.
import { useEffect, useState } from 'react';
import { type ConsentInfo, consentInfo, decideConsent, disconnectClient, useConnector } from '../lib/connector';
import { formatShort, dayKey } from '../lib/date';
import { ask, errorText, Sheet, toast } from './ui';
import { CopyRow } from './form';
import { Icon } from './Icon';
import { tr } from '../../shared/i18n';

const since = (ms: number) => formatShort(dayKey(new Date(ms)));

/** Réglages, IA (et le coach) : ajouter Shred dans Claude, voir et couper les accès. */
export function ConnectorCard() {
  const status = useConnector();
  const clients = status?.clients ?? [];
  const url = status?.url ?? `${location.origin}/api/mcp`;
  const cut = async (id: string, name: string) => {
    if (!(await ask(tr('{name} ne pourra plus lire tes données Shred. Tu pourras le reconnecter depuis Claude.', { name }), tr('Déconnecter'), true))) return;
    try {
      await disconnectClient(id);
      toast(tr('{name} déconnecté', { name }));
    } catch (e) {
      toast(errorText(e), true);
    }
  };
  return (
    <div className="card stack connector-card" style={{ gap: 12 }}>
      <div className="connector-head">
        <Icon name="plug" size={20} />
        <b>{clients.length ? tr('Shred est connecté à Claude') : tr('Connecte Shred à Claude')}</b>
      </div>
      {clients.length > 0 && (
        <ul className="connector-list">
          {clients.map((c) => (
            <li key={c.id}>
              <span className="grow">
                {c.name}
                <span className="small muted">{' '}{tr('· depuis le {date}', { date: since(c.since) })}</span>
              </span>
              <button className="btn small" onClick={() => cut(c.id, c.name)}>
                {tr('Déconnecter')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!clients.length && (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            {tr('Claude lit tes séances, tes records, tes repas et ton poids quand tu lui poses une question, avec ton propre abonnement (même gratuit). Lecture seule.')}
          </p>
          <ol className="connector-steps small">
            <li>{tr('Sur claude.ai ou l’app de bureau Claude : Personnaliser, Connecteurs, puis « Ajouter un connecteur personnalisé ».')}</li>
            <li>{tr('Nom : Shred. Adresse :')}</li>
          </ol>
          <CopyRow label={tr('Adresse du connecteur')} value={url} />
          <ol className="connector-steps small" start={3}>
            <li>{tr('Claude te renvoie ici : connecte-toi et autorise. Shred est ensuite dispo dans tes conversations, aussi sur mobile.')}</li>
          </ol>
        </>
      )}
      <a className="btn small" href="https://claude.ai" target="_blank" rel="noopener noreferrer" style={{ alignSelf: 'flex-start' }}>
        <Icon name="external" size={16} />{' '}{tr('Ouvrir Claude')}
      </a>
    </div>
  );
}

const READS = [tr('Tes séances, séries et records'), tr('Tes repas, calories et poids'), tr('Ton profil, ton programme et ta série')];

/** La demande d'accès : qui demande, ce qu'il pourra lire, accepter ou refuser. */
export function ConnectClaude({ handle, onClose }: { handle: string; onClose: () => void }) {
  const [info, setInfo] = useState<ConsentInfo | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<'yes' | 'no' | null>(null);

  useEffect(() => {
    consentInfo(handle).then(setInfo, (e) => setError(errorText(e)));
  }, [handle]);

  const decide = async (approve: boolean) => {
    setBusy(approve ? 'yes' : 'no');
    setError(undefined);
    try {
      const to = await decideConsent(handle, approve);
      // Retour vers l'application qui a demandé (Claude), avec le code ou le refus.
      location.assign(to);
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  };

  const name = info?.name ?? tr('Une application');
  return (
    <Sheet
      title={tr('Connecter Claude')}
      onClose={onClose}
      footer={
        info ? (
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn" style={{ flex: 1 }} disabled={busy !== null} onClick={() => decide(false)}>
              {busy === 'no' ? tr('Refus…') : tr('Refuser')}
            </button>
            <button className="btn primary" style={{ flex: 1 }} disabled={busy !== null} onClick={() => decide(true)}>
              {busy === 'yes' ? tr('Autorisation…') : tr('Autoriser')}
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="stack consent" style={{ gap: 14 }}>
        {!info && !error && <div className="spinner" style={{ alignSelf: 'center', margin: '24px 0' }} />}
        {info && (
          <>
            <div>
              <h2 className="consent-title">{tr('{name} veut lire tes données Shred', { name })}</h2>
              <p className="small muted" style={{ margin: '6px 0 0' }}>
                {info.domain ? (
                  <>
                    <Icon name="lock" size={14} />{' '}{tr('Application vérifiée : {domain}.', { domain: info.domain })}
                  </>
                ) : (
                  tr('Ce nom est donné par l’application elle-même.')
                )}{' '}{tr('Les accès partiront vers')}{' '}<b>{info.host}</b>.
              </p>
            </div>
            {info.loopback && (
              <div className="card notice small">
                {tr('Une application sur ton ordinateur demande l’accès. Continue seulement si tu viens de lancer la connexion toi-même.')}
              </div>
            )}
            <ul className="consent-reads">
              {READS.map((r) => (
                <li key={r}>
                  <Icon name="check" size={16} /> {r}
                </li>
              ))}
            </ul>
            <p className="small muted" style={{ margin: 0 }}>
              {tr('Lecture seule : rien ne peut être modifié ni publié. Claude lit ta dernière sauvegarde quand tu lui poses une question ; le serveur ne peut l’ouvrir que pendant ces requêtes. Tu coupes l’accès quand tu veux dans Réglages, IA.')}
            </p>
          </>
        )}
        {error && (
          <p className="small" style={{ color: 'var(--red)', margin: 0 }}>
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
