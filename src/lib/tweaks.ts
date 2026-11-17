// Ajustements proposés par Pulse d'après tes séances : priorité qui manque de volume, exercice
// qui ne progresse plus, programme trop chargé pour ton rythme réel. Rien ne change sans ton accord.
import { catalogEntry, exerciseName } from '../../shared/catalog';
import { PATTERNS, type PatternId, programVolume, type Region, regionName, regionOf, targetsFor } from '../../shared/generator';
import { usable } from '../../shared/plans';
import { planWeek, scheduleFor } from '../../shared/program';
import { history } from './advisor';
import { strengthProfile } from './strength';
import { applyProgram, programFor } from './coaching';
import { addDays, dayKey, weekdayOf } from './date';
import { DELOAD_AFTER, DELOAD_MAX, isDeload, weeksInBlock } from './recovery';
import { startDeload } from './workoutActions';
import { alternatives } from './dynamic';
import { type AppState, getState, setState } from './store';
import { loc, lower, tn, tr } from '../../shared/i18n';

export type TweakAction =
  | { kind: 'add-set'; session: string; key: string }
  | { kind: 'add-exercise'; session: string; key: string }
  | { kind: 'swap'; from: string; to: string }
  | { kind: 'days'; days: number }
  | { kind: 'deload' }
  | { kind: 'next-block'; block: number };

export interface Tweak {
  id: string;
  title: string;
  text: string;
  cta: string;
  action: TweakAction;
}

/** Mouvement à ajouter quand une priorité manque de volume : peu fatigant, facile à caser. */
const ADD_PATTERN: Record<Region, PatternId> = {
  chest: 'chestIso', back: 'hpull', delts: 'lateral', rear: 'rear', biceps: 'biceps', triceps: 'triceps',
  quads: 'quadIso', posterior: 'hamIso', calves: 'calves', abs: 'abs', traps: 'traps', neck: 'neck',
};

/** Séances qui peuvent accueillir la zone : celles qui travaillent déjà des muscles voisins. */
const COMPAT: Record<Region, Region[]> = {
  chest: ['chest', 'triceps'], back: ['back', 'biceps', 'rear'], delts: ['delts', 'chest', 'back'], rear: ['back', 'rear', 'delts'],
  biceps: ['back', 'biceps'], triceps: ['chest', 'triceps'], quads: ['quads', 'posterior'], posterior: ['posterior', 'quads'],
  calves: ['quads', 'posterior', 'calves'], abs: ['abs', 'quads', 'posterior', 'back'], traps: ['back', 'traps', 'delts'], neck: ['back', 'delts', 'neck'],
};

const nameOf = (s: AppState, key: string) => exerciseName(key, s.customExercises);

/** Séries réellement faites par zone, moyenne par semaine sur les `weeks` dernières semaines. */
export function doneByRegion(s: AppState, today: string, weeks = 2): Partial<Record<Region, number>> {
  const from = addDays(today, -7 * weeks);
  const out: Partial<Record<Region, number>> = {};
  for (const [date, d] of Object.entries(s.days)) {
    if (date <= from || date > today) continue;
    for (const [key, logs] of Object.entries(d.sets)) {
      const e = catalogEntry(key, s.customExercises);
      if (!e || e.kind === 'cardio' || e.kind === 'task' || e.kind === 'power') continue;
      const r = regionOf(key, s.customExercises);
      const n = logs.filter((l) => l.done).length;
      if (r && n) out[r] = (out[r] ?? 0) + n;
    }
  }
  for (const k of Object.keys(out) as Region[]) out[k] = Math.round((out[k]! / weeks) * 10) / 10;
  return out;
}

/** Séances de muscu prévues et faites sur les `days` derniers jours. */
export function adherence(s: AppState, today: string, days = 21): { planned: number; done: number } {
  let planned = 0;
  let done = 0;
  for (let i = 1; i <= days; i++) {
    const date = addDays(today, -i);
    if (date < s.createdAt) break;
    const id = s.days[date]?.session ?? scheduleFor(s.program, date)[weekdayOf(date)];
    const def = s.program.sessions.find((x) => x.id === id);
    if (def?.type !== 'lifting') continue;
    planned++;
    if (s.days[date]?.mainDone) done++;
  }
  return { planned, done };
}

export function programTweaks(s: AppState, today: string): Tweak[] {
  const out: Tweak[] = [];
  const a = s.settings.athlete;
  const lifting = s.program.sessions.filter((x) => x.type === 'lifting' && s.program.schedule.includes(x.id));

  // 1. Une zone prioritaire qui reçoit trop peu de séries dans le programme.
  if (a.priorities?.length) {
    const targets = targetsFor(a);
    const planned = programVolume(s.program, s.customExercises);
    for (const r of a.priorities) {
      if (planned[r] >= targets[r] - 2) continue;
      const slot = lifting
        .flatMap((def) => def.exercises.filter((x) => regionOf(x.key, s.customExercises) === r).map((x) => ({ def, x })))
        .sort((p, q) => (p.x.sets ?? 3) - (q.x.sets ?? 3))[0];
      const missing = targets[r] - planned[r];
      if (slot && (slot.x.sets ?? 3) < 5 && missing <= 3) {
        out.push({
          id: `vol-${r}-${slot.x.key}`,
          title: tr('{regionName} : {planned} séries par semaine', { regionName: regionName(r), planned: planned[r] }),
          text: tr('C’est ta priorité, la cible est d’environ {targets}. Une série de plus sur {nameOf} ({name}) rapproche du compte.', { targets: targets[r], nameOf: lower(nameOf(s, slot.x.key)), name: slot.def.name }),
          cta: tr('Ajouter une série'),
          action: { kind: 'add-set', session: slot.def.id, key: slot.x.key },
        });
      } else {
        // Ajouter un mouvement de la zone dans une séance qui travaille déjà cette partie du corps.
        const pid = ADD_PATTERN[r];
        const keys = pid ? (PATTERNS[pid] as { keys: string[] }).keys : [];
        const compat = COMPAT[r];
        const host = lifting
          .filter((def) => def.exercises.some((x) => compat.includes(regionOf(x.key, s.customExercises) as Region)))
          .sort((p, q) => p.exercises.length - q.exercises.length)[0];
        const key = keys.find((k) => usable(k, s.settings.gym) && !host?.exercises.some((x) => x.key === k));
        if (host && key)
          out.push({
            id: `vol-${r}-add-${key}`,
            title: tr('{regionName} : {planned} séries par semaine', { regionName: regionName(r), planned: planned[r] }),
            text: tr('C’est ta priorité, la cible est d’environ {targets}. Ajoute {nameOf} à ta séance {name}.', { targets: targets[r], nameOf: lower(nameOf(s, key)), name: host.name }),
            cta: tr('Ajouter l’exercice'),
            action: { kind: 'add-exercise', session: host.id, key },
          });
      }
    }
  }

  // 2. Un exercice qui ne progresse plus depuis 6 séances : on change de variante.
  const inProgram = new Set(lifting.flatMap((x) => x.exercises.map((e) => e.key)));
  for (const key of inProgram) {
    const h = history(s, key, today, 7);
    if (h.length < 6) continue;
    const recent = Math.max(...h.slice(0, 3).map((o) => o.best));
    const before = Math.max(...h.slice(3, 6).map((o) => o.best));
    const older = h[6] ? h[6].best : before;
    if (recent > before * 1.01 || before > older * 1.02) continue;
    const alt = alternatives(s, key, today, [...inProgram]).find((x) => x.why === tr('Même mouvement')) ?? alternatives(s, key, today, [...inProgram])[0];
    if (!alt) continue;
    out.push({
      id: `stall-${key}`,
      title: tr('{nameOf} plafonne', { nameOf: nameOf(s, key) }),
      text: tr('Pas de record depuis {n} séances. Change de variante pour 4 à 6 semaines : {name} travaille les mêmes muscles sous un autre angle, puis reviens-y.', { n: h.length - 1, name: lower(alt.name) }),
      cta: tr('Changer de variante'),
      action: { kind: 'swap', from: key, to: alt.key },
    });
  }

  // 3. Le programme demande plus de séances que tu n'en fais vraiment.
  const adh = adherence(s, today);
  if (adh.planned >= 9 && adh.done / adh.planned < 0.65 && a.days >= 3) {
    const perWeek = Math.round((adh.done / adh.planned) * a.days * 10) / 10;
    out.push({
      id: `days-${a.days}`,
      title: tr('{done} séances sur {planned} ces 3 semaines', { done: adh.done, planned: adh.planned }),
      text: tr('Tu tiens environ {perWeek} séances par semaine. Un programme pensé pour {n} jours répartit mieux le volume qu’un {days} jours à moitié fait.', { perWeek: perWeek.toLocaleString(loc()), n: a.days - 1, days: a.days }),
      cta: tr('Passer à {n} jours', { n: a.days - 1 }),
      action: { kind: 'days', days: a.days - 1 },
    });
  }

  // 4. Une semaine de décharge après 6 à 8 semaines d'entraînement (les plans d'endurance ont déjà leurs semaines allégées).
  if (!isDeload(s, today) && !s.program.weeks?.length) {
    const weeks = weeksInBlock(s, today);
    const stalls = [...inProgram].filter((key) => {
      const h = history(s, key, today, 4);
      return h.length >= 4 && Math.max(...h.slice(0, 2).map((o) => o.best)) <= Math.max(...h.slice(2).map((o) => o.best)) * 1.005;
    }).length;
    if (weeks >= DELOAD_MAX || (weeks >= DELOAD_AFTER && stalls >= 2)) {
      out.unshift({
        id: `deload-${weeks}`,
        title: tr('{weeks} semaines d’entraînement sans pause', { weeks }),
        text: tr('{v}Une semaine de décharge (un tiers de séries en moins, charges −10 %) laisse le corps encaisser. Tu repars plus fort, sans perdre de muscle.', { v: stalls >= 2 ? tn(stalls, '{n} exercice plafonne. ', '{n} exercices plafonnent. ') : '' }),
        cta: tr('Commencer la décharge'),
        action: { kind: 'deload' },
      });
    }
  }

  // 5. Bloc d'endurance terminé : on enchaîne sur le suivant, un cran plus fort.
  const p = s.program;
  if (p.start && p.weeks?.length && !p.event && p.meta?.block && planWeek(p, today) === null && today >= addDays(p.start, p.weeks.length * 7)) {
    const next = p.meta.block + 1;
    out.unshift({
      id: `block-${next}-${p.start}`,
      title: tr('Bloc {block} terminé', { block: p.meta.block }),
      text: tr('{length} semaines bouclées. Le bloc {next} reprend la même structure avec un peu plus de volume : c’est comme ça qu’on progresse sans se blesser.', { length: p.weeks.length, next }),
      cta: tr('Lancer le bloc {next}', { next }),
      action: { kind: 'next-block', block: next },
    });
  }

  const dismissed = s.ui.dismissedTweaks ?? {};
  return out.filter((t) => !dismissed[t.id] || dismissed[t.id] < addDays(today, -14)).slice(0, 3);
}

export function applyTweak(t: Tweak, today = dayKey()): string {
  const action = t.action;
  if (action.kind === 'deload') {
    startDeload(today);
    return tr('Semaine de décharge lancée jusqu’à dimanche');
  }
  if (action.kind === 'next-block') {
    const s = getState();
    applyProgram(programFor(s.settings.athlete, s.settings.gym, today, s, action.block).program);
    return tr('Bloc {block} lancé : 8 nouvelles semaines', { block: action.block });
  }
  if (action.kind === 'days') {
    setState((d) => void (d.settings.athlete.days = action.days));
    const s = getState();
    applyProgram(programFor(s.settings.athlete, s.settings.gym).program);
    return tr('Programme reconstruit sur {days} jours. L’ancien est gardé dans Programme.', { days: action.days });
  }
  setState((d) => {
    if (action.kind === 'add-set') {
      const slot = d.program.sessions.find((x) => x.id === action.session)?.exercises.find((x) => x.key === action.key);
      if (slot) slot.sets = Math.min(6, (slot.sets ?? catalogEntry(slot.key, d.customExercises)?.defaults.sets ?? 3) + 1);
    } else if (action.kind === 'add-exercise') {
      const def = d.program.sessions.find((x) => x.id === action.session);
      if (def && !def.exercises.some((x) => x.key === action.key)) def.exercises.push({ key: action.key, sets: 3 });
    } else if (action.kind === 'swap') {
      for (const def of d.program.sessions) for (const x of def.exercises) if (x.key === action.from) x.key = action.to;
    }
  });
  return tr('Programme ajusté');
}

export function dismissTweak(id: string, today: string) {
  setState((d) => void ((d.ui.dismissedTweaks ??= {})[id] = today));
}

/** Zones à prioriser d'après tes données : point faible en force, puis zones les moins travaillées. */
export function suggestPriorities(s: AppState, today: string): Region[] {
  const out: Region[] = [];
  const weakMap: Record<string, Region> = { chest: 'chest', shoulders: 'delts', arms: 'biceps', back: 'back', quads: 'quads', hamstrings: 'posterior' };
  const weak = strengthProfile(s, today).weakest;
  if (weak && weakMap[weak.id]) out.push(weakMap[weak.id]);
  const done = doneByRegion(s, today, 3);
  if (Object.keys(done).length) {
    const targets = targetsFor(s.settings.athlete);
    const big: Region[] = ['chest', 'back', 'delts', 'quads', 'posterior', 'abs'];
    const low = big.filter((r) => !out.includes(r)).sort((x, y) => (done[x] ?? 0) / targets[x] - (done[y] ?? 0) / targets[y]);
    for (const r of low) if (out.length < 2 && (done[r] ?? 0) < targets[r] * 0.7) out.push(r);
  }
  return out;
}
