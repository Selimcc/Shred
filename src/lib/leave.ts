// Animation de sortie, quel que soit le chemin qui ferme l'élément (bouton, fond, programme) : au moment où il
// quitte la page, une copie inerte prend sa place et s'efface en douceur, puis disparaît. Court (≈ 0,2 s) :
// on voit que l'élément est parti, sans attendre.

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function leave(el: HTMLElement | null, cls: string, ms = 220, scrollers: { selector: string; top: number }[] = []) {
  if (!el || reduced() || typeof document === 'undefined') return;
  const ghost = el.cloneNode(true) as HTMLElement;
  // Une copie ne doit rien rejouer ni rien recevoir.
  ghost.querySelectorAll('iframe, audio, video, input, textarea, select').forEach((n) => {
    if (n.tagName === 'IFRAME' || n.tagName === 'AUDIO' || n.tagName === 'VIDEO') n.remove();
    else (n as HTMLInputElement).disabled = true;
  });
  ghost.removeAttribute('id');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.style.pointerEvents = 'none';
  ghost.classList.add('leaving', cls);
  document.body.appendChild(ghost);
  for (const s of scrollers) {
    const n = ghost.matches(s.selector) ? ghost : ghost.querySelector<HTMLElement>(s.selector);
    if (n) n.scrollTop = s.top;
  }
  const done = () => ghost.remove();
  // Seule l'animation de la copie elle-même compte (pas celle d'un ::before ni d'un enfant).
  ghost.addEventListener('animationend', (e) => e.target === ghost && !e.pseudoElement && done());
  setTimeout(done, ms + 120);
}

/** Pour un élément posé dans le flux (toast, bandeau) : la copie garde sa position à l'écran. */
export function leaveInPlace(el: HTMLElement | null, cls: string, ms = 200) {
  if (!el || reduced()) return;
  const r = el.getBoundingClientRect();
  if (!r.width) return;
  const ghost = el.cloneNode(true) as HTMLElement;
  Object.assign(ghost.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, margin: '0', pointerEvents: 'none', transform: 'none' });
  ghost.setAttribute('aria-hidden', 'true');
  ghost.classList.add('leaving', cls);
  document.body.appendChild(ghost);
  ghost.addEventListener('animationend', (e) => e.target === ghost && !e.pseudoElement && ghost.remove());
  setTimeout(() => ghost.remove(), ms + 120);
}
