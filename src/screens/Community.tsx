// Les autres testeurs : leur série, leur record, leurs flammes et leur fiche de force, s'ils ont choisi de les montrer.
import { useEffect, useState } from 'react';
import { Flame } from '../components/Flame';
import { Icon } from '../components/Icon';
import { Radar } from '../components/Radar';
import { errorText, Sheet } from '../components/ui';
import { DEMO } from '../lib/api';
import { TIERS } from '../lib/flames';
import { fetchProfiles, type PublicProfile } from '../lib/profile';
import { signedIn } from '../lib/session';
import type { GroupScore } from '../lib/strength';
import { useApp } from '../lib/store';

function hue(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function Avatar({ id, name, size = 44 }: { id: string; name: string; size?: number }) {
  const h = hue(id);
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${h} 70% 55%)`, boxShadow: `0 3px 0 hsl(${h} 60% 38%)` }}
      aria-hidden="true"
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

export function Community({ openPrivacy }: { openPrivacy: () => void }) {
  const s = useApp();
  const [list, setList] = useState<PublicProfile[] | null>(null);
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState<PublicProfile | null>(null);
  const canSee = DEMO || signedIn();
  const mine = s.settings.profile.visible;

  useEffect(() => {
    if (!canSee) return;
    fetchProfiles().then(setList, (e) => setError(errorText(e)));
  }, [canSee]);

  if (!canSee) {
    return <p className="muted">Connecte-toi à ton compte pour voir les autres testeurs.</p>;
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      {!mine && (
        <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Icon name="lock" size={20} />
          <div className="grow small" style={{ flex: 1 }}>
            Ton profil est privé : les autres ne voient rien de toi.
          </div>
          <button className="btn small primary" onClick={openPrivacy}>
            Le montrer
          </button>
        </div>
      )}
      {error && <p className="small" style={{ color: 'var(--red)' }}>{error}</p>}
      {!list && !error && <div className="spinner" />}
      {list && list.length === 0 && <p className="muted">Personne n’a encore rendu son profil visible.</p>}
      {list && list.length > 0 && (
        <div className="group">
          {list.map((p) => (
            <button key={p.id} className="row" style={{ width: '100%', border: 0, background: 'none', textAlign: 'left' }} onClick={() => setOpen(p)}>
              <Avatar id={p.id} name={p.name} />
              <div className="grow">
                <div className="title">
                  {p.name} {p.me && <span className="small faint">(toi)</span>}
                </div>
                <div className="small muted">
                  {[p.best !== undefined ? `record ${p.best} j` : '', p.level !== undefined ? `niveau ${p.level}` : '', p.program ?? ''].filter(Boolean).join(' · ') || 'Profil discret'}
                </div>
              </div>
              {p.streak !== undefined && (
                <span className="stat-pill flame" aria-label={`${p.streak} jours de série`}>
                  <Flame tier={p.tier ?? 0} size={18} animated={false} />
                  {p.streak}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={openPrivacy}>
        Ce que les autres voient de moi
      </button>
      {open && <ProfileSheet p={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ProfileSheet({ p, onClose }: { p: PublicProfile; onClose: () => void }) {
  const groups: GroupScore[] | null = p.radar ? p.radar.map((r) => ({ ...r, grade: r.grade as GroupScore['grade'], lifts: [] })) : null;
  const rated = groups?.filter((g) => g.score !== null) ?? [];
  const weakest = rated.length >= 2 ? rated.reduce((a, b) => (b.score! < a.score! ? b : a)) : null;
  const strongest = rated.length >= 2 ? rated.reduce((a, b) => (b.score! > a.score! ? b : a)) : null;
  const stats = [
    p.streak !== undefined ? [p.streak, 'série'] : null,
    p.best !== undefined ? [p.best, 'record'] : null,
    p.flames !== undefined ? [p.flames, p.flames > 1 ? 'flammes' : 'flamme'] : null,
    p.level !== undefined ? [p.level, 'niveau'] : null,
  ].filter(Boolean) as [number, string][];
  return (
    <Sheet title={p.name} onClose={onClose}>
      <div className="stack" style={{ gap: 18 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <Avatar id={p.id} name={p.name} size={56} />
          <div>
            <div style={{ fontWeight: 850, fontSize: '1.2rem' }}>{p.name}</div>
            <div className="small muted">{[p.tier !== undefined ? TIERS[p.tier]?.name : '', p.program].filter(Boolean).join(' · ')}</div>
          </div>
          {p.tier !== undefined && (
            <div style={{ marginLeft: 'auto' }}>
              <Flame tier={p.tier} size={40} />
            </div>
          )}
        </div>
        {stats.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${stats.length}, 1fr)`, gap: 8 }}>
            {stats.map(([v, label]) => (
              <div key={label} className="card" style={{ padding: '12px 8px', textAlign: 'center', background: 'var(--surface-2)' }}>
                <div className="display num" style={{ fontSize: '1.6rem' }}>
                  {v}
                </div>
                <div className="small muted">{label}</div>
              </div>
            ))}
          </div>
        )}
        {groups && (
          <section className="stack">
            <h2>Fiche de force</h2>
            <Radar groups={groups} weakestId={weakest?.id} />
            {weakest && strongest && (
              <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>
                Point fort : {strongest.name.toLowerCase()}. Point faible : {weakest.name.toLowerCase()}.
              </p>
            )}
          </section>
        )}
        {!stats.length && !groups && <p className="muted">{p.name} ne montre pas encore de détails.</p>}
      </div>
    </Sheet>
  );
}
