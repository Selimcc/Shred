import { BodyPhotos } from '../components/BodyPhotos';
import { HealthStats } from '../components/HealthStats';
import { useState } from 'react';
import { Icon } from '../components/Icon';
import { Radar } from '../components/Radar';
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
import { fmtHours, LiftChart, Sparkline, useCountUp, WeekLoadChart } from '../components/Charts';
import { liftSeries, recentRecords, rollingWeeks, totalMinutes, trackedLifts, trainingWeeks } from '../lib/training';
import { DISCIPLINE_NAMES } from '../../shared/catalog';
import type { Discipline } from '../../shared/types';

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
          <Tile key={label} value={v} label={label} color={color} />
        ))}
      </div>

      <WeekHero today={today} />
      <EnduranceTiles today={today} />

      <Flames today={today} openGoals={() => openSettings('goals')} />

      {mod.strength && <Lifts today={today} />}

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
      {mod.weight && <BodyPhotos today={today} />}

      <section className="section">
        <div className="section-head">
          <h2>Records</h2>
        </div>
        <div className="group">
          {bestLifts(s).map(({ key, name, best }) => {
            const fresh = best && best.date >= addDays(today, -14);
            return (
              <div className="row" key={key}>
                <span className="grow">{name}</span>
                {fresh && <span className="tag up">Nouveau</span>}
                <span className="num muted">{best ? `${fmtKg(best.w)} × ${best.r}` : 'à venir'}</span>
              </div>
            );
          })}
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
        <h2>Santé</h2>
        <span className="small muted">Apple Santé, 7 jours</span>
      </div>
      <HealthStats s={s} today={today} />
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

function Tile({ value, label, color }: { value: number; label: string; color: string }) {
  const v = useCountUp(value);
  return (
    <div className="card" style={{ padding: '12px 10px', textAlign: 'center' }}>
      <div className="display num" style={{ fontSize: '1.8rem', color }}>
        {Math.round(v)}
      </div>
      <div className="small muted" style={{ marginTop: 4 }}>
        {label}
      </div>
    </div>
  );
}

/** La semaine en cours : le temps d'entraînement, comparé aux 4 précédentes, et 8 semaines en colonnes. */
function WeekHero({ today }: { today: string }) {
  const s = useApp();
  // Pas de colonnes vides avant tes débuts : 4 semaines au moins, 8 au plus.
  const all = trainingWeeks(s, today, 8);
  const firstUsed = all.findIndex((w) => totalMinutes(w) > 0);
  const weeks = all.slice(Math.max(0, Math.min(firstUsed < 0 ? 4 : firstUsed, all.length - 4)));
  const now = weeks[weeks.length - 1];
  const prev = weeks.slice(-5, -1).filter((w) => w.monday >= mondayOf(s.createdAt));
  const avg = prev.length ? prev.reduce((n, w) => n + totalMinutes(w), 0) / prev.length : null;
  const total = totalMinutes(now);
  const shown = useCountUp(total);
  if (!weeks.some((w) => totalMinutes(w) > 0)) return null;
  const delta = avg && avg > 10 ? (total - avg) / avg : null;
  const dayIndex = (new Date(`${today}T12:00:00`).getDay() + 6) % 7;
  return (
    <section className="section">
      <div className="section-head">
        <h2>Ta semaine</h2>
        <span className="small muted num">
          {now.sessions} séance{now.sessions > 1 ? 's' : ''}
          {now.planned ? ` sur ${now.planned}` : ''}
        </span>
      </div>
      <div className="card week-hero">
        <div className="week-hero-figure">
          <b className="display num">{fmtHours(shown)}</b>
          <span className={`small ${delta === null ? 'muted' : delta >= 0 ? 'trend-good' : 'muted'}`}>
            {delta === null
              ? 'd’entraînement cette semaine'
              : delta >= 0
                ? `+${Math.round(delta * 100)} % sur ta moyenne des 4 dernières semaines`
                : dayIndex <= 1
                  ? `Ta moyenne : ${fmtHours(avg!)} par semaine. La semaine ne fait que commencer.`
                  : dayIndex < 6
                    ? `Encore ${fmtHours(Math.max(0, avg! - total))} pour rejoindre ta moyenne de ${fmtHours(avg!)}`
                    : `${Math.round(-delta * 100)} % sous ta moyenne : semaine plus calme`}
          </span>
        </div>
        <WeekLoadChart weeks={weeks} />
      </div>
    </section>
  );
}

const DISC_VAR: Partial<Record<Discipline, string>> = { run: 'var(--d-run)', bike: 'var(--d-bike)', swim: 'var(--d-swim)', row: 'var(--d-other)', ski: 'var(--d-other)' };

/** Une tuile par sport d'endurance pratiqué : les km de la semaine, l'écart, 8 semaines en courbe. */
function EnduranceTiles({ today }: { today: string }) {
  const s = useApp();
  const weeks = rollingWeeks(s, today, 8);
  const sports = (['run', 'bike', 'swim', 'row', 'ski'] as Discipline[]).filter((d) => weeks.some((w) => (w.km[d] ?? 0) > 0.05));
  if (!sports.length) return null;
  return (
    <section className="section">
      <div className="section-head">
        <h2>Endurance</h2>
        <span className="small muted">7 derniers jours</span>
      </div>
      <div className={`endurance-tiles ${sports.length % 2 ? 'odd' : ''}`}>
        {sports.map((d) => (
          <DistanceTile key={d} d={d} values={weeks.map((w) => w.km[d] ?? 0)} />
        ))}
      </div>
    </section>
  );
}

function DistanceTile({ d, values }: { d: Discipline; values: number[] }) {
  const now = values[values.length - 1];
  const before = values[values.length - 2] ?? 0;
  const swim = d === 'swim';
  const v = useCountUp(swim ? now * 1000 : now);
  const diff = swim ? (now - before) * 1000 : now - before;
  return (
    <div className="card distance-tile">
      <div className="small muted">{DISCIPLINE_NAMES[d]}</div>
      <div className="distance-value num">
        {swim ? formatNumber(Math.round(v / 50) * 50) : formatNumber(v, v >= 100 ? 0 : 1)}
        <small>{swim ? 'm' : 'km'}</small>
      </div>
      <Sparkline values={values} color={DISC_VAR[d] ?? 'var(--d-other)'} label={`${DISCIPLINE_NAMES[d]} : 8 dernières semaines`} />
      <div className={`small ${Math.abs(diff) < (swim ? 50 : 0.5) ? 'faint' : diff > 0 ? 'trend-good' : 'muted'} num`}>
        {Math.abs(diff) < (swim ? 50 : 0.5) ? 'comme les 7 jours d’avant' : `${diff > 0 ? '+' : '−'}${swim ? formatNumber(Math.round(Math.abs(diff) / 50) * 50) : formatNumber(Math.abs(diff), 1)} ${swim ? 'm' : 'km'} vs les 7 jours d’avant`}
      </div>
    </div>
  );
}

/** Progression du 1RM estimé sur les exercices les plus suivis. */
function Lifts({ today }: { today: string }) {
  const s = useApp();
  const lifts = trackedLifts(s, today);
  const [key, setKey] = useState<string | null>(null);
  const current = lifts.find((l) => l.key === key) ?? lifts[0];
  if (!current) return null;
  const points = liftSeries(s, current.key, today);
  const first = points[0];
  const last = points[points.length - 1];
  const gain = first && last ? last.e1rm - first.e1rm : 0;
  const weeks = first && last ? Math.max(1, Math.round((Date.parse(last.date) - Date.parse(first.date)) / (7 * 86_400_000))) : 0;
  const prs = recentRecords(s, today).length;
  return (
    <section className="section">
      <div className="section-head">
        <h2>Tes charges</h2>
        {prs > 0 && (
          <span className="tag up">
            {prs} record{prs > 1 ? 's' : ''} en 2 semaines
          </span>
        )}
      </div>
      <div className="chips lift-chips" role="tablist" aria-label="Exercice">
        {lifts.map((l) => (
          <button key={l.key} role="tab" aria-selected={l.key === current.key} className={`chip ${l.key === current.key ? 'on' : ''}`} onClick={() => setKey(l.key)}>
            {l.name.replace(/ \(.*\)$/, '')}
          </button>
        ))}
      </div>
      <div className="card" style={{ padding: '14px 12px 10px' }}>
        <p style={{ margin: '0 4px 10px', fontWeight: 700 }}>
          {gain > 0.5
            ? `+${formatNumber(gain, 1)} kg de 1RM estimé en ${weeks} semaine${weeks > 1 ? 's' : ''}`
            : gain < -0.5
              ? `${formatNumber(gain, 1)} kg sur ${weeks} semaine${weeks > 1 ? 's' : ''} : fatigue ou décharge ?`
              : 'Stable : tes prochaines séances diront la suite'}
        </p>
        <LiftChart points={points} />
        <p className="small faint" style={{ margin: '6px 4px 0' }}>
          1RM estimé de ta meilleure série à chaque séance (formule d’Epley). Les points marquent tes records.
        </p>
      </div>
    </section>
  );
}
