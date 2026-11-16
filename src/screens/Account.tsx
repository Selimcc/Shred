// Réglages, Compte (pour tout le monde) et Réglages, Testeurs (pour l'administrateur).
import { type FormEvent, useEffect, useState } from 'react';
import { copyText, Field, PasswordInput } from '../components/form';
import { Icon } from '../components/Icon';
import { ask, errorText, toast } from '../components/ui';
import { changePassword, deleteAccount, leaveLocalMode, logout } from '../lib/account';
import { api, type Health } from '../lib/api';
import { hasUnsaved, uploadBackup } from '../lib/backup';
import { dayKey, formatShort } from '../lib/date';
import { useSession } from '../lib/session';
import { useApp } from '../lib/store';

function ago(ms?: number): string {
  if (!ms) return 'jamais';
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

const until = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : '');

/* ---------- Compte ---------- */

export function AccountPage({ onClose }: { onClose: () => void }) {
  useApp(); // se rafraîchit quand les données changent (sauvegarde en attente)
  const session = useSession();
  const acc = session.account;
  const [busy, setBusy] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [panel, setPanel] = useState<'password' | 'delete' | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(null);
    }
  };

  if (!acc) {
    return (
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>
          Tu utilises Shred sans compte : tout reste sur ce téléphone, sans rappels, sans sauvegarde et sans IA intégrée.
        </p>
        <p className="small muted" style={{ margin: 0 }}>
          Avec un compte (sur invitation), tes données de ce téléphone sont gardées et sauvegardées, chiffrées.
        </p>
        <button className="btn primary block" onClick={leaveLocalMode}>
          Me connecter ou créer mon compte
        </button>
      </div>
    );
  }

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    void run('password', async () => {
      await changePassword(current, next);
      setCurrent('');
      setNext('');
      setPanel(null);
      toast('Mot de passe changé, sauvegarde rechiffrée');
    });
  };

  const submitDelete = (e: FormEvent) => {
    e.preventDefault();
    void run('delete', async () => {
      if (!(await ask('Supprimer ton compte et toutes tes données sur le serveur ? Action définitive.', 'Supprimer', true))) return;
      await deleteAccount(current);
      onClose();
    });
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span className="icon-btn" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
          <Icon name="user" size={20} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 850 }}>
            {acc.name} {acc.role === 'admin' && <span className="badge-admin">ADMIN</span>}
          </div>
          <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {acc.email}
          </div>
        </div>
      </div>

      <section className="stack">
        <h2>Sauvegarde</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Dernière sauvegarde : {ago(acc.syncedAt)}
          {hasUnsaved() ? ', des changements attendent' : ''}. Elle se fait toute seule, au plus tous les quarts d’heure et quand tu quittes l’app.
        </p>
        <button
          className="btn block"
          disabled={busy === 'backup'}
          onClick={() =>
            run('backup', async () => {
              const r = await uploadBackup(true);
              toast(r === 'skipped' ? 'Sauvegarde indisponible' : 'Sauvegardé');
            })
          }
        >
          Sauvegarder maintenant
        </button>
        <details className="small muted">
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Où sont mes données ?</summary>
          <p>
            Sur ce téléphone, et en sauvegarde sur le serveur Shred (Cloudflare), dans ton espace à toi. La sauvegarde (séances, repas, poids,
            programme) est chiffrée ici avec une clé tirée de ton mot de passe : le serveur ne garde qu’un bloc illisible.
          </p>
          <p>
            Pour envoyer les rappels, le serveur voit un résumé du jour (séance faite ou non, nombre de repas, série) et, si tu relies Apple Santé,
            tes pas et calories. Ton mot de passe n’est jamais envoyé : le serveur garde seulement une empreinte qui permet de le vérifier.
          </p>
          <p>
            Mot de passe oublié : l’administrateur peut te donner un code pour en choisir un autre, mais personne ne peut relire une sauvegarde
            chiffrée avec l’ancien. Seules les données encore sur ton téléphone repartent, alors évite de te déconnecter sans raison.
          </p>
          <p style={{ marginBottom: 0 }}>Les photos de repas restent sur ce téléphone.</p>
        </details>
      </section>

      <section className="stack">
        <h2>Connexion</h2>
        <button
          className="btn block"
          disabled={busy === 'health'}
          onClick={() => run('health', async () => setHealth(await api<Health>('/api/health')))}
        >
          Tester la connexion
        </button>
        {health && (
          <p className="small muted" style={{ margin: 0 }}>
            Serveur {health.version} joignable. IA intégrée :{' '}
            {health.ai === 'missing'
              ? 'pas de clé API sur le serveur, utilise « App Claude »'
              : health.aiLimit === 0
                ? 'réservée à l’administrateur'
                : `${health.ai === 'mock' ? 'simulée, ' : ''}${health.aiLimit} requêtes par jour`}
            . Notifications : {health.push ? 'prêtes' : 'clés manquantes sur le serveur'}.
          </p>
        )}
      </section>

      <section className="stack">
        <h2>Sécurité</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" style={{ flex: 1 }} onClick={() => setPanel(panel === 'password' ? null : 'password')}>
            Changer le mot de passe
          </button>
        </div>
        {panel === 'password' && (
          <form className="stack card" onSubmit={submitPassword}>
            <Field label="Mot de passe actuel">
              <PasswordInput label="Mot de passe actuel" value={current} onChange={setCurrent} autoComplete="current-password" />
            </Field>
            <Field label="Nouveau mot de passe" hint="8 caractères minimum.">
              <PasswordInput label="Nouveau mot de passe" value={next} onChange={setNext} autoComplete="new-password" />
            </Field>
            <button className="btn primary block" disabled={busy === 'password'}>
              {busy === 'password' ? 'Sécurisation…' : 'Enregistrer'}
            </button>
          </form>
        )}
        <button
          className="btn block"
          disabled={busy === 'logout'}
          onClick={() =>
            run('logout', async () => {
              if (!(await ask('Te déconnecter ? Les données sont effacées de ce téléphone et restent sur ton compte.', 'Me déconnecter'))) return;
              try {
                await logout();
              } catch {
                if (!(await ask('Sauvegarde impossible (hors ligne ?). Te déconnecter quand même et perdre les changements récents ?', 'Oui, me déconnecter', true)))
                  return;
                await logout({ force: true });
              }
              onClose();
            })
          }
        >
          Me déconnecter
        </button>
        <button className="link small" style={{ color: 'var(--red)', alignSelf: 'flex-start' }} onClick={() => setPanel(panel === 'delete' ? null : 'delete')}>
          Supprimer mon compte
        </button>
        {panel === 'delete' && (
          <form className="stack card" onSubmit={submitDelete}>
            <p className="small muted" style={{ margin: 0 }}>
              Supprime ton compte, ta sauvegarde, tes rappels et tes données Santé du serveur, puis vide ce téléphone.
            </p>
            <Field label="Mot de passe">
              <PasswordInput label="Mot de passe pour confirmer" value={current} onChange={setCurrent} autoComplete="current-password" />
            </Field>
            <button className="btn danger block" disabled={busy === 'delete' || !current}>
              Supprimer définitivement
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

/* ---------- Testeurs (administrateur) ---------- */

interface Overview {
  users: { id: string; name: string; email: string; role: 'admin' | 'member'; createdAt: string; lastDay: string | null; me: boolean }[];
  invites: { code: string; note: string; created: string | null; expires: string | null }[];
}

function inviteMessage(code: string, expires: string) {
  const link = `${location.origin}/?invite=${encodeURIComponent(code)}`;
  return [
    'Salut ! Je te fais tester Shred, mon app de muscu (séances, repas, série du jour).',
    `Crée ton compte ici : ${link}`,
    `Code d’invitation : ${code} (valable jusqu’au ${until(expires)})`,
    'iPhone : ouvre le lien dans Safari, touche ⋯ (ou Partager), puis Partager, « Sur l’écran d’accueil » et Ajouter. Ouvre Shred depuis l’icône : ton code est déjà rempli.',
    'Android : ouvre-le dans Chrome et touche « Installer l’app » (ou menu ⋮, « Installer l’application »).',
  ].join('\n');
}

async function shareText(text: string) {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  if (await copyText(text)) toast('Message copié : colle-le dans WhatsApp ou SMS');
}

export function TestersPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ code: string; expires: string; note: string } | null>(null);
  const [reset, setReset] = useState<{ name: string; email: string; code: string; expires: string } | null>(null);

  const load = () =>
    api<Overview>('/api/admin/overview').then(setData, (e) => {
      toast(errorText(e), true);
    });
  useEffect(() => {
    void load();
  }, []);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(false);
    }
  };

  const today = dayKey();

  return (
    <div className="stack" style={{ gap: 22 }}>
      <section className="stack">
        <h2>Inviter quelqu’un</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Chaque invitation sert une seule fois et expire au bout de 7 jours. La personne crée son compte avec son email et son mot de passe :
          elle a son espace à elle, sans accès au tien.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <input className="input" placeholder="Pour qui ? (facultatif)" aria-label="Pour qui" value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            className="btn primary"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const r = await api<{ code: string; expires: string; note: string }>('/api/admin/invites', { body: { note } });
                setFresh(r);
                setNote('');
                await load();
              })
            }
          >
            Créer
          </button>
        </div>
        {fresh && (
          <div className="card stack" style={{ border: '2px solid var(--blue)' }}>
            <div className="small muted">Invitation{fresh.note ? ` pour ${fresh.note}` : ''}</div>
            <div className="display num" style={{ fontSize: '1.6rem', userSelect: 'all' }}>
              {fresh.code}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn primary" style={{ flex: 1 }} onClick={() => shareText(inviteMessage(fresh.code, fresh.expires))}>
                <Icon name="share" size={18} /> Envoyer
              </button>
              <button className="btn" onClick={async () => (await copyText(`${location.origin}/?invite=${fresh.code}`)) && toast('Lien copié')}>
                Lien
              </button>
            </div>
          </div>
        )}
      </section>

      {data && data.invites.length > 0 && (
        <section className="stack">
          <h2>En attente</h2>
          <div className="group">
            {data.invites.map((i) => (
              <div className="row" key={i.code}>
                <div className="grow">
                  <div className="title num">{i.code}</div>
                  <div className="small muted">
                    {i.note || 'Sans nom'}, expire le {until(i.expires)}
                  </div>
                </div>
                <button
                  className="btn small"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await api(`/api/admin/invites/${encodeURIComponent(i.code)}`, { method: 'DELETE' });
                      if (fresh?.code === i.code) setFresh(null);
                      await load();
                    })
                  }
                >
                  Annuler
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="stack">
        <h2>Comptes {data ? `(${data.users.length})` : ''}</h2>
        {!data && <div className="spinner" />}
        {data && (
          <div className="group">
            {data.users.map((u) => (
              <div className="row" key={u.id} style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div className="grow">
                  <div className="title">
                    {u.name} {u.role === 'admin' && <span className="badge-admin">ADMIN</span>} {u.me && <span className="small faint">(toi)</span>}
                  </div>
                  <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {u.email}
                  </div>
                  <div className="small faint">
                    {u.lastDay ? (u.lastDay === today ? 'Actif aujourd’hui' : `Actif le ${formatShort(u.lastDay)}`) : 'Pas encore de rappels activés'}
                  </div>
                </div>
                {!u.me && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn small"
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          const r = await api<{ code: string; expires: string }>(`/api/admin/users/${u.id}/reset`, { body: {} });
                          setReset({ name: u.name, email: u.email, ...r });
                        })
                      }
                    >
                      Mot de passe
                    </button>
                    <button
                      className="btn small danger"
                      disabled={busy}
                      aria-label={`Retirer ${u.name}`}
                      onClick={() =>
                        act(async () => {
                          if (!(await ask(`Retirer ${u.name} ? Son compte et toutes ses données sont supprimés du serveur.`, 'Retirer', true))) return;
                          await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
                          await load();
                        })
                      }
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {reset && (
          <div className="card stack" style={{ border: '2px solid var(--gold)' }}>
            <div className="small muted">Code de réinitialisation pour {reset.name}, valable 48 h</div>
            <div className="display num" style={{ fontSize: '1.6rem', userSelect: 'all' }}>
              {reset.code}
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              Sur l’écran de connexion : « Mot de passe oublié ? ». Sa sauvegarde en ligne, chiffrée avec l’ancien mot de passe, sera remplacée par
              les données de son téléphone.
            </p>
            <button
              className="btn primary block"
              onClick={() =>
                shareText(
                  `Ton code pour changer ton mot de passe Shred : ${reset.code} (valable 48 h). Ouvre l’app, « Me connecter », « Mot de passe oublié ? », avec ton email ${reset.email}.`,
                )
              }
            >
              <Icon name="share" size={18} /> Envoyer le code
            </button>
          </div>
        )}
      </section>

      <p className="small faint" style={{ margin: 0 }}>
        Le plan gratuit Cloudflare tient une vingtaine de testeurs actifs. L’IA intégrée coûte sur ta clé API : chaque invité a droit à
        GUEST_AI_LIMIT requêtes par jour (wrangler.jsonc, 0 pour la réserver à toi).
      </p>
    </div>
  );
}
