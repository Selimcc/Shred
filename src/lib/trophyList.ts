// Trophées : des paliers calculés à partir de ce que tu as déjà fait (séances, tonnage, série, records,
// repas, cardio, corps). Comme les badges d'Apple Fitness ou les trophées de Strava : rien à déclarer, ils se
// débloquent seuls. La date de déblocage reste dans l'état (ui.trophies) pour l'afficher.
// La liste et le calcul, sans l'état de l'app (le serveur s'en sert) ; la surveillance est dans trophies.ts.
import { dayKey, parseKey, weekdayOf } from './date';
import { dayValidated, mealsCount } from './logic';
import type { AppState } from './state';
import { e1rm } from './strength';
import { tr } from '../../shared/i18n';

export type Tier = 'bronze' | 'silver' | 'gold' | 'legend';

export interface Trophy {
  id: string;
  title: string;
  text: string;
  icon: string;
  tier: Tier;
  family: string;
  /** Valeur actuelle et cible, pour la jauge des trophées pas encore gagnés. */
  value: (st: Stats) => number;
  goal: number;
}

export interface Stats {
  sessions: number;
  tonnage: number;
  bestStreak: number;
  records: number;
  meals: number;
  validated: number;
  cardioKm: number;
  weighIns: number;
  photos: number;
  steps10k: number;
  early: number;
  late: number;
  weekends: number;
}

/** Tout se calcule en un passage sur les journées. */
export function trophyStats(s: AppState): Stats {
  const st: Stats = {
    sessions: 0,
    tonnage: 0,
    bestStreak: s.streak.best,
    records: 0,
    meals: 0,
    validated: 0,
    cardioKm: 0,
    weighIns: 0,
    photos: 0,
    steps10k: 0,
    early: 0,
    late: 0,
    weekends: 0,
  };
  const best = new Map<string, number>();
  const done = new Set<string>();
  const today = dayKey();
  for (const date of Object.keys(s.days).sort()) {
    const day = s.days[date];
    if (day.mainDone) {
      st.sessions++;
      done.add(date);
      if (day.mainDoneAt) {
        const h = new Date(day.mainDoneAt).getHours();
        if (h < 8) st.early++;
        if (h >= 22) st.late++;
      }
    }
    for (const [key, logs] of Object.entries(day.sets)) {
      let dayBest = 0;
      for (const l of logs) {
        if (!l.done) continue;
        if (l.w && l.r) {
          st.tonnage += l.w * l.r;
          dayBest = Math.max(dayBest, e1rm(l.w, l.r));
        }
        if (l.km) st.cardioKm += l.km;
      }
      if (dayBest > 0) {
        const prev = best.get(key);
        if (prev !== undefined && dayBest > prev) st.records++;
        if (prev === undefined || dayBest > prev) best.set(key, dayBest);
      }
    }
    for (const a of day.activities ?? []) if (a.km) st.cardioKm += a.km;
    st.meals += mealsCount(day);
    if (date <= today && dayValidated(s, date)) st.validated++;
  }
  // Week-end complet : samedi et dimanche du même week-end.
  for (const d of done)
    if (weekdayOf(d) === 6) {
      const sun = new Date(parseKey(d));
      sun.setDate(sun.getDate() + 1);
      if (done.has(dayKey(sun))) st.weekends++;
    }
  st.weighIns = Object.keys(s.body.weight).length;
  st.photos = s.body.photos?.length ?? 0;
  st.steps10k = Object.values(s.health).filter((h) => (h.steps ?? 0) >= 10_000).length;
  st.tonnage = Math.round(st.tonnage);
  st.cardioKm = Math.round(st.cardioKm);
  return st;
}

const t = (id: string, family: string, tier: Tier, icon: string, title: string, text: string, value: (st: Stats) => number, goal: number): Trophy => ({
  id,
  family,
  tier,
  icon,
  title,
  text,
  value,
  goal,
});

export const TROPHIES: Trophy[] = [
  t('s1', tr('Séances'), 'bronze', 'dumbbell', tr('Premier pas'), tr('Ta première séance validée.'), (x) => x.sessions, 1),
  t('s10', tr('Séances'), 'bronze', 'dumbbell', tr('Régulier'), tr('10 séances validées.'), (x) => x.sessions, 10),
  t('s50', tr('Séances'), 'silver', 'dumbbell', tr('Habitué'), tr('50 séances validées.'), (x) => x.sessions, 50),
  t('s100', tr('Séances'), 'gold', 'dumbbell', tr('Centurion'), tr('100 séances validées.'), (x) => x.sessions, 100),
  t('s250', tr('Séances'), 'legend', 'dumbbell', tr('Machine'), tr('250 séances validées.'), (x) => x.sessions, 250),
  t('t10', tr('Tonnage'), 'bronze', 'bolt', tr('10 tonnes'), tr('10 000 kg soulevés au total.'), (x) => x.tonnage, 10_000),
  t('t100', tr('Tonnage'), 'silver', 'bolt', tr('100 tonnes'), tr('Le poids d’une baleine bleue.'), (x) => x.tonnage, 100_000),
  t('t500', tr('Tonnage'), 'gold', 'bolt', tr('500 tonnes'), tr('Un Airbus A380 chargé, à la main.'), (x) => x.tonnage, 500_000),
  t('t1000', tr('Tonnage'), 'legend', 'bolt', tr('Mille tonnes'), tr('1 000 000 kg soulevés.'), (x) => x.tonnage, 1_000_000),
  t('r1', tr('Records'), 'bronze', 'trophy', tr('Premier record'), tr('Une série qui bat ton meilleur 1RM estimé.'), (x) => x.records, 1),
  t('r25', tr('Records'), 'silver', 'trophy', tr('Collectionneur'), tr('25 records battus.'), (x) => x.records, 25),
  t('r100', tr('Records'), 'gold', 'trophy', tr('Briseur de plafonds'), tr('100 records battus.'), (x) => x.records, 100),
  t('f7', tr('Série'), 'bronze', 'flame', tr('Une semaine pleine'), tr('7 jours de série.'), (x) => x.bestStreak, 7),
  t('f30', tr('Série'), 'silver', 'flame', tr('Un mois sans lâcher'), tr('30 jours de série.'), (x) => x.bestStreak, 30),
  t('f100', tr('Série'), 'gold', 'flame', tr('Cent jours'), tr('100 jours de série.'), (x) => x.bestStreak, 100),
  t('f365', tr('Série'), 'legend', 'flame', tr('Une année entière'), tr('365 jours de série.'), (x) => x.bestStreak, 365),
  t('v30', tr('Journées'), 'silver', 'check', tr('Discipline'), tr('30 journées validées (séance et repas).'), (x) => x.validated, 30),
  t('m50', tr('Nutrition'), 'bronze', 'utensils', tr('Carnet ouvert'), tr('50 repas notés.'), (x) => x.meals, 50),
  t('m300', tr('Nutrition'), 'silver', 'utensils', tr('Rien ne m’échappe'), tr('300 repas notés.'), (x) => x.meals, 300),
  t('c50', tr('Cardio'), 'bronze', 'run', tr('50 km'), tr('50 km en course, vélo, nage ou marche notée.'), (x) => x.cardioKm, 50),
  t('c500', tr('Cardio'), 'gold', 'run', tr('500 km'), tr('Paris, Lyon et un peu plus.'), (x) => x.cardioKm, 500),
  t('p10', tr('Pas'), 'bronze', 'steps', tr('10 000 pas × 10'), tr('10 journées au-dessus de 10 000 pas.'), (x) => x.steps10k, 10),
  t('b10', tr('Corps'), 'bronze', 'scale', tr('Sur la balance'), tr('10 pesées notées.'), (x) => x.weighIns, 10),
  t('b1', tr('Corps'), 'bronze', 'camera', tr('Avant, après'), tr('Ta première photo de physique.'), (x) => x.photos, 1),
  t('e1', tr('Moments'), 'silver', 'sun', tr('Lève-tôt'), tr('Une séance validée avant 8 h.'), (x) => x.early, 1),
  t('l1', tr('Moments'), 'silver', 'moon', tr('Oiseau de nuit'), tr('Une séance validée après 22 h.'), (x) => x.late, 1),
  t('w4', tr('Moments'), 'gold', 'spark', tr('Week-end warrior'), tr('Samedi et dimanche, quatre week-ends.'), (x) => x.weekends, 4),
];

export const TIER_LABEL: Record<Tier, string> = { bronze: tr('Bronze'), silver: tr('Argent'), gold: tr('Or'), legend: tr('Légende') };

export const unlockedOf = (st: Stats) => TROPHIES.filter((x) => x.value(st) >= x.goal);
