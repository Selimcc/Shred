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
  if (!at) return 'Pas encore vu';
  const m = Math.round((now - at) / 60_000);
  if (m < 5) return 'En ligne';
  if (m < 60) return `Vu il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `Vu il y a ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'Vu hier' : d < 30 ? `Vu il y a ${d} jours` : `Vu le ${new Date(at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
}

const date = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

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
          Réessayer
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
    { id: 'all', n: counts.all, label: counts.all > 1 ? 'testeurs' : 'testeur' },
    { id: 'online', n: counts.online, label: 'en ligne' },
    { id: 'today', n: counts.today, label: 'aujourd’hui' },
    { id: 'idle', n: counts.idle, label: 'absents 7 j' },
  ];

  return (
    <div className="stack" style={{ gap: 16 }}>
      <SeasonLabCard />
      <div className="admin-tiles" role="group" aria-label="Filtrer les testeurs">
        {tiles.map((t) => (
          <button key={t.id} className={`admin-tile ${filter === t.id ? 'on' : ''} ${t.id}`} onClick={() => setFilter(t.id)} aria-pressed={filter === t.id}>
            <span className="admin-tile-n num">{t.n}</span>
            <span className="small">{t.label}</span>
          </button>
        ))}
      </div>

      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Prénom, @pseudo ou email" aria-label="Chercher un testeur" />

      {list.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          Personne dans cette vue.
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
                    {t.name} {t.role === 'admin' && <span className="badge-admin">ADMIN</span>} {t.me && <span className="small faint">(toi)</span>}
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
        « En ligne » : actif dans les 5 dernières minutes. La version en orange n’a pas encore pris la mise à jour {data.version}.
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
        <h2 style={{ fontSize: '1.05rem' }}>Tester les fêtes</h2>
        {lab && (
          <button className="link small" onClick={() => setSeasonLab(null)}>
            Arrêter
          </button>
        )}
      </div>
      <p className="small muted" style={{ margin: '4px 0 12px' }}>
        Sur cet appareil seulement, jusqu’à la fermeture de l’app. Personne d’autre ne le voit.
      </p>
      <div className="season-lab-row" role="group" aria-label="Fête à tester">
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
            <span className="small">Simuler le jour J ({SEASONS[lab.season].wish})</span>
          </label>
          <button className="btn small" onClick={playSeasonScene}>
            <Icon name="play" size={14} filled /> Lancer la scène
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
    ['Dernière visite', t.lastSeen ? `${since(t.lastSeen, now)}${t.lastSeen && now - t.lastSeen >= ONLINE ? ` (${new Date(t.lastSeen).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })})` : ''}` : 'Pas encore vu depuis le suivi'],
    ['Appareil', t.platform ?? 'Inconnu'],
    ['Version', t.version ? `${t.version}${older(t.version, current) ? ` (à jour : ${current})` : ''}` : 'Inconnue'],
    ['Séance du jour envoyée', t.lastDay ? (t.lastDay === today ? 'Aujourd’hui' : new Date(t.lastDay).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })) : 'Jamais'],
    ['Inscrit le', date(t.createdAt)],
    ['Email', t.email],
    ['Compte', t.private ? 'Privé' : 'Public'],
  ];
  return (
    <Sheet title={t.name} onClose={onClose}>
      <div className="stack" style={{ gap: 16 }}>
        <div className="member-head">
          <MemberAvatar m={t} size={64} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 850, fontSize: '1.3rem' }}>
              {t.name} {t.role === 'admin' && <span className="badge-admin">ADMIN</span>}
            </div>
            {t.handle && <div className="small member-handle">@{t.handle}</div>}
          </div>
        </div>
        <div className="member-stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {(
            [
              [t.posts, t.posts > 1 ? 'publications' : 'publication'],
              [t.followers, t.followers > 1 ? 'abonnés' : 'abonné'],
              [t.following, t.following > 1 ? 'abonnements' : 'abonnement'],
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
              <Icon name="lock" size={17} /> Code pour changer son mot de passe
            </button>
            {reset && (
              <div className="card stack" style={{ border: '2px solid var(--gold)' }}>
                <div className="small muted">Code valable 48 h</div>
                <div className="display num" style={{ fontSize: '1.6rem', userSelect: 'all' }}>
                  {reset.code}
                </div>
                <button
                  className="btn primary block"
                  onClick={() =>
                    shareText(
                      `Ton code pour changer ton mot de passe Shred : ${reset.code} (valable 48 h). Ouvre l’app, « Me connecter », « Mot de passe oublié ? », avec ton email ${t.email}.`,
                    )
                  }
                >
                  <Icon name="share" size={18} /> Envoyer le code
                </button>
              </div>
            )}
            <button
              className="btn block danger"
              disabled={busy}
              onClick={async () => {
                if (!(await ask(`Retirer ${t.name} ? Son compte et toutes ses données sont supprimés du serveur.`, 'Retirer', true))) return;
                setBusy(true);
                try {
                  await api(`/api/admin/users/${t.id}`, { method: 'DELETE' });
                  toast(`${t.name} a été retiré`);
                  onRemoved();
                } catch (e) {
                  toast(errorText(e), true);
                  setBusy(false);
                }
              }}
            >
              <Icon name="trash" size={17} /> Retirer ce testeur
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
