// Les disques : la monnaie des défis. On en gagne en tenant sa série (un par journée validée, un bonus à chaque
// palier), on les mise pour défier quelqu'un. S'il relève le défi, il empoche la mise ; s'il le rate, elle revient
// à son auteur, et lui porte le bonnet de Nulos pendant 24 h (et fait son gage s'il y en avait un).
// Calculs purs : le serveur tient les comptes, l'app et la démo s'en servent pour afficher les règles.

/** Solde de départ, plafond, prix d'un défi et supplément pour un gage. */
export const PLATES = { start: 5, cap: 30, challenge: 1, gage: 2 } as const;
/** Durée du bonnet de Nulos après un défi raté. */
export const NULOS_HOURS = 24;
/** Défis lancés en même temps, en tout (et un seul à la fois par personne). */
export const OPEN_MAX = 3;
/** Une séance validée hors ligne compte encore si le téléphone se synchronise dans la demi-heure. */
export const GRACE_MS = 30 * 60_000;
export const GAGE_MAX = 80;

export interface Wallet {
  /** Disques disponibles. */
  bal: number;
  /** Dernière journée validée comptée, et la série ce jour-là. */
  day?: string;
  streak?: number;
}

/** Paliers de série : jours atteints → disques en bonus. Puis 15 tous les 100 jours après un an. */
const LADDER: [number, number][] = [
  [7, 3],
  [14, 3],
  [21, 3],
  [30, 5],
  [45, 5],
  [60, 5],
  [90, 8],
  [120, 8],
  [180, 10],
  [270, 10],
  [365, 15],
];

/** Le bonus pour une série qui atteint exactement `days` jours. */
export function streakBonus(days: number): number {
  const hit = LADDER.find(([d]) => d === days);
  if (hit) return hit[1];
  return days > 365 && (days - 365) % 100 === 0 ? 15 : 0;
}

/** Le prochain palier qui rapporte, après une série de `streak` jours. */
export function nextBonus(streak: number): { days: number; plates: number } {
  for (let d = streak + 1; d < streak + 400; d++) {
    const p = streakBonus(d);
    if (p) return { days: d, plates: p };
  }
  return { days: streak + 100, plates: 15 };
}

/** Ce que coûte un défi : la mise, gage compris. Une revanche est gratuite. */
export const stakeOf = (gage: boolean, rematch = false) => (rematch ? 0 : PLATES.challenge + (gage ? PLATES.gage : 0));

const dayMs = (d: string) => Date.parse(`${d}T12:00:00Z`);
const between = (a: string, b: string) => Math.round((dayMs(b) - dayMs(a)) / 86_400_000);

/**
 * Une journée validée de plus : +1 disque, plus le bonus des paliers franchis. Le serveur ne compte qu'une fois par
 * jour, et les paliers seulement si la série avance au même rythme que le calendrier (impossible de sauter de 3 à
 * 30 jours d'un coup). Au-delà du plafond, rien ne s'ajoute : il est temps de lancer des défis.
 */
export function claimPlates(w: Wallet | undefined, day: string, streak: number): { wallet: Wallet; gained: number; bonus: number } {
  const cur: Wallet = w ? { ...w } : { bal: PLATES.start };
  if (!(streak >= 1) || (cur.day && day <= cur.day)) return { wallet: cur, gained: 0, bonus: 0 };
  const prev = cur.streak ?? 0;
  const days = cur.day ? between(cur.day, day) : 1;
  const steady = cur.day !== undefined && streak > prev && streak - prev <= days;
  const daily = steady ? Math.min(3, streak - prev) : 1;
  let bonus = 0;
  if (steady) for (let n = prev + 1; n <= streak; n++) bonus += streakBonus(n);
  const before = cur.bal;
  cur.bal = Math.min(PLATES.cap, cur.bal + daily + bonus);
  cur.day = day;
  cur.streak = streak;
  const gained = Math.max(0, cur.bal - before);
  return { wallet: cur, gained, bonus: Math.max(0, gained - daily) };
}

/** Ajoute (ou retire) des disques sans dépasser le plafond ni passer sous zéro. */
export function addPlates(w: Wallet | undefined, n: number): Wallet {
  const cur: Wallet = w ? { ...w } : { bal: PLATES.start };
  cur.bal = Math.max(0, Math.min(PLATES.cap, cur.bal + n));
  return cur;
}
