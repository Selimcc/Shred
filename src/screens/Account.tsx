// Réglages, Compte (pour tout le monde) et Réglages, Testeurs (pour l'administrateur).
import { type FormEvent, useEffect, useState } from 'react';
import { emailSuggestion } from '../../shared/email-typo';
import { copyText, Field, PasswordInput } from '../components/form';
import { Icon } from '../components/Icon';
import { ask, errorText, toast } from '../components/ui';
import { changeEmail, changePassword, deleteAccount, leaveLocalMode, logout } from '../lib/account';
import { api, type Health } from '../lib/api';
import { hasUnsaved, uploadBackup } from '../lib/backup';
import { useSession } from '../lib/session';
import { useApp } from '../lib/store';
import { loc, tn, tr } from '../../shared/i18n';

function ago(ms?: number): string {
  if (!ms) return tr('jamais');
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return tr('à l’instant');
  if (min < 60) return tr('il y a {min} min', { min });
  const h = Math.round(min / 60);
  if (h < 24) return tr('il y a {h} h', { h });
  return new Date(ms).toLocaleDateString(loc(), { day: 'numeric', month: 'long' });
}

const until = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(loc(), { day: 'numeric', month: 'long' }) : '');

/* ---------- Compte ---------- */

export function AccountPage({ onClose }: { onClose: () => void }) {
  useApp(); // se rafraîchit quand les données changent (sauvegarde en attente)
  const session = useSession();
  const acc = session.account;
  const [busy, setBusy] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [panel, setPanel] = useState<'password' | 'email' | 'delete' | null>(null);
  const [email, setEmail] = useState('');
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
          {tr('Tu utilises Shred sans compte : tout reste sur ce téléphone, sans rappels, sans sauvegarde et sans IA intégrée.')}
        </p>
        <p className="small muted" style={{ margin: 0 }}>
          {tr('Avec un compte (sur invitation), tes données de ce téléphone sont gardées et sauvegardées, chiffrées.')}
        </p>
        <button className="btn primary block" onClick={leaveLocalMode}>
          {tr('Me connecter ou créer mon compte')}
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
      toast(tr('Mot de passe changé, sauvegarde rechiffrée'));
    });
  };

  const submitEmail = (e: FormEvent) => {
    e.preventDefault();
    void run('email', async () => {
      await changeEmail(email, current);
      setCurrent('');
      setEmail('');
      setPanel(null);
      toast(tr('Email changé : connecte-toi désormais avec celui-ci'));
    });
  };

  const submitDelete = (e: FormEvent) => {
    e.preventDefault();
    void run('delete', async () => {
      if (!(await ask(tr('Supprimer ton compte et toutes tes données sur le serveur ? Action définitive.'), tr('Supprimer'), true))) return;
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
            {acc.name} {acc.role === 'admin' && <span className="badge-admin">{tr('ADMIN')}</span>}
          </div>
          <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {acc.email}
          </div>
        </div>
      </div>

      <section className="stack">
        <h2>{tr('Sauvegarde')}</h2>
        <p className="small muted" style={{ margin: 0 }}>
          {tr('Dernière sauvegarde : {ago}', { ago: ago(acc.syncedAt) })}
          {hasUnsaved() ? tr(', des changements attendent') : ''}{tr('. Elle se fait toute seule, au plus tous les quarts d’heure et quand tu quittes l’app.')}
        </p>
        <button
          className="btn block"
          disabled={busy === 'backup'}
          onClick={() =>
            run('backup', async () => {
              const r = await uploadBackup(true);
              toast(r === 'skipped' ? tr('Sauvegarde indisponible') : tr('Sauvegardé'));
            })
          }
        >
          {tr('Sauvegarder maintenant')}
        </button>
        <details className="small muted">
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{tr('Où sont mes données ?')}</summary>
          <p>
            {tr('Sur ce téléphone, et en sauvegarde sur le serveur Shred (Cloudflare), dans ton espace à toi. La sauvegarde (séances, repas, poids, programme) est chiffrée ici avec une clé tirée de ton mot de passe : le serveur ne garde qu’un bloc illisible.')}
          </p>
          <p>
            {tr('Pour envoyer les rappels, le serveur voit un résumé du jour (séance faite ou non, nombre de repas, série) et, si tu relies Apple Santé, tes pas et calories. Ton mot de passe n’est jamais envoyé : le serveur garde seulement une empreinte qui permet de le vérifier.')}
          </p>
          <p>
            {tr('Mot de passe oublié : l’administrateur peut te donner un code pour en choisir un autre, mais personne ne peut relire une sauvegarde chiffrée avec l’ancien. Seules les données encore sur ton téléphone repartent, alors évite de te déconnecter sans raison.')}
          </p>
          <p style={{ marginBottom: 0 }}>{tr('Les photos de repas restent sur ce téléphone.')}</p>
        </details>
      </section>

      <section className="stack">
        <h2>{tr('Connexion')}</h2>
        <button
          className="btn block"
          disabled={busy === 'health'}
          onClick={() => run('health', async () => setHealth(await api<Health>('/api/health')))}
        >
          {tr('Tester la connexion')}
        </button>
        {health && (
          <p className="small muted" style={{ margin: 0 }}>
            {tr('Serveur {version} joignable. IA intégrée : {ai}. Notifications : {push}.', {
              version: health.version,
              ai:
                health.ai === 'missing'
                  ? tr('pas de clé API sur le serveur, utilise « App Claude »')
                  : health.aiLimit === 0
                    ? tr('réservée à l’administrateur')
                    : tr('{v}{aiLimit} requêtes par jour', { v: health.ai === 'mock' ? tr('simulée, ') : '', aiLimit: health.aiLimit }),
              push: health.push ? tr('prêtes') : tr('clés manquantes sur le serveur'),
            })}
          </p>
        )}
      </section>

      <section className="stack">
        <h2>{tr('Sécurité')}</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" style={{ flex: 1 }} onClick={() => setPanel(panel === 'password' ? null : 'password')}>
            {tr('Changer le mot de passe')}
          </button>
          <button className="btn" style={{ flex: 1 }} onClick={() => setPanel(panel === 'email' ? null : 'email')}>
            {tr('Changer l’email')}
          </button>
        </div>
        {panel === 'email' && (
          <form className="stack card" onSubmit={submitEmail}>
            <p className="small muted" style={{ margin: 0 }}>
              {tr('Faute de frappe à l’inscription, nouvelle adresse : c’est avec cet email que tu te connecteras. S’il est déjà utilisé par un autre compte, il faudra en choisir un autre. Tes autres appareils seront déconnectés.')}
            </p>
            <Field label={tr('Nouvel email')}>
              <input className="input" type="email" inputMode="email" autoComplete="email" autoCapitalize="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} placeholder={acc.email} />
            </Field>
            {emailSuggestion(email) && (
              <button type="button" className="link small" style={{ alignSelf: 'flex-start', marginTop: -6 }} onClick={() => setEmail(emailSuggestion(email)!)}>
                {tr('Tu voulais dire')}{' '}<b>{emailSuggestion(email)}</b> ?
              </button>
            )}
            <Field label={tr('Mot de passe')}>
              <PasswordInput label={tr('Mot de passe pour confirmer')} value={current} onChange={setCurrent} autoComplete="current-password" />
            </Field>
            <button className="btn primary block" disabled={busy === 'email' || !email.includes('@') || !current}>
              {busy === 'email' ? tr('Sécurisation…') : tr('Changer l’email')}
            </button>
          </form>
        )}
        {panel === 'password' && (
          <form className="stack card" onSubmit={submitPassword}>
            <Field label={tr('Mot de passe actuel')}>
              <PasswordInput label={tr('Mot de passe actuel')} value={current} onChange={setCurrent} autoComplete="current-password" />
            </Field>
            <Field label={tr('Nouveau mot de passe')} hint={tr('8 caractères minimum.')}>
              <PasswordInput label={tr('Nouveau mot de passe')} value={next} onChange={setNext} autoComplete="new-password" />
            </Field>
            <button className="btn primary block" disabled={busy === 'password'}>
              {busy === 'password' ? tr('Sécurisation…') : tr('Enregistrer')}
            </button>
          </form>
        )}
        <button
          className="btn block"
          disabled={busy === 'logout'}
          onClick={() =>
            run('logout', async () => {
              if (!(await ask(tr('Te déconnecter ? Les données sont effacées de ce téléphone et restent sur ton compte.'), tr('Me déconnecter')))) return;
              try {
                await logout();
              } catch {
                if (!(await ask(tr('Sauvegarde impossible (hors ligne ?). Te déconnecter quand même et perdre les changements récents ?'), tr('Oui, me déconnecter'), true)))
                  return;
                await logout({ force: true });
              }
              onClose();
            })
          }
        >
          {tr('Me déconnecter')}
        </button>
        <button className="link small" style={{ color: 'var(--red)', alignSelf: 'flex-start' }} onClick={() => setPanel(panel === 'delete' ? null : 'delete')}>
          {tr('Supprimer mon compte')}
        </button>
        {panel === 'delete' && (
          <form className="stack card" onSubmit={submitDelete}>
            <p className="small muted" style={{ margin: 0 }}>
              {tr('Supprime ton compte, ta sauvegarde, tes rappels et tes données Santé du serveur, puis vide ce téléphone.')}
            </p>
            <Field label={tr('Mot de passe')}>
              <PasswordInput label={tr('Mot de passe pour confirmer')} value={current} onChange={setCurrent} autoComplete="current-password" />
            </Field>
            <button className="btn danger block" disabled={busy === 'delete' || !current}>
              {tr('Supprimer définitivement')}
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
  invites: { code: string; note: string; created: string | null; expires: string | null; max?: number; uses?: number }[];
}

function inviteMessage(code: string, expires: string, group = false) {
  const link = `${location.origin}/?invite=${encodeURIComponent(code)}`;
  return [
    group
      ? tr('Salut tout le monde ! Je vous fais tester Shred, mon app de muscu (séances, repas, série du jour, club entre nous).')
      : tr('Salut ! Je te fais tester Shred, mon app de muscu (séances, repas, série du jour).'),
    tr('{v} ici : {link}', { v: group ? tr('Créez votre compte') : tr('Crée ton compte'), link }),
    tr('Code d’invitation : {code} (valable jusqu’au {until})', { code, until: until(expires) }),
    tr('iPhone : ouvre le lien dans Safari, touche ⋯ (ou Partager), puis Partager, « Sur l’écran d’accueil » et Ajouter. Ouvre Shred depuis l’icône : ton code est déjà rempli.'),
    tr('Android : ouvre-le dans Chrome et touche « Installer l’app » (ou menu ⋮, « Installer l’application »).'),
  ].join('\n');
}

export async function shareText(text: string) {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  if (await copyText(text)) toast(tr('Message copié : colle-le dans WhatsApp ou SMS'));
}

export function TestersPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ code: string; expires: string; note: string; max: number } | null>(null);
  const [kind, setKind] = useState<'one' | 'group'>('one');
  const [places, setPlaces] = useState(10);
  const [days, setDays] = useState(30);
  const [joined, setJoined] = useState<{ code: string; names: string[] } | null>(null);

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

  const group = kind === 'group';

  return (
    <div className="stack" style={{ gap: 22 }}>
      <section className="stack">
        <h2>{tr('Inviter')}</h2>
        <div className="seg" role="group" aria-label={tr('Type d’invitation')}>
          <button type="button" className={!group ? 'on' : ''} onClick={() => setKind('one')}>
            {tr('Une personne')}
          </button>
          <button type="button" className={group ? 'on' : ''} onClick={() => setKind('group')}>
            {tr('Un groupe')}
          </button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {group
            ? tr('Un seul lien pour plusieurs personnes (un groupe WhatsApp, une salle) : chacune crée son propre compte, jusqu’au nombre de places choisi.')
            : tr('Un code pour une seule personne, valable 7 jours.')}{' '}{tr('Chacun a son espace à lui, sans accès au tien.')}
        </p>
        {group && (
          <div className="stack" style={{ gap: 10 }}>
            <div className="chips" role="group" aria-label={tr('Nombre de places')}>
              {[5, 10, 25, 50].map((n) => (
                <button key={n} type="button" className={`chip ${places === n ? 'on' : ''}`} onClick={() => setPlaces(n)}>
                  {tn(n, '{n} place', '{n} places')}
                </button>
              ))}
            </div>
            <div className="chips" role="group" aria-label={tr('Durée')}>
              {[7, 30].map((n) => (
                <button key={n} type="button" className={`chip ${days === n ? 'on' : ''}`} onClick={() => setDays(n)}>
                  {tn(n, '{n} jour', '{n} jours')}
                </button>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            className="input"
            placeholder={group ? tr('Nom du groupe (facultatif)') : tr('Pour qui ? (facultatif)')}
            aria-label={group ? tr('Nom du groupe') : tr('Pour qui')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className="btn primary"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const r = await api<{ code: string; expires: string; note: string; max: number }>('/api/admin/invites', {
                  body: group ? { note, uses: places, days } : { note },
                });
                setFresh(r);
                setNote('');
                await load();
              })
            }
          >
            {tr('Créer')}
          </button>
        </div>
        {fresh && (
          <div className="card stack" style={{ border: '2px solid var(--blue)' }}>
            <div className="small muted">
              {fresh.max > 1 ? tr('Lien de groupe, {max} places', { max: fresh.max }) : tr('Invitation')}
              {fresh.note ? ` : ${fresh.note}` : ''}{tr(', jusqu’au {until}', { until: until(fresh.expires) })}
            </div>
            <div className="display num" style={{ fontSize: '1.6rem', userSelect: 'all' }}>
              {fresh.code}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn primary" style={{ flex: 1 }} onClick={() => shareText(inviteMessage(fresh.code, fresh.expires, fresh.max > 1))}>
                <Icon name="share" size={18} />{' '}{tr('Envoyer')}
              </button>
              <button className="btn" onClick={async () => (await copyText(`${location.origin}/?invite=${fresh.code}`)) && toast(tr('Lien copié'))}>
                {tr('Lien')}
              </button>
            </div>
          </div>
        )}
      </section>

      {data && data.invites.length > 0 && (
        <section className="stack">
          <h2>{tr('Invitations en cours')}</h2>
          <div className="group">
            {data.invites.map((i) => (
              <div className="row" key={i.code}>
                <div className="grow">
                  <div className="title num">{i.code}</div>
                  <div className="small muted">
                    {(i.max ?? 1) > 1 ? tr('{n}, {n2} / {max} inscrits', { n: i.note || tr('Groupe'), n2: i.uses ?? 0, max: i.max }) : i.note || tr('Sans nom')}{tr(', expire le {until}', { until: until(i.expires) })}
                  </div>
                  {(i.max ?? 1) > 1 && (i.uses ?? 0) > 0 && (
                    <button
                      className="link small"
                      onClick={async () => {
                        if (joined?.code === i.code) return setJoined(null);
                        const r = await api<{ joined: string[] }>(`/api/admin/invites/${encodeURIComponent(i.code)}/joined`).catch(() => ({ joined: [] }));
                        setJoined({ code: i.code, names: r.joined });
                      }}
                    >
                      {joined?.code === i.code ? joined.names.join(', ') || tr('Personne pour l’instant') : tr('Voir qui')}
                    </button>
                  )}
                </div>
                {(i.max ?? 1) > 1 && (
                  <button className="btn small" onClick={() => shareText(inviteMessage(i.code, i.expires ?? '', true))} aria-label={tr('Renvoyer le lien')}>
                    <Icon name="share" size={16} />
                  </button>
                )}
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
                  {tr('Annuler')}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="small muted" style={{ margin: 0 }}>
        {tr('Les comptes, qui est en ligne, et les actions (mot de passe, retirer) sont dans Réglages, Panneau admin.')}
      </p>

      <p className="small faint" style={{ margin: 0 }}>
        {tr('Le plan gratuit Cloudflare tient une vingtaine de testeurs actifs. L’IA intégrée coûte sur ta clé API : chaque invité a droit à GUEST_AI_LIMIT requêtes par jour (wrangler.jsonc, 0 pour la réserver à toi).')}
      </p>
    </div>
  );
}
