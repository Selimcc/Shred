// Ce que Claude lit de Shred à travers le connecteur. La sauvegarde de la personne est déchiffrée le temps d'une
// requête, avec la clé confiée au moment où elle a autorisé Claude (rangée chiffrée par le jeton d'accès : sans
// le jeton, le serveur ne peut pas la lire). Les réponses sont calculées avec le code de l'app : même séance du
// jour, mêmes charges conseillées, même récap, même recherche dans l'historique (RAG local, BM25).
import { CATALOG, catalogEntry, GROUP_NAMES } from '../shared/catalog';
import { adviseLoad } from '../src/lib/advisor';
import { type Sealed, unseal } from '../src/lib/crypto';
import { addDays, diffDays, formatLong, formatShort, mondayOf } from '../src/lib/date';
import { flameInfo } from '../src/lib/flames';
import { bodyDoc, dayDoc, type KnowledgeDoc, localRetriever, normalize, profileDoc, programText } from '../src/lib/knowledge';
import { fmtKg, reconcileStreak, sessionFor, setProgress, totals, weeklyChange } from '../src/lib/logic';
import { fmtDuration, fmtTonnes, monthRecap, PROFILE_COLOR } from '../src/lib/monthRecap';
import { type AppState, migrate } from '../src/lib/state';
import { e1rm, profileSummary } from '../src/lib/strength';
import { TROPHIES } from '../src/lib/trophyList';
import { type Env, localTime } from './env';
import { DEFAULT_CFG, type UserCfg } from './reminders';
import { getAccount, loadJson, userStore } from './users';

/** Ce que l'autorisation range avec le jeton : qui, la clé de sa sauvegarde, et l'époque de son mot de passe. */
export interface ConnectorProps {
  uid: string;
  key: string;
  epoch: number;
}

/** La personne doit reconnecter Claude : mot de passe changé, compte supprimé, sauvegarde illisible. */
export class Reconnect extends Error {}

export interface UserData {
  s: AppState;
  today: string;
  tz: string;
  /** Heure de la dernière sauvegarde du téléphone (ms). */
  savedAt: number;
}

export async function loadUserData(env: Env, props: ConnectorProps): Promise<UserData> {
  const acct = await getAccount(env, props.uid);
  if (!acct || acct.epoch !== props.epoch) throw new Reconnect('Le compte a changé de mot de passe ou n’existe plus');
  const [raw, cfg] = await Promise.all([env.KV.get(`u:${props.uid}:backup`), loadJson<UserCfg>(userStore(env.KV, props.uid), 'cfg')]);
  if (!raw) throw new Reconnect('Aucune sauvegarde sur le compte');
  const box = JSON.parse(raw) as Sealed & { savedAt: number };
  let text: string;
  try {
    text = await unseal(props.key, { iv: box.iv, data: box.data, gz: Boolean(box.gz) });
  } catch {
    throw new Reconnect('Sauvegarde chiffrée avec une autre clé');
  }
  const tz = cfg?.timezone || DEFAULT_CFG.timezone;
  const today = localTime(new Date(), tz).date;
  const s = migrate(JSON.parse(text));
  // Comme l'app au changement de jour : la série est mise à jour jusqu'à hier (sur cette copie seulement).
  reconcileStreak(s, today);
  return { s, today, tz, savedAt: box.savedAt };
}

/* ---------- Petits formats ---------- */

const shortMonth = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });
const nf = (n: number, d = 0) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
/** Avec son signe, et le vrai signe moins. */
const signed = (n: number, d = 0) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${nf(Math.abs(n), d)}`;

function syncedLine(d: UserData): string {
  const at = new Intl.DateTimeFormat('fr-FR', { timeZone: d.tz, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(
    new Date(d.savedAt),
  );
  return `Données synchronisées depuis le téléphone le ${at}.`;
}

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** Une erreur d'argument, rendue à Claude comme résultat d'outil en erreur. */
export class BadInput extends Error {}

export interface ToolOutput {
  text: string;
  /** Les données de la carte affichée dans Claude (MCP Apps). */
  card?: Record<string, unknown>;
}

/* ---------- Séance du jour ---------- */

export function today(d: UserData, args: { date?: unknown }, appUrl: string): ToolOutput {
  const date = args.date === undefined ? d.today : args.date;
  if (!isDate(date)) throw new BadInput('date doit être au format AAAA-MM-JJ');
  const { s } = d;
  const session = sessionFor(s, date);
  const day = s.days[date] ?? { sets: {}, mainDone: false, meals: [], habits: {} };
  const progress = setProgress(session, day);
  const skipped = new Set(day.skipped ?? []);
  const exercises = session.exercises.map((ex) => {
    const done = (day.sets[ex.key] ?? []).filter((l) => l.done);
    const advice = adviseLoad(s, ex, date);
    const cardio = ex.kind === 'cardio' || ex.discipline !== undefined;
    return {
      name: ex.name,
      sets: ex.sets,
      plan: cardio && ex.target ? `${ex.sets > 1 ? `${ex.sets} × ` : ''}${ex.reps}, ${ex.target}` : `${ex.sets} × ${ex.reps}`,
      load: advice ? fmtKg(advice.weight) : null,
      trend: advice?.trend ?? null,
      done: done.map((l) => (l.km ? `${nf(l.km, 1)} km` : l.w !== undefined ? `${nf(l.w, l.w % 1 ? 1 : 0)}×${l.r ?? '?'}` : `${l.r ?? '?'} reps`)),
      complete: done.length >= ex.sets,
      skipped: skipped.has(ex.slotKey ?? ex.key) || skipped.has(ex.key),
      change: ex.change ?? null,
    };
  });
  const flame = flameInfo(s, date);
  const eaten = totals(day);
  const nutrition = s.settings.modules.nutrition;
  const kg = Object.entries(s.body.weight)
    .filter(([k]) => k <= date)
    .sort(([a], [b]) => b.localeCompare(a))[0];
  const trend = weeklyChange(s, date);

  const lines: string[] = [];
  const label = formatLong(date);
  if (session.type === 'rest' || !session.exercises.length) {
    lines.push(`${label} : jour de repos (${session.name}).`);
  } else {
    lines.push(`${label} : séance ${session.name} (${session.focus}), ${session.duration}.`);
    lines.push(day.mainDone ? 'Séance validée.' : `${progress.done}/${progress.total} séries faites.`);
    for (const e of exercises) {
      const bits = [`- ${e.name} : ${e.plan}`];
      if (e.load) bits.push(`charge conseillée ${e.load}`);
      if (e.done.length) bits.push(`fait ${e.done.join(', ')}`);
      if (e.skipped) bits.push('sauté');
      if (e.change === 'swap' || e.change === 'broken') bits.push('remplacé aujourd’hui');
      if (e.change === 'extra') bits.push('ajouté');
      lines.push(bits.join(', '));
    }
  }
  lines.push(`Série : ${flame.current} jour${flame.current > 1 ? 's' : ''} (record ${flame.best}), ${flame.tierInfo.name.toLowerCase()}.`);
  if (nutrition) {
    const t = s.settings.targets;
    lines.push(`Mangé : ${eaten.kcal}/${t.kcal} kcal, ${eaten.protein}/${t.protein} g de protéines, ${eaten.carbs}/${t.carbs} g de glucides, ${eaten.fat}/${t.fat} g de lipides.`);
  }
  if (kg) lines.push(`Poids : ${nf(kg[1], 1)} kg le ${formatShort(kg[0])}${trend !== null ? ` (${signed(trend, 2)} kg par semaine)` : ''}`.replace(/\.?$/, '.'));
  lines.push(syncedLine(d));

  return {
    text: lines.join('\n'),
    card: {
      kind: 'today',
      date,
      label,
      today: date === d.today,
      session: { name: session.name, focus: session.focus, type: session.type, duration: session.duration },
      mainDone: day.mainDone,
      progress,
      exercises,
      streak: { days: flame.current, best: flame.best, tier: flame.tierInfo.name, colors: flame.tierInfo.colors },
      nutrition: nutrition ? { kcal: [eaten.kcal, s.settings.targets.kcal], protein: [eaten.protein, s.settings.targets.protein] } : null,
      weight: kg ? { kg: kg[1], date: kg[0], perWeek: trend } : null,
      app: `${appUrl}/?tab=workout`,
      syncedAt: d.savedAt,
    },
  };
}

/* ---------- Récap du mois ---------- */

export function recap(d: UserData, args: { month?: unknown }, appUrl: string): ToolOutput {
  const month = args.month === undefined ? d.today.slice(0, 7) : args.month;
  if (!isMonth(month)) throw new BadInput('month doit être au format AAAA-MM');
  if (month > d.today.slice(0, 7)) throw new BadInput('Ce mois n’a pas encore commencé');
  const r = monthRecap(d.s, month, d.today);
  // Les mois qu'on peut parcourir depuis la carte : les trois derniers avec au moins une séance, plus celui-ci.
  const withData = new Set(
    Object.entries(d.s.days)
      .filter(([, day]) => day.mainDone)
      .map(([k]) => k.slice(0, 7)),
  );
  withData.add(month);
  const months = [...withData].filter((m) => m <= d.today.slice(0, 7)).sort().slice(-3);

  const M = r.name.charAt(0).toUpperCase() + r.name.slice(1);
  const lines = [
    `Récap ${M} ${r.year}${r.partial ? ' (mois en cours, jusqu’à aujourd’hui)' : ''}.`,
    `Profil du mois : ${r.profile.title}. ${r.profile.line}`,
    `${r.sessions} séance${r.sessions > 1 ? 's' : ''} validée${r.sessions > 1 ? 's' : ''} (${nf(r.perWeek, 1)} par semaine), ${r.sets} séries, ${fmtTonnes(r.tonnage)} soulevées, ${fmtDuration(r.minutes)} d’entraînement.`,
  ];
  if (r.prev) lines.push(`Mois d’avant (${r.prev.name}${r.partial ? ', à la même date' : ''}) : ${r.prev.sessions} séances, ${fmtTonnes(r.prev.tonnage)}.`);
  if (r.recordCount)
    lines.push(
      `${r.recordCount} record${r.recordCount > 1 ? 's' : ''} : ${r.records
        .slice(0, 5)
        .map((x) => `${x.name} ${nf(x.w, x.w % 1 ? 1 : 0)} kg × ${x.r} (+${Math.round(x.gain)} %)`)
        .join(' ; ')}.`,
    );
  if (r.top) lines.push(`Exercice du mois : ${r.top.name}, ${r.top.sets} séries, ${fmtTonnes(r.top.tonnage)}.`);
  if (r.best) lines.push(`Séance la plus lourde : ${formatLong(r.best.date).toLowerCase()}, ${fmtTonnes(r.best.tonnage)} en ${r.best.sets} séries.`);
  if (r.weekday) lines.push(`Jour préféré : le ${r.weekday.name} (${r.weekday.count} séances).`);
  if (r.moment) lines.push(`Moment préféré : ${r.moment}.`);
  if (r.run >= 2) lines.push(`Plus longue série de journées validées : ${r.run} jours.`);
  if (r.weight) lines.push(`Poids : de ${nf(r.weight.from, 1)} à ${nf(r.weight.to, 1)} kg.`);
  if (r.cardioKm) lines.push(`Endurance : ${nf(r.cardioKm, 1)} km.`);
  if (r.trophies.length) lines.push(`Trophées gagnés : ${r.trophies.map((t) => t.title).join(', ')}.`);
  lines.push(syncedLine(d));

  return {
    text: lines.join('\n'),
    card: {
      kind: 'recap',
      month,
      name: M,
      year: r.year,
      partial: r.partial,
      months: months.map((m) => ({ id: m, label: shortMonth.format(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 15))) })),
      sessions: r.sessions,
      perWeek: r.perWeek,
      tonnage: fmtTonnes(r.tonnage),
      tonnageKg: r.tonnage,
      records: r.recordCount,
      time: fmtDuration(r.minutes),
      profile: { title: r.profile.title, line: r.profile.line, color: PROFILE_COLOR[r.profile.id] },
      cal: {
        offset: r.cal.offset,
        trained: r.cal.days.flatMap((x, i) => (x.trained ? [i + 1] : [])),
        records: r.cal.days.flatMap((x, i) => (x.record ? [i + 1] : [])),
        days: r.cal.days.length,
        today: r.partial ? Number(d.today.slice(8)) : null,
      },
      top: r.top ? { name: r.top.name, sets: r.top.sets } : null,
      prev: r.prev ? { name: r.prev.name, sessions: r.prev.sessions } : null,
      app: `${appUrl}/?tab=progress`,
      syncedAt: d.savedAt,
    },
  };
}

/* ---------- Recherche dans l'historique (RAG) ---------- */

export function search(d: UserData, args: { query?: unknown; limit?: unknown }): ToolOutput {
  const query = typeof args.query === 'string' ? args.query.trim().slice(0, 300) : '';
  if (!query) throw new BadInput('query est vide');
  const k = Math.max(1, Math.min(12, Math.round(Number(args.limit ?? 6)) || 6));
  const hits = localRetriever(d.s, d.today).searchSync(query, { k, budget: 9000 });
  const text = hits.length
    ? hits.map((h) => `[${h.doc.title}]\n${h.doc.text}`).join('\n\n')
    : 'Rien dans l’historique ne correspond à cette recherche.';
  return { text: `${text}\n\n${syncedLine(d)}` };
}

/* ---------- Historique d'un exercice ---------- */

/** L'exercice le plus proche du nom donné, parmi ceux que la personne a déjà faits d'abord. */
export function findExercise(s: AppState, query: string): { key: string; name: string } | null {
  const q = normalize(query);
  if (!q) return null;
  const logged = new Set<string>();
  for (const day of Object.values(s.days)) for (const [key, sets] of Object.entries(day.sets)) if (sets.some((l) => l.done)) logged.add(key);
  const pool = new Map<string, string>();
  for (const e of CATALOG) pool.set(e.key, e.name);
  for (const [key, e] of Object.entries(s.customExercises)) pool.set(key, e.name);
  for (const key of logged) if (!pool.has(key)) pool.set(key, key);
  const words = q.split(' ').filter(Boolean);
  let best: { key: string; name: string; score: number } | null = null;
  for (const [key, name] of pool) {
    const n = normalize(name);
    const k = normalize(key.replace(/-/g, ' '));
    let score = 0;
    if (n === q || k === q) score = 100;
    else if (n.startsWith(q) || k.startsWith(q)) score = 60;
    else if (n.includes(q)) score = 45;
    else {
      const hit = words.filter((w) => w.length > 1 && (n.includes(w) || k.includes(w))).length;
      if (!hit) continue;
      score = (hit / words.length) * 40;
    }
    if (logged.has(key)) score += 25;
    if (!best || score > best.score) best = { key, name, score };
  }
  return best && best.score >= 30 ? { key: best.key, name: best.name } : null;
}

export function exerciseHistory(d: UserData, args: { exercise?: unknown; weeks?: unknown }): ToolOutput {
  const query = typeof args.exercise === 'string' ? args.exercise.trim() : '';
  if (!query) throw new BadInput('exercise est vide');
  const weeks = Math.max(1, Math.min(104, Math.round(Number(args.weeks ?? 12)) || 12));
  const found = findExercise(d.s, query);
  if (!found) throw new BadInput(`Aucun exercice ne ressemble à « ${query.slice(0, 60)} »`);
  const entry = catalogEntry(found.key, d.s.customExercises);
  const since = addDays(d.today, -weeks * 7);
  const sessions: { date: string; sets: string; best: number; top: string }[] = [];
  let record: { date: string; w: number; r: number; e: number } | null = null;
  for (const date of Object.keys(d.s.days).sort()) {
    const sets = (d.s.days[date].sets[found.key] ?? []).filter((l) => l.done);
    if (!sets.length) continue;
    let best = 0;
    let top = '';
    for (const l of sets) {
      if (l.w === undefined || !l.r) continue;
      const v = e1rm(l.w, l.r);
      if (v > best) {
        best = v;
        top = `${fmtKg(l.w)} × ${l.r}`;
      }
      if (!record || v > record.e) record = { date, w: l.w, r: l.r, e: v };
    }
    if (date < since) continue;
    const list = sets.map((l) => (l.km ? `${nf(l.km, 1)} km` : l.w !== undefined ? `${nf(l.w, l.w % 1 ? 1 : 0)} kg × ${l.r ?? '?'}` : `${l.r ?? '?'} reps`));
    sessions.push({ date, sets: list.join(', '), best, top });
  }
  const lines = [`${found.name}${entry ? ` (${entry.muscles?.length ? entry.muscles.join(', ') : GROUP_NAMES[entry.group]})` : ''}.`];
  if (!sessions.length) {
    lines.push(`Pas de série notée sur les ${weeks} dernières semaines.`);
  } else {
    lines.push(`${sessions.length} séance${sessions.length > 1 ? 's' : ''} sur les ${weeks} dernières semaines :`);
    for (const x of sessions.slice(-40)) lines.push(`- ${formatShort(x.date)} : ${x.sets}${x.best ? ` (meilleure ${x.top}, 1RM estimé ${Math.round(x.best)} kg)` : ''}`);
    const lifted = sessions.filter((x) => x.best);
    if (lifted.length > 1) {
      const delta = lifted[lifted.length - 1].best - lifted[0].best;
      lines.push(`1RM estimé : ${signed(Math.round(delta))} kg du ${formatShort(lifted[0].date)} au ${formatShort(lifted[lifted.length - 1].date)}`.replace(/\.?$/, '.'));
    }
  }
  if (record) lines.push(`Record de tous les temps : ${fmtKg(record.w)} × ${record.r} le ${formatShort(record.date)} (1RM estimé ${Math.round(record.e)} kg).`);
  lines.push(syncedLine(d));
  return { text: lines.join('\n') };
}

/* ---------- Journal de quelques jours ---------- */

export function journal(d: UserData, args: { from?: unknown; to?: unknown }): ToolOutput {
  const to = args.to === undefined ? d.today : args.to;
  const from = args.from === undefined ? addDays(String(to), -6) : args.from;
  if (!isDate(from) || !isDate(to)) throw new BadInput('from et to doivent être au format AAAA-MM-JJ');
  if (from > to) throw new BadInput('from doit précéder to');
  if (diffDays(to, from) > 30) throw new BadInput('31 jours au plus à la fois');
  const lines: string[] = [];
  for (let date = to; date >= from; date = addDays(date, -1)) {
    const doc: KnowledgeDoc | null = dayDoc(d.s, date);
    lines.push(doc ? `[${doc.title}]\n${doc.text}` : `[${formatLong(date)}]\nRien de noté.`);
  }
  lines.push(syncedLine(d));
  return { text: lines.join('\n\n') };
}

/* ---------- Profil, programme, corps ---------- */

export function profile(d: UserData): ToolOutput {
  const { s, today } = d;
  const flame = flameInfo(s, today);
  const won = Object.keys(s.ui.trophies ?? {}).length;
  const body = bodyDoc(s, today);
  const parts = [
    `Profil\n${profileDoc(s).text}`,
    `Programme ${s.program.name}\n${programText(s)}`,
    body ? `Poids et mensurations\n${body.text}` : '',
    `Force\n${profileSummary(s, today)}`,
    `Série : ${flame.current} jours (record ${flame.best}), ${flame.tierInfo.name.toLowerCase()}. Trophées : ${won} sur ${TROPHIES.length}. Semaine du ${formatShort(mondayOf(today))}.`,
    syncedLine(d),
  ];
  return { text: parts.filter(Boolean).join('\n\n') };
}
