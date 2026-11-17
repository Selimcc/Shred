// Récap du mois, façon « Wrapped » : séances (et leur calendrier), tonnage, plus grosse séance, records, exercice
// phare, jour et heure préférés, plus longue série, corps, trophées, la comparaison avec le mois d'avant, et un
// profil du mois qui résume le tout. Tout se calcule sur le téléphone.
import { catalogEntry, exerciseName } from '../../shared/catalog';
import { addDays, dayKey, diffDays, parseKey, weekdayOf, WEEKDAY_LOWER } from './date';
import { dayValidated, mealsCount } from './logic';
import { type AppState, WEIGHT_GOALS, type WeightGoal } from './state';
import { e1rm } from './strength';
import { dayTraining, totalMinutes } from './training';
import { type Tier, TROPHIES } from './trophyList';
import { date as fmtDate, lang, loc, lower, pct, tr } from '../../shared/i18n';

export interface MonthRecord {
  key: string;
  name: string;
  w: number;
  r: number;
  /** Gain sur le meilleur 1RM estimé d'avant, en %. */
  gain: number;
}

export interface MonthRecap {
  /** « 2026-10 » */
  month: string;
  /** « octobre » */
  name: string;
  year: number;
  /** Mois en cours : les chiffres s'arrêtent à aujourd'hui. */
  partial: boolean;
  sessions: number;
  sets: number;
  tonnage: number;
  minutes: number;
  cardioKm: number;
  /** Une ligne par exercice (le meilleur record du mois), les plus gros gains d'abord. */
  records: MonthRecord[];
  recordCount: number;
  /** `weeks` : ses séries, semaine par semaine (une ligne du calendrier chacune). */
  top: { key: string; name: string; sets: number; tonnage: number; weeks: number[] } | null;
  weekday: { day: number; name: string; count: number } | null;
  /** « le matin », « le soir »… quand au moins trois séances sont datées. */
  moment: string | null;
  /** Plus longue suite de journées validées dans le mois. */
  run: number;
  meals: number;
  /** Première et dernière pesée du mois, et les jours entre les deux. */
  weight: { from: number; to: number; days: number } | null;
  trophies: { id: string; title: string; icon: string; tier: Tier }[];
  prev: { name: string; sessions: number; tonnage: number } | null;
  /** Séances par semaine en moyenne (sur les jours écoulés du mois). */
  perWeek: number;
  /** Le mois en calendrier : décalage du 1er (lundi = 0), puis un jour par case (séance, record). */
  cal: { offset: number; days: { trained: boolean; record: boolean; future: boolean }[] };
  /** Séances par jour de la semaine, du lundi au dimanche. */
  byWeekday: number[];
  /** Pesées du mois, dans l'ordre. */
  weighIns: { date: string; kg: number }[];
  /** La séance la plus lourde du mois. */
  best: { date: string; tonnage: number; sets: number } | null;
  profile: RecapProfile;
}

/** Le profil du mois : ce qui t'a le plus défini ce mois-ci, en un titre et une phrase. */
export interface RecapProfile {
  id: 'records' | 'streak' | 'machine' | 'early' | 'night' | 'metronome' | 'engine' | 'architect';
  title: string;
  line: string;
  icon: string;
}

/** La couleur du profil du mois (carte révélée, image à partager, carte dans Claude). */
export const PROFILE_COLOR: Record<RecapProfile['id'], string> = {
  records: '#ffd166',
  streak: '#ff8a1f',
  machine: '#ff4d6d',
  early: '#ffb38a',
  night: '#8f8cff',
  metronome: '#2ee6a0',
  engine: '#34d3e0',
  architect: '#86b9ff',
};

/** Les mois comme dans une phrase : « octobre », « October », « Oktober ». */
const MONTHS = Array.from({ length: 12 }, (_, i) => fmtDate(new Date(2024, i, 1, 12), { month: 'long' }));

export const monthOf = (date: string) => date.slice(0, 7);
export const monthName = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
/** « d’octobre », « de novembre » ; ailleurs « of October », « de octubre »… */
export const ofMonth = (month: string) =>
  lang() === 'fr' && /^[aeiouyéèêàâîïôûh]/i.test(monthName(month)) ? `d’${monthName(month)}` : tr('de {month}', { month: monthName(month) });

export function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

function lastDay(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return dayKey(new Date(y, m, 0));
}

/** Séances et tonnage d'un mois, sans le reste (pour la comparaison). */
function light(s: AppState, month: string, until: string) {
  let sessions = 0;
  let tonnage = 0;
  for (const [date, day] of Object.entries(s.days)) {
    if (monthOf(date) !== month || date > until) continue;
    if (day.mainDone) sessions++;
    for (const logs of Object.values(day.sets)) for (const l of logs) if (l.done && l.w && l.r) tonnage += l.w * l.r;
  }
  return { sessions, tonnage: Math.round(tonnage) };
}

export function monthRecap(s: AppState, month: string, today = dayKey()): MonthRecap {
  const first = `${month}-01`;
  const partial = monthOf(today) === month;
  const end = partial ? today : lastDay(month);
  const out: MonthRecap = {
    month,
    name: monthName(month),
    year: Number(month.slice(0, 4)),
    partial,
    sessions: 0,
    sets: 0,
    tonnage: 0,
    minutes: 0,
    cardioKm: 0,
    records: [],
    recordCount: 0,
    top: null,
    weekday: null,
    moment: null,
    run: 0,
    meals: 0,
    weight: null,
    trophies: [],
    prev: null,
    perWeek: 0,
    cal: { offset: (weekdayOf(first) + 6) % 7, days: [] },
    byWeekday: Array(7).fill(0) as number[],
    weighIns: [],
    best: null,
    profile: { id: 'architect', title: '', line: '', icon: 'chart' },
  };
  const recordDays = new Set<string>();
  const dayLoad = new Map<string, { tonnage: number; sets: number }>();

  // Records : on rejoue tout l'historique dans l'ordre, un record du mois bat le meilleur d'avant.
  const best = new Map<string, number>();
  const startBest = new Map<string, number>();
  const records = new Map<string, MonthRecord>();
  const perEx = new Map<string, { sets: number; tonnage: number; weeks: number[] }>();
  const kinds = new Map<string, string | undefined>();
  const kindOf = (key: string) => {
    if (!kinds.has(key)) kinds.set(key, catalogEntry(key, s.customExercises)?.kind);
    return kinds.get(key);
  };
  const weekdays = Array(7).fill(0) as number[];
  const hours: number[] = [];
  for (const date of Object.keys(s.days).sort()) {
    if (date > end) break;
    const day = s.days[date];
    const inMonth = date >= first;
    if (inMonth) {
      if (day.mainDone) {
        out.sessions++;
        weekdays[weekdayOf(date)]++;
        if (day.mainDoneAt) hours.push(new Date(day.mainDoneAt).getHours());
      }
      out.meals += mealsCount(day);
      const t = dayTraining(s, date);
      out.minutes += totalMinutes(t);
      out.cardioKm += Object.values(t.km).reduce((a, b) => a + (b ?? 0), 0);
    }
    for (const [key, logs] of Object.entries(day.sets)) {
      const lift = kindOf(key) !== 'cardio' && kindOf(key) !== 'task';
      let dayBest = 0;
      let top: { w: number; r: number } | null = null;
      for (const l of logs) {
        if (!l.done) continue;
        if (inMonth && lift) out.sets++;
        if (!l.w || !l.r) continue;
        if (inMonth) {
          out.tonnage += l.w * l.r;
          const e = perEx.get(key) ?? { sets: 0, tonnage: 0, weeks: [] };
          e.sets++;
          e.tonnage += l.w * l.r;
          const row = Math.floor((out.cal.offset + Number(date.slice(8)) - 1) / 7);
          e.weeks[row] = (e.weeks[row] ?? 0) + 1;
          perEx.set(key, e);
          const load = dayLoad.get(date) ?? { tonnage: 0, sets: 0 };
          load.tonnage += l.w * l.r;
          load.sets++;
          dayLoad.set(date, load);
        }
        const v = e1rm(l.w, l.r);
        if (v > dayBest) {
          dayBest = v;
          top = { w: l.w, r: l.r };
        }
      }
      if (!dayBest || !top) continue;
      const prev = best.get(key);
      // Le point de départ du mois : le meilleur d'avant, ou la première séance du mois pour un nouvel exercice.
      if (inMonth && !startBest.has(key)) startBest.set(key, prev ?? dayBest);
      if (inMonth && prev !== undefined && dayBest > prev + 0.01) {
        out.recordCount++;
        recordDays.add(date);
        const base = startBest.get(key)!;
        // Chaque record bat le précédent : le dernier du mois est le plus haut.
        records.set(key, {
          key,
          name: exerciseName(key, s.customExercises).replace(/ \(.*\)$/, ''),
          w: top.w,
          r: top.r,
          gain: ((dayBest - base) / base) * 100,
        });
      }
      if (prev === undefined || dayBest > prev) best.set(key, dayBest);
    }
  }
  out.tonnage = Math.round(out.tonnage);
  out.minutes = Math.round(out.minutes);
  out.cardioKm = Math.round(out.cardioKm * 10) / 10;
  out.records = [...records.values()].sort((a, b) => b.gain - a.gain);

  // Exercice phare : le plus de séries de muscu (le tonnage départage).
  const lifts = [...perEx].filter(([key]) => kindOf(key) !== 'cardio' && kindOf(key) !== 'task');
  lifts.sort(([, a], [, b]) => b.sets - a.sets || b.tonnage - a.tonnage);
  if (lifts[0] && lifts[0][1].sets >= 3) {
    const [key, v] = lifts[0];
    // Une barre par semaine du mois ; en cours de mois, seulement les semaines déjà commencées.
    const rows = Math.ceil((out.cal.offset + Number(end.slice(8))) / 7);
    out.top = {
      key,
      name: exerciseName(key, s.customExercises),
      sets: v.sets,
      tonnage: Math.round(v.tonnage),
      weeks: Array.from({ length: rows }, (_, i) => v.weeks[i] ?? 0),
    };
  }

  // Jour préféré : au moins deux séances ce jour-là, et pas d'égalité.
  const max = Math.max(...weekdays);
  if (max >= 2 && weekdays.filter((n) => n === max).length === 1) {
    const d = weekdays.indexOf(max);
    out.weekday = { day: d, name: WEEKDAY_LOWER[d], count: max };
  }

  if (hours.length >= 3) {
    const slot = (h: number) =>
      h >= 5 && h < 11 ? tr('le matin') : h < 14 && h >= 11 ? tr('à midi') : h >= 14 && h < 18 ? tr('l’après-midi') : h >= 18 && h < 22 ? tr('le soir') : tr('la nuit');
    const count = new Map<string, number>();
    for (const h of hours) count.set(slot(h), (count.get(slot(h)) ?? 0) + 1);
    const [label, n] = [...count].sort((a, b) => b[1] - a[1])[0];
    if (n / hours.length >= 0.5) out.moment = label;
  }

  // Plus longue suite de journées validées (séance et repas selon ta règle).
  let run = 0;
  for (let d = first; d <= end; d = addDays(d, 1)) {
    run = dayValidated(s, d) ? run + 1 : 0;
    out.run = Math.max(out.run, run);
  }

  const weighIns = Object.keys(s.body.weight)
    .filter((d) => d >= first && d <= end)
    .sort();
  if (weighIns.length >= 2)
    out.weight = {
      from: s.body.weight[weighIns[0]],
      to: s.body.weight[weighIns[weighIns.length - 1]],
      days: diffDays(weighIns[weighIns.length - 1], weighIns[0]),
    };
  out.weighIns = weighIns.map((date) => ({ date, kg: s.body.weight[date] }));

  // Le calendrier du mois entier (les jours à venir restent éteints), et les séances par jour de semaine.
  const total = Number(lastDay(month).slice(8));
  for (let d = 1; d <= total; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const trained = date <= end && s.days[date]?.mainDone === true;
    out.cal.days.push({ trained, record: recordDays.has(date), future: date > end });
    if (trained) out.byWeekday[(weekdayOf(date) + 6) % 7]++;
  }
  const elapsed = partial ? Math.max(1, Number(today.slice(8))) : total;
  out.perWeek = Math.round((out.sessions / (elapsed / 7)) * 10) / 10;

  let heavy: MonthRecap['best'] = null;
  for (const [date, load] of dayLoad) if (!heavy || load.tonnage > heavy.tonnage) heavy = { date, tonnage: Math.round(load.tonnage), sets: load.sets };
  out.best = heavy && heavy.tonnage >= 500 ? heavy : null;

  const won = s.ui.trophies ?? {};
  out.trophies = TROPHIES.filter((t) => typeof won[t.id] === 'string' && monthOf(won[t.id]) === month).map((t) => ({
    id: t.id,
    title: t.title,
    icon: t.icon,
    tier: t.tier,
  }));

  // Le mois d'avant, à la même date si celui-ci est en cours.
  const pm = prevMonth(month);
  const pEnd = partial ? `${pm}-${String(Math.min(Number(today.slice(8)), Number(lastDay(pm).slice(8)))).padStart(2, '0')}` : lastDay(pm);
  const p = light(s, pm, pEnd);
  if (p.sessions > 0) out.prev = { name: monthName(pm), ...p };
  out.profile = recapProfile(out);
  return out;
}

/**
 * Le profil du mois : le trait le plus marquant, dans cet ordre (un mois à 6 records parle de records avant de
 * parler d'horaires). Des titres valables pour tout le monde, sans genre.
 */
export function recapProfile(r: Pick<MonthRecap, 'recordCount' | 'run' | 'tonnage' | 'moment' | 'perWeek' | 'cardioKm'>): RecapProfile {
  if (r.recordCount >= 5)
    return { id: 'records', title: tr('La fabrique à records'), line: tr('{recordCount} records battus en un mois. Les barres n’ont rien vu venir.', { recordCount: r.recordCount }), icon: 'trophy' };
  if (r.run >= 10) return { id: 'streak', title: tr('L’inarrêtable'), line: tr('{run} jours validés d’affilée. La pause, tu connais de nom.', { run: r.run }), icon: 'flame' };
  if (r.tonnage >= 60_000)
    return { id: 'machine', title: tr('La machine'), line: tr('{fmtTonnes} soulevées. Les disques n’ont pas eu le temps de refroidir.', { fmtTonnes: fmtTonnes(r.tonnage) }), icon: 'dumbbell' };
  if (r.moment === tr('le matin')) return { id: 'early', title: tr('Le lève-tôt'), line: tr('Tes séances avant 11 h, quand la ville dort encore.'), icon: 'sunrise' };
  if (r.moment === tr('le soir') || r.moment === tr('la nuit'))
    return { id: 'night', title: tr('L’oiseau de nuit'), line: tr('Tes séances tombent quand les autres décrochent.'), icon: 'moon' };
  if (r.perWeek >= 3)
    return { id: 'metronome', title: tr('Le métronome'), line: tr('{perWeek} séances par semaine, réglé comme une horloge.', { perWeek: r.perWeek.toLocaleString(loc()) }), icon: 'clock' };
  if (r.cardioKm >= 30) return { id: 'engine', title: tr('Le moteur'), line: tr('{cardioKm} km d’endurance. Ton cœur dit merci.', { cardioKm: r.cardioKm.toLocaleString(loc()) }), icon: 'run' };
  return { id: 'architect', title: tr('L’architecte'), line: tr('Une séance après l’autre : c’est comme ça qu’on bâtit.'), icon: 'chart' };
}

/** Le mois à récapituler : le précédent pendant la première semaine, sinon le mois en cours. */
export function recapMonths(s: AppState, today = dayKey()): { month: string; partial: boolean }[] {
  const cur = monthOf(today);
  const prev = prevMonth(cur);
  const has = (m: string) => Object.entries(s.days).some(([d, day]) => monthOf(d) === m && day.mainDone);
  const out: { month: string; partial: boolean }[] = [];
  if (has(prev)) out.push({ month: prev, partial: false });
  if (has(cur)) out.push({ month: cur, partial: true });
  return out;
}

/** Le bandeau d'Aujourd'hui : la première semaine du mois, si le mois d'avant compte au moins 4 séances. */
export function recapReady(s: AppState, today = dayKey()): string | null {
  if (Number(today.slice(8)) > 7) return null;
  const prev = prevMonth(monthOf(today));
  if (s.ui.recapSeen === prev) return null;
  const sessions = Object.entries(s.days).filter(([d, day]) => monthOf(d) === prev && day.mainDone).length;
  return sessions >= 4 ? prev : null;
}

const UNITS = [
  { below: 6_000, kg: 1_200, one: tr('une voiture citadine'), many: tr('voitures citadines') },
  { below: 60_000, kg: 6_000, one: tr('un éléphant d’Afrique'), many: tr('éléphants d’Afrique') },
  { below: 300_000, kg: 40_000, one: tr('un semi-remorque chargé'), many: tr('semi-remorques chargés') },
  { below: Infinity, kg: 150_000, one: tr('une baleine bleue'), many: tr('baleines bleues') },
];

/** « Le poids de 7 éléphants d’Afrique. » À partir d'une tonne. */
export function tonnageLike(kg: number): string | null {
  const u = tonnageUnit(kg);
  if (!u) return null;
  return u.n === 1 ? tr('Le poids d’{one}.', { one: u.one }) : tr('Le poids de {n} {many}.', { n: u.n, many: u.many });
}

/** L'unité de comparaison et combien il en faut (pour les dessiner) : voiture, éléphant, semi-remorque, baleine. */
export function tonnageUnit(kg: number): { key: 'car' | 'elephant' | 'truck' | 'whale'; n: number; one: string; many: string } | null {
  if (kg < 1_000) return null;
  const i = UNITS.findIndex((x) => kg < x.below);
  const u = UNITS[i];
  return { key: (['car', 'elephant', 'truck', 'whale'] as const)[i], n: Math.max(1, Math.round(kg / u.kg)), one: u.one, many: u.many };
}

export const fmtTonnes = (kg: number) =>
  kg >= 1000 ? `${(Math.round(kg / 100) / 10).toLocaleString(loc())}\u00a0t` : `${Math.round(kg).toLocaleString(loc())}\u00a0kg`;
export const fmtDuration = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}` : ''}` : `${min} min`);

/** Évolution en %, arrondie, avec son signe (« +12 % »), ou null si rien à comparer. */
export function delta(now: number, before: number | undefined): string | null {
  if (!before) return null;
  const p = Math.round(((now - before) / before) * 100);
  return `${p > 0 ? '+' : p < 0 ? '−' : '±'}${pct(Math.abs(p))}`;
}

export const recapDate = (month: string) => parseKey(`${month}-01`);

/** Le sens de la balance au regard de l'objectif : « pile dans le rythme », « dans le bon sens », ou rien. */
export function weightVerdict(w: MonthRecap['weight'], goal: WeightGoal): string | null {
  if (!w || w.days < 7) return null;
  const perWeek = ((w.to - w.from) / w.days) * 7;
  const g = WEIGHT_GOALS[goal];
  const name = lower(g.label);
  if (perWeek >= g.min - 0.1 && perWeek <= g.max + 0.1) return goal === 'maintain' ? tr('Poids stable, comme prévu') : tr('Pile dans le rythme de ta {name}', { name });
  if ((goal === 'cut' && perWeek < 0) || (goal === 'bulk' && perWeek > 0)) return tr('Dans le bon sens pour ta {name}', { name });
  return null;
}
