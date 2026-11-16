import { ScanSheet } from '../components/ScanSheet';
import { useEffect, useRef, useState } from 'react';
import { type MealSlot, SLOTS } from '../../shared/program';
import { mealPhotoPrompt, openInClaude } from '../lib/ai';
import { Icon } from '../components/Icon';
import { SuggestSheet } from '../components/SuggestSheet';
import { Ring } from '../components/Ring';
import { Bar, errorText, PhotoThumb, Sheet, toast } from '../components/ui';
import { addMeal, addWater, parseDecimal, removeMeal, togglePlannedMeal } from '../lib/actions';
import { type FoodHit, forGrams, recentFoods, searchFoods } from '../lib/foodSearch';
import { api, type MealAnalysis } from '../lib/api';
import { formatNumber } from '../lib/date';
import { prepareImage } from '../lib/image';
import { totals } from '../lib/logic';
import { deletePhoto, savePhoto } from '../lib/photos';
import { getState, type MealItem, readDay, uid, useApp, WEIGHT_GOALS } from '../lib/store';

function slotForNow(): MealSlot {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  if (h < 10.5) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 18.5) return 'snack';
  if (h < 22.5) return 'dinner';
  return 'extra';
}

const slotName = (id: MealSlot) => SLOTS.find((s) => s.id === id)?.name ?? id;

export function Food({ today, openCoach }: { today: string; openCoach: () => void }) {
  const s = useApp();
  const day = readDay(s, today);
  const t = totals(day);
  const target = s.settings.targets;
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [manual, setManual] = useState<MealSlot | null>(null);
  const [suggest, setSuggest] = useState(false);
  const [scan, setScan] = useState(false);

  return (
    <>
      <header className="topbar">
        <div>
          <div className="date">Nutrition du jour</div>
          <h1>Repas</h1>
        </div>
      </header>

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <Ring value={t.kcal} max={target.kcal} color={t.kcal > target.kcal * 1.05 ? 'var(--red)' : 'var(--gold)'} size={116} stroke={12} label="Calories du jour">
          <div>
            <div className="display num" style={{ fontSize: '1.45rem' }}>
              {formatNumber(Math.abs(target.kcal - t.kcal))}
            </div>
            <div className="faint" style={{ fontSize: '0.7rem', fontWeight: 700 }}>
              {t.kcal > target.kcal ? 'kcal en trop' : 'kcal restantes'}
            </div>
          </div>
        </Ring>
        <div className="stack" style={{ flex: 1, gap: 10, minWidth: 0 }}>
          <MacroLine label="Protéines" value={t.protein} max={target.protein} tone="blue" />
          <MacroLine label="Glucides" value={t.carbs} max={target.carbs} />
          <MacroLine label="Lipides" value={t.fat} max={target.fat} tone="yellow" />
        </div>
      </div>

      {s.settings.modules.health && <Balance today={today} eaten={t.kcal} />}

      <WaterCard today={today} />

      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <button className="btn primary" style={{ flex: 1.2, minHeight: 58 }} onClick={() => fileRef.current?.click()}>
          <Icon name="camera" /> Photographier
        </button>
        <button className="btn" style={{ flex: 1, minHeight: 58 }} onClick={() => setScan(true)}>
          <Icon name="barcode" /> Scanner
        </button>
      </div>
      <button className="btn block" style={{ marginTop: 10 }} onClick={() => setSuggest(true)}>
        <Icon name="bolt" size={18} /> Proposer un plat pour ce qu’il me reste
      </button>
      {scan && <ScanSheet today={today} slot={slotForNow()} onClose={() => setScan(false)} />}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setPhoto(f);
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
                      {m.label}
                    </div>
                    <div className="small muted num">
                      {formatNumber(m.kcal)} kcal, {formatNumber(m.protein)} g P, {formatNumber(m.carbs)} g G,{' '}
                      {formatNumber(m.fat)} g L
                    </div>
                  </div>
                  <button
                    className="icon-btn"
                    style={{ boxShadow: 'none', background: 'transparent' }}
                    aria-label={`Supprimer ${m.label}`}
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
                  <Icon name="plus" size={16} /> Autre
                </button>
              </div>
            </div>
          </section>
        );
      })}

      {photo && <PhotoSheet file={photo} today={today} onClose={() => setPhoto(null)} />}
      {manual && <ManualSheet slot={manual} today={today} onClose={() => setManual(null)} />}
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
        {formatNumber(h.active ?? 0)} kcal brûlées en activité aujourd’hui. Ajoute « Énergie au repos » au raccourci pour voir ton bilan complet.
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
            ['Mangé', eaten, 'var(--gold)'],
            ['Dépensé', spent, 'var(--flame)'],
            [gap <= 0 ? 'Déficit' : 'Excédent', Math.abs(gap), gap <= 0 ? 'var(--green)' : 'var(--red)'],
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
        D’après Apple Santé à {h.at ? new Date(h.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'la dernière synchro'} : {formatNumber(h.resting)} kcal au repos, {formatNumber(h.active ?? 0)} en activité. Ton objectif de {formatNumber(s.settings.targets.kcal)} kcal tient déjà compte d’une activité normale : pas besoin de remanger ce que tu brûles.
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

function PhotoSheet({ file, today, onClose }: { file: File; today: string; onClose: () => void }) {
  const ai = useApp().settings.ai;
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [preview, setPreview] = useState<string>();
  const [slot, setSlot] = useState<MealSlot>(slotForNow());
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
      .catch(() => setError('Impossible de lire cette photo. Essaie en JPEG ou PNG.'));
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
        setError('Je ne vois pas de nourriture sur cette photo.');
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
    toast(`Ajouté : ${formatNumber(sum.kcal)} kcal`);
    onClose();
  };

  const saveManual = async (m: { label: string; kcal: number; protein: number; carbs: number; fat: number }) => {
    const photoId = uid();
    if (prepared) await savePhoto(photoId, prepared.thumb).catch(() => undefined);
    addMeal(today, { slot, ...m, source: 'photo', photoId: prepared ? photoId : undefined });
    toast(`Ajouté : ${formatNumber(m.kcal)} kcal`);
    onClose();
  };

  const confidence = { high: 'Estimation fiable', medium: 'Estimation moyenne', low: 'Estimation approximative' };

  return (
    <Sheet title="Analyser un repas" onClose={onClose}>
      {preview ? (
        <img
          src={preview}
          alt="Ton repas"
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
                  if (how === 'copied') toast('Consigne copiée : colle-la dans Claude avec ta photo.');
                }}
              >
                Analyser dans Claude
              </button>
              <p className="small muted" style={{ margin: 0 }}>
                Joins ta photo dans Claude, puis reviens saisir le total qu’il te donne.
              </p>
            </>
          )}
          <ManualForm cta={`Ajouter au ${slotName(slot).toLowerCase()}`} onSave={saveManual} />
        </div>
      )}

      {!result && ai === 'api' && (
        <div className="stack" style={{ marginTop: 14 }}>
          <label className="field">
            <span>Précision (optionnel)</span>
            <input
              className="input"
              placeholder="ex. box de 150 g de poulet, sauce soja"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button className="btn primary block" onClick={analyze} disabled={!prepared || busy}>
            {busy ? (
              <>
                <span className="spinner" style={{ borderTopColor: 'var(--on-accent)', width: 18, height: 18 }} /> Analyse en cours
              </>
            ) : (
              'Estimer les calories'
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
                    {it.kcal} kcal, {it.protein} g P
                  </div>
                </div>
                <label style={{ width: 84 }}>
                  <span className="visually-hidden">Grammes de {it.name}</span>
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
                  aria-label={`Retirer ${it.name}`}
                  onClick={() => setItems((l) => l.filter((_, j) => j !== i))}
                >
                  <Icon name="x" size={18} />
                </button>
              </div>
            ))}
          </div>
          <p className="num" style={{ margin: '12px 2px 4px', fontWeight: 700 }}>
            Total : {formatNumber(sum.kcal)} kcal, {sum.protein} g P, {sum.carbs} g G, {sum.fat} g L
          </p>
          {result.advice && <p className="small muted" style={{ margin: '0 2px 14px' }}>{result.advice}</p>}
          <button className="btn primary block" onClick={save} disabled={!items.length}>
            Ajouter au {slotName(slot).toLowerCase()}
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
    if (!f.label.trim() || kcal === undefined) return toast('Indique au moins un nom et les calories', true);
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
        <span>Nom</span>
        <input className="input" value={f.label} onChange={set('label')} placeholder="ex. Wrap poulet" />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {(
          [
            ['kcal', 'Calories'],
            ['protein', 'Protéines (g)'],
            ['carbs', 'Glucides (g)'],
            ['fat', 'Lipides (g)'],
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
          <div className="small muted">Hydratation</div>
          <div className="water-amount num">
            {formatNumber(ml / 1000, ml % 1000 ? 2 : 1)} <span>/ {formatNumber(goal / 1000, 1)} L</span>
          </div>
        </div>
        <div className="water-actions">
          <button className="icon-btn" disabled={!ml} aria-label="Retirer un verre" onClick={() => addWater(today, -250)}>
            <Icon name="minus" size={18} />
          </button>
          <button className="btn small primary" onClick={() => addWater(today, 250)}>
            + 25 cl
          </button>
          <button className="btn small" onClick={() => addWater(today, 500)}>
            + 50 cl
          </button>
        </div>
      </div>
      <div className="water-glasses" role="img" aria-label={`${full} verres sur ${glasses}`}>
        {Array.from({ length: glasses }, (_, i) => (
          <span key={i} className={i < full ? 'on' : ''} style={{ animationDelay: `${i * 30}ms` }} />
        ))}
      </div>
      {ml >= goal && <div className="small water-done">Objectif atteint, bien hydraté.</div>}
    </section>
  );
}

function ManualSheet({ slot, today, onClose }: { slot: MealSlot; today: string; onClose: () => void }) {
  const s = useApp();
  const recent = recentFoods(s, today);
  const [tab, setTab] = useState<'recent' | 'search' | 'manual'>(recent.length ? 'recent' : 'search');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<FoodHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<FoodHit | null>(null);
  const [grams, setGrams] = useState('100');

  useEffect(() => {
    if (tab !== 'search' || q.trim().length < 2) return setHits(null);
    let live = true;
    setError(null);
    const t = setTimeout(() => {
      searchFoods(q).then(
        (h) => live && setHits(h),
        (e) => live && (setError(errorText(e)), setHits([])),
      );
    }, 450);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, tab]);

  const done = (label: string) => {
    toast(`${label} ajouté`);
    onClose();
  };
  const g = parseDecimal(grams) ?? 0;

  return (
    <Sheet title={`Ajouter au ${slotName(slot).toLowerCase()}`} onClose={onClose}>
      <div className="seg" role="tablist" style={{ marginBottom: 14 }}>
        {(
          [
            ['recent', 'Récents'],
            ['search', 'Rechercher'],
            ['manual', 'À la main'],
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
                    {m.label}
                  </span>
                  <span className="small muted num">
                    {formatNumber(m.kcal)} kcal, {formatNumber(m.protein)} g P
                  </span>
                </span>
                <Icon name="plus" size={18} />
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">Tes repas notés apparaîtront ici pour les remettre en un geste.</p>
        ))}

      {tab === 'search' && !pick && (
        <div className="stack" style={{ gap: 12 }}>
          <input className="input" type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Skyr, pain complet, poulet…" aria-label="Chercher un aliment" />
          {error && <p className="small muted" style={{ margin: 0 }}>{error}</p>}
          {hits === null && q.trim().length >= 2 && <div className="spinner" />}
          {hits && hits.length === 0 && !error && <p className="small muted" style={{ margin: 0 }}>Rien trouvé. Essaie un autre mot, ou saisis-le à la main.</p>}
          {hits && hits.length > 0 && (
            <div className="group">
              {hits.map((h) => (
                <button
                  key={h.code || h.name}
                  className="row settings-row"
                  style={{ width: '100%' }}
                  onClick={() => {
                    setPick(h);
                    setGrams(String(h.serving ?? 100));
                  }}
                >
                  {h.image ? <img className="food-thumb" src={h.image} alt="" loading="lazy" /> : <span className="food-thumb" />}
                  <span className="grow" style={{ textAlign: 'left', minWidth: 0 }}>
                    <span className="title ellipsis" style={{ display: 'block' }}>
                      {h.name}
                    </span>
                    <span className="small muted ellipsis" style={{ display: 'block' }}>
                      {h.brand ? `${h.brand}, ` : ''}
                      {formatNumber(h.per100.kcal)} kcal pour 100 g
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <p className="small faint" style={{ margin: 0 }}>
            Données Open Food Facts, base collaborative : vérifie l’étiquette en cas de doute.
          </p>
        </div>
      )}

      {tab === 'search' && pick && (
        <div className="stack" style={{ gap: 12 }}>
          <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => setPick(null)}>
            ‹ Résultats
          </button>
          <div style={{ fontWeight: 800 }}>{pick.name}</div>
          {pick.brand && <div className="small muted">{pick.brand}</div>}
          <label className="field">
            <span>Quantité (g)</span>
            <input className="input num" inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} />
          </label>
          <div className="chips" style={{ gap: 6 }}>
            {[50, 100, 150, 200, ...(pick.serving ? [pick.serving] : [])].map((v) => (
              <button key={v} className={`chip ${g === v ? 'on' : ''}`} onClick={() => setGrams(String(v))}>
                {v} g{pick.serving === v ? ' (portion)' : ''}
              </button>
            ))}
          </div>
          {g > 0 && (
            <div className="small muted num">
              {(() => {
                const m = forGrams(pick, g);
                return `${formatNumber(m.kcal)} kcal, ${m.protein} g P, ${m.carbs} g G, ${m.fat} g L`;
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
            Ajouter {g > 0 ? `${formatNumber(g)} g` : ''}
          </button>
        </div>
      )}

      {tab === 'manual' && (
        <ManualForm
          cta="Ajouter"
          onSave={(m) => {
            addMeal(today, { slot, ...m, source: 'manual' });
            done(m.label);
          }}
        />
      )}
    </Sheet>
  );
}
