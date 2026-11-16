// Réglages, Apple Santé et salle : installer les raccourcis partagés en deux touches.
//
// Apple n'accepte que les raccourcis partagés par lien iCloud (un fichier généré par code est refusé
// s'il n'est pas signé sur un Mac). L'administrateur crée donc chaque raccourci une fois, avec une
// « question d'importation » sur la clé, et colle son lien ici. Chacun l'installe ensuite : l'app
// copie sa clé, ouvre le lien, et Raccourcis demande de la coller.
import { useEffect, useState } from 'react';
import { copyText, CopyRow } from '../components/form';
import { Icon } from '../components/Icon';
import { ask, errorText, toast } from '../components/ui';
import { createShortcutKey } from '../lib/account';
import { api, DEMO, type Health } from '../lib/api';
import { dayKey } from '../lib/date';
import { runShortcut, syncHealth, timeOf } from '../lib/health';
import { getSession, signedIn } from '../lib/session';
import { useApp } from '../lib/store';
import { isNative } from '../lib/native';
import { connectNativeHealth, syncNativeHealth } from '../lib/nativeHealth';

type LinkKey = 'health' | 'gymIn' | 'gymOut';

const SHORTCUTS: { key: LinkKey; name: string; module: 'health' | 'gym'; what: string }[] = [
  { key: 'health', name: 'Shred Santé', module: 'health', what: 'envoie pas, calories, sommeil, cœur et minutes d’exercice' },
  { key: 'gymIn', name: 'Shred Arrivée', module: 'gym', what: 'signale ton arrivée à la salle' },
  { key: 'gymOut', name: 'Shred Départ', module: 'gym', what: 'signale ton départ' },
];

const HEALTH_FIELDS: [string, string][] = [
  ['steps', 'Nombre de pas, total du jour'],
  ['active_kcal', 'Énergie active, total du jour'],
  ['resting_kcal', 'Énergie au repos, total du jour'],
  ['sleep_h', 'Analyse du sommeil, durée « Endormi » de la nuit (en heures, 7,5) ou sleep_min en minutes'],
  ['resting_hr', 'Fréquence cardiaque au repos (bpm)'],
  ['hrv', 'Variabilité de la fréquence cardiaque (ms)'],
  ['exercise_min', 'Minutes d’exercice, total du jour'],
  ['distance_km', 'Distance de marche et de course (km)'],
];

export function HealthPage() {
  const s = useApp();
  const today = s.health[dayKey()];
  const [links, setLinks] = useState<Health['shortcuts'] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const admin = getSession().account?.role === 'admin';
  const key = s.settings.shortcutKey;
  const shown = SHORTCUTS.filter((x) => s.settings.modules[x.module]);

  useEffect(() => {
    if (DEMO || !signedIn()) return;
    api<Health>('/api/health').then((h) => setLinks(h.shortcuts ?? {}), () => setLinks({}));
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

  // Tout part dans le même geste : iOS refuse la copie et l'ouverture de lien après une attente.
  const install = (link: string, name: string) => {
    if (!key) return;
    navigator.clipboard
      ?.writeText(key)
      .then(
        () => toast(`Clé copiée. Dans Raccourcis, colle-la quand « ${name} » la demande.`),
        () => toast('Copie impossible : copie la clé avec le bouton « Copier » puis réessaie', true),
      );
    window.open(link, '_blank', 'noopener');
  };

  const native = isNative();
  return (
    <div className="stack" style={{ gap: 20 }}>
      {native ? (
        <section className="card stack" style={{ gap: 10 }}>
          <div style={{ fontWeight: 800 }}>Apple Santé, en direct</div>
          <p className="small muted" style={{ margin: 0 }}>
            L’app lit tes pas, ta distance, ton énergie, tes minutes d’exercice, ton sommeil, ton cœur au repos, ta VFC et les séances de ta montre. Rien à installer, rien à lancer : ça se met à jour à chaque ouverture.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              className="btn primary"
              disabled={busy !== null}
              onClick={() =>
                run('native', async () => {
                  await connectNativeHealth();
                  const r = await syncNativeHealth(true);
                  toast(r?.added ? `Santé synchronisée, ${r.added} séance(s) de la montre importée(s)` : 'Santé synchronisée');
                })
              }
            >
              {busy === 'native' ? 'Lecture…' : 'Autoriser et synchroniser'}
            </button>
          </div>
          <p className="small faint" style={{ margin: 0 }}>
            Pour changer les autorisations plus tard : Réglages de l’iPhone, Santé, Accès aux données, Shred.
          </p>
        </section>
      ) : (
        <section className="card stack" style={{ gap: 6 }}>
          <div style={{ fontWeight: 800 }}>Sans raccourci : l’app iPhone</div>
          <p className="small muted" style={{ margin: 0 }}>
            Une app web ne peut pas lire Apple Santé (Apple le réserve aux apps installées). La version iPhone de Shred le fait directement, sans raccourci, et importe aussi les séances de ta montre. Pour les sorties, tu peux aussi relier Strava.
          </p>
        </section>
      )}
      <section className="stack">
        <p className="small" style={{ margin: 0 }}>
          {today?.at ? `Dernière synchro Santé aujourd’hui à ${timeOf(today.at)}.` : Object.keys(s.health).length ? 'Pas encore de synchro aujourd’hui.' : 'Jamais synchronisé.'}
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn primary" style={{ flex: 1 }} disabled={DEMO} onClick={runShortcut}>
            Synchroniser
          </button>
          <button
            className="btn"
            disabled={DEMO || !signedIn() || busy === 'sync'}
            onClick={() =>
              run('sync', async () => {
                await syncHealth(true);
                toast('Données Santé à jour');
              })
            }
          >
            Actualiser
          </button>
        </div>
      </section>

      {!DEMO && (
        <section className="stack">
          <h2>Installer les raccourcis</h2>
          <p className="small muted" style={{ margin: 0 }}>
            iPhone uniquement. 1. Crée ta clé. 2. Touche « Installer » : la clé est copiée et le raccourci s’ouvre ; touche « Obtenir le raccourci »,
            colle la clé quand elle est demandée, puis « Ajouter ». 3. Crée les automatisations.
          </p>
          <div className="row" style={{ background: 'var(--surface)', borderRadius: 'var(--radius)' }}>
            <div className="grow">
              <div className="small muted">Ta clé Raccourcis</div>
              <div className="small num">{key ? `${key.slice(0, 10)}••••••` : 'Pas encore créée'}</div>
            </div>
            {key && (
              <button className="btn small" onClick={async () => (await copyText(key)) && toast('Clé copiée')}>
                Copier
              </button>
            )}
            <button
              className="btn small"
              disabled={!signedIn() || busy === 'key'}
              onClick={async () => {
                if (key && !(await ask('Créer une nouvelle clé ? L’ancienne cesse de marcher : il faudra réinstaller tes raccourcis.', 'Nouvelle clé'))) return;
                void run('key', async () => {
                  await createShortcutKey();
                  toast('Clé créée');
                });
              }}
            >
              {key ? 'Nouvelle' : 'Créer'}
            </button>
          </div>
          <p className="small faint" style={{ margin: 0 }}>
            La clé ne sert qu’à envoyer tes chiffres Santé et tes passages à la salle. Elle ne donne accès à rien d’autre.
          </p>

          <div className="group">
            {shown.map((x) => {
              const link = links?.[x.key];
              return (
                <div className="row" key={x.key}>
                  <div className="grow">
                    <div className="title">{x.name}</div>
                    <div className="small muted">
                      {!links ? 'Chargement…' : !link ? 'Lien pas encore ajouté par l’administrateur' : key ? x.what : 'Crée d’abord ta clé'}
                    </div>
                  </div>
                  <button className="btn small primary" disabled={!link || !key} onClick={() => link && install(link, x.name)}>
                    Installer
                  </button>
                </div>
              );
            })}
          </div>
          <div className="small muted stack" style={{ gap: 6 }}>
            <div>
              <b>Pour que ça se fasse tout seul</b>, crée dans Raccourcis, onglet Automatisation :
            </div>
            <div>
              · « App », choisis une app que tu ouvres souvent (WhatsApp, Instagram…), « Est ouverte », « Exécuter immédiatement », puis {SHORTCUTS[0].name}.
              Coupe « Me notifier ». Tes pas suivent dans la journée, sans rien toucher.
            </div>
            <div>· « Heure de la journée » à 21:00, pour le bilan du soir.</div>
            {s.settings.modules.gym && <div>· « Arrivée » et « Départ » sur l’adresse de ta salle, avec Shred Arrivée et Shred Départ.</div>}
          </div>

          <details className="small">
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Ajouter le sommeil, le cœur et l’exercice au raccourci</summary>
            <div className="stack" style={{ gap: 8, marginTop: 10 }}>
              <p className="muted" style={{ margin: 0 }}>
                Dans le raccourci Shred Santé, ajoute une action « Rechercher des échantillons de santé » par donnée (période : aujourd’hui, ou la nuit
                dernière pour le sommeil), puis ajoute la valeur au dictionnaire envoyé avec la clé indiquée. Chaque clé est facultative.
              </p>
              <div className="group">
                {HEALTH_FIELDS.map(([k, what]) => (
                  <div className="row" key={k} style={{ minHeight: 48 }}>
                    <code className="num" style={{ minWidth: 108 }}>
                      {k}
                    </code>
                    <span className="grow muted">{what}</span>
                  </div>
                ))}
              </div>
              <p className="faint" style={{ margin: 0 }}>
                Le sommeil sert aussi à la forme du jour : après une nuit courte ou une VFC basse, Pulse te propose le mode Fatigué.
              </p>
            </div>
          </details>

          <details className="small">
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Configuration à la main</summary>
            <div className="group" style={{ marginTop: 10 }}>
              {s.settings.modules.health && <CopyRow label="Adresse Santé" value={`${location.origin}/api/health/ingest`} />}
              {s.settings.modules.gym && <CopyRow label="Adresse arrivée salle" value={`${location.origin}/api/gym/checkin`} />}
              {s.settings.modules.gym && <CopyRow label="Adresse départ salle" value={`${location.origin}/api/gym/checkout`} />}
              {key && <CopyRow label="En-tête Authorization" value={`Bearer ${key}`} display={`Bearer ${key.slice(0, 8)}••••••`} />}
            </div>
          </details>
        </section>
      )}

      {!DEMO && admin && links && <AdminLinks links={links} onSaved={setLinks} />}
    </div>
  );
}

/** Pour l'administrateur : les liens iCloud des trois raccourcis, une fois créés sur son iPhone. */
function AdminLinks({ links, onSaved }: { links: NonNullable<Health['shortcuts']>; onSaved: (l: Health['shortcuts']) => void }) {
  const [draft, setDraft] = useState<Record<LinkKey, string>>({
    health: links.health ?? '',
    gymIn: links.gymIn ?? '',
    gymOut: links.gymOut ?? '',
  });
  const [busy, setBusy] = useState(false);
  const missing = SHORTCUTS.some((x) => !links[x.key]);
  return (
    <details className="card stack" open={missing}>
      <summary style={{ cursor: 'pointer', fontWeight: 850 }}>Liens de partage (administrateur)</summary>
      <p className="small muted" style={{ margin: '10px 0 0' }}>
        Crée chaque raccourci une fois sur ton iPhone, avec une question d’importation sur la clé, puis Partager, « Copier le lien iCloud », et colle-le
        ici. Le pas-à-pas est dans le guide, section Apple Santé.
      </p>
      {SHORTCUTS.map((x) => (
        <label className="field" key={x.key} style={{ marginTop: 12 }}>
          <span>{x.name}</span>
          <input
            className="input"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="https://www.icloud.com/shortcuts/…"
            value={draft[x.key]}
            onChange={(e) => setDraft({ ...draft, [x.key]: e.target.value })}
          />
        </label>
      ))}
      <button
        className="btn primary block"
        style={{ marginTop: 14 }}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await api<{ shortcuts: Health['shortcuts'] }>('/api/admin/shortcuts', { method: 'PUT', body: draft });
            onSaved(r.shortcuts);
            toast('Liens enregistrés : tes testeurs peuvent installer les raccourcis');
          } catch (e) {
            toast(errorText(e), true);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Icon name="check" size={18} /> Enregistrer les liens
      </button>
    </details>
  );
}
