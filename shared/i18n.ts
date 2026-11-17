// Traductions. Le texte français sert de clé : tr('Lancer le défi') rend sa traduction dans la langue choisie, ou le
// français tant qu'elle manque. Les variables s'écrivent {nom} ; les pluriels passent par tn(n, forme1, formeN), qui
// applique les règles de la langue (en français, 0 et 1 sont au singulier). Dates, nombres et listes suivent la
// locale de la personne.
// L'app choisit sa langue une fois au démarrage (setLang), avant de charger ses écrans. Le serveur, qui répond à des
// personnes de langues différentes en même temps, passe la langue à chaque appel (translate).

export type Lang = 'fr' | 'en' | 'es' | 'pt' | 'de' | 'it';

/** Les langues proposées, chacune écrite dans sa propre langue. */
export const LANGS: { id: Lang; name: string; locale: string }[] = [
  { id: 'fr', name: 'Français', locale: 'fr-FR' },
  { id: 'en', name: 'English', locale: 'en-GB' },
  { id: 'es', name: 'Español', locale: 'es-ES' },
  { id: 'pt', name: 'Português', locale: 'pt-BR' },
  { id: 'de', name: 'Deutsch', locale: 'de-DE' },
  { id: 'it', name: 'Italiano', locale: 'it-IT' },
];

export const isLang = (x: unknown): x is Lang => typeof x === 'string' && LANGS.some((l) => l.id === x);

/** Une traduction : un texte, ou ses deux formes de pluriel. */
export type Entry = string | { one: string; other: string };
export type Dict = Record<string, Entry>;
export type Vars = Record<string, string | number | null | undefined>;

/**
 * La langue d'une liste de préférences (navigator.languages, Accept-Language) : la première qu'on parle, avec sa
 * région quand elle est connue (en-US écrit les dates à l'américaine). Sinon l'anglais.
 */
export function pickLang(prefs: readonly string[]): { lang: Lang; locale: string } {
  for (const p of prefs) {
    const base = p.toLowerCase().split(/[-_]/)[0];
    const hit = LANGS.find((l) => l.id === base);
    if (hit) return { lang: hit.id, locale: /^[a-z]{2}[-_][A-Za-z]{2}$/.test(p) ? p.replace('_', '-') : hit.locale };
  }
  return { lang: 'en', locale: 'en-GB' };
}

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k] ?? '') : m)) : s);

/** Traduction avec une langue et un dictionnaire donnés (serveur). */
export function translate(dict: Dict | undefined, fr: string, vars?: Vars): string {
  const e = dict?.[fr];
  return fill(typeof e === 'string' ? e : (e?.other ?? fr), vars);
}

const rulesCache = new Map<string, Intl.PluralRules>();
const rules = (locale: string) => {
  let r = rulesCache.get(locale);
  if (!r) rulesCache.set(locale, (r = new Intl.PluralRules(locale)));
  return r;
};

/** Pluriel avec une langue et un dictionnaire donnés (serveur). */
export function translatePlural(dict: Dict | undefined, locale: string, n: number, one: string, other: string, vars?: Vars): string {
  const e = dict?.[other] ?? dict?.[one];
  const forms = !e ? { one, other } : typeof e === 'string' ? { one: e, other: e } : e;
  return fill(rules(locale).select(n) === 'one' ? forms.one : forms.other, { n, ...vars });
}

/* ---------- Langue de l'app ---------- */

let current: Lang = 'fr';
let locale = 'fr-FR';
let dict: Dict = {};

/** Langue de l'app, choisie au démarrage. */
export function setLang(l: Lang, d: Dict = {}, loc?: string) {
  current = l;
  dict = l === 'fr' ? {} : d;
  locale = loc ?? LANGS.find((x) => x.id === l)!.locale;
}

export const lang = () => current;
/** Locale pour Intl (« fr-FR », « en-US »…). */
export const loc = () => locale;

export function tr(fr: string, vars?: Vars): string {
  return current === 'fr' ? fill(fr, vars) : translate(dict, fr, vars);
}

/** Pluriel : les deux formes françaises (« {n} séance », « {n} séances »), {n} vaut le nombre. */
export function tn(n: number, one: string, other: string, vars?: Vars): string {
  return translatePlural(current === 'fr' ? undefined : dict, locale, n, one, other, vars);
}

/* ---------- Formats ---------- */

const fmtCache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.ListFormat>();
function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.ListFormat>(kind: string, opts: object, make: () => T): T {
  const k = `${kind}|${locale}|${JSON.stringify(opts)}`;
  let f = fmtCache.get(k) as T | undefined;
  if (!f) fmtCache.set(k, (f = make()));
  return f;
}

/** Un nombre dans la locale de la personne (1 250 ou 1,250 ; 2,5 ou 2.5). */
export function num(n: number, digits = 0, max = digits): string {
  const opts = { minimumFractionDigits: digits, maximumFractionDigits: max };
  return cached('n', opts, () => new Intl.NumberFormat(locale, opts)).format(n);
}

/** Un pourcentage à la façon de la langue : « 12 % » en français, « 12% » en anglais. `n` est déjà en pourcents. */
export function pct(n: number, digits = 0): string {
  const opts = { style: 'percent', maximumFractionDigits: digits } as const;
  return cached('p', opts, () => new Intl.NumberFormat(locale, opts)).format(n / 100);
}

/** Une date dans la locale de la personne. */
export function date(d: Date, opts: Intl.DateTimeFormatOptions): string {
  return cached('d', opts, () => new Intl.DateTimeFormat(locale, opts)).format(d);
}

/** « a, b et c », « a, b and c ». */
export function list(items: string[], type: 'conjunction' | 'disjunction' = 'conjunction'): string {
  if (items.length < 2) return items[0] ?? '';
  return cached('l', { type }, () => new Intl.ListFormat(locale, { type, style: 'long' })).format(items);
}

/** La première lettre en majuscule, selon la langue. */
export const capital = (s: string) => (s ? s.charAt(0).toLocaleUpperCase(locale) + s.slice(1) : s);

/** Un nom au milieu d'une phrase : en minuscule, sauf en allemand où les noms gardent leur majuscule. */
export const lower = (s: string | null | undefined): string => (!s ? '' : current === 'de' ? s : s.toLocaleLowerCase(locale));
