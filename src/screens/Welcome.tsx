// Accueil : créer son compte avec une invitation, se connecter, ou retrouver l'accès avec un code.
import { type FormEvent, useState } from 'react';
import { Field, PasswordInput } from '../components/form';
import { Icon } from '../components/Icon';
import { Pulse } from '../components/Pulse';
import { ask, errorText, toast } from '../components/ui';
import { continueWithoutAccount, hasData, login, logout, MIN_PASSWORD, register, resetPassword } from '../lib/account';
import type { Account } from '../lib/session';
import { InstallGuide } from '../components/InstallGuide';
import { installDismissed } from '../lib/install';

type Mode = 'start' | 'login' | 'register' | 'reset';

const TITLES: Record<Exclude<Mode, 'start'>, string> = {
  register: 'Créer mon compte',
  login: 'Me connecter',
  reset: 'Nouveau mot de passe',
};

function inviteFromUrl(): string {
  try {
    return (new URLSearchParams(location.search).get('invite') ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);
  } catch {
    return '';
  }
}

export function Welcome({ expired }: { expired?: Account }) {
  const [invite] = useState(inviteFromUrl);
  const [mode, setMode] = useState<Mode>(expired ? 'login' : invite ? 'register' : 'start');
  const [email, setEmail] = useState(expired?.email ?? '');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState(invite);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [later, setLater] = useState(installDismissed);

  const go = (m: Mode) => {
    setMode(m);
    setError(undefined);
    setPassword('');
    setCode(m === 'register' ? invite : '');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      if (mode === 'register') await register({ name, email, password, invite: code });
      else if (mode === 'login') await login(email, password);
      else if (mode === 'reset') {
        await resetPassword(email, code, password);
        toast(
          hasData()
            ? 'Mot de passe changé. Ta sauvegarde repart des données de ce téléphone.'
            : 'Mot de passe changé. L’ancienne sauvegarde, chiffrée avec l’ancien mot de passe, ne pouvait pas être relue : tu repars de zéro.',
        );
      }
      try {
        history.replaceState(null, '', location.pathname);
      } catch {
        // Aperçu intégré : pas d'historique, sans conséquence.
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app welcome">
      <header className="welcome-hero">
        <Pulse mood="cheer" tier={0} size={110} className="kilo-enter" />
        <h1 className="display">Shred</h1>
        <p className="muted">Ta séance, tes repas et ta série du jour. Une app privée, sur invitation.</p>
      </header>

      {!later && !expired && <InstallGuide invite={invite || undefined} onLater={() => setLater(true)} />}

      {mode === 'start' && (
        <div className="stack">
          <button className="btn primary block" onClick={() => go('register')}>
            J’ai une invitation
          </button>
          <button className="btn block" onClick={() => go('login')}>
            Me connecter
          </button>
          <button className="link small" style={{ alignSelf: 'center', marginTop: 6 }} onClick={continueWithoutAccount}>
            Essayer sans compte
          </button>
          <p className="small faint" style={{ margin: 0, textAlign: 'center' }}>
            Sans compte, tout reste sur ce téléphone : pas de rappels, pas de sauvegarde, pas d’IA intégrée.
          </p>
        </div>
      )}

      {mode !== 'start' && (
        <form className="stack" onSubmit={submit} noValidate>
          <h2>{TITLES[mode]}</h2>
          {expired && (
            <p className="small muted" style={{ margin: 0 }}>
              Ta session a expiré. Reconnecte-toi pour continuer : tes données sont toujours sur ce téléphone.
            </p>
          )}
          {mode === 'reset' && (
            <p className="small muted" style={{ margin: 0 }}>
              Demande un code de réinitialisation à la personne qui t’a invité (valable 48 heures). Ta sauvegarde en ligne est chiffrée avec ton
              ancien mot de passe : seules les données encore présentes sur ce téléphone seront gardées.
            </p>
          )}
          {mode === 'register' && (
            <Field label="Prénom">
              <input className="input" autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          )}
          <Field label="Email">
            <input
              className="input"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          {mode === 'reset' && (
            <Field label="Code de réinitialisation">
              <input className="input" autoCapitalize="characters" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
          )}
          <Field
            label={mode === 'reset' ? 'Nouveau mot de passe' : 'Mot de passe'}
            hint={mode === 'login' ? undefined : `${MIN_PASSWORD} caractères minimum. Il ne quitte jamais ce téléphone.`}
          >
            <PasswordInput
              label={mode === 'reset' ? 'Nouveau mot de passe' : 'Mot de passe'}
              value={password}
              onChange={setPassword}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </Field>
          {mode === 'register' && (
            <Field label="Code d’invitation">
              <input className="input" autoCapitalize="characters" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
          )}
          {error && (
            <p className="small" role="alert" style={{ color: 'var(--red)', margin: 0 }}>
              {error}
            </p>
          )}
          <button className="btn primary block" disabled={busy}>
            {busy ? 'Sécurisation…' : TITLES[mode]}
          </button>

          <div className="stack" style={{ gap: 8, alignItems: 'center', marginTop: 4 }}>
            {mode === 'login' && (
              <button type="button" className="link small" onClick={() => go('reset')}>
                Mot de passe oublié ?
              </button>
            )}
            {mode === 'login' && !expired && (
              <button type="button" className="link small" onClick={() => go('register')}>
                Pas encore de compte ? J’ai une invitation
              </button>
            )}
            {mode === 'register' && (
              <button type="button" className="link small" onClick={() => go('login')}>
                Déjà un compte ? Me connecter
              </button>
            )}
            {mode === 'reset' && (
              <button type="button" className="link small" onClick={() => go('login')}>
                ← Retour à la connexion
              </button>
            )}
            {!expired && mode !== 'reset' && (
              <button type="button" className="link small" style={{ color: 'var(--ink-2)' }} onClick={() => go('start')}>
                ← Retour
              </button>
            )}
            {expired && (
              <button
                type="button"
                className="link small"
                style={{ color: 'var(--ink-2)' }}
                onClick={async () => {
                  if (await ask(`Ce n’est pas le compte de ${expired.name} ? Les données de ce téléphone seront effacées ici (elles restent sur son compte).`, 'Effacer et changer', true)) {
                    await logout({ force: true });
                  }
                }}
              >
                Ce n’est pas toi ? Changer de compte
              </button>
            )}
          </div>
        </form>
      )}

      <p className="small faint welcome-foot">
        <Icon name="lock" size={14} /> Tes séances et repas sont chiffrés sur ton téléphone avant d’être sauvegardés : personne d’autre ne peut les lire,
        pas même l’administrateur.
      </p>
    </main>
  );
}
