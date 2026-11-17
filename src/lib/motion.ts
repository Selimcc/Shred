// Le mouvement de l'app, au même endroit : l'entrée des blocs d'un écran, la pastille qui glisse sous le choix
// d'un contrôle segmenté, et l'état « une feuille est ouverte » (le décor des fêtes se met en pause dessous).
// Rien ne bouge si l'utilisateur a demandé moins d'animations.

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Entrée des blocs ---------- */

/** `up` : ouverture de l'app ; `fwd` / `back` : onglet suivant ou précédent dans la barre. */
export type EnterDir = 'up' | 'fwd' | 'back';

/**
 * Les blocs visibles d'un écran arrivent l'un après l'autre (34 ms d'écart, huit au plus), du côté où l'on va ;
 * ceux qui sont hors de l'écran sont simplement là quand on y descend. À appeler juste après le rendu de l'écran,
 * avant qu'il soit peint (useLayoutEffect).
 */
export function enterBlocks(root: HTMLElement | null, dir: EnterDir) {
  if (!root) return;
  const still = reducedMotion();
  const vh = window.innerHeight;
  let k = 0;
  for (const el of Array.from(root.children) as HTMLElement[]) {
    if (still) {
      el.dataset.in = 'still';
      continue;
    }
    const r = el.getBoundingClientRect();
    const visible = r.bottom > 0 && r.top < vh && r.height > 0;
    el.dataset.in = visible ? dir : 'still';
    if (visible) el.style.setProperty('--in-d', `${Math.min(k++, 8) * 34}ms`);
  }
}

/* ---------- Contrôles segmentés : une pastille qui glisse ---------- */

function placeThumb(seg: HTMLElement) {
  const on = seg.querySelector<HTMLElement>(':scope > .on');
  if (!on || !on.offsetWidth) {
    delete seg.dataset.glide;
    return;
  }
  seg.style.setProperty('--glide-x', `${on.offsetLeft}px`);
  seg.style.setProperty('--glide-y', `${on.offsetTop}px`);
  seg.style.setProperty('--glide-w', `${on.offsetWidth}px`);
  seg.style.setProperty('--glide-h', `${on.offsetHeight}px`);
  if (seg.dataset.glide === undefined) {
    // Première pose sans glisser, puis la pastille suit chaque choix.
    seg.dataset.glide = '';
    requestAnimationFrame(() => requestAnimationFrame(() => seg.isConnected && (seg.dataset.glide = 'ready')));
  }
}

/**
 * Tous les `.seg` de l'app, présents et à venir : la pastille suit le bouton `.on`, et se recale si la largeur
 * change (rotation, police chargée). Un seul observateur pour toute la page.
 */
export function startGlide() {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
  const sized = new WeakSet<HTMLElement>();
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((list) => list.forEach((e) => placeThumb(e.target as HTMLElement)));
  const track = (seg: HTMLElement) => {
    if (resize && !sized.has(seg)) {
      sized.add(seg);
      resize.observe(seg);
    }
    placeThumb(seg);
  };
  document.querySelectorAll<HTMLElement>('.seg').forEach(track);
  new MutationObserver((records) => {
    const todo = new Set<HTMLElement>();
    for (const r of records) {
      if (r.type === 'attributes') {
        const seg = (r.target as HTMLElement).parentElement;
        if (seg?.classList.contains('seg')) todo.add(seg);
        continue;
      }
      r.addedNodes.forEach((n) => {
        if (!(n instanceof HTMLElement)) return;
        if (n.classList.contains('seg')) todo.add(n);
        else if (n.parentElement?.classList.contains('seg')) todo.add(n.parentElement);
        else n.querySelectorAll<HTMLElement>('.seg').forEach((s) => todo.add(s));
      });
    }
    todo.forEach(track);
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
}

/* ---------- Une feuille ou un plein écran est ouvert ---------- */

let overlays = 0;

/** Bloque le défilement derrière, et signale au décor des fêtes qu'il peut se mettre en pause. */
export function holdOverlay(): () => void {
  overlays += 1;
  document.body.style.overflow = 'hidden';
  document.documentElement.dataset.overlay = '';
  let done = false;
  return () => {
    if (done) return;
    done = true;
    overlays -= 1;
    if (overlays === 0) {
      document.body.style.overflow = '';
      delete document.documentElement.dataset.overlay;
    }
  };
}
