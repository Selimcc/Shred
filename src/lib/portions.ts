// Portions : combien on en mange, dans l'unité qui a du sens. Une boisson se compte en ml (une tasse, un mug),
// un œuf à la pièce, l'huile à la cuillère, le riz au gramme. Les valeurs restent pour 100 g ou 100 ml.
import type { FoodHit, Measure } from '../../shared/food';
import { PACK_MAX } from '../../shared/food';
import { formatNumber } from './date';
import { tr } from '../../shared/i18n';

export type Portionable = Pick<FoodHit, 'per100' | 'serving' | 'unit' | 'pack' | 'measures'>;

/** `measure` : index de la mesure choisie, ou -1 pour une quantité en grammes (ou en ml). */
export interface Portion {
  measure: number;
  qty: number;
}

export const unitOf = (f: Pick<FoodHit, 'unit'>): 'g' | 'ml' => (f.unit === 'ml' ? 'ml' : 'g');

/** Produit entier proposé pour un aliment solide jusqu'à ce poids (un pot, une barre, une pizza). */
const SOLID_PACK_MAX = 450;

/**
 * Les mesures d'un aliment : les siennes pour un aliment de base ; pour un produit, sa portion, le produit entier
 * s'il se mange en une fois, et pour une boisson un verre et un mug. Pas deux mesures presque égales.
 */
export function measuresOf(f: Portionable): Measure[] {
  if (f.measures?.length) return f.measures;
  const out: Measure[] = [];
  const add = (name: string, amount: number | undefined) => {
    if (!amount || amount <= 0 || out.some((m) => Math.abs(m.amount - amount) <= amount * 0.08)) return;
    out.push({ name, amount });
  };
  add(tr('Portion'), f.serving);
  if (f.pack && f.pack <= (f.unit === 'ml' ? PACK_MAX : SOLID_PACK_MAX)) add(tr('Tout le produit'), f.pack);
  if (f.unit === 'ml') {
    add(tr('Verre'), 200);
    add(tr('Mug'), 250);
  }
  return out;
}

/** Ce qu'on propose d'abord : la première mesure, sinon 100 g (ou 100 ml). */
export function defaultPortion(f: Portionable): Portion {
  return measuresOf(f).length ? { measure: 0, qty: 1 } : { measure: -1, qty: 100 };
}

/** Quantité totale en grammes (ou en ml). */
export function amountOf(f: Portionable, p: Portion): number {
  const m = p.measure >= 0 ? measuresOf(f)[p.measure] : undefined;
  return Math.round((m ? m.amount * p.qty : p.qty) * 10) / 10;
}

/** « 250 ml », « 4,5 g ». */
export function fmtAmount(n: number, unit: 'g' | 'ml'): string {
  return `${formatNumber(n, Number.isInteger(n) ? 0 : 1)} ${unit}`;
}
