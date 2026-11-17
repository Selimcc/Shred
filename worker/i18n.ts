// Textes du serveur dans la langue de la personne. Erreurs : la langue de la requête (en-tête X-Shred-Lang de l'app,
// sinon Accept-Language). Notifications : la langue de la personne qui les reçoit, retenue quand son app appelle le
// serveur. Le texte français sert de clé, comme dans l'app ; say('…') marque un texte à traduire plus loin.
import { type Dict, isLang, type Lang, LANGS, pickLang, translate, translatePlural, type Vars } from '../shared/i18n';
import de from './locales/de.json';
import en from './locales/en.json';
import es from './locales/es.json';
import it from './locales/it.json';
import pt from './locales/pt.json';
import type { Store } from './users';

const DICTS: Partial<Record<Lang, Dict>> = { en, es, pt, de, it };

export type { Lang, Vars };

/** Marque un texte que le serveur traduira au moment de l'envoyer (notification, page). */
export const say = (fr: string) => fr;

export function tx(lang: Lang, fr: string, vars?: Vars): string {
  return translate(lang === 'fr' ? undefined : DICTS[lang], fr, vars);
}

export function txn(lang: Lang, n: number, one: string, other: string, vars?: Vars): string {
  return translatePlural(lang === 'fr' ? undefined : DICTS[lang], LANGS.find((l) => l.id === lang)!.locale, n, one, other, vars);
}

/** La langue d'une requête : celle de l'app, sinon celle du navigateur, sinon le français (apps d'avant la 0.31). */
export function requestLang(req: Request): Lang {
  const h = req.headers.get('x-shred-lang');
  if (isLang(h)) return h;
  const accept = req.headers.get('accept-language');
  if (accept) return pickLang(accept.split(',').map((x) => x.split(';')[0].trim())).lang;
  return 'fr';
}

/** Langue retenue de chaque compte, pour ne relire KV qu'une fois par instance. */
const known = new Map<string, Lang>();

/** L'app dit dans quelle langue elle tourne : on la retient pour les notifications (écrite seulement quand elle change). */
export async function rememberLang(userId: string, store: Store, req: Request): Promise<void> {
  const l = req.headers.get('x-shred-lang');
  if (!isLang(l) || known.get(userId) === l) return;
  const stored = await store.get('lang');
  if (stored !== l) await store.put('lang', l);
  known.set(userId, l);
}

/** La langue d'une personne pour lui écrire (notification), le français si on ne la connaît pas. */
export async function langOf(userId: string, store: Pick<Store, 'get'>): Promise<Lang> {
  const k = known.get(userId);
  if (k) return k;
  const stored = await store.get('lang');
  const l = isLang(stored) ? stored : 'fr';
  known.set(userId, l);
  return l;
}
