// Récap du mois en story, façon « Wrapped ». Chaque écran a sa couleur, qui se répand depuis le doigt ; les chiffres
// claquent, le calendrier du mois s'allume, les barres poussent, les records tombent, puis le profil du mois se
// révèle. Touche à droite pour avancer, à gauche pour revenir, appui long pour mettre en pause. Rien ne part au
// serveur : la carte à partager est dessinée sur le téléphone.
//
// Tout ce qui bouge anime transform / opacity, et jamais une opacité dans une autre (le navigateur les compose
// sans recalculer la page).
import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { dayKey, parseKey } from '../lib/date';
import { flameInfo } from '../lib/flames';
import { leave } from '../lib/leave';
import {
  delta,
  fmtDuration,
  fmtTonnes,
  monthName,
  monthRecap,
  type MonthRecap as Recap,
  ofMonth,
  PROFILE_COLOR,
  recapMonths,
  tonnageLike,
  tonnageUnit,
  weightVerdict,
} from '../lib/monthRecap';
import { reducedMotion } from '../lib/motion';
import { getState, setState, useApp, type WeightGoal } from '../lib/store';
import { drawMonthStory, shareStory, storyBlob } from '../lib/storyCard';
import { TROPHIES } from '../lib/trophies';
import { Icon } from './Icon';
import { Pulse } from './Pulse';
import { Medal } from './Trophies';
import { errorText, toast, useScrollLock } from './ui';
import { loc, pct, tn, tr } from '../../shared/i18n';

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
const css = (o: Record<string, string | number>) => o as CSSProperties;
/** Le très gros chiffre tient sur une ligne : la taille suit le nombre de caractères. */
const fit = (text: string) => css({ '--len': [...text].length });

type SlideId = 'intro' | 'sessions' | 'volume' | 'best' | 'records' | 'top' | 'rhythm' | 'body' | 'trophies' | 'profile' | 'outro';

/** Fond (il se répand en cercle au changement d'écran), encre et accent de chaque écran. */
export const RECAP_THEME: Record<SlideId, { bg: string; ink: string; accent: string }> = {
  intro: { bg: '#2747ff', ink: '#ffffff', accent: '#c6ff4a' },
  sessions: { bg: '#ff6a1a', ink: '#1c0b02', accent: '#fff4e8' },
  volume: { bg: '#ffd23f', ink: '#1b1400', accent: '#8a5a00' },
  best: { bg: '#ff3b6b', ink: '#ffffff', accent: '#ffe066' },
  records: { bg: '#101114', ink: '#ffffff', accent: '#ffd166' },
  top: { bg: '#2ee6a0', ink: '#03170f', accent: '#ffffff' },
  rhythm: { bg: '#7c4dff', ink: '#ffffff', accent: '#ffd166' },
  body: { bg: '#14b8b0', ink: '#021716', accent: '#ffffff' },
  trophies: { bg: '#141a33', ink: '#ffffff', accent: '#ffd166' },
  profile: { bg: '#0a0a0d', ink: '#ffffff', accent: '#86b9ff' },
  outro: { bg: '#16181d', ink: '#ffffff', accent: '#ffd166' },
};

interface Slide {
  id: SlideId;
  /** Durée à l'écran, en ms. */
  ms: number;
  body: ReactNode;
}

/* ---------- Petits morceaux ---------- */

/** Un nombre qui monte de 0 à sa valeur quand l'écran s'affiche. */
function CountUp({ value, decimals = 0, suffix = '', ms = 1100 }: { value: number; decimals?: number; suffix?: string; ms?: number }) {
  const [v, setV] = useState(() => (reducedMotion() ? value : 0));
  useEffect(() => {
    if (reducedMotion()) return setV(value);
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  const f = 10 ** decimals;
  return (
    <>
      {(Math.round(v * f) / f).toLocaleString(loc(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </>
  );
}

/** Tonnage animé : en tonnes à partir d'une tonne. */
function Tonnage({ kg }: { kg: number }) {
  return kg >= 1000 ? <CountUp value={Math.round(kg / 100) / 10} decimals={1} suffix={'\u00a0t'} /> : <CountUp value={Math.round(kg)} suffix={'\u00a0kg'} />;
}

/** Un mot dont les lettres tombent l'une après l'autre. */
function Letters({ text }: { text: string }) {
  return (
    <span className="rc-letters" aria-label={text}>
      {[...text].map((c, i) => (
        <span key={i} aria-hidden="true" style={css({ '--i': i })}>
          {c === ' ' ? ' ' : c}
        </span>
      ))}
    </span>
  );
}

/** Entre en scène après `d` dixièmes de seconde, avec l'effet `fx` (monte, claque, glisse). */
function In({ d = 0, fx = 'up', className = '', children }: { d?: number; fx?: 'up' | 'slam' | 'left' | 'pop'; className?: string; children: ReactNode }) {
  return (
    <div className={`rc-in ${fx} ${className}`} style={css({ '--d': `${d * 100}ms` })}>
      {children}
    </div>
  );
}

const DAY_LETTERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/** Le mois en calendrier : les jours de séance s'allument dans l'ordre, une étoile les jours de record. */
function Calendar({ cal }: { cal: Recap['cal'] }) {
  let n = 0;
  return (
    <div className="rc-cal" role="img" aria-label={tr('{length} jours de séance sur le mois', { length: cal.days.filter((d) => d.trained).length })}>
      {DAY_LETTERS.map((l, i) => (
        <b key={`h${i}`}>{l}</b>
      ))}
      {Array.from({ length: cal.offset }, (_, i) => (
        <span key={`o${i}`} className="blank" />
      ))}
      {cal.days.map((d, i) => (
        <span key={i} className={`${d.trained ? 'on' : ''}${d.future ? ' future' : ''}`} style={d.trained ? css({ '--i': n++ }) : undefined}>
          {i + 1}
          {d.record && (
            <svg className="rc-star" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M5 0l1.5 3.4L10 3.8 7.4 6.2 8.1 10 5 8.1 1.9 10l.7-3.8L0 3.8l3.5-.4Z" />
            </svg>
          )}
        </span>
      ))}
    </div>
  );
}

/** Des barres qui poussent ; `hi` : celle à mettre en avant. */
function Bars({ values, labels, hi }: { values: number[]; labels: string[]; hi?: number }) {
  const max = Math.max(1, ...values);
  return (
    <div className="rc-bars" style={css({ '--n': values.length })}>
      {values.map((v, i) => (
        <div key={i} className={`rc-bar${i === hi ? ' hi' : ''}`}>
          <span className="num">{v || ''}</span>
          <i style={css({ '--h': (v / max).toFixed(3), '--i': i })} />
          <b>{labels[i]}</b>
        </div>
      ))}
    </div>
  );
}

/** La courbe des pesées du mois, tracée de gauche à droite. */
function WeightLine({ points }: { points: { date: string; kg: number }[] }) {
  const W = 300;
  const H = 96;
  const kgs = points.map((p) => p.kg);
  const lo = Math.min(...kgs);
  const hi = Math.max(...kgs);
  const span = Math.max(0.6, hi - lo);
  const t0 = parseKey(points[0].date).getTime();
  const t1 = Math.max(t0 + 1, parseKey(points[points.length - 1].date).getTime());
  const xy = points.map((p) => [8 + ((parseKey(p.date).getTime() - t0) / (t1 - t0)) * (W - 16), 10 + (1 - (p.kg - lo) / span) * (H - 20)] as const);
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [x0, y0] = xy[0];
  const [x1, y1] = xy[xy.length - 1];
  return (
    <svg className="rc-weight" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <path d={`${d} L${x1} ${H} L${x0} ${H} Z`} className="area" />
      <path d={d} className="line" pathLength={1} />
      <circle cx={x0} cy={y0} r="5" className="dot" />
      <circle cx={x1} cy={y1} r="7" className="dot end" />
    </svg>
  );
}

/** Les objets du « poids de… », dessinés et comptés. */
function UnitIcon({ kind }: { kind: 'car' | 'elephant' | 'truck' | 'whale' }) {
  switch (kind) {
    case 'car':
      return (
        <svg viewBox="0 0 48 30" aria-hidden="true">
          <path d="M3 21c0-3 2-5 5-5h4l6-6.5c1-1 2.5-1.5 4-1.5h9c1.6 0 3 .7 4 2l4 6h2c3 0 5 2 5 5v3H3Z" />
          <path d="M19 15.5 23 11h4v4.5ZM30 11h3l3 4.5h-6Z" className="cut" />
          <circle cx="13" cy="24" r="4.4" />
          <circle cx="36" cy="24" r="4.4" />
          <circle cx="13" cy="24" r="1.6" className="cut" />
          <circle cx="36" cy="24" r="1.6" className="cut" />
        </svg>
      );
    case 'elephant':
      return (
        <svg viewBox="0 0 48 34" aria-hidden="true">
          <path d="M10 30v-9c0-8 6-14 15-14h5c7 0 12 4 13 10 .4 2.4.4 5 0 7.6-.4 2-1 4-2.2 5.4H37v-6h-3v6h-5v-7h-9v7h-5v-6h-3v6Z" />
          <path d="M42 15c2 3 3 7 2 11-.5 2 1 3 2.5 2.4" fill="none" strokeWidth="3.4" strokeLinecap="round" className="trunk" />
          <path d="M28 9c-3 2-4 6-2 10 2 3 6 3 8 1" className="cut ear" />
          <circle cx="38" cy="14" r="1.3" className="cut" />
          <path d="M10 18c-3 1-5 4-5 7" fill="none" strokeWidth="1.6" strokeLinecap="round" className="trunk" />
        </svg>
      );
    case 'truck':
      return (
        <svg viewBox="0 0 56 30" aria-hidden="true">
          <rect x="2" y="5" width="32" height="17" rx="2" />
          <path d="M36 10h9l6 7v7H36Z" />
          <path d="M39 12.5h5l3.6 4.5H39Z" className="cut" />
          <circle cx="10" cy="24.5" r="3.8" />
          <circle cx="19" cy="24.5" r="3.8" />
          <circle cx="44" cy="24.5" r="3.8" />
          <circle cx="10" cy="24.5" r="1.4" className="cut" />
          <circle cx="19" cy="24.5" r="1.4" className="cut" />
          <circle cx="44" cy="24.5" r="1.4" className="cut" />
        </svg>
      );
    case 'whale':
      return (
        <svg viewBox="0 0 56 30" aria-hidden="true">
          <path d="M6 18C8 9 18 5 28 6c10 1 16 6 17 12 .5 4-2 7-7 7H15C9 25 5 22 6 18Z" />
          <path d="M44 15l7-8c1 4 1 7-1 9 3 1 4 4 4 7-4-1-7-3-10-5Z" />
          <circle cx="14" cy="15" r="1.4" className="cut" />
          <path d="M10 21c5 2 12 2 18 1" fill="none" strokeWidth="1.4" className="trunk cut" />
        </svg>
      );
  }
}

/** Pluie de confettis, une fois. */
function Confetti({ n = 26, colors }: { n?: number; colors: string[] }) {
  return (
    <div className="rc-confetti" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <i
          key={i}
          style={css({
            left: `${(i * 37) % 100}%`,
            background: colors[i % colors.length],
            '--x': `${((i * 53) % 70) - 35}px`,
            '--r': `${360 + ((i * 97) % 540)}deg`,
            '--w': `${6 + (i % 3) * 2}px`,
            animationDelay: `${((i * 7) % 12) * 45}ms`,
            animationDuration: `${1900 + ((i * 13) % 9) * 120}ms`,
          })}
        />
      ))}
    </div>
  );
}

/** Éclats dorés autour d'un chiffre (records). */
function Burst({ n = 12 }: { n?: number }) {
  return (
    <span className="rc-burst" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <i key={i} style={css({ '--a': `${(i * 360) / n}deg`, '--s': i % 2 ? 0.7 : 1 })} />
      ))}
    </span>
  );
}

/* ---------- Les écrans ---------- */

function slidesOf(r: Recap, partial: boolean, goal: WeightGoal, tier: number): Slide[] {
  const out: Slide[] = [];
  const M = cap(r.name);

  out.push({
    id: 'intro',
    ms: 4600,
    body: (
      <>
        <In d={1} fx="left">
          <p className="rc-kicker">{tr('Ton mois {ofMonth}', { ofMonth: ofMonth(r.month) })}</p>
        </In>
        <h2 className="display rc-month" style={fit(M)}>
          <Letters text={M} />
        </h2>
        <In d={9}>
          <p className="rc-line">{partial ? tr('Pas encore fini, mais déjà de quoi en parler.') : tr('Un mois de plus dans les jambes. On rembobine ?')}</p>
        </In>
        <In d={12} fx="pop" className="rc-host">
          <Pulse mood="cheer" tier={tier} size={112} season={null} />
        </In>
      </>
    ),
  });

  const diff = r.prev ? r.sessions - r.prev.sessions : 0;
  out.push({
    id: 'sessions',
    ms: 6600,
    body: (
      <>
        <In d={1} fx="left">
          <p className="rc-kicker">{tr('Séances validées')}</p>
        </In>
        <In d={2} fx="slam">
          <div className="display rc-big num" style={fit(String(r.sessions))}>
            <CountUp value={r.sessions} />
          </div>
        </In>
        <In d={4}>
          <Calendar cal={r.cal} />
        </In>
        <In d={8}>
          <p className="rc-line">{r.sessions > 1 ? tr('{perWeek} par semaine en moyenne.', { perWeek: r.perWeek.toLocaleString(loc()) }) : tr('La première, et c’est la plus dure.')}</p>
        </In>
        {r.prev && diff !== 0 && (
          <In d={10} fx="pop">
            <p className="rc-chip">
              {diff > 0 ? <Icon name="chart" size={16} /> : null}
              {diff > 0 ? tr('{diff} de plus qu’en {name}', { diff, name: r.prev.name }) : tr('{v} de moins qu’en {name}', { v: -diff, name: r.prev.name })}
              {partial ? tr(' à la même date') : ''}
            </p>
          </In>
        )}
      </>
    ),
  });

  if (r.tonnage >= 500) {
    const unit = tonnageUnit(r.tonnage);
    const like = tonnageLike(r.tonnage);
    const d = delta(r.tonnage, r.prev?.tonnage);
    out.push({
      id: 'volume',
      ms: 6200,
      body: (
        <>
          <In d={1} fx="left">
            <p className="rc-kicker">{tr('Soulevé ce mois-ci')}</p>
          </In>
          <In d={2} fx="slam">
            <div className="display rc-big num" style={fit(fmtTonnes(r.tonnage))}>
              <Tonnage kg={r.tonnage} />
            </div>
          </In>
          {like && (
            <In d={6}>
              <p className="rc-line">{like}</p>
            </In>
          )}
          {unit && (
            <div className={`rc-units n${Math.min(unit.n, 10)}`} aria-hidden="true">
              {Array.from({ length: Math.min(unit.n, 10) }, (_, i) => (
                <span key={i} style={css({ '--i': i })}>
                  <UnitIcon kind={unit.key} />
                </span>
              ))}
              {unit.n > 10 && <b className="num">× {unit.n}</b>}
            </div>
          )}
          <In d={10}>
            <p className="rc-sub num">
              {tr('En {sets} séries', { sets: r.sets.toLocaleString(loc()) })}{r.minutes >= 30 ? tr(', {duration} d’entraînement', { duration: fmtDuration(r.minutes) }) : ''}.
            </p>
          </In>
          {d && r.prev && (
            <In d={12} fx="pop">
              <p className="rc-chip">{tr('{d} sur {name}', { d, name: r.prev.name })}</p>
            </In>
          )}
        </>
      ),
    });
  }

  if (r.best && r.sessions >= 2) {
    const day = new Intl.DateTimeFormat(loc(), { weekday: 'long', day: 'numeric' }).format(parseKey(r.best.date));
    out.push({
      id: 'best',
      ms: 5000,
      body: (
        <>
          <In d={1} fx="left">
            <p className="rc-kicker">{tr('Ta séance la plus lourde')}</p>
          </In>
          <In d={2} fx="slam">
            <h2 className="display rc-name">{cap(day)}</h2>
          </In>
          <In d={5}>
            <div className="display rc-mid num">
              <Tonnage kg={r.best.tonnage} />
            </div>
          </In>
          <In d={8}>
            <p className="rc-line num">
              {tr('En {sets} séries. Ce jour-là, la barre a compris.', { sets: r.best.sets })}
            </p>
          </In>
        </>
      ),
    });
  }

  if (r.recordCount > 0) {
    const top = r.records[0];
    out.push({
      id: 'records',
      ms: 6800,
      body: (
        <>
          <In d={1} fx="left">
            <p className="rc-kicker">{tr('Records battus')}</p>
          </In>
          <div className="rc-burst-host">
            <Burst />
            <In d={2} fx="slam">
              <div className="display rc-big num gold" style={fit(String(r.recordCount))}>
                <CountUp value={r.recordCount} />
              </div>
            </In>
          </div>
          <div className="rc-prs">
            {r.records.slice(0, 3).map((x, i) => (
              <div key={x.key} className="rc-pr" style={css({ '--i': i })}>
                <span className="rc-pr-tag">{tr('PR')}</span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <b className="ellipsis" style={{ display: 'block' }}>
                    {x.name}
                  </b>
                  <span className="num">
                    {tr('{w} kg × {r}', { w: x.w.toLocaleString(loc()), r: x.r })}
                  </span>
                </span>
                {x.gain >= 1 && <span className="rc-pr-gain num">+{pct(Math.round(x.gain))}</span>}
              </div>
            ))}
          </div>
          {top && top.gain >= 5 && (
            <In d={14}>
              <p className="rc-sub">
                {tr('Ton plus gros bond : {name}, +{n} % en un mois.', { name: top.name, n: Math.round(top.gain) })}
              </p>
            </In>
          )}
        </>
      ),
    });
  }

  if (r.top) {
    out.push({
      id: 'top',
      ms: 6000,
      body: (
        <>
          <In d={1} fx="left">
            <p className="rc-kicker">{tr('Ton exercice du mois')}</p>
          </In>
          <In d={2} fx="slam">
            <h2 className="display rc-name">{r.top.name}</h2>
          </In>
          <In d={5}>
            <p className="rc-line num">
              {tr('{sets} séries, {fmtTonnes}', { sets: r.top.sets, fmtTonnes: fmtTonnes(r.top.tonnage) })}
            </p>
          </In>
          {r.top.weeks.filter(Boolean).length >= 2 && <Bars values={r.top.weeks} labels={r.top.weeks.map((_, i) => `S${i + 1}`)} />}
          <In d={12}>
            <p className="rc-sub">{tr('Celui que tu n’as jamais lâché.')}</p>
          </In>
        </>
      ),
    });
  }

  const fav = r.byWeekday.indexOf(Math.max(...r.byWeekday));
  if (r.sessions >= 3 && (r.weekday || r.moment || r.run >= 3)) {
    const momentIcon = r.moment === tr('le matin') ? 'sunrise' : r.moment === tr('le soir') || r.moment === tr('la nuit') ? 'moon' : 'sun';
    out.push({
      id: 'rhythm',
      ms: 6400,
      body: (
        <>
          <In d={1} fx="left">
            <p className="rc-kicker">{tr('Ton rythme')}</p>
          </In>
          <In d={2} fx="slam">
            <h2 className="display rc-name">{r.weekday ? cap(tr('Le {name}', { name: r.weekday.name })) : r.moment ? cap(r.moment) : tr('Régulier')}</h2>
          </In>
          {r.weekday && (
            <In d={4}>
              <p className="rc-line">
                {tr('{count} séances le {name}, ton jour fort.', { count: r.weekday.count, name: r.weekday.name })}
              </p>
            </In>
          )}
          <Bars values={r.byWeekday} labels={DAY_LETTERS} hi={r.weekday ? fav : undefined} />
          <div className="rc-chips">
            {r.moment && (
              <In d={12} fx="pop">
                <p className="rc-chip">
                  <Icon name={momentIcon} size={16} />{' '}{tr('Surtout {moment}', { moment: r.moment })}
                </p>
              </In>
            )}
            {r.run >= 3 && (
              <In d={14} fx="pop">
                <p className="rc-chip">
                  <Icon name="flame" size={16} />{' '}{tr('{run} jours validés d’affilée', { run: r.run })}
                </p>
              </In>
            )}
          </div>
        </>
      ),
    });
  }

  const kg = r.weight ? Math.round((r.weight.to - r.weight.from) * 10) / 10 : null;
  if ((kg !== null && kg !== 0) || r.meals >= 10 || r.cardioKm >= 5) {
    const verdict = weightVerdict(r.weight, goal);
    out.push({
      id: 'body',
      ms: 6200,
      body: (
        <>
          <In d={1} fx="left">
            <p className="rc-kicker">{tr('Côté corps')}</p>
          </In>
          {kg !== null && kg !== 0 ? (
            <>
              <In d={2} fx="slam">
                <div className="display rc-big num" style={fit(tr('+{abs} kg', { abs: Math.abs(kg).toLocaleString(loc(), { minimumFractionDigits: 1 }) }))}>
                  {kg > 0 ? '+' : '−'}
                  <CountUp value={Math.abs(kg)} decimals={1} suffix={'\u00a0kg'} />
                </div>
              </In>
              {r.weighIns.length >= 2 && (
                <In d={4}>
                  <WeightLine points={r.weighIns} />
                </In>
              )}
              <In d={7}>
                <p className="rc-line num">
                  {tr('De {from} à {to} kg.', { from: r.weight!.from.toLocaleString(loc()), to: r.weight!.to.toLocaleString(loc()) })}
                </p>
              </In>
              {verdict && (
                <In d={10} fx="pop">
                  <p className="rc-chip">{verdict}</p>
                </In>
              )}
            </>
          ) : null}
          <div className="rc-chips">
            {r.meals >= 10 && (
              <In d={12} fx="pop">
                <p className="rc-chip soft">
                  <Icon name="utensils" size={16} />{' '}{tr('{meals} repas notés', { meals: r.meals })}
                </p>
              </In>
            )}
            {r.cardioKm >= 5 && (
              <In d={13} fx="pop">
                <p className="rc-chip soft">
                  <Icon name="run" size={16} />{' '}{tr('{cardioKm} km d’endurance', { cardioKm: r.cardioKm.toLocaleString(loc()) })}
                </p>
              </In>
            )}
          </div>
        </>
      ),
    });
  }

  if (r.trophies.length) {
    out.push({
      id: 'trophies',
      ms: 5600,
      body: (
        <>
          <In d={1} fx="left">
            <p className="rc-kicker">{tr('Trophées gagnés')}</p>
          </In>
          <In d={2} fx="slam">
            <div className="display rc-big num gold" style={fit(String(r.trophies.length))}>
              <CountUp value={r.trophies.length} />
            </div>
          </In>
          <div className="rc-medals">
            {r.trophies.slice(0, 6).map((t, i) => {
              const full = TROPHIES.find((x) => x.id === t.id)!;
              return (
                <span key={t.id} className="rc-medal" style={css({ '--i': i })}>
                  <Medal t={full} on size={64} />
                  <span className="small">{t.title}</span>
                </span>
              );
            })}
          </div>
        </>
      ),
    });
  }

  // Le profil du mois : la révélation, juste avant la fin.
  const p = r.profile;
  out.push({
    id: 'profile',
    ms: 7400,
    body: (
      <>
        <In d={1} fx="left">
          <p className="rc-kicker">{partial ? tr('Ton profil, pour l’instant') : tr('Ton profil du mois')}</p>
        </In>
        <div className="rc-profile" style={css({ '--pc': PROFILE_COLOR[p.id] })}>
          <i className="rc-halo" aria-hidden="true">
            <i />
          </i>
          <div className="rc-card">
            <span className="rc-card-icon">
              <Icon name={p.icon} size={30} />
            </span>
            <h2 className="display rc-card-title">{p.title}</h2>
            <p className="rc-card-line">{p.line}</p>
          </div>
        </div>
        <In d={16} fx="pop" className="rc-host small">
          <Pulse mood="proud" tier={tier} size={72} season={null} />
        </In>
      </>
    ),
  });
  return out;
}

/* ---------- La story ---------- */

export function MonthRecap({ month, onClose }: { month: string; onClose: () => void }) {
  useScrollLock();
  const s = useApp();
  // Les chiffres sont figés à l'ouverture : la story ne bouge pas si l'état change pendant qu'on la regarde.
  const recap = useMemo(() => monthRecap(getState(), month), [month]);
  const tier = useMemo(() => flameInfo(getState(), dayKey()).tier, []);
  const slides = useMemo(() => slidesOf(recap, recap.partial, getState().settings.weightGoal, tier), [recap, tier]);
  const ids: SlideId[] = [...slides.map((x) => x.id), 'outro'];
  const total = ids.length;
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  // Les fonds qui se répandent : le dernier recouvre les précédents, qu'on retire une fois couverts.
  // Le fond du profil prend la couleur du profil révélé.
  const bgOf = (sid: SlideId) => (sid === 'profile' ? `color-mix(in srgb, ${PROFILE_COLOR[recap.profile.id]} 15%, #09090b)` : RECAP_THEME[sid].bg);
  const [wipes, setWipes] = useState<{ key: number; color: string; x: number; y: number; base?: boolean }[]>(() => [
    { key: 0, color: RECAP_THEME.intro.bg, x: 50, y: 50, base: true },
  ]);
  const root = useRef<HTMLDivElement>(null);
  const press = useRef<{ t: number; x: number; y: number } | null>(null);
  const origin = useRef({ x: 86, y: 52 });
  const last = i === total - 1;
  const id = ids[i];
  const theme = RECAP_THEME[id];

  useLayoutEffect(() => {
    const el = root.current;
    el?.focus();
    return () => leave(el, 'recap-out', 240);
  }, []);

  // Ouvert : le bandeau d'Aujourd'hui ne revient plus pour ce mois.
  useEffect(() => {
    if (!recap.partial && getState().ui.recapSeen !== month)
      setState((d) => {
        d.ui.recapSeen = month;
      });
  }, [month, recap.partial]);

  const go = (n: number) => {
    const k = Math.max(0, Math.min(total - 1, n));
    if (k === i) return;
    setI(k);
    const { x, y } = origin.current;
    setWipes((w) => [...w.slice(-2), { key: Date.now() + k, color: bgOf(ids[k]), x, y }]);
    origin.current = { x: 86, y: 52 };
  };

  const onDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    press.current = { t: Date.now(), x: e.clientX, y: e.clientY };
    setPaused(true);
  };
  const onUp = (e: PointerEvent) => {
    const p = press.current;
    press.current = null;
    setPaused(false);
    if (!p || Date.now() - p.t > 350 || last) return;
    const el = e.currentTarget as HTMLElement;
    const back = p.x < el.clientWidth * 0.3;
    origin.current = { x: (p.x / el.clientWidth) * 100, y: (p.y / el.clientHeight) * 100 };
    go(i + (back ? -1 : 1));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowRight' || e.key === ' ') go(i + 1);
    if (e.key === 'ArrowLeft') go(i - 1);
  };

  const share = async () => {
    setBusy(true);
    try {
      const stats = [
        { label: tn(recap.sessions, 'Séance', 'Séances'), value: String(recap.sessions) },
        ...(recap.tonnage >= 500 ? [{ label: tr('Soulevé'), value: fmtTonnes(recap.tonnage) }] : []),
        ...(recap.recordCount ? [{ label: tn(recap.recordCount, 'Record', 'Records'), value: String(recap.recordCount) }] : []),
        ...(recap.minutes >= 30 ? [{ label: tr('Entraînement'), value: fmtDuration(recap.minutes) }] : []),
        ...(recap.cardioKm >= 5 ? [{ label: tr('Endurance'), value: `${recap.cardioKm.toLocaleString(loc())} km` }] : []),
      ];
      const canvas = await drawMonthStory({
        month: recap.name,
        year: recap.year,
        stats: stats.slice(0, 3),
        like: recap.tonnage >= 1000 ? tonnageLike(recap.tonnage) : null,
        top: recap.top ? tr('{name}, {sets} séries', { name: recap.top.name, sets: recap.top.sets }) : null,
        records: recap.records.slice(0, 2).map((x) => tr('{name} {w} kg × {r}', { name: x.name, w: x.w.toLocaleString(loc()), r: x.r })),
        run: recap.run,
        name: s.settings.name,
        profile: { title: recap.profile.title, line: recap.profile.line, color: PROFILE_COLOR[recap.profile.id] },
        cal: recap.cal,
      });
      const res = await shareStory(await storyBlob(canvas), `recap ${recap.name} ${recap.year}`, tr('Mon mois {ofMonth}', { ofMonth: ofMonth(recap.month) }));
      if (res === 'saved') toast(tr('Image enregistrée dans tes téléchargements'));
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(false);
    }
  };

  const M = cap(monthName(month));
  const slide = slides[i];

  return createPortal(
    <div
      ref={root}
      className={`recap on-${id} ${paused ? 'paused' : ''}`}
      style={css({ '--rc-ink': theme.ink, '--rc-accent': theme.accent, '--rc-bg': theme.bg })}
      role="dialog"
      aria-modal="true"
      aria-label={tr('Récap {ofMonth}', { ofMonth: ofMonth(month) })}
      tabIndex={-1}
      onKeyDown={onKey}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={() => {
        press.current = null;
        setPaused(false);
      }}
    >
      <div className="rc-wipes" aria-hidden="true">
        {wipes.map((w) => (
          <i
            key={w.key}
            className={w.base ? 'base' : ''}
            style={css({ left: `${w.x}%`, top: `${w.y}%`, background: w.color })}
            onAnimationEnd={() => setWipes((list) => list.filter((v) => v.key >= w.key))}
          />
        ))}
      </div>
      <div key={`deco-${id}`} className="rc-deco" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>

      <div className="recap-bars" aria-hidden="true">
        {ids.map((sid, k) => (
          <span key={sid} className={k < i ? 'seen' : k === i ? 'now' : ''}>
            {k === i && !last ? <i key={i} style={{ animationDuration: `${slide.ms}ms` }} onAnimationEnd={() => go(i + 1)} /> : <i />}
          </span>
        ))}
      </div>
      <div className="recap-top">
        <span className="small rc-brand">
          {tr('Shred, {M} {year}', { M, year: recap.year })}
          {recap.partial ? tr(' (en cours)') : ''}
        </span>
        <button className="icon-btn rc-close" onClick={onClose} aria-label={tr('Fermer le récap')}>
          <Icon name="x" />
        </button>
      </div>
      <div className="recap-stage" aria-live="polite">
        {!last ? (
          <div key={slide.id} className="recap-slide">
            {slide.body}
          </div>
        ) : (
          <div key="outro" className="recap-slide recap-outro">
            <Confetti colors={['#ffd166', '#ff6a1a', '#2ee6a0', '#7c4dff', '#ff3b6b', '#ffffff']} />
            <In d={1} fx="left">
              <p className="rc-kicker">{recap.partial ? tr('Pour l’instant') : tr('Bouclé')}</p>
            </In>
            <In d={2} fx="slam">
              <h2 className="display rc-name">
                {M}, {recap.partial ? tr('à suivre') : tr('c’est fait')}.
              </h2>
            </In>
            <In d={4}>
              <p className="rc-tag" style={css({ '--pc': PROFILE_COLOR[recap.profile.id] })}>
                <Icon name={recap.profile.icon} size={16} /> {recap.profile.title}
              </p>
            </In>
            <div className="recap-summary">
              {[
                [String(recap.sessions), tn(recap.sessions, 'séance', 'séances')],
                ...(recap.tonnage >= 500 ? [[fmtTonnes(recap.tonnage), tr('soulevées')]] : []),
                ...(recap.recordCount > 0 ? [[String(recap.recordCount), tn(recap.recordCount, 'record', 'records')]] : []),
                ...(recap.minutes >= 30 ? [[fmtDuration(recap.minutes), tr('d’entraînement')]] : []),
              ].map(([v, l], k) => (
                <span key={l} style={css({ '--i': k })}>
                  <b className="num">{v}</b> {l}
                </span>
              ))}
            </div>
            <In d={9} className="recap-actions">
              <button className="btn primary block" onClick={share} disabled={busy}>
                <Icon name="share" size={17} /> {busy ? tr('Préparation de l’image…') : tr('Partager mon récap')}
              </button>
              <button className="btn block" onClick={() => go(0)}>
                <Icon name="undo" size={16} />{' '}{tr('Revoir')}
              </button>
            </In>
          </div>
        )}
      </div>
      {i === 0 && <p className="recap-hint small">{tr('Touche pour avancer, garde le doigt pour mettre en pause')}</p>}
    </div>,
    document.body,
  );
}

/** Onglet Progrès : le mois d'avant (s'il a des séances) et le mois en cours. */
export function RecapCards({ today }: { today: string }) {
  const s = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const cards = useMemo(() => recapMonths(s, today).map(({ month }) => monthRecap(s, month, today)), [s, today]);
  if (!cards.length) return null;
  return (
    <section className="section">
      <div className="section-head">
        <h2>{tr('Récap du mois')}</h2>
      </div>
      <div className={`recap-cards n${cards.length}`}>
        {cards.map((r) => (
          <button
            key={r.month}
            className={`recap-card ${r.partial ? 'partial' : ''}`}
            onClick={() => setOpen(r.month)}
            aria-label={tr('Voir le récap {ofMonth}', { ofMonth: ofMonth(r.month) })}
          >
            <span className="recap-card-glow" aria-hidden="true" />
            <span className="small recap-card-kicker">{r.partial ? tr('En cours') : tr('Ton récap est prêt')}</span>
            <b className="display" style={fit(r.name)}>
              {cap(r.name)}
            </b>
            <span className="small recap-card-stats num">
              {tn(r.sessions, '{n} séance', '{n} séances')}
              {r.tonnage >= 500 ? `, ${fmtTonnes(r.tonnage)}` : ''}
            </span>
            <span className="small recap-card-tease">{tr('Et ton profil du mois')}</span>
            <span className="recap-card-play" aria-hidden="true">
              <Icon name="play" size={14} filled />
            </span>
          </button>
        ))}
      </div>
      {open && <MonthRecap month={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
