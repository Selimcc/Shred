// Forme du jour et récupération musculaire : ce que Whoop ou Fitbod vendent sur abonnement, calculé sur le
// téléphone à partir de ce que Shred a déjà (Apple Santé et les séries notées). Rien ne part au serveur.
//
// Score de forme (0 à 100) : quatre signaux, chacun ramené sur 100, pondérés, renormalisés sur ceux qui existent.
//   VFC du matin contre ta moyenne des 14 jours d'avant (35 %), sommeil de la nuit (25 %),
//   cœur au repos contre ta moyenne (20 %), charge des 3 derniers jours contre ton rythme des 4 semaines (20 %).
// Récupération musculaire : chaque série faite fatigue ses muscles (principal 1, secondaires 0,5), et cette
// fatigue s'efface avec le temps (demi-vie d'environ 24 h). 8 séries « fraîches » = muscle à plat.
import { catalogEntry } from '../../shared/catalog';
import { addDays, diffDays } from './date';
import type { AppState } from './state';
import { tr } from '../../shared/i18n';

export type Tone = 'go' | 'ok' | 'low';

export interface ReadinessPart {
  id: 'hrv' | 'sleep' | 'rhr' | 'load';
  label: string;
  score: number;
  detail: string;
}

export interface Readiness {
  score: number;
  tone: Tone;
  title: string;
  advice: string;
  parts: ReadinessPart[];
  /** Pas de données Santé ce matin : le score ne repose que sur la charge d'entraînement. */
  partial: boolean;
}

const clamp = (v: number, lo = 5, hi = 100) => Math.max(lo, Math.min(hi, v));
const WEIGHTS: Record<ReadinessPart['id'], number> = { hrv: 0.35, sleep: 0.25, rhr: 0.2, load: 0.2 };

function baseline(s: AppState, today: string, key: 'hrv' | 'restingHr'): number | null {
  const v = Array.from({ length: 14 }, (_, i) => s.health[addDays(today, -i - 1)]?.[key]).filter((x): x is number => typeof x === 'number' && x > 0);
  return v.length >= 4 ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Séries faites un jour donné (muscu et blocs de cardio confondus). */
function setsOn(s: AppState, date: string): number {
  const day = s.days[date];
  if (!day) return 0;
  return Object.values(day.sets).reduce((n, logs) => n + logs.filter((l) => l.done).length, 0);
}

const fmtH = (min: number) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')}`;

export function readiness(s: AppState, today: string): Readiness | null {
  const h = s.health[today];
  const parts: ReadinessPart[] = [];

  const hrv0 = baseline(s, today, 'hrv');
  if (h?.hrv && hrv0) {
    const r = h.hrv / hrv0;
    parts.push({
      id: 'hrv',
      label: 'VFC',
      score: Math.round(clamp(75 + (r - 1) * 250)),
      detail: tr('{n} ms, {v}{n2} % sur ta moyenne', { n: Math.round(h.hrv), v: r >= 1 ? '+' : '', n2: Math.round((r - 1) * 100) }),
    });
  }
  if (h?.sleepMin !== undefined && h.sleepMin > 0) {
    parts.push({ id: 'sleep', label: tr('Sommeil'), score: Math.round(clamp((h.sleepMin / 60 - 4) * 25)), detail: fmtH(h.sleepMin) });
  }
  const hr0 = baseline(s, today, 'restingHr');
  if (h?.restingHr && hr0) {
    const d = h.restingHr - hr0;
    parts.push({
      id: 'rhr',
      label: tr('Cœur au repos'),
      score: Math.round(clamp(75 - d * 7)),
      detail: tr('{n} bpm, {v}{n2} sur ta moyenne', { n: Math.round(h.restingHr), v: d >= 0 ? '+' : '', n2: Math.round(d) }),
    });
  }

  // Charge : séries des 3 derniers jours (hier compris, pas aujourd'hui) contre la moyenne sur 3 jours des 4 semaines
  // d'avant, ou depuis ta première séance si tu as commencé il y a moins longtemps (7 jours au minimum).
  const acute = [1, 2, 3].reduce((n, i) => n + setsOn(s, addDays(today, -i)), 0);
  const first = Object.keys(s.days)
    .filter((d) => d < today && setsOn(s, d) > 0)
    .sort()[0];
  const span = first ? Math.max(7, Math.min(28, diffDays(today, first))) : 28;
  const chronic = (Array.from({ length: span }, (_, i) => setsOn(s, addDays(today, -i - 1))).reduce((a, b) => a + b, 0) / span) * 3;
  if (chronic >= 3 || acute > 0) {
    const ratio = chronic >= 3 ? acute / chronic : acute > 30 ? 1.6 : 1;
    const score = ratio <= 1 ? 85 + (1 - ratio) * 10 : clamp(85 - (ratio - 1) * 70);
    parts.push({
      id: 'load',
      label: tr('Charge'),
      score: Math.round(clamp(score)),
      detail:
        acute === 0
          ? tr('repos ces 3 derniers jours')
          : tr('{acute} séries en 3 jours{v}', { acute, v: chronic >= 3 ? (ratio > 1.15 ? tr(', au-dessus de ton rythme') : ratio < 0.7 ? tr(', sous ton rythme') : tr(', dans ton rythme')) : '' }),
    });
  }
  if (!parts.length) return null;

  const w = parts.reduce((n, p) => n + WEIGHTS[p.id], 0);
  const score = Math.round(parts.reduce((n, p) => n + p.score * WEIGHTS[p.id], 0) / w);
  const tone: Tone = score >= 75 ? 'go' : score >= 55 ? 'ok' : 'low';
  const partial = !parts.some((p) => p.id !== 'load');
  const weakest = [...parts].sort((a, b) => a.score - b.score)[0];
  return {
    score,
    tone,
    partial,
    parts,
    title: tone === 'go' ? tr('Prêt à pousser') : tone === 'ok' ? tr('Séance normale') : tr('Récupère'),
    advice:
      tone === 'go'
        ? tr('Bon jour pour viser une rep ou 2,5 kg de plus sur ton premier exercice.')
        : tone === 'ok'
          ? tr('Fais ta séance comme prévue, sans chercher le record.{v}', { v: weakest.score < 55 ? tr(' {label} un peu bas.', { label: weakest.label }) : '' })
          : tr('{label} en retrait : garde tes charges, fais une série de moins par exercice, ou passe en mode Fatigué.', { label: weakest.label }),
  };
}

/* ---------- Récupération musculaire ---------- */

export type Region =
  | 'chest'
  | 'delts'
  | 'biceps'
  | 'forearms'
  | 'abs'
  | 'obliques'
  | 'quads'
  | 'calves'
  | 'traps'
  | 'reardelts'
  | 'lats'
  | 'lowerback'
  | 'triceps'
  | 'glutes'
  | 'hamstrings'
  | 'neck';

export const REGION_NAMES: Record<Region, string> = {
  chest: tr('Pectoraux'),
  delts: tr('Épaules'),
  biceps: tr('Biceps'),
  forearms: 'Avant-bras',
  abs: tr('Abdos'),
  obliques: tr('Obliques'),
  quads: tr('Quadriceps'),
  calves: tr('Mollets'),
  traps: tr('Trapèzes'),
  reardelts: tr('Arrière d’épaules'),
  lats: tr('Dos'),
  lowerback: tr('Bas du dos'),
  triceps: tr('Triceps'),
  glutes: tr('Fessiers'),
  hamstrings: tr('Ischios'),
  neck: tr('Cou'),
};

/** Les noms de muscles du catalogue, ramenés aux zones de la silhouette. */
const MUSCLE_REGIONS: [RegExp, Region[]][] = [
  [/haut des pecs|^pecs|pector/i, ['chest']],
  [/arrière d.épaules|coiffe/i, ['reardelts']],
  [/épaules/i, ['delts']],
  [/biceps/i, ['biceps']],
  [/triceps/i, ['triceps']],
  [/grip|avant-bras/i, ['forearms']],
  [/obliques|rotation/i, ['obliques']],
  [/abdos|gainage|sangle abdominale/i, ['abs']],
  [/quadriceps|adducteurs/i, ['quads']],
  [/^jambes$/i, ['quads', 'glutes']],
  [/mollets/i, ['calves']],
  [/trapèzes|haut du dos/i, ['traps']],
  [/bas du dos/i, ['lowerback']],
  [/grand dorsal|^dos\b/i, ['lats']],
  [/fessiers/i, ['glutes']],
  [/ischios/i, ['hamstrings']],
  [/^cou\b/i, ['neck']],
];

export function regionsOf(muscles: string[] | undefined): { region: Region; weight: number }[] {
  const out = new Map<Region, number>();
  // L'état vient aussi de la synchro : on ne suppose rien de sa forme.
  (Array.isArray(muscles) ? muscles : []).forEach((m, i) => {
    if (typeof m !== 'string') return;
    const hit = MUSCLE_REGIONS.find(([re]) => re.test(m.trim()));
    if (!hit) return;
    for (const r of hit[1]) out.set(r, Math.max(out.get(r) ?? 0, i === 0 ? 1 : 0.5));
  });
  return [...out].map(([region, weight]) => ({ region, weight }));
}

export interface MuscleState {
  region: Region;
  /** 0 = frais, 1 = à plat. */
  fatigue: number;
  /** Récupération en % (100 - fatigue). */
  recovery: number;
  /** Heures depuis la dernière série qui l'a travaillé (null : rien depuis 7 jours). */
  hours: number | null;
}

const HALF_LIFE_H = 24;
const FULL = 8;

export function muscleRecovery(s: AppState, today: string, now = Date.now()): MuscleState[] {
  const load = new Map<Region, number>();
  const last = new Map<Region, number>();
  for (let i = 0; i < 7; i++) {
    const date = addDays(today, -i);
    const day = s.days[date];
    if (!day) continue;
    // Heure de la séance : sa validation si on l'a, sinon 18 h ce jour-là.
    const at = day.mainDoneAt ?? new Date(`${date}T18:00:00`).getTime();
    const hours = Math.max(0, (now - at) / 3_600_000);
    const decay = Math.pow(0.5, hours / HALF_LIFE_H);
    for (const [key, logs] of Object.entries(day.sets)) {
      const done = logs.filter((l) => l.done).length;
      if (!done) continue;
      const entry = catalogEntry(key, s.customExercises);
      if (!entry || entry.kind === 'cardio' || entry.kind === 'task') continue;
      for (const { region, weight } of regionsOf(entry.muscles)) {
        load.set(region, (load.get(region) ?? 0) + done * weight * decay);
        last.set(region, Math.min(last.get(region) ?? Infinity, hours));
      }
    }
  }
  return (Object.keys(REGION_NAMES) as Region[]).map((region) => {
    const fatigue = Math.min(1, (load.get(region) ?? 0) / FULL);
    return { region, fatigue, recovery: Math.round((1 - fatigue) * 100), hours: last.has(region) ? Math.round(last.get(region)!) : null };
  });
}
