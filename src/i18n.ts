// Langue de l'app : choisie dans Réglages, sinon celle du téléphone (navigator.languages), l'anglais pour une
// langue qu'on ne parle pas. Le dictionnaire de la langue est chargé à part, avant les écrans.
import { type Dict, isLang, type Lang, LANGS, pickLang, setLang } from '../shared/i18n';

const KEY = 'shred:lang';
const loaders = import.meta.glob<Dict>('./locales/*.json', { import: 'default' });

/** Le choix fait dans les réglages, ou « auto ». Gardé sur ce téléphone. */
export function savedLang(): Lang | 'auto' {
  try {
    const v = localStorage.getItem(KEY);
    return isLang(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** La langue du téléphone, avec sa région pour les dates et les nombres. */
export function deviceLang() {
  const prefs = typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : [];
  return pickLang(prefs.filter(Boolean));
}

export async function initLang(): Promise<void> {
  const choice = savedLang();
  const device = deviceLang();
  const lang = choice === 'auto' ? device.lang : choice;
  // La région du téléphone si elle va avec la langue choisie (en-US, pt-PT…), sinon la région par défaut.
  const locale = device.lang === lang ? device.locale : LANGS.find((l) => l.id === lang)!.locale;
  if (lang === 'fr') return void apply('fr', {}, locale);
  try {
    const load = loaders[`./locales/${lang}.json`];
    apply(lang, load ? await load() : {}, locale);
  } catch {
    // Premier lancement hors ligne sans le dictionnaire : l'app reste en français.
    apply('fr', {}, 'fr-FR');
  }
}

function apply(lang: Lang, dict: Dict, locale: string) {
  setLang(lang, dict, locale);
  document.documentElement.lang = lang;
}

/** Nouvelle langue : on recharge, les textes de l'app sont calculés au chargement. */
export function chooseLang(l: Lang | 'auto') {
  try {
    if (l === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, l);
  } catch {
    // Sans stockage, le choix ne tient que pour cette ouverture.
  }
  location.reload();
}
