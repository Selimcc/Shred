import { ScanSheet } from '../components/ScanSheet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ADD_TO_SLOT, type MealSlot, SLOTS } from '../../shared/program';
import { mealPhotoPrompt, openInClaude } from '../lib/ai';
import { Icon } from '../components/Icon';
import { SuggestSheet } from '../components/SuggestSheet';
import { Ring } from '../components/Ring';
import { Bar, errorText, PhotoThumb, Sheet, toast } from '../components/ui';
import { addMeal, addWater, parseDecimal, removeMeal, togglePlannedMeal } from '../lib/actions';
import { type FoodHit, forGrams, recentFoods, searchFoods } from '../lib/foodSearch';
import { searchGeneric } from '../lib/genericFoods';
import { foodQuery } from '../../shared/food';
import { api, type MealAnalysis } from '../lib/api';
import { formatNumber } from '../lib/date';
import { prepareImage } from '../lib/image';
import { totals } from '../lib/logic';
import { deletePhoto, savePhoto } from '../lib/photos';
import { getState, type MealItem, readDay, uid, useApp, WEIGHT_GOALS } from '../lib/store';
import { loc, tr } from '../../shared/i18n';

function slotForNow(): MealSlot {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  if (h < 10.5) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 18.5) return 'snack';
  if (h < 22.5) return 'dinner';
  return 'extra';
}

const slotName = (id: MealSlot) => SLOTS.find((s) => s.id === id)?.name ?? id;

export function Food({ today, openCoach, add, onAdd }: { today: string; openCoach: () => void; add?: MealSlot | null; onAdd?: () => void }) {
  const s = useApp();
  const day = readDay(s, today);
  const t = totals(day);
  const target = s.settings.targets;
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<{ file: File; slot: MealSlot } | null>(null);
  const [manual, setManual] = useState<MealSlot | null>(null);
  const [suggest, setSuggest] = useState(false);
  const [scan, setScan] = useState<MealSlot | null>(null);
  // Repas visé par la prochaine photo : celui de la feuille d'ajout ouverte, sinon celui de l'heure.
  const photoSlot = useRef<MealSlot | null>(null);

  // Ouverture depuis un rappel de repas (?tab=food&add=lunch) : la feuille d'ajout de ce repas, prête.
  useEffect(() => {
    if (!add) return;
    setManual(add);
    onAdd?.();
  }, [add]);

  const takePhoto = (slot: MealSlot | null) => {
    photoSlot.current = slot;
    fileRef.current?.click();
  };

  return (
    <>
      <header className="topbar">
        <div>
          <div className="date">{tr('Nutrition du jour')}</div>
          <h1>{tr('Repas')}</h1>
        </div>
      </header>

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <Ring value={t.kcal} max={target.kcal} color={t.kcal > target.kcal * 1.05 ? 'var(--red)' : 'var(--gold)'} size={116} stroke={12} label={tr('Calories du jour')}>
          <div>
            <div className="display num" style={{ fontSize: '1.45rem' }}>
              {formatNumber(Math.abs(target.kcal - t.kcal))}
            </div>
            <div className="faint" style={{ fontSize: '0.7rem', fontWeight: 700 }}>
              {t.kcal > target.kcal ? tr('kcal en trop') : tr('kcal restantes')}
            </div>
          </div>
        </Ring>
        <div className="stack" style={{ flex: 1, gap: 10, minWidth: 0 }}>
          <MacroLine label={tr('Protéines')} value={t.protein} max={target.protein} tone="blue" />
          <MacroLine label={tr('Glucides')} value={t.carbs} max={target.carbs} />
          <MacroLine label={tr('Lipides')} value={t.fat} max={target.fat} tone="yellow" />
        </div>
      </div>

      {s.settings.modules.health && <Balance today={today} eaten={t.kcal} />}

      <WaterCard today={today} />

      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <button className="btn primary" style={{ flex: 1.2, minHeight: 58 }} onClick={() => takePhoto(null)}>
          <Icon name="camera" />{' '}{tr('Photographier')}
        </button>
        <button className="btn" style={{ flex: 1, minHeight: 58 }} onClick={() => setScan(slotForNow())}>
          <Icon name="barcode" />{' '}{tr('Scanner')}
        </button>
      </div>
      <button className="btn block" style={{ marginTop: 10 }} onClick={() => setSuggest(true)}>
        <Icon name="bolt" size={18} />{' '}{tr('Proposer un plat pour ce qu’il me reste')}
      </button>
      {scan && <ScanSheet today={today} slot={scan} onClose={() => setScan(null)} />}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            setPhoto({ file: f, slot: photoSlot.current ?? slotForNow() });
            setManual(null);
          }
          e.target.value = '';
        }}
      />

      {SLOTS.map((slot) => {
        const entries = day.meals.filter((m) => m.slot === slot.id);
        const plans = s.mealPlan.filter((m) => m.slot === slot.id);
        const sub = entries.reduce((n, m) => n + m.kcal, 0);
        return (
          <section className="section" key={slot.id}>
            <div className="section-head">
              <h2>{slot.name}</h2>
              <span className="small muted num">{sub ? `${formatNumber(sub)} kcal` : ''}</span>
            </div>
            <div className="group">
              {entries.map((m) => (
                <div className="row" key={m.id}>
                  {m.photoId ? (
                    <PhotoThumb id={m.photoId} />
                  ) : (
                    <span className="check on yellow" aria-hidden>
                      <Icon name="check" size={18} />
                    </span>
                  )}
                  <div className="grow">
                    <div className="title" style={{ fontWeight: 550 }}>
                      {tr(m.label)}
                    </div>
                    <div className="small muted num">
                      {tr('{n} kcal, {n2} g P, {n3} g G, {n4} g L', { n: formatNumber(m.kcal), n2: formatNumber(m.protein), n3: formatNumber(m.carbs), n4: formatNumber(m.fat) })}
                    </div>
                  </div>
                  <button
                    className="icon-btn"
                    style={{ boxShadow: 'none', background: 'transparent' }}
                    aria-label={tr('Supprimer {label}', { label: m.label })}
                    onClick={() => {
                      removeMeal(today, m.id);
                      if (m.photoId) deletePhoto(m.photoId).catch(() => undefined);
                    }}
                  >
                    <Icon name="trash" size={18} />
                  </button>
                </div>
              ))}
              <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                {plans
                  .filter((p) => !entries.some((e) => e.planId === p.id))
                  .map((p) => (
                    <button key={p.id} className="chip" onClick={() => togglePlannedMeal(today, p)}>
                      <Icon name="plus" size={16} /> {p.label}
                    </button>
                  ))}
                <button className="chip" onClick={() => setManual(slot.id)}>
                  <Icon name="plus" size={16} />{' '}{tr('Autre')}
                </button>
              </div>
            </div>
          </section>
        );
      })}

      {photo && <PhotoSheet file={photo.file} initialSlot={photo.slot} today={today} onClose={() => setPhoto(null)} />}
      {manual && (
        <ManualSheet
          slot={manual}
          today={today}
          onClose={() => setManual(null)}
          onPhoto={() => takePhoto(manual)}
          onScan={() => {
            setScan(manual);
            setManual(null);
          }}
        />
      )}
      {suggest && <SuggestSheet today={today} slot={slotForNow()} onClose={() => setSuggest(false)} openCoach={openCoach} />}
    </>
  );
}

/** Mangé contre dépensé d'après Apple Santé (énergie au repos + énergie active). */
function Balance({ today, eaten }: { today: string; eaten: number }) {
  const s = useApp();
  const h = s.health[today];
  if (!h || (h.resting === undefined && h.active === undefined)) return null;
  if (h.resting === undefined) {
    return (
      <p className="small muted" style={{ margin: '12px 2px 0' }}>
        {tr('{n} kcal brûlées en activité aujourd’hui. Ajoute « Énergie au repos » au raccourci pour voir ton bilan complet.', { n: formatNumber(h.active ?? 0) })}
      </p>
    );
  }
  const spent = h.resting + (h.active ?? 0);
  const gap = eaten - spent;
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, textAlign: 'center' }}>
        {(
          [
            [tr('Mangé'), eaten, 'var(--gold)'],
            [tr('Dépensé'), spent, 'var(--flame)'],
            [gap <= 0 ? tr('Déficit') : tr('Excédent'), Math.abs(gap), gap <= 0 ? 'var(--green)' : 'var(--red)'],
          ] as const
        ).map(([label, v, color]) => (
          <div key={label}>
            <div className="display num" style={{ fontSize: '1.3rem', color }}>
              {formatNumber(v)}
            </div>
            <div className="small muted">{label}</div>
          </div>
        ))}
      </div>
      <p className="small faint" style={{ margin: '10px 0 0' }}>
        {tr('D’après Apple Santé ({time}) : {n} kcal au repos, {n2} en activité. Ton objectif de {n3} kcal tient déjà compte d’une activité normale : pas besoin de remanger ce que tu brûles.', {
          time: h.at ? new Date(h.at).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' }) : tr('dernière synchro'),
          n: formatNumber(h.resting),
          n2: formatNumber(h.active ?? 0),
          n3: formatNumber(s.settings.targets.kcal),
        })}
      </p>
    </div>
  );
}

function MacroLine({ label, value, max, tone }: { label: string; value: number; max: number; tone?: 'green' | 'yellow' | 'blue' }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }} className="small">
        <span className="muted">{label}</span>
        <span className="num" style={{ fontWeight: 700 }}>
          {formatNumber(value)} / {max} g
        </span>
      </div>
      <div style={{ marginTop: 4 }}>
        <Bar value={value} max={max} tone={tone} />
      </div>
    </div>
  );
}

type Prepared = Awaited<ReturnType<typeof prepareImage>>;

function PhotoSheet({ file, initialSlot, today, onClose }: { file: File; initialSlot: MealSlot; today: string; onClose: () => void }) {
  const ai = useApp().settings.ai;
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [preview, setPreview] = useState<string>();
  const [slot, setSlot] = useState<MealSlot>(initialSlot);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MealAnalysis | null>(null);
  const [items, setItems] = useState<(MealItem & { base: MealItem })[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let url: string | undefined;
    prepareImage(file)
      .then((p) => {
        setPrepared(p);
        url = URL.createObjectURL(p.blob);
        setPreview(url);
      })
      .catch(() => setError(tr('Impossible de lire cette photo. Essaie en JPEG ou PNG.')));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]);

  const analyze = async () => {
    if (!prepared) return;
    setBusy(true);
    setError(undefined);
    try {
      const s = getState();
      const t = totals(readDay(s, today));
      const res = await api<MealAnalysis>('/api/meal/analyze', {
        body: {
          image: prepared.base64,
          mediaType: prepared.mediaType,
          note: note.trim() || undefined,
          slot: slotName(slot),
          goal: WEIGHT_GOALS[s.settings.weightGoal].label,
          remaining: {
            kcal: s.settings.targets.kcal - t.kcal,
            protein: s.settings.targets.protein - t.protein,
          },
        },
      });
      if (!res.is_food) {
        setError(tr('Je ne vois pas de nourriture sur cette photo.'));
      } else {
        setResult(res);
        setItems(res.items.map((i) => ({ ...i, base: { ...i } })));
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const setGrams = (idx: number, grams: number | undefined) => {
    setItems((list) =>
      list.map((it, i) => {
        if (i !== idx || grams === undefined) return it;
        const k = it.base.grams > 0 ? grams / it.base.grams : 1;
        return {
          ...it,
          grams,
          kcal: Math.round(it.base.kcal * k),
          protein: Math.round(it.base.protein * k),
          carbs: Math.round(it.base.carbs * k),
          fat: Math.round(it.base.fat * k),
        };
      }),
    );
  };

  const sum = items.reduce(
    (a, i) => ({ kcal: a.kcal + i.kcal, protein: a.protein + i.protein, carbs: a.carbs + i.carbs, fat: a.fat + i.fat }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );

  const save = async () => {
    if (!result || !prepared) return;
    const photoId = uid();
    await savePhoto(photoId, prepared.thumb).catch(() => undefined);
    addMeal(today, {
      slot,
      label: result.title,
      ...sum,
      source: 'photo',
      photoId,
      items: items.map(({ base: _b, ...i }) => i),
    });
    toast(tr('Ajouté : {n} kcal', { n: formatNumber(sum.kcal) }));
    onClose();
  };

  const saveManual = async (m: { label: string; kcal: number; protein: number; carbs: number; fat: number }) => {
    const photoId = uid();
    if (prepared) await savePhoto(photoId, prepared.thumb).catch(() => undefined);
    addMeal(today, { slot, ...m, source: 'photo', photoId: prepared ? photoId : undefined });
    toast(tr('Ajouté : {n} kcal', { n: formatNumber(m.kcal) }));
    onClose();
  };

  const confidence = { high: tr('Estimation fiable'), medium: tr('Estimation moyenne'), low: tr('Estimation approximative') };

  return (
    <Sheet title={tr('Analyser un repas')} onClose={onClose}>
      {preview ? (
        <img
          src={preview}
          alt={tr('Ton repas')}
          style={{ width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 14, display: 'block' }}
        />
      ) : (
        !error && (
          <div className="empty">
            <div className="spinner" style={{ margin: '0 auto' }} />
          </div>
        )
      )}

      <div className="chips" style={{ marginTop: 14 }}>
        {SLOTS.map((sl) => (
          <button key={sl.id} className={`chip ${slot === sl.id ? 'on' : ''}`} onClick={() => setSlot(sl.id)}>
            {sl.name}
          </button>
        ))}
      </div>

      {!result && ai !== 'api' && (
        <div className="stack" style={{ marginTop: 14 }}>
          {ai === 'claude' && (
            <>
              <button
                className="btn block"
                onClick={async () => {
                  const how = await openInClaude(mealPhotoPrompt(slotName(slot), note.trim() || undefined));
                  if (how === 'copied') toast(tr('Consigne copiée : colle-la dans Claude avec ta photo.'));
                }}
              >
                {tr('Analyser dans Claude')}
              </button>
              <p className="small muted" style={{ margin: 0 }}>
                {tr('Joins ta photo dans Claude, puis reviens saisir le total qu’il te donne.')}
              </p>
            </>
          )}
          <ManualForm cta={ADD_TO_SLOT[slot]} onSave={saveManual} />
        </div>
      )}

      {!result && ai === 'api' && (
        <div className="stack" style={{ marginTop: 14 }}>
          <label className="field">
            <span>{tr('Précision (optionnel)')}</span>
            <input
              className="input"
              placeholder={tr('ex. box de 150 g de poulet, sauce soja')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button className="btn primary block" onClick={analyze} disabled={!prepared || busy}>
            {busy ? (
              <>
                <span className="spinner" style={{ borderTopColor: 'var(--on-accent)', width: 18, height: 18 }} />{' '}{tr('Analyse en cours')}
              </>
            ) : (
              tr('Estimer les calories')
            )}
          </button>
        </div>
      )}

      {error && (
        <p className="small" style={{ color: 'var(--red)', marginTop: 12 }}>
          {error}
        </p>
      )}

      {result && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <h2>{result.title}</h2>
            <span className={`tag ${result.confidence === 'low' ? 'warn' : ''}`}>{confidence[result.confidence]}</span>
          </div>
          <div className="group" style={{ marginTop: 10 }}>
            {items.map((it, i) => (
              <div className="row" key={i} style={{ gap: 10 }}>
                <div className="grow">
                  <div className="title" style={{ fontWeight: 550 }}>
                    {it.name}
                  </div>
                  <div className="small muted num">
                    {tr('{kcal} kcal, {protein} g P', { kcal: it.kcal, protein: it.protein })}
                  </div>
                </div>
                <label style={{ width: 84 }}>
                  <span className="visually-hidden">{tr('Grammes de {name}', { name: it.name })}</span>
                  <input
                    className="input center num"
                    style={{ minHeight: 40 }}
                    inputMode="numeric"
                    defaultValue={it.grams}
                    onBlur={(e) => setGrams(i, parseDecimal(e.target.value))}
                  />
                </label>
                <span className="small faint">g</span>
                <button
                  className="icon-btn"
                  style={{ width: 36, height: 36, boxShadow: 'none', background: 'transparent' }}
                  aria-label={tr('Retirer {name}', { name: it.name })}
                  onClick={() => setItems((l) => l.filter((_, j) => j !== i))}
                >
                  <Icon name="x" size={18} />
                </button>
              </div>
            ))}
          </div>
          <p className="num" style={{ margin: '12px 2px 4px', fontWeight: 700 }}>
            {tr('Total : {n} kcal, {protein} g P, {carbs} g G, {fat} g L', { n: formatNumber(sum.kcal), protein: sum.protein, carbs: sum.carbs, fat: sum.fat })}
          </p>
          {result.advice && <p className="small muted" style={{ margin: '0 2px 14px' }}>{result.advice}</p>}
          <button className="btn primary block" onClick={save} disabled={!items.length}>
            {ADD_TO_SLOT[slot]}
          </button>
        </div>
      )}
    </Sheet>
  );
}

function ManualForm({
  cta,
  onSave,
}: {
  cta: string;
  onSave: (m: { label: string; kcal: number; protein: number; carbs: number; fat: number }) => void;
}) {
  const [f, setF] = useState({ label: '', kcal: '', protein: '', carbs: '', fat: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = () => {
    const kcal = parseDecimal(f.kcal);
    if (!f.label.trim() || kcal === undefined) return toast(tr('Indique au moins un nom et les calories'), true);
    onSave({
      label: f.label.trim(),
      kcal: Math.round(kcal),
      protein: Math.round(parseDecimal(f.protein) ?? 0),
      carbs: Math.round(parseDecimal(f.carbs) ?? 0),
      fat: Math.round(parseDecimal(f.fat) ?? 0),
    });
  };
  return (
    <div className="stack">
      <label className="field">
        <span>{tr('Nom')}</span>
        <input className="input" value={f.label} onChange={set('label')} placeholder={tr('ex. Wrap poulet')} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {(
          [
            ['kcal', tr('Calories')],
            ['protein', tr('Protéines (g)')],
            ['carbs', tr('Glucides (g)')],
            ['fat', tr('Lipides (g)')],
          ] as const
        ).map(([k, label]) => (
          <label className="field" key={k}>
            <span>{label}</span>
            <input className="input num" inputMode="decimal" value={f[k]} onChange={set(k)} />
          </label>
        ))}
      </div>
      <button className="btn primary block" onClick={save}>
        {cta}
      </button>
    </div>
  );
}

/** Objectif d'eau : réglé à la main, sinon 35 ml par kilo (entre 2 et 4 litres), arrondi au verre. */
function waterGoal(s: ReturnType<typeof useApp>): number {
  if (s.settings.waterGoal) return s.settings.waterGoal;
  const weights = Object.entries(s.body.weight).sort(([a], [b]) => b.localeCompare(a));
  const kg = weights[0]?.[1] ?? 75;
  return Math.min(4000, Math.max(2000, Math.round((kg * 35) / 250) * 250));
}

function WaterCard({ today }: { today: string }) {
  const s = useApp();
  const ml = readDay(s, today).water ?? 0;
  const goal = waterGoal(s);
  const glasses = Math.round(goal / 250);
  const full = Math.floor(ml / 250);
  return (
    <section className="card water-card" style={{ marginTop: 12 }}>
      <div className="water-head">
        <div>
          <div className="small muted">{tr('Hydratation')}</div>
          <div className="water-amount num">
            {formatNumber(ml / 1000, ml % 1000 ? 2 : 1)} <span>/ {formatNumber(goal / 1000, 1)} L</span>
          </div>
        </div>
        <div className="water-actions">
          <button className="icon-btn" disabled={!ml} aria-label={tr('Retirer un verre')} onClick={() => addWater(today, -250)}>
            <Icon name="minus" size={18} />
          </button>
          <button className="btn small primary" onClick={() => addWater(today, 250)}>
            {tr('+ 25 cl')}
          </button>
          <button className="btn small" onClick={() => addWater(today, 500)}>
            {tr('+ 50 cl')}
          </button>
        </div>
      </div>
      <div className="water-glasses" role="img" aria-label={tr('{full} verres sur {glasses}', { full, glasses })}>
        {Array.from({ length: glasses }, (_, i) => (
          <span key={i} className={i < full ? 'on' : ''} style={{ animationDelay: `${i * 30}ms` }} />
        ))}
      </div>
      {ml >= goal && <div className="small water-done">{tr('Objectif atteint, bien hydraté.')}</div>}
    </section>
  );
}

/** Vignette d'un aliment : la photo du produit, sinon (pas de photo, ou lien cassé) un pictogramme. */
function FoodThumb({ hit }: { hit: FoodHit }) {
  const [broken, setBroken] = useState(false);
  if (hit.image && !broken) {
    return <img className="food-thumb" src={hit.image} alt="" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  return (
    <span className={`food-thumb food-thumb-empty${hit.generic ? ' generic' : ''}`} aria-hidden="true">
      <Icon name={hit.generic ? 'apple' : 'utensils'} size={18} />
    </span>
  );
}

function HitRow({ hit, onPick }: { hit: FoodHit; onPick: (h: FoodHit) => void }) {
  return (
    <button type="button" className="row settings-row" style={{ width: '100%' }} onClick={() => onPick(hit)}>
      <FoodThumb hit={hit} />
      <span className="grow" style={{ textAlign: 'left', minWidth: 0 }}>
        <span className="title ellipsis" style={{ display: 'block' }}>
          {hit.name}
        </span>
        <span className="small muted ellipsis" style={{ display: 'block' }}>
          {hit.brand ? `${hit.brand}, ` : ''}
          {tr('{n} kcal pour 100 g', { n: formatNumber(hit.per100.kcal) })}
        </span>
      </span>
    </button>
  );
}

function ManualSheet({ slot, today, onClose, onPhoto, onScan }: { slot: MealSlot; today: string; onClose: () => void; onPhoto: () => void; onScan: () => void }) {
  const s = useApp();
  const recent = recentFoods(s, today);
  const [tab, setTab] = useState<'recent' | 'search' | 'manual'>(recent.length ? 'recent' : 'search');
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState<{ q: string; hits: FoodHit[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Entrée sur le clavier : la recherche part sans attendre. « Réessayer » relance la même.
  const [now, setNow] = useState('');
  const [retry, setRetry] = useState(0);
  const [pick, setPick] = useState<FoodHit | null>(null);
  const [grams, setGrams] = useState('100');
  const query = foodQuery(q);
  const local = useMemo(() => searchGeneric(query), [query]);

  // Produits du commerce : à partir de 3 lettres, une fois la frappe posée (Open Food Facts limite les recherches).
  useEffect(() => {
    setError(null);
    if (tab !== 'search' || query.length < 3) return setLoading(false);
    let live = true;
    setLoading(true);
    const t = setTimeout(
      () => {
        searchFoods(query).then(
          (hits) => {
            if (!live) return;
            setRemote({ q: query, hits });
            setLoading(false);
          },
          (e) => {
            if (!live) return;
            setError(errorText(e));
            setLoading(false);
          },
        );
      },
      now === query ? 0 : 700,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, tab, now, retry]);

  const done = (label: string) => {
    toast(tr('{label} ajouté', { label }));
    onClose();
  };
  const choose = (h: FoodHit) => {
    setPick(h);
    setGrams(String(h.serving ?? 100));
  };
  const g = parseDecimal(grams) ?? 0;
  const products = query.length >= 3 && remote ? remote.hits : [];
  const stale = remote !== null && remote.q !== query;

  return (
    <Sheet title={ADD_TO_SLOT[slot]} onClose={onClose}>
      <div className="quick-log">
        <button type="button" className="btn primary" onClick={onPhoto}>
          <Icon name="camera" size={18} />{' '}{tr('Photographier')}
        </button>
        <button type="button" className="btn" onClick={onScan}>
          <Icon name="barcode" size={18} />{' '}{tr('Scanner')}
        </button>
      </div>
      <div className="seg" role="tablist" style={{ marginBottom: 14 }}>
        {(
          [
            ['recent', tr('Récents')],
            ['search', tr('Rechercher')],
            ['manual', tr('À la main')],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'recent' &&
        (recent.length ? (
          <div className="group">
            {recent.map((m) => (
              <button
                key={m.id}
                className="row settings-row"
                style={{ width: '100%' }}
                onClick={() => {
                  addMeal(today, { slot, label: m.label, kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat, source: 'manual', ...(m.items ? { items: m.items } : {}) });
                  done(m.label);
                }}
              >
                <span className="grow" style={{ textAlign: 'left', minWidth: 0 }}>
                  <span className="title ellipsis" style={{ display: 'block' }}>
                    {tr(m.label)}
                  </span>
                  <span className="small muted num">
                    {tr('{n} kcal, {n2} g P', { n: formatNumber(m.kcal), n2: formatNumber(m.protein) })}
                  </span>
                </span>
                <Icon name="plus" size={18} />
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">{tr('Tes repas notés apparaîtront ici pour les remettre en un geste.')}</p>
        ))}

      {tab === 'search' && !pick && (
        <form
          className="stack"
          style={{ gap: 14 }}
          onSubmit={(e) => {
            e.preventDefault();
            setNow(query);
            // Le clavier se range : les résultats prennent l'écran.
            (document.activeElement as HTMLElement | null)?.blur?.();
          }}
        >
          <input
            className="input"
            type="search"
            enterKeyHint="search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tr('Skyr, pain complet, poulet…')}
            aria-label={tr('Chercher un aliment')}
          />
          {local.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <div className="food-group">{tr('Aliments de base')}</div>
              <div className="group">
                {local.map((h) => (
                  <HitRow key={h.name} hit={h} onPick={choose} />
                ))}
              </div>
            </div>
          )}
          {query.length >= 3 && (
            <div className="stack" style={{ gap: 6 }}>
              <div className="food-group">{tr('Produits du commerce')}</div>
              {error ? (
                <div className="food-error">
                  <p className="small muted" style={{ margin: 0 }}>
                    {error}
                  </p>
                  <button type="button" className="btn small" onClick={() => setRetry((n) => n + 1)}>
                    {tr('Réessayer')}
                  </button>
                </div>
              ) : loading && !products.length ? (
                <div className="spinner" />
              ) : null}
              {products.length > 0 && (
                <div className="group" style={{ opacity: stale && loading ? 0.55 : 1, transition: 'opacity 0.2s' }}>
                  {products.map((h) => (
                    <HitRow key={h.code || `${h.name}|${h.brand ?? ''}`} hit={h} onPick={choose} />
                  ))}
                </div>
              )}
              {!loading && !error && !stale && remote && !products.length && (
                <p className="small muted" style={{ margin: 0 }}>
                  {local.length ? tr('Aucun produit du commerce à ce nom.') : tr('Rien trouvé. Essaie un autre mot, ou saisis-le à la main.')}
                </p>
              )}
            </div>
          )}
          <p className="small faint" style={{ margin: 0 }}>
            {tr('Aliments de base : valeurs moyennes. Produits : Open Food Facts, base collaborative, vérifie l’étiquette en cas de doute.')}
          </p>
        </form>
      )}

      {tab === 'search' && pick && (
        <div className="stack" style={{ gap: 12 }}>
          <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => setPick(null)}>
            {tr('‹ Résultats')}
          </button>
          <div style={{ fontWeight: 800 }}>{pick.name}</div>
          {pick.brand ? <div className="small muted">{pick.brand}</div> : pick.generic ? <div className="small muted">{tr('Valeurs moyennes, sans marque')}</div> : null}
          <label className="field">
            <span>{tr('Quantité (g)')}</span>
            <input className="input num" inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} />
          </label>
          <div className="chips" style={{ gap: 6 }}>
            {[...new Set([50, 100, 150, 200, ...(pick.serving ? [pick.serving] : [])])].map((v) => (
              <button key={v} className={`chip ${g === v ? 'on' : ''}`} onClick={() => setGrams(String(v))}>
                {pick.serving === v ? tr('{n} g (portion)', { n: formatNumber(v) }) : `${formatNumber(v)} g`}
              </button>
            ))}
          </div>
          {g > 0 && (
            <div className="small muted num">
              {(() => {
                const m = forGrams(pick, g);
                return tr('{n} kcal, {protein} g P, {carbs} g G, {fat} g L', { n: formatNumber(m.kcal), protein: m.protein, carbs: m.carbs, fat: m.fat });
              })()}
            </div>
          )}
          <button
            className="btn primary block"
            disabled={!(g > 0 && g <= 5000)}
            onClick={() => {
              const m = forGrams(pick, g);
              const label = `${pick.name}${pick.brand ? ` (${pick.brand})` : ''}`.slice(0, 80);
              addMeal(today, { slot, label, ...m, source: 'manual', items: [{ name: pick.name, grams: g, ...m }] });
              done(pick.name);
            }}
          >
            {tr('Ajouter')}{' '}{g > 0 ? `${formatNumber(g)} g` : ''}
          </button>
        </div>
      )}

      {tab === 'manual' && (
        <ManualForm
          cta={tr('Ajouter')}
          onSave={(m) => {
            addMeal(today, { slot, ...m, source: 'manual' });
            done(m.label);
          }}
        />
      )}
    </Sheet>
  );
}
