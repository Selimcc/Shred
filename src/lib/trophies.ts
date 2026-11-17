// Surveille l'état : un trophée nouvellement gagné est daté et fêté. La liste et le calcul sont dans
// trophyList.ts.
import { dayKey } from './date';
import { moment } from './moments';
import { getState, setState, subscribe } from './store';
import { type Tier, trophyStats, unlockedOf } from './trophyList';
import { tn, tr } from '../../shared/i18n';

export * from './trophyList';

/**
 * Surveille l'état : un trophée nouvellement gagné est daté et fêté. Au tout premier passage (trophées déjà
 * mérités avant cette version), tout est daté d'aujourd'hui sans fête.
 */
export function startTrophies() {
  let timer = 0;
  const check = () => {
    const s = getState();
    if (!s.settings.onboarded) return;
    const got = s.ui.trophies;
    const won = unlockedOf(trophyStats(s)).filter((x) => !got?.[x.id]);
    if (!won.length && got) return;
    const today = dayKey();
    setState((d) => {
      d.ui.trophies ??= {};
      for (const x of won) d.ui.trophies[x.id] = today;
    });
    if (!got) return;
    const top = [...won].sort((a, b) => order(b.tier) - order(a.tier))[0];
    if (top)
      setTimeout(
        () => moment('trophy', tr('Trophée : {title}', { title: top.title }), won.length > 1 ? tn(won.length - 1, '{text} Et {n} autre.', '{text} Et {n} autres.', { text: top.text }) : top.text),
        2600,
      );
  };
  check();
  // Calcul groupé : une rafale de séries cochées ne relance qu'un seul calcul.
  subscribe(() => {
    clearTimeout(timer);
    timer = window.setTimeout(check, 900);
  });
}

const order = (t: Tier) => ['bronze', 'silver', 'gold', 'legend'].indexOf(t);
