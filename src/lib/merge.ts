// Fusion de deux versions des données (ce téléphone et le compte) sans rien perdre.
// Les journées se fusionnent une par une : séries, repas, habitudes, santé, pesées.
// Les réglages et le programme viennent de la version modifiée le plus récemment.
import type { AppState, DayLog, HealthDay, SetLog } from './store';

const doneOf = (logs?: SetLog[]) => logs?.filter((l) => l.done).length ?? 0;

function dayScore(d: DayLog): number {
  return Object.values(d.sets).reduce((n, l) => n + doneOf(l), 0) + d.meals.length * 3 + Object.values(d.habits).filter(Boolean).length + (d.mainDone ? 5 : 0);
}

/** Une journée présente des deux côtés : on garde tout ce qui a été noté de part et d'autre. */
export function mergeDay(a: DayLog, b: DayLog): DayLog {
  // La journée la plus remplie sert de base (séance choisie, remplacements, forme…).
  const [base, other] = dayScore(a) >= dayScore(b) ? [a, b] : [b, a];
  const out: DayLog = structuredClone(base);
  for (const [key, logs] of Object.entries(other.sets)) {
    const mine = out.sets[key];
    if (!mine || doneOf(logs) > doneOf(mine) || (doneOf(logs) === doneOf(mine) && logs.length > mine.length)) out.sets[key] = structuredClone(logs);
  }
  const ids = new Set(out.meals.map((m) => m.id));
  for (const m of other.meals) if (!ids.has(m.id)) out.meals.push(structuredClone(m));
  out.meals.sort((x, y) => x.at - y.at);
  for (const [id, on] of Object.entries(other.habits)) if (on) out.habits[id] = true;
  out.mainDone = a.mainDone || b.mainDone;
  if (a.water || b.water) out.water = Math.max(a.water ?? 0, b.water ?? 0);
  if (other.swaps) out.swaps = { ...other.swaps, ...out.swaps };
  if (other.extra) for (const x of other.extra) if (!out.extra?.some((y) => y.key === x.key)) (out.extra ??= []).push(x);
  if (other.skipped) out.skipped = [...new Set([...(out.skipped ?? []), ...other.skipped])];
  // Fait d'un côté l'emporte sur passé de l'autre.
  if (a.warmup === 'done' || b.warmup === 'done') out.warmup = 'done';
  else if (a.warmup || b.warmup) out.warmup = 'skipped';
  if (other.activities?.length) {
    const ids = new Set((out.activities ?? []).map((x) => x.id));
    for (const x of other.activities) if (!ids.has(x.id)) (out.activities ??= []).push(structuredClone(x));
  }
  return out;
}

function mergeHealth(a: HealthDay, b: HealthDay): HealthDay {
  const newer = (a.at ?? '') >= (b.at ?? '') ? a : b;
  const older = newer === a ? b : a;
  return { ...older, ...newer, gymIn: a.gymIn ?? b.gymIn, gymOut: newer.gymOut ?? older.gymOut };
}

function unionBy<T>(a: T[], b: T[], key: (x: T) => string): T[] {
  const seen = new Set(a.map(key));
  return [...a, ...b.filter((x) => !seen.has(key(x)))];
}

/**
 * Fusionne ce téléphone (`local`) et le compte (`remote`).
 * `localNewer` : le téléphone a été modifié après la dernière sauvegarde du compte.
 */
export function mergeStates(local: AppState, remote: AppState, localNewer: boolean): AppState {
  const recent = localNewer ? local : remote;
  const out: AppState = structuredClone(recent);
  const other = localNewer ? remote : local;

  out.createdAt = local.createdAt < remote.createdAt ? local.createdAt : remote.createdAt;

  out.days = {};
  for (const date of new Set([...Object.keys(local.days), ...Object.keys(remote.days)])) {
    const a = local.days[date];
    const b = remote.days[date];
    out.days[date] = structuredClone(a && b ? mergeDay(a, b) : (a ?? b));
  }

  out.body = {
    weight: { ...other.body.weight, ...recent.body.weight },
    waist: { ...other.body.waist, ...recent.body.waist },
  };
  if (local.body.photos || remote.body.photos) out.body.photos = unionBy(recent.body.photos ?? [], other.body.photos ?? [], (p) => p.id).sort((x, y) => x.date.localeCompare(y.date));

  out.health = {};
  for (const date of new Set([...Object.keys(local.health), ...Object.keys(remote.health)])) {
    const a = local.health[date];
    const b = remote.health[date];
    out.health[date] = a && b ? mergeHealth(a, b) : structuredClone((a ?? b)!);
  }

  // La série : celle qui est à jour le plus loin, à égalité la plus longue.
  const sa = local.streak;
  const sb = remote.streak;
  out.streak = structuredClone(sa.through > sb.through || (sa.through === sb.through && sa.banked >= sb.banked) ? sa : sb);
  out.streak.best = Math.max(sa.best, sb.best, out.streak.best);
  out.streak.frozen = [...new Set([...sa.frozen, ...sb.frozen])].sort().slice(-60);

  out.coach = local.coach.length >= remote.coach.length ? structuredClone(local.coach) : structuredClone(remote.coach);
  out.customExercises = { ...other.customExercises, ...recent.customExercises };
  out.habits = unionBy(recent.habits, other.habits, (h) => h.id);
  out.mealPlan = unionBy(recent.mealPlan, other.mealPlan, (m) => m.id);
  out.programHistory = unionBy(recent.programHistory ?? [], other.programHistory ?? [], (p) => `${p.replacedAt}:${p.program.name}`).slice(0, 5);
  // Trophées : l'union des deux, avec la date la plus ancienne.
  if (local.ui.trophies || remote.ui.trophies) {
    const all = { ...remote.ui.trophies, ...local.ui.trophies };
    for (const [id, d] of Object.entries(remote.ui.trophies ?? {})) if (d < all[id]) all[id] = d;
    out.ui.trophies = all;
  }
  // Les notifications et le matériel de l'appareil restent ceux du téléphone.
  out.settings.pushEnabled = local.settings.pushEnabled;
  return out;
}

/** Les deux versions sont-elles différentes sur le fond (pas seulement l'ordre des clés) ? */
export function sameData(a: AppState, b: AppState): boolean {
  return JSON.stringify(a.days) === JSON.stringify(b.days) && JSON.stringify(a.body) === JSON.stringify(b.body);
}
