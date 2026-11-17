// Panneau admin : tous les testeurs, qui est là en ce moment, sur quel appareil et quelle version, et ce
// qu'ils font dans le club. Réservé au compte admin (le serveur refuse les autres).
import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { ask, errorText, Sheet, toast } from '../components/ui';
import { api } from '../lib/api';
import { dayKey } from '../lib/date';
import { MemberAvatar } from './Club';
import { shareText } from './Account';
import { Pulse } from '../components/Pulse';
import { playSeasonScene } from '../components/SeasonScene';
import { SEASON_IDS, SEASONS } from '../../shared/season';
import { setSeasonLab, useSeasonLab } from '../lib/season';
import { loc, tn, tr } from '../../shared/i18n';

interface Tester {
  id: string;
  name: string;
  handle: string | null;
  email: string;
  role: 'admin' | 'member';
  createdAt: string;
  me: boolean;
  avatar: string | null;
  lastSeen: number | null;
  version: string | null;
  platform: string | null;
  lastDay: string | null;
  posts: number;
  followers: number;
  following: number;
  private: boolean;
}

type Filter = 'all' | 'online' | 'today' | 'idle';

const ONLINE = 5 * 60_000;
const WEEK = 7 * 86400_000;

function since(at: number | null, now: number): string {
  if (!at) return tr('Pas encore vu');
  const m = Math.round((now - at) / 60_000);
  if (m < 5) return tr('En ligne');
  if (m < 60) return tr('Vu il y a {m} min', { m });
  const h = Math.round(m / 60);
  if (h < 24) return tr('Vu il y a {h} h', { h });
  const d = Math.round(h / 24);
  return d === 1 ? tr('Vu hier') : d < 30 ? tr('Vu il y a {d} jours', { d }) : tr('Vu le {toLocaleDateString}', { toLocaleDateString: new Date(at).toLocaleDateString(loc(), { day: 'numeric', month: 'short' }) });
}

const date = (iso: string) => new Date(iso).toLocaleDateString(loc(), { day: 'numeric', month: 'long', year: 'numeric' });

/** Version plus ancienne que celle du serveur : l'app n'a pas encore pris la mise à jour. */
function older(v: string | null, current: string) {
  if (!v) return false;
  const a = v.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
}

export function AdminPanel() {
  const [data, setData] = useState<{ testers: Tester[]; version: string; now: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Tester | null>(null);

  const load = () =>
    api<{ testers: Tester[]; version: string; now: number }>('/api/admin/testers').then(
      (d) => {
        setData(d);
        setError(null);
      },
      (e) => setError(errorText(e)),
    );

  // Rafraîchi toutes les 30 secondes tant que le panneau est ouvert et visible.
  useEffect(() => {
    void load();
    const t = setInterval(() => !document.hidden && void load(), 30_000);
    return () => clearInterval(t);
  }, []);

  const now = data?.now ?? Date.now();
  const today = dayKey();
  const counts = useMemo(() => {
    const t = data?.testers ?? [];
    return {
      all: t.length,
      online: t.filter((x) => x.lastSeen && now - x.lastSeen < ONLINE).length,
      today: t.filter((x) => x.lastSeen && new Date(x.lastSeen).toDateString() === new Date(now).toDateString()).length,
      idle: t.filter((x) => !x.lastSeen || now - x.lastSeen > WEEK).length,
    };
  }, [data, now]);

  const list = useMemo(() => {
    const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const query = fold(q.trim().replace(/^@/, ''));
    return (data?.testers ?? [])
      .filter((t) => {
        if (filter === 'online') return t.lastSeen && now - t.lastSeen < ONLINE;
        if (filter === 'today') return t.lastSeen && new Date(t.lastSeen).toDateString() === new Date(now).toDateString();
        if (filter === 'idle') return !t.lastSeen || now - t.lastSeen > WEEK;
        return true;
      })
      .filter((t) => !query || [t.name, t.handle ?? '', t.email].some((x) => fold(x).includes(query)))
      .sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0) || a.name.localeCompare(b.name));
  }, [data, filter, q, now]);

  // Le labo des fêtes reste utilisable même si la liste des testeurs ne charge pas.
  if (error && !data) {
    return (
      <div className="stack" style={{ gap: 16 }}>
        <SeasonLabCard />
        <p className="muted">{error}</p>
        <button className="btn block" onClick={() => void load()}>
          {tr('Réessayer')}
        </button>
      </div>
    );
  }
  if (!data)
    return (
      <div className="stack" style={{ gap: 16 }}>
        <SeasonLabCard />
        <div className="spinner" />
      </div>
    );

  const tiles: { id: Filter; n: number; label: string }[] = [
    { id: 'all', n: counts.all, label: tn(counts.all, 'testeur', 'testeurs') },
    { id: 'online', n: counts.online, label: tr('en ligne') },
    { id: 'today', n: counts.today, label: tr('aujourd’hui') },
    { id: 'idle', n: counts.idle, label: tr('absents 7 j') },
  ];

  return (
    <div className="stack" style={{ gap: 16 }}>
      <SeasonLabCard />
      <div className="admin-tiles" role="group" aria-label={tr('Filtrer les testeurs')}>
        {tiles.map((t) => (
          <button key={t.id} className={`admin-tile ${filter === t.id ? 'on' : ''} ${t.id}`} onClick={() => setFilter(t.id)} aria-pressed={filter === t.id}>
            <span className="admin-tile-n num">{t.n}</span>
            <span className="small">{t.label}</span>
          </button>
        ))}
      </div>

      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Prénom, @pseudo ou email')} aria-label={tr('Chercher un testeur')} />

      {list.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          {tr('Personne dans cette vue.')}
        </p>
      ) : (
        <div className="group">
          {list.map((t) => {
            const online = Boolean(t.lastSeen && now - t.lastSeen < ONLINE);
            const stale = older(t.version, data.version);
            return (
              <button key={t.id} className="row settings-row admin-row" onClick={() => setOpen(t)}>
                <span className="admin-avatar">
                  <MemberAvatar m={t} size={42} />
                  {online && <span className="presence-dot" aria-hidden="true" />}
                </span>
                <span className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
                  <span className="title" style={{ display: 'block' }}>
                    {t.name} {t.role === 'admin' && <span className="badge-admin">{tr('ADMIN')}</span>} {t.me && <span className="small faint">{tr('(toi)')}</span>}
                  </span>
                  <span className="small muted ellipsis" style={{ display: 'block' }}>
                    {t.handle ? `@${t.handle}` : t.email}
                  </span>
                  <span className={`small ${online ? 'presence-on' : 'faint'}`} style={{ display: 'block' }}>
                    {since(t.lastSeen, now)}
                    {t.platform ? `, ${t.platform}` : ''}
                    {t.version && <span className={stale ? 'admin-stale' : 'faint'}> v{t.version}</span>}
                  </span>
                </span>
                <Icon name="chevron" size={18} />
              </button>
            );
          })}
        </div>
      )}

      <p className="small faint" style={{ margin: 0 }}>
        {tr('« En ligne » : actif dans les 5 dernières minutes. La version en orange n’a pas encore pris la mise à jour {version}.', { version: data.version })}
      </p>

      {open && (
        <TesterSheet
          t={open}
          now={now}
          current={data.version}
          today={today}
          onClose={() => setOpen(null)}
          onRemoved={() => {
            setOpen(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

/**
 * Labo des fêtes : forcer un thème sur cet appareil seulement (rien d'enregistré ni de synchronisé),
 * simuler le jour J et lancer la scène, pour tester avant la date.
 */
function SeasonLabCard() {
  const lab = useSeasonLab();
  const pick = (id: (typeof SEASON_IDS)[number]) => {
    setSeasonLab(lab?.season === id ? null : { season: id, holiday: lab?.holiday ?? false });
    if (lab?.season !== id) setTimeout(playSeasonScene, 450);
  };
  return (
    <section className="card season-lab">
      <div className="section-head" style={{ margin: 0 }}>
        <h2 style={{ fontSize: '1.05rem' }}>{tr('Tester les fêtes')}</h2>
        {lab && (
          <button className="link small" onClick={() => setSeasonLab(null)}>
            {tr('Arrêter')}
          </button>
        )}
      </div>
      <p className="small muted" style={{ margin: '4px 0 12px' }}>
        {tr('Sur cet appareil seulement, jusqu’à la fermeture de l’app. Personne d’autre ne le voit.')}
      </p>
      <div className="season-lab-row" role="group" aria-label={tr('Fête à tester')}>
        {SEASON_IDS.map((id) => (
          <button key={id} type="button" className={`season-lab-pick sc-${id} ${lab?.season === id ? 'on' : ''}`} onClick={() => pick(id)} aria-pressed={lab?.season === id}>
            <Pulse season={id} mood="happy" size={40} />
            <span className="small">{SEASONS[id].name}</span>
          </button>
        ))}
      </div>
      {lab && (
        <div className="season-lab-actions">
          <label className="row" style={{ padding: 0, gap: 10 }}>
            <input type="checkbox" checked={lab.holiday} onChange={(e) => setSeasonLab({ ...lab, holiday: e.target.checked })} />
            <span className="small">{tr('Simuler le jour J ({wish})', { wish: SEASONS[lab.season].wish })}</span>
          </label>
          <button className="btn small" onClick={playSeasonScene}>
            <Icon name="play" size={14} filled />{' '}{tr('Lancer la scène')}
          </button>
        </div>
      )}
    </section>
  );
}

function TesterSheet({ t, now, current, today, onClose, onRemoved }: { t: Tester; now: number; current: string; today: string; onClose: () => void; onRemoved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState<{ code: string; expires: string } | null>(null);
  const rows: [string, string][] = [
    [tr('Dernière visite'), t.lastSeen ? `${since(t.lastSeen, now)}${t.lastSeen && now - t.lastSeen >= ONLINE ? ` (${new Date(t.lastSeen).toLocaleString(loc(), { dateStyle: 'short', timeStyle: 'short' })})` : ''}` : tr('Pas encore vu depuis le suivi')],
    [tr('Appareil'), t.platform ?? tr('Inconnu')],
    [tr('Version'), t.version ? `${t.version}${older(t.version, current) ? tr(' (à jour : {current})', { current }) : ''}` : tr('Inconnue')],
    [tr('Séance du jour envoyée'), t.lastDay ? (t.lastDay === today ? tr('Aujourd’hui') : new Date(t.lastDay).toLocaleDateString(loc(), { day: 'numeric', month: 'long' })) : tr('Jamais')],
    [tr('Inscrit le'), date(t.createdAt)],
    [tr('Email'), t.email],
    [tr('Compte'), t.private ? tr('Privé') : tr('Public')],
  ];
  return (
    <Sheet title={t.name} onClose={onClose}>
      <div className="stack" style={{ gap: 16 }}>
        <div className="member-head">
          <MemberAvatar m={t} size={64} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 850, fontSize: '1.3rem' }}>
              {t.name} {t.role === 'admin' && <span className="badge-admin">{tr('ADMIN')}</span>}
            </div>
            {t.handle && <div className="small member-handle">@{t.handle}</div>}
          </div>
        </div>
        <div className="member-stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {(
            [
              [t.posts, tn(t.posts, 'publication', 'publications')],
              [t.followers, tn(t.followers, 'abonné', 'abonnés')],
              [t.following, tn(t.following, 'abonnement', 'abonnements')],
            ] as const
          ).map(([n, label]) => (
            <div key={label} className="member-stat">
              <b className="num">{n}</b>
              <span className="small muted">{label}</span>
            </div>
          ))}
        </div>
        <dl className="admin-facts">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="small muted">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        {!t.me && (
          <div className="stack" style={{ gap: 10 }}>
            <button
              className="btn block"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setReset(await api<{ code: string; expires: string }>(`/api/admin/users/${t.id}/reset`, { body: {} }));
                } catch (e) {
                  toast(errorText(e), true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon name="lock" size={17} />{' '}{tr('Code pour changer son mot de passe')}
            </button>
            {reset && (
              <div className="card stack" style={{ border: '2px solid var(--gold)' }}>
                <div className="small muted">{tr('Code valable 48 h')}</div>
                <div className="display num" style={{ fontSize: '1.6rem', userSelect: 'all' }}>
                  {reset.code}
                </div>
                <button
                  className="btn primary block"
                  onClick={() =>
                    shareText(
                      tr('Ton code pour changer ton mot de passe Shred : {code} (valable 48 h). Ouvre l’app, « Me connecter », « Mot de passe oublié ? », avec ton email {email}.', { code: reset.code, email: t.email }),
                    )
                  }
                >
                  <Icon name="share" size={18} />{' '}{tr('Envoyer le code')}
                </button>
              </div>
            )}
            <button
              className="btn block danger"
              disabled={busy}
              onClick={async () => {
                if (!(await ask(tr('Retirer {name} ? Son compte et toutes ses données sont supprimés du serveur.', { name: t.name }), tr('Retirer'), true))) return;
                setBusy(true);
                try {
                  await api(`/api/admin/users/${t.id}`, { method: 'DELETE' });
                  toast(tr('{name} a été retiré', { name: t.name }));
                  onRemoved();
                } catch (e) {
                  toast(errorText(e), true);
                  setBusy(false);
                }
              }}
            >
              <Icon name="trash" size={17} />{' '}{tr('Retirer ce testeur')}
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
