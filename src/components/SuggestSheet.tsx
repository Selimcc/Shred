// « Proposer un plat » : trois idées pour ce qu'il reste dans la journée, dehors, au supermarché ou à cuisiner.
import { useState } from 'react';
import type { MealSlot } from '../../shared/types';
import { suggestMeals, type SuggestMode } from '../../shared/meals';
import { addMeal } from '../lib/actions';
import { openInClaude } from '../lib/ai';
import { formatNumber } from '../lib/date';
import { totals } from '../lib/logic';
import { readDay, setState, useApp } from '../lib/store';
import { Icon } from './Icon';
import { Sheet, toast } from './ui';

const MODES: { id: SuggestMode; label: string }[] = [
  { id: 'out', label: 'Dehors' },
  { id: 'shop', label: 'Supermarché' },
  { id: 'cook', label: 'À cuisiner' },
];

export function SuggestSheet({ today, slot, onClose, openCoach }: { today: string; slot: MealSlot; onClose: () => void; openCoach: () => void }) {
  const s = useApp();
  const [mode, setMode] = useState<SuggestMode>('out');
  const [seed, setSeed] = useState(0);
  const t = totals(readDay(s, today));
  const tg = s.settings.targets;
  const remaining = { kcal: tg.kcal - t.kcal, protein: tg.protein - t.protein, carbs: tg.carbs - t.carbs, fat: tg.fat - t.fat };
  const { aim, items } = suggestMeals(remaining, mode, s.settings.athlete.diet, seed);

  const askClaude = async () => {
    const where = mode === 'out' ? 'à manger dehors (restaurant, fast-food, boulangerie)' : mode === 'shop' ? 'à acheter au supermarché, sans cuisiner' : 'à cuisiner en moins de 20 minutes';
    const prompt = `Il me reste ${Math.max(0, Math.round(remaining.kcal))} kcal et ${Math.max(0, Math.round(remaining.protein))} g de protéines aujourd’hui (${Math.max(0, Math.round(remaining.carbs))} g de glucides, ${Math.max(0, Math.round(remaining.fat))} g de lipides). Propose-moi 3 idées de repas ${where}, avec les quantités et une estimation des macros. Contraintes : ${s.settings.athlete.diet.vegetarian ? 'végétarien, ' : ''}${s.settings.athlete.diet.noPork ? 'sans porc, ' : ''}${s.settings.athlete.diet.lactoseFree ? 'sans lactose, ' : ''}${s.settings.athlete.diet.dislikes ? `je n’aime pas : ${s.settings.athlete.diet.dislikes}` : 'aucune'}.`;
    if (s.settings.ai === 'api') {
      setState((d) => void (d.ui.coachDraft = prompt));
      onClose();
      openCoach();
    } else {
      const how = await openInClaude(prompt);
      if (how === 'copied') toast('Question copiée : colle-la dans Claude');
    }
  };

  return (
    <Sheet title="Proposer un plat" onClose={onClose}>
      <div className="stack" style={{ gap: 16 }}>
        <p className="small muted" style={{ margin: 0 }}>
          {remaining.kcal > 150
            ? `Il te reste ${formatNumber(remaining.kcal)} kcal et ${formatNumber(Math.max(0, remaining.protein))} g de protéines.${remaining.kcal > 1100 ? ` Idées pour un repas d’environ ${formatNumber(aim.kcal)} kcal.` : ''}`
            : 'Ta journée est déjà bouclée. Voici de quoi tenir sans dépasser.'}
        </p>
        <div className="seg" role="tablist" style={{ gridTemplateColumns: 'repeat(3, 1fr)', margin: 0 }}>
          {MODES.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={mode === m.id}
              className={mode === m.id ? 'on' : ''}
              onClick={() => {
                setMode(m.id);
                setSeed(0);
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="stack">
          {items.map((it) => (
            <div key={it.id} className="card stack" style={{ gap: 6 }}>
              <div style={{ fontWeight: 850 }}>{it.title}</div>
              <div className="small muted">{it.detail}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="small num" style={{ flex: 1 }}>
                  {it.rough ? '≈ ' : ''}
                  {formatNumber(it.macros.kcal)} kcal · {it.macros.protein} g P · {it.macros.carbs} g G · {it.macros.fat} g L
                </span>
                <button
                  className="btn small primary"
                  onClick={() => {
                    addMeal(today, { slot, label: it.title, source: 'manual', ...it.macros });
                    toast('Repas noté');
                    onClose();
                  }}
                >
                  Je prends
                </button>
              </div>
            </div>
          ))}
          {!items.length && <p className="muted">Rien ne correspond à tes préférences dans cette catégorie.</p>}
        </div>
        {mode === 'out' && (
          <p className="small faint" style={{ margin: 0 }}>
            Valeurs moyennes pour une portion standard : une photo du plat donne une estimation plus juste.
          </p>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" style={{ flex: 1 }} onClick={() => setSeed(seed + 1)}>
            Autres idées
          </button>
          {s.settings.ai !== 'off' && (
            <button className="btn" style={{ flex: 1 }} onClick={askClaude}>
              <Icon name="chat" size={16} /> Demander à Claude
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
