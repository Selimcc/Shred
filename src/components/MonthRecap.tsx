// Récap du mois en story : des écrans plein cadre qui défilent seuls (touche à droite pour avancer, à gauche
// pour revenir, appui long pour mettre en pause), puis une carte à partager. Rien ne part au serveur.
import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { leave } from '../lib/leave';
import {
  delta,
  fmtDuration,
  fmtTonnes,
  monthName,
  monthRecap,
  type MonthRecap as Recap,
  ofMonth,
  recapMonths,
  tonnageLike,
  weightVerdict,
} from '../lib/monthRecap';
import { getState, setState, useApp, type WeightGoal } from '../lib/store';
import { drawMonthStory, shareStory, storyBlob } from '../lib/storyCard';
import { TROPHIES } from '../lib/trophies';
import { Icon } from './Icon';
import { Medal } from './Trophies';
import { errorText, toast, useScrollLock } from './ui';

const SLIDE_MS = 5600;
const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Un nombre qui monte de 0 à sa valeur quand l'écran s'affiche. */
function CountUp({ value, decimals = 0, suffix = '' }: { value: number; decimals?: number; suffix?: string }) {
  const [v, setV] = useState(() => (reduced() ? value : 0));
  useEffect(() => {
    if (reduced()) return setV(value);
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 1100);
      setV(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  const f = 10 ** decimals;
  return (
    <>
      {(Math.round(v * f) / f).toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </>
  );
}

/** Tonnage animé : en tonnes à partir d'une tonne. */
function Tonnage({ kg }: { kg: number }) {
  return kg >= 1000 ? <CountUp value={Math.round(kg / 100) / 10} decimals={1} suffix=" t" /> : <CountUp value={Math.round(kg)} suffix=" kg" />;
}

interface Slide {
  id: string;
  accent: string;
  body: ReactNode;
}

function slidesOf(r: Recap, partial: boolean, goal: WeightGoal): Slide[] {
  const out: Slide[] = [];
  const M = cap(r.name);
  const days = partial ? Math.max(1, Number(new Date().getDate())) : new Date(r.year, Number(r.month.slice(5)), 0).getDate();
  const perWeek = Math.round((r.sessions / (days / 7)) * 10) / 10;

  out.push({
    id: 'intro',
    accent: 'var(--glacier)',
    body: (
      <>
        <p className="recap-kicker">Ton mois {ofMonth(r.month)}</p>
        <h2 className="display recap-month">{M}</h2>
        <p className="recap-line">{partial ? 'Pas encore fini. On fait le point ?' : `${r.year}. On rembobine ?`}</p>
      </>
    ),
  });

  out.push({
    id: 'sessions',
    accent: 'var(--amber)',
    body: (
      <>
        <p className="recap-kicker">Séances validées</p>
        <div className="display recap-big num">
          <CountUp value={r.sessions} />
        </div>
        <p className="recap-line">{r.sessions > 1 ? `${perWeek.toLocaleString('fr-FR')} par semaine en moyenne.` : 'Une première, et c’est la plus dure.'}</p>
        {r.minutes >= 30 && <p className="recap-sub">Soit {fmtDuration(r.minutes)} d’entraînement.</p>}
        {r.prev && r.prev.sessions !== r.sessions && (
          <p className="recap-chip">
            {r.sessions > r.prev.sessions ? '+' : '−'}
            {Math.abs(r.sessions - r.prev.sessions)} par rapport à {r.prev.name}
            {partial ? ' à la même date' : ''}
          </p>
        )}
      </>
    ),
  });

  if (r.tonnage >= 500) {
    const like = tonnageLike(r.tonnage);
    const d = delta(r.tonnage, r.prev?.tonnage);
    out.push({
      id: 'volume',
      accent: 'var(--gold)',
      body: (
        <>
          <p className="recap-kicker">Soulevé ce mois-ci</p>
          <div className="display recap-big num">
            <Tonnage kg={r.tonnage} />
          </div>
          {like && <p className="recap-line">{like}</p>}
          <p className="recap-sub">En {r.sets.toLocaleString('fr-FR')} séries.</p>
          {d && r.prev && <p className="recap-chip">{`${d} sur ${r.prev.name}`}</p>}
        </>
      ),
    });
  }

  if (r.recordCount > 0) {
    out.push({
      id: 'records',
      accent: 'var(--gold)',
      body: (
        <>
          <p className="recap-kicker">Records battus</p>
          <div className="display recap-big num">
            <CountUp value={r.recordCount} />
          </div>
          <div className="recap-list">
            {r.records.slice(0, 3).map((x, i) => (
              <div key={x.key} className="recap-row" style={{ '--i': i } as CSSProperties}>
                <span className="recap-pr">PR</span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <b className="ellipsis" style={{ display: 'block' }}>
                    {x.name}
                  </b>
                  <span className="small muted num">
                    {x.w.toLocaleString('fr-FR')} kg × {x.r}
                    {x.gain >= 1 ? `, +${Math.round(x.gain)} % sur le mois` : ''}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </>
      ),
    });
  }

  if (r.top) {
    out.push({
      id: 'top',
      accent: 'var(--mint)',
      body: (
        <>
          <p className="recap-kicker">Ton exercice du mois</p>
          <h2 className="display recap-name">{r.top.name}</h2>
          <p className="recap-line num">
            {r.top.sets} séries, {fmtTonnes(r.top.tonnage)}
          </p>
          <p className="recap-sub">Celui que tu n’as jamais lâché.</p>
        </>
      ),
    });
  }

  if (r.weekday || r.moment || r.run >= 3) {
    out.push({
      id: 'rhythm',
      accent: 'var(--purple)',
      body: (
        <>
          <p className="recap-kicker">Ton rythme</p>
          {r.weekday ? (
            <>
              <h2 className="display recap-name">Le {r.weekday.name}</h2>
              <p className="recap-line">
                Ton jour : {r.weekday.count} séances ce jour-là{r.moment ? `, surtout ${r.moment}` : ''}.
              </p>
            </>
          ) : (
            r.moment && <h2 className="display recap-name">{cap(r.moment)}</h2>
          )}
          {r.run >= 3 && (
            <p className="recap-chip flame">
              <Icon name="flame" size={16} /> {r.run} jours validés d’affilée
            </p>
          )}
        </>
      ),
    });
  }

  const kg = r.weight ? Math.round((r.weight.to - r.weight.from) * 10) / 10 : null;
  if ((kg !== null && kg !== 0) || r.meals >= 10 || r.cardioKm >= 5) {
    out.push({
      id: 'body',
      accent: 'var(--mint)',
      body: (
        <>
          <p className="recap-kicker">Côté corps</p>
          {kg !== null && kg !== 0 ? (
            <>
              <div className="display recap-big num">
                {kg > 0 ? '+' : '−'}
                <CountUp value={Math.abs(kg)} decimals={1} suffix=" kg" />
              </div>
              <p className="recap-line num">
                De {r.weight!.from.toLocaleString('fr-FR')} à {r.weight!.to.toLocaleString('fr-FR')} kg sur le mois.
              </p>
              {weightVerdict(r.weight, goal) && <p className="recap-chip">{weightVerdict(r.weight, goal)}</p>}
            </>
          ) : null}
          <div className="recap-facts">
            {r.meals >= 10 && (
              <span>
                <Icon name="utensils" size={16} /> {r.meals} repas notés
              </span>
            )}
            {r.cardioKm >= 5 && (
              <span>
                <Icon name="run" size={16} /> {r.cardioKm.toLocaleString('fr-FR')} km d’endurance
              </span>
            )}
          </div>
        </>
      ),
    });
  }

  if (r.trophies.length) {
    out.push({
      id: 'trophies',
      accent: 'var(--gold)',
      body: (
        <>
          <p className="recap-kicker">Trophées gagnés</p>
          <div className="display recap-big num">
            <CountUp value={r.trophies.length} />
          </div>
          <div className="recap-medals">
            {r.trophies.slice(0, 6).map((t, i) => {
              const full = TROPHIES.find((x) => x.id === t.id)!;
              return (
                <span key={t.id} className="recap-medal" style={{ '--i': i } as CSSProperties}>
                  <Medal t={full} on size={60} />
                  <span className="small">{t.title}</span>
                </span>
              );
            })}
          </div>
        </>
      ),
    });
  }
  return out;
}

export function MonthRecap({ month, onClose }: { month: string; onClose: () => void }) {
  useScrollLock();
  const s = useApp();
  // Les chiffres sont figés à l'ouverture : la story ne bouge pas si l'état change pendant qu'on la regarde.
  const recap = useMemo(() => monthRecap(getState(), month), [month]);
  const slides = useMemo(() => slidesOf(recap, recap.partial, getState().settings.weightGoal), [recap]);
  const total = slides.length + 1;
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const press = useRef<{ t: number; x: number } | null>(null);
  const last = i === total - 1;

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

  const go = (n: number) => setI(Math.max(0, Math.min(total - 1, n)));

  const onDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    press.current = { t: Date.now(), x: e.clientX };
    setPaused(true);
  };
  const onUp = (e: PointerEvent) => {
    const p = press.current;
    press.current = null;
    setPaused(false);
    if (!p || Date.now() - p.t > 350 || last) return;
    const w = (e.currentTarget as HTMLElement).clientWidth;
    go(i + (p.x < w * 0.3 ? -1 : 1));
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
        { label: 'Séances', value: String(recap.sessions) },
        ...(recap.tonnage >= 500 ? [{ label: 'Soulevé', value: fmtTonnes(recap.tonnage) }] : []),
        ...(recap.recordCount ? [{ label: recap.recordCount > 1 ? 'Records' : 'Record', value: String(recap.recordCount) }] : []),
        ...(recap.minutes >= 30 ? [{ label: 'Entraînement', value: fmtDuration(recap.minutes) }] : []),
        ...(recap.cardioKm >= 5 ? [{ label: 'Endurance', value: `${recap.cardioKm.toLocaleString('fr-FR')} km` }] : []),
      ];
      const canvas = await drawMonthStory({
        month: recap.name,
        year: recap.year,
        stats: stats.slice(0, 4),
        like: recap.tonnage >= 1000 ? tonnageLike(recap.tonnage) : null,
        top: recap.top ? `${recap.top.name}, ${recap.top.sets} séries` : null,
        records: recap.records.slice(0, 2).map((x) => `${x.name} ${x.w.toLocaleString('fr-FR')} kg × ${x.r}`),
        run: recap.run,
        name: s.settings.name,
      });
      const res = await shareStory(await storyBlob(canvas), `recap ${recap.name} ${recap.year}`, `Mon mois ${ofMonth(recap.month)}`);
      if (res === 'saved') toast('Image enregistrée dans tes téléchargements');
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(false);
    }
  };

  const accent = last ? 'var(--gold)' : slides[i].accent;
  const M = cap(monthName(month));

  return createPortal(
    <div
      ref={root}
      className={`recap ${paused ? 'paused' : ''}`}
      style={{ '--recap-accent': accent } as CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-label={`Récap ${ofMonth(month)}`}
      tabIndex={-1}
      onKeyDown={onKey}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={() => {
        press.current = null;
        setPaused(false);
      }}
    >
      <div className="recap-bars" aria-hidden="true">
        {Array.from({ length: total }, (_, k) => (
          <span key={k} className={k < i ? 'seen' : k === i ? 'now' : ''}>
            {k === i && !last ? <i key={i} style={{ animationDuration: `${SLIDE_MS}ms` }} onAnimationEnd={() => go(i + 1)} /> : <i />}
          </span>
        ))}
      </div>
      <div className="recap-top">
        <span className="small muted">
          Shred · {M} {recap.year}
          {recap.partial ? ', en cours' : ''}
        </span>
        <button className="icon-btn" onClick={onClose} aria-label="Fermer le récap">
          <Icon name="x" />
        </button>
      </div>
      <div className="recap-stage" aria-live="polite">
        {!last ? (
          <div key={slides[i].id} className="recap-slide">
            {slides[i].body}
          </div>
        ) : (
          <div key="outro" className="recap-slide recap-outro">
            <p className="recap-kicker">{recap.partial ? 'Pour l’instant' : 'Bouclé'}</p>
            <h2 className="display recap-name">
              {M}, {recap.partial ? 'à suivre' : 'c’est fait'}.
            </h2>
            <div className="recap-summary">
              <span>
                <b className="num">{recap.sessions}</b> séances
              </span>
              {recap.tonnage >= 500 && (
                <span>
                  <b className="num">{fmtTonnes(recap.tonnage)}</b> soulevées
                </span>
              )}
              {recap.recordCount > 0 && (
                <span>
                  <b className="num">{recap.recordCount}</b> record{recap.recordCount > 1 ? 's' : ''}
                </span>
              )}
              {recap.minutes >= 30 && (
                <span>
                  <b className="num">{fmtDuration(recap.minutes)}</b> d’entraînement
                </span>
              )}
            </div>
            <div className="recap-actions">
              <button className="btn primary block" onClick={share} disabled={busy}>
                <Icon name="share" size={17} /> {busy ? 'Préparation de l’image…' : 'Partager mon récap'}
              </button>
              <button className="btn block" onClick={() => go(0)}>
                <Icon name="undo" size={16} /> Revoir
              </button>
            </div>
          </div>
        )}
      </div>
      {!last && <p className="recap-hint small faint">Touche pour avancer, garde le doigt pour mettre en pause</p>}
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
        <h2>Récap du mois</h2>
      </div>
      <div className={`recap-cards n${cards.length}`}>
        {cards.map((r) => (
          <button
            key={r.month}
            className={`recap-card ${r.partial ? 'partial' : ''}`}
            onClick={() => setOpen(r.month)}
            aria-label={`Voir le récap ${ofMonth(r.month)}`}
          >
            <span className="small muted">{r.partial ? 'En cours' : 'Ton récap est prêt'}</span>
            <b className="display">{cap(r.name)}</b>
            <span className="small muted num" style={{ paddingRight: 40 }}>
              {r.sessions} séance{r.sessions > 1 ? 's' : ''}
              {r.tonnage >= 500 ? `, ${fmtTonnes(r.tonnage)}` : ''}
            </span>
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
