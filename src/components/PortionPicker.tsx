// Choisir sa portion : un nombre et une mesure (1 mug, 2 œufs, 1 cuillère à soupe), ou des grammes (des ml pour
// une boisson) pour ce qui se pèse. Le total s'affiche en dessous, dans la bonne unité.
import { useEffect, useRef, useState } from 'react';
import { parseDecimal } from '../lib/actions';
import { amountOf, fmtAmount, measuresOf, type Portion, type Portionable, unitOf } from '../lib/portions';
import { tr } from '../../shared/i18n';

const fmtQty = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

export function PortionPicker({ food, value, onChange }: { food: Portionable; value: Portion; onChange: (p: Portion) => void }) {
  const unit = unitOf(food);
  const measures = measuresOf(food);
  const base = value.measure < 0 || !measures[value.measure];
  const [text, setText] = useState(fmtQty(value.qty));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmtQty(value.qty));
  }, [value.qty, value.measure]);

  const set = (qty: number) => onChange({ ...value, qty: Math.max(0, Math.round(qty * 100) / 100) });
  // À la mesure : de 1 en 1, avec une demi en dessous de 1 (un demi-avocat). En grammes : de 10 en 10, en ml de 25 en 25.
  const bump = (dir: 1 | -1) => {
    if (base) return set(value.qty + dir * (unit === 'ml' ? 25 : 10));
    if (dir < 0) return set(value.qty > 1 ? value.qty - 1 : 0.5);
    set(value.qty < 1 ? 1 : value.qty + 1);
  };
  const what = base ? unit : measures[value.measure].name;
  const total = amountOf(food, value);

  return (
    <div className="portion">
      <div className="portion-row">
        <div className="stepper">
          <button type="button" onClick={() => bump(-1)} aria-label={tr('Moins')}>
            −
          </button>
          <label>
            <span className="visually-hidden">{base ? tr('Quantité en {unit}', { unit }) : tr('Nombre : {what}', { what })}</span>
            <input
              className="num"
              inputMode="decimal"
              value={text}
              onFocus={() => (focused.current = true)}
              onChange={(e) => {
                setText(e.target.value);
                const n = parseDecimal(e.target.value);
                if (n !== undefined && n >= 0) onChange({ ...value, qty: n });
              }}
              onBlur={() => {
                focused.current = false;
                setText(fmtQty(value.qty));
              }}
            />
          </label>
          <button type="button" onClick={() => bump(1)} aria-label={tr('Plus')}>
            +
          </button>
        </div>
        <span className="portion-what">
          {base ? (
            unit
          ) : (
            <>
              {what}
              <span className="small faint num">
                {' '}
                {value.qty === 1 ? fmtAmount(measures[value.measure].amount, unit) : tr('= {total}', { total: fmtAmount(total, unit) })}
              </span>
            </>
          )}
        </span>
      </div>
      <div className="chips" style={{ gap: 6 }} role="group" aria-label={tr('Mesure')}>
        {measures.map((m, i) => (
          <button
            key={`${m.name}-${m.amount}`}
            type="button"
            className={`chip small ${!base && value.measure === i ? 'on' : ''}`}
            onClick={() => onChange({ measure: i, qty: 1 })}
          >
            {m.name}
            <span className="chip-sub num">{fmtAmount(m.amount, unit)}</span>
          </button>
        ))}
        <button type="button" className={`chip small ${base ? 'on' : ''}`} onClick={() => onChange({ measure: -1, qty: Math.round(total) || 100 })}>
          {unit === 'ml' ? tr('En ml') : tr('En grammes')}
        </button>
      </div>
    </div>
  );
}
