// Bilan de la semaine : ce qui a été fait, ce qui a bougé, et ce qu'on ajuste.
// Tout se calcule sur le téléphone ; seul le mail (si la personne l'active) passe par le serveur.
import { athleteSummary, sportLabel, WEIGHT_GOALS } from '../../shared/athlete';
import { DISCIPLINE_NAMES, exerciseName } from '../../shared/catalog';
import type { Discipline } from '../../shared/types';
import { findSession, scheduleFor } from '../../shared/program';
import { usable } from '../../shared/plans';
import { addDays, dayKey, formatNumber, formatShort, mondayOf, weekdayOf } from './date';
import { dayValidated, mealsCount, ruleOf, sessionFor, streakInfo, totals } from './logic';
import type { AppState } from './store';
import { e1rm, GROUPS, strengthProfile } from './strength';
import { addTraining, dayTraining, empty, totalMinutes } from './training';
import { lang, list, loc, lower, tn, tr } from '../../shared/i18n';

export interface Advice {
  id: string;
  title: string;
  text: string;
  tone: 'good' | 'warn' | 'info';
  /** Ce que l'app peut faire tout de suite si la personne accepte. */
  action?: { kind: 'kcal'; delta: number } | { kind: 'add-exercise'; key: string; session: string } | { kind: 'swap'; from: string; to: string };
}

export interface WeeklyReport {
  monday: string;
  sunday: string;
  /** Jours comptés (7, ou moins pour la semaine en cours). */
  days: number;
  sessions: { planned: number; done: number; names: string[] };
  validated: number;
  streak: number;
  nutrition: { days: number; kcal: number | null; protein: number | null; target: { kcal: number; protein: number }; proteinDays: number };
  weight: { avg: number | null; prev: number | null; change: number | null; goal: { label: string; min: number; max: number } };
  steps: number | null;
  /** Temps d'entraînement et distances par sport d'endurance. */
  training: { minutes: number; km: { name: string; km: number }[] };
  prs: { name: string; text: string }[];
  stalls: { key: string; name: string }[];
  advice: Advice[];
  /** Phrase d'accroche du bilan. */
  headline: string;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function weekDates(monday: string) {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

function avgWeight(s: AppState, monday: string): number | null {
  return avg(weekDates(monday).map((d) => s.body.weight[d]).filter((x): x is number => x !== undefined));
}

/** Meilleur 1RM estimé d'un exercice sur une période. */
function bestE1rm(s: AppState, key: string, from: string, to: string): number | null {
  let best: number | null = null;
  for (const [date, day] of Object.entries(s.days)) {
    if (date < from || date > to) continue;
    for (const l of day.sets[key] ?? []) {
      if (!l.done || !l.w || !l.r) continue;
      const v = e1rm(l.w, l.r);
      if (best === null || v > best) best = v;
    }
  }
  return best;
}

/** Exercices à proposer pour renforcer un groupe, du plus utile au moins utile. */
const BOOST: Record<string, string[]> = {
  chest: ['incline-db-press', 'dips', 'cable-fly', 'db-bench', 'pushup'],
  shoulders: ['db-lateral-raise', 'cable-lateral-raise', 'arnold-press', 'face-pull'],
  arms: ['incline-curl', 'hammer-curl', 'overhead-triceps', 'dips'],
  hamstrings: ['rdl', 'leg-curl', 'hip-thrust', 'good-morning'],
  quads: ['bulgarian', 'hack-squat', 'leg-press', 'goblet-squat'],
  back: ['pullup', 'db-row', 'seated-cable-row', 'neutral-pulldown'],
};

/** Variante proposée quand un exercice stagne depuis plusieurs semaines. */
const VARIATION: Record<string, string> = {
  bench: 'incline-db-press', 'incline-db-press': 'db-bench', 'db-bench': 'bench', squat: 'front-squat', 'front-squat': 'hack-squat',
  'leg-press': 'hack-squat', 'hack-squat': 'bulgarian', deadlift: 'rdl', rdl: 'hip-thrust', 'barbell-row': 'db-row', 'db-row': 'seated-cable-row',
  'seated-cable-row': 't-bar-row', pullup: 'chin-up', 'chin-up': 'neutral-pulldown', 'neutral-pulldown': 'wide-pulldown',
  'db-shoulder-press': 'arnold-press', 'military-press': 'db-shoulder-press', 'db-lateral-raise': 'cable-lateral-raise',
  'incline-curl': 'hammer-curl', 'hammer-curl': 'cable-curl', 'rope-pushdown': 'overhead-triceps', 'overhead-triceps': 'rope-pushdown',
};

const nameOf = (s: AppState, key: string) => exerciseName(key, s.customExercises);

export function weeklyReport(s: AppState, monday: string, today = dayKey()): WeeklyReport {
  const sunday = addDays(monday, 6);
  // Semaine en cours : on ne compte que les jours déjà passés.
  const dates = weekDates(monday).filter((d) => d <= today);
  const ongoing = sunday >= today;
  const rule = ruleOf(s);
  const p = s.settings;

  // Séances
  const planned = dates.filter((d) => findSession(s.program, scheduleFor(s.program, d)[weekdayOf(d)]).type !== 'rest');
  const doneDays = dates.filter((d) => s.days[d]?.mainDone && sessionFor(s, d).type !== 'rest');
  const sessions = { planned: planned.length, done: doneDays.length, names: doneDays.map((d) => sessionFor(s, d).name) };
  const validated = dates.filter((d) => dayValidated(s, d, rule)).length;
  const load = dates.reduce((t, d) => addTraining(t, dayTraining(s, d)), empty());
  const training = {
    minutes: Math.round(totalMinutes(load)),
    km: (Object.entries(load.km) as [Discipline, number][])
      .filter(([d, km]) => km >= 0.1 && d !== 'walk' && d !== 'combat')
      .map(([d, km]) => ({ name: DISCIPLINE_NAMES[d], km: Math.round(km * 10) / 10 })),
  };

  // Nutrition
  const fed = dates.filter((d) => (s.days[d]?.meals.length ?? 0) > 0 && mealsCount(s.days[d]) >= 2);
  const kcal = avg(fed.map((d) => totals(s.days[d]).kcal));
  const protein = avg(fed.map((d) => totals(s.days[d]).protein));
  const proteinDays = fed.filter((d) => totals(s.days[d]).protein >= p.targets.protein * 0.9).length;

  // Poids : moyenne de la semaine contre la précédente.
  const wAvg = avgWeight(s, monday);
  const wPrev = avgWeight(s, addDays(monday, -7));
  const change = wAvg !== null && wPrev !== null ? Math.round((wAvg - wPrev) * 100) / 100 : null;
  const goal = WEIGHT_GOALS[p.weightGoal];

  const steps = avg(dates.map((d) => s.health[d]?.steps).filter((x): x is number => x !== undefined));

  // Force : records de la semaine, et exercices qui stagnent sur 4 semaines.
  const keys = new Set<string>();
  for (const d of dates) for (const k of Object.keys(s.days[d]?.sets ?? {})) keys.add(k);
  const prs: WeeklyReport['prs'] = [];
  const stalls: WeeklyReport['stalls'] = [];
  for (const key of keys) {
    const now = bestE1rm(s, key, monday, sunday);
    const before = bestE1rm(s, key, addDays(monday, -42), addDays(monday, -1));
    if (now === null) continue;
    if (before !== null && now > before * 1.005) {
      prs.push({ name: nameOf(s, key), text: tr('1RM estimé {n} → {n2} kg', { n: Math.round(before), n2: Math.round(now) }) });
    }
    const weeksDone = [1, 2, 3].filter((i) => bestE1rm(s, key, addDays(monday, -7 * i), addDays(monday, -7 * i + 6)) !== null).length;
    const peak4 = bestE1rm(s, key, addDays(monday, -28), addDays(monday, -1));
    if (weeksDone >= 3 && peak4 !== null && now <= peak4 * 1.005 && before !== null && now <= before) stalls.push({ key, name: nameOf(s, key) });
  }

  const advice = adviceFor(s, { monday, sessions, kcal, protein, change, steps, stalls, goal });
  const streak = streakInfo(s, ongoing ? today : addDays(sunday, 1))[ongoing ? 'current' : 'banked'];

  let headline: string;
  const sur = tn(sessions.planned, '{done} sur {n} prévue', '{done} sur {n} prévues', { done: tn(sessions.done, '{n} séance', '{n} séances') });
  if (ongoing && sessions.planned && sessions.done >= sessions.planned) headline = tr('Semaine en cours : {sur} jusqu’ici, tout est fait.', { sur });
  else if (ongoing) headline = tr('Semaine en cours : {sur} jusqu’ici.', { sur });
  else if (sessions.planned && sessions.done >= sessions.planned) headline = tr('Semaine complète : toutes les séances sont faites.');
  else if (sessions.done === 0) headline = tr('Semaine blanche côté entraînement. On relance cette semaine.');
  else headline = tr('{done} sur {planned}, {validated}.', { done: tn(sessions.done, '{n} séance', '{n} séances'), planned: sessions.planned, validated: tn(validated, '{n} journée validée', '{n} journées validées') });

  return {
    monday,
    sunday,
    days: dates.length,
    sessions,
    validated,
    streak,
    nutrition: { days: fed.length, kcal: kcal && Math.round(kcal), protein: protein && Math.round(protein), target: { kcal: p.targets.kcal, protein: p.targets.protein }, proteinDays },
    weight: { avg: wAvg && Math.round(wAvg * 10) / 10, prev: wPrev && Math.round(wPrev * 10) / 10, change, goal },
    steps: steps && Math.round(steps),
    training,
    prs: prs.slice(0, 5),
    stalls,
    advice,
    headline,
  };
}

function adviceFor(
  s: AppState,
  r: {
    monday: string;
    sessions: WeeklyReport['sessions'];
    kcal: number | null;
    protein: number | null;
    change: number | null;
    steps: number | null;
    stalls: WeeklyReport['stalls'];
    goal: { label: string; min: number; max: number };
  },
): Advice[] {
  const out: Advice[] = [];
  const p = s.settings;
  const gym = p.gym;
  const lastWeight = Object.entries(s.body.weight).sort(([a], [b]) => b.localeCompare(a))[0]?.[1];
  const bmi = lastWeight && p.height ? lastWeight / (p.height / 100) ** 2 : null;

  // Calories : la courbe de poids dit si l'objectif est le bon.
  if (r.change !== null && p.modules.nutrition) {
    const goalName = lower(r.goal.label);
    if (r.change > r.goal.max + 0.1) {
      out.push({
        id: 'kcal-down',
        title: tr('Poids au-dessus du rythme visé ({v}{n} kg)', { v: r.change > 0 ? '+' : '', n: formatNumber(r.change, 2) }),
        text: tr('Pour ta {goalName}, vise {n} à {n2} kg par semaine. Baisse de 150 kcal par jour, sur les glucides du soir.', { goalName, n: formatNumber(r.goal.min, 1), n2: formatNumber(r.goal.max, 1) }),
        tone: 'warn',
        action: { kind: 'kcal', delta: -150 },
      });
    } else if (r.change < r.goal.min - 0.15) {
      out.push({
        id: 'kcal-up',
        title: tr('Tu descends trop vite ({n} kg)', { n: formatNumber(r.change, 2) }),
        text: tr('Une perte trop rapide coûte du muscle et de l’énergie à la salle. Ajoute 150 kcal par jour.'),
        tone: 'warn',
        action: { kind: 'kcal', delta: 150 },
      });
    } else {
      out.push({ id: 'kcal-ok', title: tr('Rythme de poids dans la cible'), text: tr('{v}{n} kg sur la semaine : on garde les calories.', { v: r.change > 0 ? '+' : '', n: formatNumber(r.change, 2) }), tone: 'good' });
    }
  } else if (p.modules.weight) {
    out.push({ id: 'weigh', title: tr('Pèse-toi 3 fois par semaine'), text: tr('Le matin, à jeun : sans deux semaines de pesées, impossible d’ajuster les calories correctement.'), tone: 'info' });
  }

  if (r.protein !== null && r.protein < p.targets.protein * 0.9) {
    out.push({
      id: 'protein',
      title: tr('Protéines en dessous de l’objectif ({n} g sur {protein} g)', { n: Math.round(r.protein), protein: p.targets.protein }),
      text: tr('Ajoute une collation protéinée (skyr, fromage blanc, thon, shake) : c’est ce qui protège ton muscle.'),
      tone: 'warn',
    });
  }

  if (r.sessions.planned > 0 && r.sessions.done < r.sessions.planned - 1) {
    out.push({
      id: 'sessions',
      title: tr('{n} séances manquées', { n: r.sessions.planned - r.sessions.done }),
      text:
        r.sessions.planned > p.athlete.days
          ? tr('Ton programme demande {planned} séances alors que tu as dit en avoir {days} par semaine. Choisis un programme plus court dans Séance, Modifier le programme.', { planned: r.sessions.planned, days: p.athlete.days })
          : tr('Bloque tes créneaux dans ton agenda dès le dimanche soir, comme un rendez-vous.'),
      tone: 'warn',
    });
  }

  // Exercices qui stagnent : une variante faisable dans la salle.
  for (const st of r.stalls.slice(0, 2)) {
    const to = VARIATION[st.key];
    if (to && usable(to, gym)) {
      out.push({
        id: `swap-${st.key}`,
        title: tr('{name} stagne depuis 4 semaines', { name: st.name }),
        text: tr('Passe 4 à 6 semaines sur {nameOf} : nouvel angle, nouveau stimulus, puis reviens-y.', { nameOf: lower(nameOf(s, to)) }),
        tone: 'info',
        action: { kind: 'swap', from: st.key, to },
      });
    }
  }

  // Point faible de la fiche de force : un exercice en plus, absent du programme.
  if (p.modules.strength) {
    const prof = strengthProfile(s, addDays(r.monday, 6));
    const weak = prof.weakest;
    if (weak) {
      const inProgram = new Set(s.program.sessions.flatMap((x) => x.exercises.map((e) => e.key)));
      const pick = (BOOST[weak.id] ?? []).find((k) => !inProgram.has(k) && usable(k, gym));
      const group = GROUPS.find((g) => g.id === weak.id);
      const target = s.program.sessions.find((x) => x.type === 'lifting' && !x.generated && x.exercises.some((e) => group?.lifts.includes(e.key)))
        ?? s.program.sessions.find((x) => x.type === 'lifting');
      if (pick && target) {
        out.push({
          id: `boost-${weak.id}`,
          title: tr('Point faible : {name} ({grade})', { name: lower(weak.name), grade: weak.grade }),
          text: tr('Ajoute {nameOf} à ta séance {name}, 3 séries.', { nameOf: lower(nameOf(s, pick)), name: target.name }),
          tone: 'info',
          action: { kind: 'add-exercise', key: pick, session: target.id },
        });
      }
    }
  }

  // Corpulence : moins d'impact au-dessus de 30 d'IMC, plus de force en dessous de 20 en prise.
  if (bmi !== null && bmi >= 30 && p.athlete.sport !== 'running') {
    out.push({
      id: 'impact',
      title: tr('Cardio sans impact'),
      text: tr('Privilégie vélo, rameur et marche inclinée au footing : même dépense, articulations épargnées. Passe à la course quand tu seras sous 30 d’IMC.'),
      tone: 'info',
    });
  } else if (bmi !== null && bmi < 20 && p.weightGoal === 'bulk') {
    out.push({
      id: 'compounds',
      title: tr('Mise sur les gros mouvements'),
      text: tr('Squat, développé, tractions, rowing : 3 à 4 séries lourdes. Limite le cardio à 2 séances courtes pour garder tes calories pour la prise.'),
      tone: 'info',
    });
  }

  if (r.steps !== null && r.steps < 6000) {
    out.push({ id: 'steps', title: tr('{n} pas par jour en moyenne', { n: formatNumber(r.steps) }), text: tr('Vise 8 000 : 20 minutes de marche après le déjeuner suffisent.'), tone: 'info' });
  }

  return out;
}

/** Lundi de la dernière semaine terminée. */
export const lastWeekMonday = (today: string) => addDays(mondayOf(today), -7);

/** Le bilan est-il nouveau (semaine terminée et pas encore vu) ? */
export function reportPending(s: AppState, today: string): boolean {
  const m = lastWeekMonday(today);
  if (m < mondayOf(s.createdAt)) return false;
  return s.ui.reportSeen !== m;
}

/* ---------- Texte et mail ---------- */

export function reportText(s: AppState, r: WeeklyReport): string {
  const lines = [
    tr('Bilan Shred, semaine du {date} au {date2}', { date: formatShort(r.monday), date2: formatShort(r.sunday) }),
    r.headline,
    tr('Séances : {done}/{planned}. Journées validées : {validated}/{days}. Série : {streak} jours.', { done: r.sessions.done, planned: r.sessions.planned, validated: r.validated, days: r.days, streak: r.streak }),
  ];
  if (r.training.minutes > 0) {
    const h = Math.floor(r.training.minutes / 60);
    const min = String(r.training.minutes % 60).padStart(2, '0');
    const km = r.training.km.map((x) => `${lower(x.name)} ${formatNumber(x.km, 1)} km`);
    lines.push(km.length ? tr('Entraînement : {h} h {min}, dont {km}.', { h, min, km: list(km) }) : tr('Entraînement : {h} h {min}.', { h, min }));
  }
  if (r.nutrition.kcal !== null) lines.push(tr('Nutrition : {kcal} kcal et {protein} g de protéines par jour en moyenne (objectif {kcal2} kcal, {protein2} g).', { kcal: r.nutrition.kcal, protein: r.nutrition.protein, kcal2: r.nutrition.target.kcal, protein2: r.nutrition.target.protein }));
  if (r.weight.avg !== null) lines.push(tr('Poids moyen : {n} kg{v}.', { n: formatNumber(r.weight.avg, 1), v: r.weight.change !== null ? ` (${r.weight.change > 0 ? '+' : ''}${formatNumber(r.weight.change, 2)} kg)` : '' }));
  if (r.steps !== null) lines.push(tr('Pas : {n} par jour.', { n: formatNumber(r.steps) }));
  if (r.prs.length) lines.push(tr('Records : {join}.', { join: r.prs.map((x) => `${x.name} (${x.text})`).join(', ') }));
  if (r.advice.length) lines.push('', tr('Pour la semaine qui vient :'), ...r.advice.map((a) => `- ${a.title}. ${a.text}`));
  lines.push('', tr('Profil : {sportLabel}, objectif {label}. {athleteSummary}', { sportLabel: sportLabel(s.settings.athlete), label: lower(r.weight.goal.label), athleteSummary: athleteSummary(s.settings.athlete, s.settings.gym) }));
  return lines.join('\n');
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Mail simple, lisible partout (styles en ligne, une colonne, pas d'image). */
export function reportHtml(s: AppState, r: WeeklyReport, appUrl: string): string {
  const stat = (v: string, label: string) =>
    `<td style="padding:12px 8px;text-align:center;background:#f2f4fa;border-radius:12px"><div style="font-size:22px;font-weight:800;color:#0f1630">${esc(v)}</div><div style="font-size:12px;color:#4d5874">${esc(label)}</div></td>`;
  const rows = [
    stat(`${r.sessions.done}/${r.sessions.planned}`, tr('séances')),
    stat(`${r.validated}/${r.days}`, tr('jours validés')),
    stat(String(r.streak), tr('jours de série')),
  ].join('<td style="width:8px"></td>');
  const details: string[] = [];
  if (r.nutrition.kcal !== null) details.push(tr('<b>Nutrition</b> : {kcal} kcal et {protein} g de protéines par jour (objectif {kcal2} kcal, {protein2} g).', { kcal: r.nutrition.kcal, protein: r.nutrition.protein, kcal2: r.nutrition.target.kcal, protein2: r.nutrition.target.protein }));
  if (r.weight.avg !== null)
    details.push(
      r.weight.change !== null
        ? tr('<b>Poids</b> : {n} kg, {change} kg sur la semaine.', { n: formatNumber(r.weight.avg, 1), change: `${r.weight.change > 0 ? '+' : ''}${formatNumber(r.weight.change, 2)}` })
        : tr('<b>Poids</b> : {n} kg.', { n: formatNumber(r.weight.avg, 1) }),
    );
  if (r.steps !== null) details.push(tr('<b>Pas</b> : {n} par jour.', { n: formatNumber(r.steps) }));
  if (r.prs.length) details.push(tr('<b>Records</b> : {list}.', { list: r.prs.map((x) => `${esc(x.name)} (${esc(x.text)})`).join(', ') }));
  const advice = r.advice
    .map((a) => `<li style="margin:0 0 10px"><b>${esc(a.title)}</b><br><span style="color:#4d5874">${esc(a.text)}</span></li>`)
    .join('');
  // Le gabarit reste hors des traductions : seuls les textes passent par tr().
  return `<!doctype html><html lang="${lang()}"><body style="margin:0;background:#ffffff;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f1630">
<div style="max-width:520px;margin:0 auto;padding:24px 18px">
<div style="font-size:13px;color:#3563f0;font-weight:700;letter-spacing:.04em">SHRED · ${esc(tr('Bilan de la semaine').toLocaleUpperCase(loc()))}</div>
<h1 style="font-size:22px;margin:6px 0 4px">${esc(tr('Salut {name}', { name: s.settings.name || '' }).trim())}</h1>
<p style="margin:0 0 18px;color:#4d5874">${esc(tr('Du {from} au {to}.', { from: formatShort(r.monday), to: formatShort(r.sunday) }))} ${esc(r.headline)}</p>
<table role="presentation" style="width:100%;border-collapse:separate"><tr>${rows}</tr></table>
<div style="margin:18px 0;line-height:1.55">${details.map((x) => `<p style="margin:0 0 8px">${x}</p>`).join('')}</div>
${advice ? `<h2 style="font-size:17px;margin:20px 0 10px">${esc(tr('Pour la semaine qui vient'))}</h2><ul style="padding-left:18px;margin:0;line-height:1.5">${advice}</ul>` : ''}
<p style="margin:24px 0 0"><a href="${esc(appUrl)}" style="display:inline-block;background:#3563f0;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:12px">${esc(tr('Ouvrir Shred'))}</a></p>
<p style="margin:24px 0 0;font-size:12px;color:#8a93ab">${esc(tr('Tu reçois ce mail parce que tu l’as activé dans Réglages, Bilan de la semaine.'))}</p>
</div></body></html>`;
}
