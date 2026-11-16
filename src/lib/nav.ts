// Passage d'une page à l'autre dans une feuille (réglages) : la nouvelle page glisse depuis la droite, l'ancienne
// part vers la gauche en s'effaçant ; au retour, l'inverse. Avec l'API View Transitions (Safari 18, Chrome),
// les deux pages bougent en même temps ; sinon, seule la nouvelle entre en glissant.
import { flushSync } from 'react-dom';

export type NavDir = 'forward' | 'back';

type VTDocument = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const canMorph = () => typeof document !== 'undefined' && typeof (document as VTDocument).startViewTransition === 'function' && !reduced();

export function navigate(update: () => void, dir: NavDir) {
  const doc = document as VTDocument;
  if (!canMorph()) return update();
  const root = document.documentElement;
  root.dataset.nav = dir;
  try {
    const t = doc.startViewTransition!(() => flushSync(update));
    void t.finished.finally(() => {
      if (root.dataset.nav === dir) delete root.dataset.nav;
    });
  } catch {
    delete root.dataset.nav;
    update();
  }
}
