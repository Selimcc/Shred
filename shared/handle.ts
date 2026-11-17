import { tr } from './i18n';
// Règles du @pseudo, partagées par l'app (vérification instantanée) et le serveur (qui décide).
export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;
export const NICK_MAX = 30;
export const BIO_MAX = 160;

const RESERVED = new Set([
  'admin',
  'administrateur',
  'root',
  'shred',
  'shredapp',
  'support',
  'aide',
  'help',
  'coach',
  'moderateur',
  'moderation',
  'modo',
  'staff',
  'equipe',
  'team',
  'officiel',
  'official',
  'system',
  'systeme',
  'api',
  'null',
  'undefined',
  'anonyme',
  'anonymous',
  'anthropic',
  'security',
  'securite',
  'contact',
  'invite',
  'invitation',
  'compte',
  'account',
  'login',
  'settings',
]);

const RESERVED_SK = () => [...RESERVED].map(skeleton);

/** Retire les accents et met en minuscules : « Élodie » → « elodie ». */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Pseudo saisi → forme canonique (sans @, en minuscules). */
export const normHandle = (raw: unknown) =>
  fold(
    String(raw ?? '')
      .trim()
      .replace(/^@+/, ''),
  );

/** Pourquoi ce pseudo n'est pas valable, ou null s'il l'est (sans regarder s'il est pris). */
export function handleProblem(h: string): string | null {
  if (h.length < HANDLE_MIN) return tr('Au moins {HANDLE_MIN} caractères', { HANDLE_MIN });
  if (h.length > HANDLE_MAX) return tr('{HANDLE_MAX} caractères maximum', { HANDLE_MAX });
  if (!/^[a-z0-9._]+$/.test(h)) return tr('Lettres sans accent, chiffres, point et tiret bas seulement');
  if (!/^[a-z]/.test(h)) return tr('Commence par une lettre');
  if (/[._]$/.test(h)) return tr('Ne termine pas par un point ou un tiret bas');
  if (/[._]{2}/.test(h)) return tr('Pas deux points ou tirets bas à la suite');
  const sk = skeleton(h);
  if (RESERVED_SK().some((r) => sk === r || (r.length >= 5 && sk.startsWith(r)))) return tr('Ce pseudo est réservé');
  return null;
}

/** Forme « squelette » pour repérer les sosies : se1im, s.e.l.i.m et selim donnent la même. */
export function skeleton(h: string): string {
  return h
    .replace(/[._]/g, '')
    .replace(/0/g, 'o')
    .replace(/[1!|i]/g, 'l')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/8/g, 'b')
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w');
}
