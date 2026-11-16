// Les sorties enregistrées ailleurs (Strava, Apple Watch via Apple Santé) arrivent ici : rangées au bon jour,
// sans doublon, et elles valident la séance prévue quand c'est le même sport.
import type { Discipline } from '../../shared/types';
import { sessionFor } from './logic';
import { type Activity, type AppState, ensureDay, setState } from './store';

const ENDURANCE: Discipline[] = ['run', 'bike', 'swim', 'row', 'walk'];

export interface ImportResult {
  added: number;
  /** Séances validées par une sortie importée. */
  validated: { date: string; name: string }[];
}

/** Même sortie vue par deux sources (Strava et la montre) : même sport, départ à moins de 10 minutes. */
function duplicate(list: Activity[], a: Activity): boolean {
  return list.some((x) => x.id === a.id || (x.sport === a.sport && x.source !== a.source && Math.abs(Date.parse(x.start) - Date.parse(a.start)) < 10 * 60_000));
}

/**
 * Coche la séance du jour si la sortie correspond : mêmes sports, ou une séance cardio générique.
 * `linked` : les blocs que la sortie représente (pour ne pas les compter deux fois dans les stats) ;
 * `ticked` : ceux qu'elle vient de cocher (la séance n'était pas encore faite).
 */
function link(d: AppState, date: string, a: Activity): { linked: string[]; ticked: string[] } {
  const none = { linked: [], ticked: [] };
  const session = sessionFor(d, date);
  if (session.type !== 'cardio' || a.sport === 'lift' || a.sport === 'other') return none;
  const day = ensureDay(d, date);
  const same = session.exercises.filter((x) => x.discipline === a.sport);
  // « Cardio zone 2 », « Course à pied » sans sport précis : une sortie d'endurance les remplit.
  const generic = ENDURANCE.includes(a.sport as Discipline) ? session.exercises.filter((x) => !x.discipline && (x.kind === 'cardio' || x.key === 'zone2')) : [];
  const targets = same.length ? same : generic.slice(0, 1);
  // Un bloc déjà représenté par une autre sortie importée n'est pas repris.
  const taken = new Set((day.activities ?? []).flatMap((x) => x.linked ?? []));
  const free = targets.filter((ex) => !taken.has(ex.key));
  const keys: string[] = [];
  for (const ex of free) {
    const logs = (day.sets[ex.key] ??= []);
    if (logs.filter((l) => l.done).length >= ex.sets) continue;
    while (logs.length < ex.sets) logs.push({ done: false });
    for (const l of logs) l.done = true;
    keys.push(ex.key);
  }
  if (keys.length) {
    const rest = session.exercises.filter((x) => x.kind !== 'task' || x.key === 'zone2');
    const all = rest.every((x) => (day.sets[x.key]?.filter((l) => l.done).length ?? 0) >= x.sets);
    if (all && !day.mainDone) {
      day.mainDone = true;
      day.mainDoneAt = Date.now();
    }
  }
  return { linked: free.map((x) => x.key), ticked: keys };
}

export function importActivities(list: Activity[]): ImportResult {
  const result: ImportResult = { added: 0, validated: [] };
  if (!list.length) return result;
  setState((d) => {
    for (const raw of [...list].sort((x, y) => x.start.localeCompare(y.start))) {
      const date = raw.start.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const day = ensureDay(d, date);
      day.activities ??= [];
      if (duplicate(day.activities, raw)) continue;
      const a: Activity = structuredClone(raw);
      const { linked, ticked } = link(d, date, a);
      if (linked.length) a.linked = linked;
      if (ticked.length) result.validated.push({ date, name: sessionFor(d, date).name });
      day.activities.push(a);
      result.added++;
    }
  });
  return result;
}
