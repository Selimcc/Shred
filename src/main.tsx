// Démarrage : la langue d'abord (choisie dans les réglages, sinon celle du téléphone), puis l'app. Ses textes sont
// traduits au chargement de chaque module, donc après ce choix.
import { initLang } from './i18n';

void initLang().then(() => import('./boot'));
