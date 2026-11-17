// Profil public : l'app calcule un petit résumé (seulement les champs cochés) et l'envoie quand il change.
import { api, DEMO } from './api';
import { addDays, dayKey, mondayOf } from './date';
import { flameInfo } from './flames';
import { levelFor, totalXp } from './logic';
import { signedIn } from './session';
import { type AppState, getState, subscribe } from './store';
import { strengthProfile } from './strength';

export interface RadarPoint {
  id: string;
  name: string;
  short: string;
  grade: string | null;
  score: number | null;
}

export interface PublicData {
  streak?: number;
  best?: number;
  flames?: number;
  tier?: number;
  level?: number;
  radar?: RadarPoint[];
  program?: string;
}

export interface PublicProfile extends PublicData {
  id: string;
  name: string;
  me: boolean;
  updatedAt: string | null;
}

export function publicData(s: AppState, today: string): PublicData {
  const show = s.settings.profile.show;
  const f = flameInfo(s, today);
  const d: PublicData = {};
  if (show.streak) d.streak = f.current;
  if (show.best) d.best = f.best;
  if (show.flames) {
    d.flames = f.earned.length;
    d.tier = f.tier;
  }
  if (show.level) d.level = levelFor(totalXp(s)).level;
  if (show.radar && s.settings.modules.strength) {
    const groups = strengthProfile(s, today).groups;
    // Pas encore de séance notée : rien à montrer.
    if (groups.some((g) => g.score !== null)) {
      d.radar = groups.map((g) => ({ id: g.id, name: g.name, short: g.short, grade: g.grade, score: g.score }));
    }
  }
  if (show.program) d.program = s.program.name;
  return d;
}

const SENT_KEY = 'shred:profile-sent';
let timer: ReturnType<typeof setTimeout> | undefined;

function lastSent(): string {
  try {
    return localStorage.getItem(SENT_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Chiffres de la semaine pour le classement du club (vus seulement par tes abonnés). */
export interface BoardData {
  weekOf: string;
  week: number;
  volume: number;
  streak: number;
  /** Jours de la semaine avec une séance validée : bit 0 = lundi … bit 6 = dimanche. */
  days: number;
}

export function boardData(s: AppState, today: string): BoardData {
  const monday = mondayOf(today);
  let week = 0;
  let volume = 0;
  let days = 0;
  for (let i = 0; i < 7; i++) {
    const day = s.days[addDays(monday, i)];
    if (!day) continue;
    if (day.mainDone) {
      week++;
      days |= 1 << i;
    }
    for (const logs of Object.values(day.sets)) for (const l of logs) if (l.done && l.w && l.r) volume += l.w * l.r;
  }
  return { weekOf: monday, week, volume: Math.round(volume), streak: flameInfo(s, today).current, days };
}

/** Envoie le profil s'il a changé depuis le dernier envoi. */
export async function publishProfile(force = false): Promise<void> {
  if (DEMO || !signedIn()) return;
  const s = getState();
  const visible = s.settings.profile.visible;
  const board = s.settings.profile.board !== false ? boardData(s, dayKey()) : undefined;
  const body = { visible, data: visible ? publicData(s, dayKey()) : undefined, board };
  const text = JSON.stringify(body);
  if (!force && text === lastSent()) return;
  await api('/api/profile', { method: 'PUT', body });
  try {
    localStorage.setItem(SENT_KEY, text);
  } catch {
    // Sans stockage, on renverra simplement la prochaine fois.
  }
}

export function forgetPublishedProfile() {
  try {
    localStorage.removeItem(SENT_KEY);
  } catch {
    // Rien à oublier.
  }
}

/** Publie au démarrage, au retour dans l'app, et une demi-minute après un changement. */
export function startProfileSync() {
  if (DEMO) return;
  const later = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void publishProfile().catch(() => undefined), ms);
  };
  subscribe(() => later(30_000));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') later(2_000);
  });
  later(3_000);
}

export async function fetchProfiles(): Promise<PublicProfile[]> {
  if (DEMO) return demoProfiles();
  const { profiles } = await api<{ profiles: PublicProfile[] }>('/api/profiles');
  return profiles;
}

function demoProfiles(): PublicProfile[] {
  const radar = (grades: (string | null)[]): RadarPoint[] =>
    [
      ['chest', 'Pecs', 'Pecs'],
      ['shoulders', 'Épaules', 'Épaules'],
      ['arms', 'Bras', 'Bras'],
      ['hamstrings', 'Ischios', 'Ischios'],
      ['quads', 'Quadriceps', 'Quadri'],
      ['back', 'Dos', 'Dos'],
    ].map(([id, name, short], i) => ({ id, name, short, grade: grades[i], score: grades[i] ? 5 - 'ABCDE'.indexOf(grades[i]!) - 0.5 : null }));
  return [
    { id: 'demo-ines', name: 'Inès', me: false, updatedAt: null, streak: 23, best: 31, flames: 4, tier: 4, level: 9, program: 'Upper / Lower', radar: radar(['C', 'B', 'C', 'B', 'A', 'B']) },
    { id: 'demo-yanis', name: 'Yanis', me: false, updatedAt: null, streak: 9, best: 15, flames: 2, tier: 2, level: 6, program: 'PPL', radar: radar(['B', 'C', 'B', 'D', 'C', 'B']) },
    { id: 'demo-lucas', name: 'Lucas', me: false, updatedAt: null, streak: 2, best: 8, flames: 1, tier: 1, level: 3, program: 'Full body' },
  ];
}
