// Ajustements proposés par Pulse d'après tes séances : priorité qui manque de volume, exercice
// qui ne progresse plus, programme trop chargé pour ton rythme réel. Rien ne change sans ton accord.
import { catalogEntry } from '../../shared/catalog';
import { PATTERNS, type PatternId, programVolume, type Region, regionName, regionOf, targetsFor } from '../../shared/generator';
import { usable } from '../../shared/plans';
import { scheduleFor } from '../../shared/program';
import { history } from './advisor';
import { strengthProfile } from './strength';
import { applyProgram, programFor } from './coaching';
import { addDays, weekdayOf } from './date';
import { alternatives } from './dynamic';
import { type AppState, getState, setState } from './store';

export type TweakAction =
  | { kind: 'add-set'; session: string; key: string }
  | { kind: 'add-exercise'; session: string; key: string }
  | { kind: 'swap'; from: string; to: string }
  | { kind: 'days'; days: number };

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

const nameOf = (s: AppState, key: string) => catalogEntry(key, s.customExercises)?.name ?? key;

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
          title: `${regionName(r)} : ${planned[r]} séries par semaine`,
          text: `C’est ta priorité, la cible est d’environ ${targets[r]}. Une série de plus sur ${nameOf(s, slot.x.key).toLowerCase()} (${slot.def.name}) rapproche du compte.`,
          cta: 'Ajouter une série',
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
            title: `${regionName(r)} : ${planned[r]} séries par semaine`,
            text: `C’est ta priorité, la cible est d’environ ${targets[r]}. Ajoute ${nameOf(s, key).toLowerCase()} à ta séance ${host.name}.`,
            cta: 'Ajouter l’exercice',
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
    const alt = alternatives(s, key, today, [...inProgram]).find((x) => x.why === 'Même mouvement') ?? alternatives(s, key, today, [...inProgram])[0];
    if (!alt) continue;
    out.push({
      id: `stall-${key}`,
      title: `${nameOf(s, key)} plafonne`,
      text: `Pas de record depuis ${h.length - 1} séances. Change de variante pour 4 à 6 semaines : ${alt.name.toLowerCase()} travaille les mêmes muscles sous un autre angle, puis reviens-y.`,
      cta: 'Changer de variante',
      action: { kind: 'swap', from: key, to: alt.key },
    });
  }

  // 3. Le programme demande plus de séances que tu n'en fais vraiment.
  const adh = adherence(s, today);
  if (adh.planned >= 9 && adh.done / adh.planned < 0.65 && a.days >= 3) {
    const perWeek = Math.round((adh.done / adh.planned) * a.days * 10) / 10;
    out.push({
      id: `days-${a.days}`,
      title: `${adh.done} séances sur ${adh.planned} ces 3 semaines`,
      text: `Tu tiens environ ${perWeek.toLocaleString('fr-FR')} séances par semaine. Un programme pensé pour ${a.days - 1} jours répartit mieux le volume qu’un ${a.days} jours à moitié fait.`,
      cta: `Passer à ${a.days - 1} jours`,
      action: { kind: 'days', days: a.days - 1 },
    });
  }

  const dismissed = s.ui.dismissedTweaks ?? {};
  return out.filter((t) => !dismissed[t.id] || dismissed[t.id] < addDays(today, -14)).slice(0, 3);
}

export function applyTweak(t: Tweak): string {
  const action = t.action;
  if (action.kind === 'days') {
    setState((d) => void (d.settings.athlete.days = action.days));
    const s = getState();
    applyProgram(programFor(s.settings.athlete, s.settings.gym).program);
    return `Programme reconstruit sur ${action.days} jours. L’ancien est gardé dans Programme.`;
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
  return 'Programme ajusté';
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
