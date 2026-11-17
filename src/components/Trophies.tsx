// Vitrine des trophées (onglet Progrès) : les derniers gagnés en médailles, et la liste complète avec la jauge
// de ceux qui restent à aller chercher.
import { useMemo, useState } from 'react';
import { parseKey } from '../lib/date';
import { useApp } from '../lib/store';
import { TIER_LABEL, type Trophy, TROPHIES, trophyStats, unlockedOf } from '../lib/trophies';
import { Icon } from './Icon';
import { Sheet } from './ui';
import { loc, tr } from '../../shared/i18n';

export function Medal({ t, on, size = 64 }: { t: Trophy; on: boolean; size?: number }) {
  return (
    <span className={`medal ${t.tier} ${on ? 'on' : 'off'}`} style={{ width: size, height: size }} aria-hidden="true">
      <span className="medal-face">
        <Icon name={t.icon} size={Math.round(size * 0.4)} />
      </span>
    </span>
  );
}

const shortDate = (k: string) => parseKey(k).toLocaleDateString(loc(), { day: 'numeric', month: 'short' });
const fmt = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000).toLocaleString(loc())} k` : n.toLocaleString(loc()));

export function TrophyCase() {
  const s = useApp();
  const [open, setOpen] = useState(false);
  const st = useMemo(() => trophyStats(s), [s]);
  const won = useMemo(() => unlockedOf(st), [st]);
  const dates = s.ui.trophies ?? {};
  const recent = [...won].sort((a, b) => (dates[b.id] ?? '').localeCompare(dates[a.id] ?? '') || TROPHIES.indexOf(b) - TROPHIES.indexOf(a)).slice(0, 4);
  // Le prochain à portée : le plus avancé parmi ceux qui restent.
  const next = TROPHIES.filter((x) => x.value(st) < x.goal).sort((a, b) => b.value(st) / b.goal - a.value(st) / a.goal)[0];

  return (
    <>
      <section className="section">
        <div className="section-head">
          <h2>{tr('Trophées')}</h2>
          <button className="link small" onClick={() => setOpen(true)}>
            {tr('{length} sur {length2}', { length: won.length, length2: TROPHIES.length })}
          </button>
        </div>
        <button className="card trophy-card" onClick={() => setOpen(true)}>
          <div className="trophy-row">
            {recent.length ? (
              recent.map((x) => <Medal key={x.id} t={x} on size={58} />)
            ) : (
              <span className="small muted">{tr('Ta première séance validée t’apporte ton premier trophée.')}</span>
            )}
          </div>
          {next && (
            <div className="trophy-next">
              <div className="small">
                {tr('Prochain :')}{' '}<b>{next.title}</b>
                <span className="faint">
                  {' '}
                  {fmt(Math.min(next.value(st), next.goal))} / {fmt(next.goal)}
                </span>
              </div>
              <div className="trophy-bar">
                <span style={{ transform: `scaleX(${Math.min(1, next.value(st) / next.goal)})` }} />
              </div>
            </div>
          )}
        </button>
      </section>

      {/* Hors de la section : son animation d'entrée ferait de la feuille un élément de la section. */}
      {open && (
        <Sheet title={tr('Trophées')} onClose={() => setOpen(false)}>
          <div className="stack" style={{ gap: 20 }}>
            {[...new Set(TROPHIES.map((x) => x.family))].map((fam) => (
              <section key={fam} className="stack" style={{ gap: 10 }}>
                <h2 style={{ fontSize: '1rem' }}>{fam}</h2>
                <div className="trophy-grid">
                  {TROPHIES.filter((x) => x.family === fam).map((x) => {
                    const on = won.includes(x);
                    const v = Math.min(x.value(st), x.goal);
                    return (
                      <div key={x.id} className={`trophy-cell ${on ? 'on' : ''}`}>
                        <Medal t={x} on={on} size={60} />
                        <div className="trophy-title">{x.title}</div>
                        <div className="small faint">{on ? (dates[x.id] ? shortDate(dates[x.id]) : TIER_LABEL[x.tier]) : `${fmt(v)} / ${fmt(x.goal)}`}</div>
                        <div className="small muted trophy-text">{x.text}</div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}
