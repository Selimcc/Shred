import { useState } from 'react';
import { Icon } from '../components/Icon';
import { Radar } from '../components/Radar';
import { StepsChart } from '../components/StepsChart';
import { toast } from '../components/ui';
import { WeightChart } from '../components/WeightChart';
import { logBody, parseDecimal } from '../lib/actions';
import { addDays, formatNumber, formatShort, mondayOf, WEEKDAY_LETTERS } from '../lib/date';
import { bestLifts, dayStatus, fmtKg, levelFor, streakInfo, totalXp, weeklyChange, weightSeries } from '../lib/logic';
import { useApp, WEIGHT_GOALS } from '../lib/store';
import { strengthProfile } from '../lib/strength';
import { focusPlan } from '../lib/advisor';
import { gymDuration } from '../lib/health';
import { Flame } from '../components/Flame';
import { flameInfo, TIERS, tierAt } from '../lib/flames';
import { Community } from './Community';
import type { SettingsPage } from './Settings';
import { ReportSheet } from '../components/ReportSheet';
import { weeklyReport } from '../lib/report';

const WEEKS = 12;

export function Progress({ today, openSettings, openCoach }: { today: string; openSettings: (page?: SettingsPage) => void; openCoach: () => void }) {
  const s = useApp();
  const [view, setView] = useState<'me' | 'others'>('me');
  const st = streakInfo(s, today);
  const lvl = levelFor(totalXp(s));
  const series = weightSeries(s, 56, today);
  const change = weeklyChange(s, today);
  const mod = s.settings.modules;
  const goal = WEIGHT_GOALS[s.settings.weightGoal];
  const recent = Object.entries(s.body.weight)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 7);

  return (
    <>
      <header className="topbar">
        <div>
          <div className="date">{view === 'me' ? `Depuis le ${formatShort(s.createdAt)}` : 'Les autres testeurs'}</div>
          <h1>{view === 'me' ? 'Ma fiche' : 'Profils'}</h1>
        </div>
        <button className="icon-btn" onClick={() => openSettings()} aria-label="Réglages">
          <Icon name="gear" />
        </button>
      </header>

      <div className="seg" role="tablist" aria-label="Fiche" style={{ marginBottom: 16 }}>
        <button role="tab" aria-selected={view === 'me'} className={view === 'me' ? 'on' : ''} onClick={() => setView('me')}>
          Moi
        </button>
        <button role="tab" aria-selected={view === 'others'} className={view === 'others' ? 'on' : ''} onClick={() => setView('others')}>
          Testeurs
        </button>
      </div>

      {view === 'others' ? (
        <Community openPrivacy={() => openSettings('publicProfile')} />
      ) : (
        <>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {(
          [
            [st.current, 'série', 'var(--flame)'],
            [st.best, 'record', 'var(--ink)'],
            [st.freezes, st.freezes > 1 ? 'gels' : 'gel', 'var(--ice)'],
            [lvl.level, 'niveau', 'var(--gold)'],
          ] as const
        ).map(([v, label, color]) => (
          <div key={label} className="card" style={{ padding: '12px 10px', textAlign: 'center' }}>
            <div className="display num" style={{ fontSize: '1.8rem', color }}>
              {v}
            </div>
            <div className="small muted" style={{ marginTop: 4 }}>
              {label}
            </div>
          </div>
        ))}
      </div>

      <Flames today={today} openGoals={() => openSettings('goals')} />

      <Reports today={today} openCoach={openCoach} />

      {mod.strength && <Strength today={today} />}
      {mod.strength && <Focus today={today} />}

      {(mod.health || mod.gym) && <ActivitySection today={today} />}

      <section className="section">
        <div className="section-head">
          <h2>12 dernières semaines</h2>
        </div>
        <Calendar today={today} />
      </section>

      {mod.weight && (
      <section className="section">
        <div className="section-head">
          <h2>Poids</h2>
          {change !== null && (
            <span className={`tag num ${change >= goal.min && change <= goal.max ? 'up' : 'warn'}`}>
              {change > 0 ? '+' : ''}
              {formatNumber(change, 2)} kg/sem
            </span>
          )}
        </div>
        <div className="group" style={{ padding: '12px 12px 8px' }}>
          <WeightChart data={series} />
        </div>
        <p className="small muted" style={{ margin: '8px 2px 0' }}>
          {goal.label} : entre {formatNumber(goal.min, 1)} et {formatNumber(goal.max, 1)} kg par semaine sur la moyenne.
        </p>
        {recent.length > 0 && (
          <div className="group" style={{ marginTop: 10 }}>
            {recent.map(([date, kg]) => (
              <div className="row" key={date} style={{ minHeight: 44, padding: '10px 16px' }}>
                <span className="grow muted">{formatShort(date)}</span>
                <span className="num">{formatNumber(kg, 1)} kg</span>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {mod.weight && <Waist today={today} />}

      <section className="section">
        <div className="section-head">
          <h2>Records</h2>
        </div>
        <div className="group">
          {bestLifts(s).map(({ key, name, best }) => (
            <div className="row" key={key}>
              <span className="grow">{name}</span>
              <span className="num muted">{best ? `${fmtKg(best.w)} × ${best.r}` : 'à venir'}</span>
            </div>
          ))}
        </div>
      </section>
        </>
      )}
    </>
  );
}

function Calendar({ today }: { today: string }) {
  const s = useApp();
  const start = addDays(mondayOf(today), -7 * (WEEKS - 1));
  const colors: Record<string, string> = {
    validated: 'var(--green)',
    frozen: 'var(--ice)',
    missed: 'var(--line)',
    today: 'var(--surface)',
    future: 'transparent',
    empty: 'transparent',
  };
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: `16px repeat(${WEEKS}, 1fr)`, gap: 4 }}>
        {Array.from({ length: 7 }, (_, row) => (
          <Row key={row} row={row} start={start} today={today} colors={colors} s={s} />
        ))}
      </div>
      <div className="small muted" style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
        <Legend color="var(--green)" label="Validé" />
        <Legend color="var(--ice)" label="Protégé par un gel" />
        <Legend color="var(--line)" label="Manqué" />
      </div>
    </div>
  );
}

function Row({
  row,
  start,
  today,
  colors,
  s,
}: {
  row: number;
  start: string;
  today: string;
  colors: Record<string, string>;
  s: ReturnType<typeof useApp>;
}) {
  return (
    <>
      <span className="faint" style={{ fontSize: 10, lineHeight: '1', alignSelf: 'center' }}>
        {WEEKDAY_LETTERS[(row + 1) % 7]}
      </span>
      {Array.from({ length: WEEKS }, (_, w) => {
        const key = addDays(start, w * 7 + row);
        const status = dayStatus(s, key, today);
        return (
          <span
            key={key}
            title={`${formatShort(key)}`}
            style={{
              aspectRatio: '1',
              borderRadius: 4,
              background: colors[status],
              outline: status === 'today' ? '2px solid var(--ink)' : status === 'future' ? '1px solid var(--line)' : 'none',
              outlineOffset: -1,
              opacity: status === 'empty' ? 0.3 : 1,
            }}
          />
        );
      })}
    </>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <i style={{ width: 10, height: 10, borderRadius: 3, background: color, display: 'inline-block' }} />
      {label}
    </span>
  );
}

function Waist({ today }: { today: string }) {
  const s = useApp();
  const [draft, setDraft] = useState('');
  const entries = Object.entries(s.body.waist).sort(([a], [b]) => b.localeCompare(a));
  const save = () => {
    const cm = parseDecimal(draft);
    if (cm === undefined || cm < 40 || cm > 200) return toast('Entre un tour de taille valide en cm', true);
    logBody('waist', today, cm);
    setDraft('');
    toast('Tour de taille enregistré');
  };
  return (
    <section className="section">
      <div className="section-head">
        <h2>Tour de taille</h2>
        {entries.length > 1 && (
          <span className="small muted num">
            {formatNumber(entries[0][1] - entries[entries.length - 1][1], 1)} cm depuis le début
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <input
          className="input num"
          inputMode="decimal"
          placeholder="cm, au nombril"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          aria-label="Tour de taille en cm"
        />
        <button className="btn primary" onClick={save} disabled={!draft.trim()}>
          Enregistrer
        </button>
      </div>
      {entries.length > 0 && (
        <p className="small muted num" style={{ margin: '8px 2px 0' }}>
          {entries
            .slice(0, 4)
            .map(([d, v]) => `${formatShort(d)} : ${formatNumber(v, 1)} cm`)
            .join(', ')}
        </p>
      )}
    </section>
  );
}

function Strength({ today }: { today: string }) {
  const s = useApp();
  const p = strengthProfile(s, today);
  const rated = p.groups.filter((g) => g.grade);
  return (
    <section className="section">
      <div className="section-head">
        <h2>Fiche de force</h2>
        <span className="small muted">8 dernières semaines</span>
      </div>
      <div className="card" style={{ padding: '8px 8px 12px' }}>
        <Radar groups={p.groups} weakestId={p.weakest?.id} />
        <p className="small muted" style={{ margin: '0 8px', textAlign: 'center' }}>
          {rated.length === 0
            ? 'Note tes charges en séance : chaque groupe reçoit une note de E à A.'
            : p.weakest
              ? `Point faible : ${p.weakest.name.toLowerCase()} (${p.weakest.grade}). Point fort : ${p.strongest?.name.toLowerCase()} (${p.strongest?.grade}).`
              : 'Encore quelques séances pour comparer tes groupes musculaires.'}
        </p>
      </div>
      <div className="group" style={{ marginTop: 10 }}>
        {p.groups.map((g) => {
          const best = g.lifts.reduce<(typeof g.lifts)[number] | null>((a, l) => (!a || l.score > a.score ? l : a), null);
          const weak = g.id === p.weakest?.id;
          return (
            <div className="row" key={g.id}>
              <span className={`grade ${weak ? 'weak' : (g.grade ?? '')}`}>{g.grade ?? '?'}</span>
              <div className="grow">
                <div className="title">{g.name}</div>
                <div className="small muted num">
                  {best
                    ? `Meilleure série : ${best.name.replace(/ \(.*\)$/, '')}, ${best.bodyweight ? `+${formatNumber(best.w, 1)} kg de lest` : `${formatNumber(best.w, 1)} kg`} × ${best.r}`
                    : 'Pas encore de charge notée'}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="small faint" style={{ margin: '8px 2px 0' }}>
        Notes indicatives : 1RM estimé (formule d’Epley) rapporté à {p.estimatedBodyweight ? 'un poids de 75 kg, pèse-toi pour affiner' : `ton poids (${formatNumber(p.bodyweight, 1)} kg)`}, comparé à des repères de force débutant à avancé.
      </p>
    </section>
  );
}

function Focus({ today }: { today: string }) {
  const s = useApp();
  const f = focusPlan(s, today);
  if (!f.logged) return null;
  const color = { low: 'var(--flame)', ok: 'var(--green)', high: 'var(--blue)' } as const;
  return (
    <section className="section">
      <div className="section-head">
        <h2>Où mettre l’effort</h2>
        <span className="small muted">séries / semaine</span>
      </div>
      {f.headline && <p style={{ margin: '0 2px 10px', fontWeight: 700 }}>{f.headline}</p>}
      <div className="group">
        {f.items.map((i) => (
          <div className="row" key={i.group} style={{ alignItems: 'flex-start' }}>
            <div className="grow">
              <div className="title">
                {i.name} {i.weak && <span className="tag up">point faible</span>}
              </div>
              <div className="focus-bar">
                <i style={{ width: `${Math.min(100, (i.sets / i.target[1]) * 100)}%`, background: color[i.status] }} />
              </div>
              <div className="small muted" style={{ marginTop: 4 }}>{i.text}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="small faint" style={{ margin: '8px 2px 0' }}>
        Moyenne des 2 dernières semaines. Repères hypertrophie : environ 10 à 20 séries par muscle et par semaine.
      </p>
    </section>
  );
}

function ActivitySection({ today }: { today: string }) {
  const s = useApp();
  if (Object.keys(s.health).length === 0) return null;
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, -i));
  const visits = week.filter((d) => s.health[d]?.gymIn);
  const durations = visits
    .map((d) => {
      const h = s.health[d];
      return h?.gymIn && h.gymOut ? (new Date(h.gymOut).getTime() - new Date(h.gymIn).getTime()) / 60000 : null;
    })
    .filter((m): m is number => m !== null && m > 0 && m < 600);
  const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
  const lastVisit = visits[0] ? s.health[visits[0]] : undefined;
  return (
    <section className="section">
      <div className="section-head">
        <h2>Activité</h2>
        <span className="small muted">Apple Santé</span>
      </div>
      <div className="card">
        <StepsChart health={s.health} today={today} />
      </div>
      <p className="small muted" style={{ margin: '10px 2px 0' }}>
        {visits.length
          ? `${visits.length} passage${visits.length > 1 ? 's' : ''} à la salle ces 7 derniers jours${avg ? `, ${avg} min en moyenne` : ''}.${lastVisit && gymDuration(lastVisit) ? ` Dernière séance : ${gymDuration(lastVisit)}.` : ''}`
          : 'Aucun passage à la salle détecté ces 7 derniers jours.'}
      </p>
    </section>
  );
}

/** Les flammes gagnées et les prochaines, de plus en plus espacées. */
function Flames({ today, openGoals }: { today: string; openGoals: () => void }) {
  const s = useApp();
  const f = flameInfo(s, today);
  // Quatre badges : les deux dernières flammes gagnées et les suivantes à gagner.
  const start = Math.max(0, f.earned.length - 2);
  const shown = f.steps.slice(start, start + 4);
  return (
    <section className="section">
      <div className="section-head">
        <h2>Mes flammes</h2>
        <button className="link small" onClick={openGoals}>
          Objectif : {f.goal} jours
        </button>
      </div>
      <div className="card stack" style={{ gap: 14 }}>
        <div className="flame-row">
          {shown.map((n, j) => {
            const i = start + j;
            const got = n <= f.best;
            return (
              <div key={n} className={`flame-badge ${got ? '' : 'locked'}`} title={got ? TIERS[tierAt(i + 1)].name : `À ${n} jours`}>
                <Flame tier={tierAt(i + 1)} size={34} animated={false} />
                <span className="small num" style={{ fontWeight: 800 }}>
                  {n} j
                </span>
              </div>
            );
          })}
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <div className="bar">
            <i style={{ width: `${Math.min(100, Math.round((f.current / f.next) * 100))}%`, background: `linear-gradient(90deg, ${f.tierInfo.colors[0]}, ${f.tierInfo.colors[1]})` }} />
          </div>
          <div className="small muted">
            {f.earned.length ? `${f.tierInfo.name}, ${f.earned.length} flamme${f.earned.length > 1 ? 's' : ''} gagnée${f.earned.length > 1 ? 's' : ''}. ` : ''}
            Prochaine à {f.next} jours : encore {f.toNext} jour{f.toNext > 1 ? 's' : ''} validé{f.toNext > 1 ? 's' : ''}.
          </div>
        </div>
      </div>
    </section>
  );
}

/** Les bilans des dernières semaines, et celui de la semaine en cours. */
function Reports({ today, openCoach }: { today: string; openCoach: () => void }) {
  const s = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const first = mondayOf(s.createdAt);
  const weeks = [0, 1, 2, 3].map((i) => addDays(mondayOf(today), -7 * i)).filter((m) => m >= first);
  if (!weeks.length) return null;
  return (
    <section className="section">
      <div className="section-head">
        <h2>Bilans</h2>
        <span className="small muted">Chaque lundi</span>
      </div>
      <div className="group">
        {weeks.map((m, i) => (
          <button key={m} className="row" style={{ width: '100%', border: 0, background: 'none', textAlign: 'left' }} onClick={() => setOpen(m)}>
            <div className="grow">
              <div className="title">{i === 0 ? 'Semaine en cours' : `Semaine du ${formatShort(m)}`}</div>
              <div className="small muted">{weeklyReport(s, m).headline}</div>
            </div>
            {i === 1 && s.ui.reportSeen !== m && <span className="tag blue">Nouveau</span>}
            <Icon name="chevron" size={18} />
          </button>
        ))}
      </div>
      {open && <ReportSheet monday={open} onClose={() => setOpen(null)} openCoach={openCoach} />}
    </section>
  );
}
