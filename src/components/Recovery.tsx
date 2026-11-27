// Forme du jour (anneau et conseil sur Aujourd'hui) et tes muscles : en 3D, colorés selon les séries de la semaine
// ou selon leur récupération. La silhouette 2D reste là quand le téléphone ne sait pas afficher la 3D.
import { lazy, Suspense, useMemo, useState } from 'react';
import { setForm } from '../lib/workoutActions';
import { muscleRecovery, type MuscleState, readiness, type Region, REGION_NAMES, weekSets } from '../lib/readiness';
import { readDay, useApp } from '../lib/store';
import type { Part } from '../lib/body3d/figure';
import { missedThisWeek } from '../lib/variety';
import { regionName } from '../../shared/generator';
import { Icon } from './Icon';
import { Ring } from './Ring';
import { Sheet, toast } from './ui';
import { list, lower, pct, tn, tr } from '../../shared/i18n';

const TONE_COLOR = { go: 'var(--mint)', ok: 'var(--amber)', low: 'var(--rose)' } as const;

const Body3D = lazy(() => import('./Body3D'));

/* ---------- Couleurs des muscles ---------- */

const IDLE = '#423b35';
const SKIN = '#5a524b';
const MINT = '#4cb86b';
const AMBER = '#f2bd2c';
const ROSE = '#ef5a45';
/** Séries de la semaine : une seule teinte, de plus en plus vive (1 à 5, 6 à 11, 12 et plus). */
const WEEK = ['#7a5a1c', '#b98a22', '#f2bd2c'];

function mix(a: string, b: string, t: number): string {
  const c = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round(c(a, i) + (c(b, i) - c(a, i)) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** Couleur d'un muscle selon sa récupération : neutre s'il n'a rien fait depuis 7 jours, de la menthe au rose. */
function recoveryColor(m?: MuscleState): string {
  if (!m || m.hours === null) return IDLE;
  if (m.fatigue >= 0.55) return mix(IDLE, ROSE, Math.min(1, 0.55 + m.fatigue * 0.45));
  if (m.fatigue >= 0.2) return mix(IDLE, AMBER, Math.min(1, 0.55 + m.fatigue * 0.6));
  return mix(IDLE, MINT, 0.62);
}

const weekColor = (n = 0) => (n < 0.5 ? IDLE : n < 6 ? WEEK[0] : n < 12 ? WEEK[1] : WEEK[2]);

type Mode = 'week' | 'recovery';

/* ---------- Silhouette ---------- */

// Figures dessinées sur 120 × 270, côté gauche seulement : le côté droit est son miroir.
const W = 120;
const mirror = (d: string) => d.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_, x, y) => `${W - Number(x)},${y}`);
const both = (d: string) => [d, mirror(d)];
const ell = (cx: number, cy: number, rx: number, ry: number) => `M${cx - rx},${cy} A${rx},${ry} 0 1,0 ${cx + rx},${cy} A${rx},${ry} 0 1,0 ${cx - rx},${cy} Z`;
// Les arcs ne passent pas par le miroir (leurs rayons ne sont pas des points) : on les recalcule.
const ellBoth = (cx: number, cy: number, rx: number, ry: number) => [ell(cx, cy, rx, ry), ell(W - cx, cy, rx, ry)];

// Le corps entier, moitié gauche (le miroir donne l'autre) : les muscles se posent dessus.
const BODY_HALF =
  'M60.5,34 L54,35 C54,40 53,43 50,45 C45,47 36,46 30,49 C24,52 22,60 22,68 C21,80 20,90 20,100 C19,112 17,124 18,133 ' +
  'C16,138 16,144 19,147 C22,149 26,147 27,143 C28,138 29,134 30,132 C31,122 32,110 32,102 C33,92 36,80 38,72 ' +
  'C40,84 41,100 43,116 C43,124 41,132 41,140 C40,160 41,180 44,200 C43,212 43,224 44,236 C45,246 46,252 45,256 ' +
  'C42,260 42,263 46,264 C50,265 55,264 56,261 C56,254 55,248 56,240 C57,226 58,212 57,202 C58,186 59,166 60.5,148 Z';
const NEUTRAL = [ell(60, 21, 12.5, 14.5), ...both(BODY_HALF)];

const FRONT: [Region, string[]][] = [
  ['neck', ['M54.5,35.5 L65.5,35.5 L66.5,44 L53.5,44 Z']],
  ['delts', ellBoth(33, 57, 9.5, 9.5)],
  ['chest', both('M40,50 Q52,45 58.5,48 L58.5,72 Q50,78 42,74 Q36,64 40,50 Z')],
  ['biceps', ellBoth(29, 84, 6.5, 14)],
  ['forearms', ellBoth(25, 116, 5.5, 15)],
  ['abs', ['M51,78 L69,78 Q70,78 70,80 L70,121 L50,121 L50,80 Q50,78 51,78 Z']],
  ['obliques', both('M42.5,80 Q47,81 48,83 L48,121 Q44,119 42.5,110 Q40.5,95 42.5,80 Z')],
  ['quads', both('M44,145 Q55,141 58,147 L57,196 Q50,201 45.5,196 Q41,172 44,145 Z')],
  ['calves', ellBoth(50, 232, 5.8, 19)],
];

const BACK: [Region, string[]][] = [
  ['neck', ['M54.5,35 L65.5,35 L66,40.5 L54,40.5 Z']],
  ['traps', ['M53,41 L67,41 L80,50 L60,63 L40,50 Z']],
  ['reardelts', ellBoth(33, 57, 9.5, 9.5)],
  ['lats', both('M42,63 Q51,62 58.5,67 L58.5,106 Q50,104 45,96 Q39.5,80 42,63 Z')],
  ['lowerback', ['M50,108 L70,108 L70,121 Q60,125 50,121 Z']],
  ['triceps', ellBoth(29, 84, 6.5, 14)],
  ['forearms', ellBoth(25, 116, 5.5, 15)],
  ['glutes', ellBoth(52, 135, 8.5, 10.5)],
  ['hamstrings', both('M44,150 Q55,146 58,152 L57,197 Q50,202 45.5,197 Q41.5,176 44,150 Z')],
  ['calves', ellBoth(50, 230, 6.2, 19)],
];

function Figure({ parts, neutral, colorOf, titleOf, label, front }: { parts: [Region, string[]][]; neutral: string[]; colorOf: (r: Region) => string; titleOf: (r: Region) => string; label: string; front: boolean }) {
  return (
    <figure className="body-figure">
      <svg viewBox={`0 0 ${W} 270`} role="img" aria-label={label}>
        {neutral.map((d, i) => (
          <path key={`n${i}`} d={d} className="body-neutral" />
        ))}
        {parts.map(([region, ds]) =>
          ds.map((d, i) => (
            <path key={`${region}${i}`} d={d} fill={colorOf(region)} className="body-muscle">
              <title>{titleOf(region)}</title>
            </path>
          )),
        )}
        {/* Lignes des abdos, pour le relief. */}
        {front && <path d="M60,79 L60,120 M51,93 L69,93 M51,107 L69,107" className="body-lines" />}
      </svg>
      <figcaption className="small faint">{front ? tr('Face') : tr('Dos')}</figcaption>
    </figure>
  );
}

/** Heures avant qu'un muscle redevienne frais (fatigue sous 25 %). */
const readyIn = (m: MuscleState) => (m.fatigue <= 0.25 ? 0 : Math.ceil(24 * Math.log2(m.fatigue / 0.25)));

/** La silhouette 2D, face et dos. */
export function BodyMap({ colorOf, titleOf }: { colorOf: (r: Region) => string; titleOf: (r: Region) => string }) {
  return (
    <div className="body-map">
      <Figure parts={FRONT} neutral={NEUTRAL} colorOf={colorOf} titleOf={titleOf} label={tr('Face : tes muscles')} front />
      <Figure parts={BACK} neutral={NEUTRAL} colorOf={colorOf} titleOf={titleOf} label={tr('Dos : tes muscles')} front={false} />
    </div>
  );
}

const webgl2 = () => {
  try {
    return typeof WebGL2RenderingContext !== 'undefined' && Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
};

/** Tes muscles en 3D, ou la silhouette 2D si la 3D n'est pas possible sur ce téléphone. */
function MuscleFigure({ colorOf, titleOf }: { colorOf: (r: Region) => string; titleOf: (r: Region) => string }) {
  const [flat, setFlat] = useState(() => !webgl2());
  if (flat) return <BodyMap colorOf={colorOf} titleOf={titleOf} />;
  const colors = { skin: SKIN, other: IDLE } as Record<Part, string>;
  for (const r of Object.keys(REGION_NAMES) as Region[]) colors[r] = colorOf(r);
  return (
    <Suspense fallback={<div className="body3d" aria-hidden="true" />}>
      <Body3D colors={colors} labelOf={(p) => (p === 'skin' ? null : p === 'other' ? tr('Muscle que Shred ne suit pas') : titleOf(p))} onFail={() => setFlat(true)} />
    </Suspense>
  );
}

/* ---------- Forme du jour ---------- */

export function ReadinessCard({ today }: { today: string }) {
  const s = useApp();
  const [open, setOpen] = useState(false);
  const r = useMemo(() => readiness(s, today), [s, today]);
  const muscles = useMemo(() => muscleRecovery(s, today), [s, today]);
  const worked = muscles.filter((m) => m.hours !== null).sort((a, b) => b.fatigue - a.fatigue);
  const tired = worked.filter((m) => m.fatigue >= 0.45);
  const busy = worked.filter((m) => m.fatigue >= 0.2);
  const names = (list: MuscleState[]) =>
    list
      .slice(0, 2)
      .map((m) => lower(REGION_NAMES[m.region]))
      .join(', ');
  const muscleLine = tired.length
    ? tr('À ménager : {names}', { names: names(tired) })
    : busy.length
      ? tr('En récupération : {names}', { names: names(busy) })
      : worked.length
        ? tr('Tes muscles sont récupérés')
        : tr('Rien de travaillé ces 7 derniers jours');
  if (!r && !muscles.some((m) => m.hours !== null)) return null;
  return (
    <>
      <button className={`card readiness-card ${r ? r.tone : ''}`} onClick={() => setOpen(true)} aria-label={tr('Forme du jour et récupération : voir le détail')}>
        {r ? (
          <Ring value={r.score} max={100} color={TONE_COLOR[r.tone]} size={64} stroke={6} label={tr('Forme du jour')}>
            <span className="readiness-num num">{r.score}</span>
          </Ring>
        ) : (
          <span className="readiness-icon">
            <Icon name="pulse" size={26} />
          </span>
        )}
        <span className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
          <span className="small muted" style={{ display: 'block' }}>
            {tr('Forme du jour')}{r?.partial ? tr(' (charge seule)') : ''}
          </span>
          <span className="readiness-title">{r ? r.title : tr('Récupération musculaire')}</span>
          <span className="small muted ellipsis" style={{ display: 'block' }}>
            {muscleLine}
          </span>
        </span>
        <Icon name="chevron" size={18} />
      </button>
      {open && <RecoverySheet today={today} onClose={() => setOpen(false)} />}
    </>
  );
}

function RecoverySheet({ today, onClose }: { today: string; onClose: () => void }) {
  const s = useApp();
  const r = readiness(s, today);
  const muscles = muscleRecovery(s, today);
  const worked = muscles.filter((m) => m.hours !== null).sort((a, b) => b.fatigue - a.fatigue);
  const byRegion = new Map(muscles.map((m) => [m.region, m]));
  const form = readDay(s, today).form;
  const [mode, setMode] = useState<Mode>('week');
  const week = weekSets(s, today);
  const ranked = [...week].filter(([, n]) => n >= 0.5).sort((a, b) => b[1] - a[1]);
  const missed = s.settings.variety?.catchUp !== false ? missedThisWeek(s, today) : [];
  return (
    <Sheet title={tr('Forme du jour')} onClose={onClose}>
      <div className="stack" style={{ gap: 18 }}>
        {r && (
          <>
            <div className="readiness-head">
              <Ring value={r.score} max={100} color={TONE_COLOR[r.tone]} size={108} stroke={9} label={tr('Forme du jour')}>
                <div>
                  <div className="readiness-big num">{r.score}</div>
                  <div className="small faint">{tr('sur 100')}</div>
                </div>
              </Ring>
              <div style={{ minWidth: 0 }}>
                <div className="readiness-title" style={{ fontSize: '1.35rem' }}>
                  {r.title}
                </div>
                <p className="small muted" style={{ margin: '6px 0 0' }}>
                  {r.advice}
                </p>
              </div>
            </div>
            <div className="stack" style={{ gap: 10 }}>
              {r.parts.map((p) => (
                <div key={p.id} className="readiness-part">
                  <div className="readiness-part-head">
                    <span style={{ fontWeight: 700 }}>{p.label}</span>
                    <span className="small muted">{p.detail}</span>
                  </div>
                  <div className="readiness-bar">
                    <span style={{ transform: `scaleX(${p.score / 100})`, background: TONE_COLOR[p.score >= 75 ? 'go' : p.score >= 55 ? 'ok' : 'low'] }} />
                  </div>
                </div>
              ))}
            </div>
            {r.partial && (
              <p className="small faint" style={{ margin: 0 }}>
                {tr('Relie Apple Santé (Réglages, Connexions) pour ajouter ta VFC, ton sommeil et ton cœur au repos au score.')}
              </p>
            )}
            {r.tone === 'low' && form !== 'low' && (
              <button
                className="btn block"
                onClick={() => {
                  setForm(today, 'low');
                  toast(tr('Mode Fatigué : séance allégée pour aujourd’hui'));
                }}
              >
                <Icon name="moon" size={17} />{' '}{tr('Passer la séance en mode Fatigué')}
              </button>
            )}
          </>
        )}

        <section className="stack" style={{ gap: 10 }}>
          <div className="section-head" style={{ margin: 0 }}>
            <h2 style={{ fontSize: '1.05rem' }}>{tr('Tes muscles')}</h2>
          </div>
          <div className="seg" role="tablist" aria-label={tr('Ce que montrent les couleurs')}>
            <button type="button" role="tab" aria-selected={mode === 'week'} className={mode === 'week' ? 'on' : ''} onClick={() => setMode('week')}>
              {tr('Cette semaine')}
            </button>
            <button type="button" role="tab" aria-selected={mode === 'recovery'} className={mode === 'recovery' ? 'on' : ''} onClick={() => setMode('recovery')}>
              {tr('Récupération')}
            </button>
          </div>
          {mode === 'week' ? (
            <>
              <MuscleFigure
                colorOf={(r) => weekColor(week.get(r))}
                titleOf={(r) => {
                  const n = Math.round(week.get(r) ?? 0);
                  return n
                    ? tn(n, '{region} : {n} série cette semaine', '{region} : {n} séries cette semaine', { region: REGION_NAMES[r] })
                    : tr('{region} : aucune série cette semaine', { region: REGION_NAMES[r] });
                }}
              />
              <div className="body-legend small">
                <span>
                  <i style={{ background: WEEK[0] }} />{' '}{tr('1 à 5 séries')}
                </span>
                <span>
                  <i style={{ background: WEEK[1] }} />{' '}{tr('6 à 11')}
                </span>
                <span>
                  <i style={{ background: WEEK[2] }} />{' '}{tr('12 et plus')}
                </span>
                <span>
                  <i style={{ background: IDLE }} />{' '}{tr('Pas travaillé')}
                </span>
              </div>
              {ranked.length > 0 ? (
                <div className="group">
                  {ranked.slice(0, 6).map(([r, n]) => (
                    <div key={r} className="row" style={{ gap: 12 }}>
                      <span className="grow" style={{ fontWeight: 650 }}>
                        {REGION_NAMES[r]}
                      </span>
                      <span className="num muted">{tn(Math.round(n), '{n} série', '{n} séries')}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="small muted" style={{ margin: 0 }}>
                  {tr('Aucune série depuis lundi.')}
                </p>
              )}
              {missed.length > 0 && (
                <p className="small" style={{ margin: 0 }}>
                  <Icon name="bolt" size={13} />{' '}
                  {tr('Resté de côté cette semaine : {names}. Tes prochaines séances ajoutent un exercice pour rattraper.', { names: list(missed.map((m) => lower(regionName(m.region)))) })}
                </p>
              )}
              <p className="small faint" style={{ margin: 0 }}>
                {tr('Séries faites depuis lundi : le muscle principal d’un exercice compte pour une série, les autres pour une demie. Repère : environ 10 à 20 séries par muscle et par semaine.')}
              </p>
            </>
          ) : (
            <>
              <MuscleFigure
                colorOf={(r) => recoveryColor(byRegion.get(r))}
                titleOf={(r) => {
                  const m = byRegion.get(r);
                  return m && m.hours !== null
                    ? tr('{region} : récupération à {recovery} %', { region: REGION_NAMES[r], recovery: m.recovery })
                    : tr('{region} : rien ces 7 derniers jours', { region: REGION_NAMES[r] });
                }}
              />
              <div className="body-legend small">
                <span>
                  <i style={{ background: mix(IDLE, MINT, 0.62) }} />{' '}{tr('Récupéré')}
                </span>
                <span>
                  <i style={{ background: AMBER }} />{' '}{tr('En cours')}
                </span>
                <span>
                  <i style={{ background: ROSE }} />{' '}{tr('Fatigué')}
                </span>
                <span>
                  <i style={{ background: IDLE }} />{' '}{tr('Pas travaillé')}
                </span>
              </div>
              {worked.length > 0 ? (
                <div className="group">
                  {worked.slice(0, 6).map((m) => (
                    <div key={m.region} className="row" style={{ gap: 12 }}>
                      <span className="grow">
                        <span style={{ display: 'block', fontWeight: 650 }}>{REGION_NAMES[m.region]}</span>
                        <span className="small muted">
                          {m.hours! < 24 ? tr('travaillé il y a {hours} h', { hours: m.hours }) : tr('travaillé il y a {n} j', { n: Math.round(m.hours! / 24) })}
                          {readyIn(m) > 0 ? tr(', frais dans {v}', { v: readyIn(m) < 24 ? `${readyIn(m)} h` : `${Math.round(readyIn(m) / 24)} j` }) : ''}
                        </span>
                      </span>
                      <span
                        className="num"
                        style={{ fontWeight: 800, color: m.fatigue >= 0.55 ? 'var(--rose)' : m.fatigue >= 0.2 ? 'var(--amber)' : 'var(--mint)' }}
                      >
                        {pct(m.recovery)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="small muted" style={{ margin: 0 }}>
                  {tr('Aucune série ces 7 derniers jours : tout est frais.')}
                </p>
              )}
              <p className="small faint" style={{ margin: 0 }}>
                {tr('Chaque série fatigue ses muscles (le principal en entier, les autres à moitié) ; la fatigue diminue de moitié environ toutes les 24 heures. Estimation, pas un avis médical.')}
              </p>
            </>
          )}
        </section>
      </div>
    </Sheet>
  );
}
