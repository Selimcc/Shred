// Réglages, Strava : relier le compte, voir les dernières sorties importées, se déconnecter.
import { useEffect, useState } from 'react';
import { ActivityRow } from '../components/ActivitySheet';
import { Icon } from '../components/Icon';
import { ask, errorText, toast } from '../components/ui';
import { DEMO } from '../lib/api';
import { formatShort } from '../lib/date';
import { signedIn } from '../lib/session';
import { returnFromStrava } from '../lib/sync';
import { useApp } from '../lib/store';
import { connectStrava, disconnectStrava, type StravaStatus, stravaStatus, syncStrava } from '../lib/strava';
import { tn, tr } from '../../shared/i18n';

export function StravaPage() {
  const s = useApp();
  const [status, setStatus] = useState<StravaStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const connected = Boolean(s.strava?.athlete);

  const refresh = () =>
    stravaStatus()
      .then(setStatus)
      .catch(() => setStatus({ configured: false, connected: false, athlete: null, connectedAt: null }));

  useEffect(() => {
    if (!DEMO && !signedIn()) return;
    void refresh();
    // Retour de la page Strava ouverte dans Safari : on revérifie en revenant.
    const onVisible = () => document.visibilityState === 'visible' && void returnFromStrava().then(refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const run = async (k: string, fn: () => Promise<void>) => {
    setBusy(k);
    try {
      await fn();
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(null);
    }
  };

  const recent = Object.values(s.days)
    .flatMap((d) => d.activities ?? [])
    .filter((a) => a.source === 'strava')
    .sort((a, b) => b.start.localeCompare(a.start))
    .slice(0, 8);

  if (!DEMO && !signedIn()) {
    return <p className="muted">{tr('Connecte-toi à ton compte (Réglages, Compte) pour relier Strava : les jetons sont gardés par ton serveur.')}</p>;
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="card strava-card">
        <span className="strava-mark" aria-hidden="true">
          <Icon name="route" size={22} />
        </span>
        <div className="grow">
          <div style={{ fontWeight: 800 }}>{connected ? tr('Relié à {athlete}', { athlete: s.strava!.athlete }) : tr('Strava n’est pas relié')}</div>
          <div className="small muted">
            {connected
              ? s.strava?.lastSync
                ? tr('Dernière synchro le {date} à {lastSync}', { date: formatShort(s.strava.lastSync.slice(0, 10)), lastSync: s.strava.lastSync.slice(11, 16) })
                : tr('Première synchro en cours')
              : tr('Tes courses, sorties vélo et séances de natation arrivent seules dans Shred.')}
          </div>
        </div>
      </div>

      {status && !status.configured && !DEMO ? (
        <p className="small muted" style={{ margin: 0 }}>
          {tr('L’administrateur doit d’abord créer une application Strava et ajouter ses deux clés au serveur (guide : docs/STRAVA.md). Ensuite, chacun relie son compte ici en deux touches.')}
        </p>
      ) : connected ? (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            className="btn primary"
            disabled={busy !== null}
            onClick={() =>
              run('sync', async () => {
                const r = await syncStrava(true);
                toast(r?.added ? tn(r.added, '{n} sortie importée', '{n} sorties importées') : tr('Rien de nouveau sur Strava'));
              })
            }
          >
            {busy === 'sync' ? tr('Synchro…') : tr('Synchroniser')}
          </button>
          <button
            className="btn"
            disabled={busy !== null}
            onClick={async () => {
              if (!(await ask(tr('Délier Strava ? Les sorties déjà importées restent dans Shred.'), tr('Délier')))) return;
              await run('off', async () => {
                await disconnectStrava();
                toast(tr('Strava délié'));
                void refresh();
              });
            }}
          >
            {tr('Délier')}
          </button>
        </div>
      ) : (
        <button className="btn strava-connect block" disabled={busy !== null} onClick={() => run('on', connectStrava)}>
          {busy === 'on' ? tr('Ouverture de Strava…') : tr('Se connecter avec Strava')}
        </button>
      )}

      <section className="stack" style={{ gap: 8 }}>
        <h3 className="settings-group" style={{ margin: 0 }}>
          {tr('Comment ça marche')}
        </h3>
        <p className="small muted" style={{ margin: 0 }}>
          {tr('Une sortie du même sport que ta séance du jour la valide toute seule (et compte pour ta flamme). Les autres sorties comptent dans tes stats. Shred vérifie Strava à chaque ouverture de l’app.')}
        </p>
        <p className="small muted" style={{ margin: 0 }}>
          {tr('Les données Strava restent visibles par toi seul, c’est la règle de Strava : elles ne sont jamais partagées dans le club. Tu peux publier ta séance avec tes propres chiffres notés dans Shred.')}
        </p>
      </section>

      {recent.length > 0 && (
        <section>
          <h3 className="settings-group">{tr('Dernières sorties importées')}</h3>
          <div className="group">
            {recent.map((a) => (
              <ActivityRow key={a.id} a={a} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

