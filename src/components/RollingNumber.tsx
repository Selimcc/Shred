// Chiffres qui roulent jusqu'à leur valeur, avec un flou de mouvement pendant la course (comme un compteur
// mécanique). Chaque chiffre a sa colonne 0-9 ; les lettres et séparateurs restent fixes. Sans animation si
// l'appareil demande moins de mouvement.
import { useLayoutEffect, useRef } from 'react';

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

function Column({ digit, index, first }: { digit: number; index: number; first: boolean }) {
  const col = useRef<HTMLSpanElement>(null);
  const strip = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = strip.current;
    if (!el) return;
    const to = `translateY(${-digit * 10}%)`;
    const from = shown.current;
    shown.current = digit;
    if (reduced() || typeof el.animate !== 'function' || from === digit) {
      el.style.transform = to;
      return;
    }
    // Premier affichage : on part de 0. Ensuite : de l'ancien chiffre au nouveau.
    const start = from ?? 0;
    const distance = Math.abs(digit - start);
    const duration = 650 + Math.min(9, distance) * 45 + (first ? 120 : 0);
    // Flou vertical pendant la course, bords fondus le temps du roulement seulement.
    col.current?.classList.add('rolling');
    const anim = el.animate(
      [
        { transform: `translateY(${-start * 10}%)`, filter: 'blur(0px)' },
        { filter: `blur(${Math.min(4, 1.4 + distance * 0.4)}px)`, offset: 0.35 },
        { transform: to, filter: 'blur(0px)' },
      ],
      { duration, delay: index * 55, easing: 'cubic-bezier(0.2, 0.9, 0.25, 1)', fill: 'both' },
    );
    anim.onfinish = anim.oncancel = () => col.current?.classList.remove('rolling');
    el.style.transform = to;
  }, [digit, index, first]);
  return (
    <span className="roll-col" ref={col}>
      <span className="roll-strip" ref={strip}>
        {DIGITS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </span>
    </span>
  );
}

/**
 * @param value  le nombre à afficher
 * @param format sa mise en forme (« 4 h 35 », « 6 240 », « 9,6 ») : seuls les chiffres roulent
 */
export function RollingNumber({ value, format = (n) => String(Math.round(n)), className }: { value: number; format?: (n: number) => string; className?: string }) {
  const text = format(value);
  const chars = [...text];
  // Les colonnes sont repérées depuis la droite : 99 → 100 garde les unités à leur place.
  const digitsTotal = chars.filter((c) => c >= '0' && c <= '9').length;
  let seen = 0;
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
  }, []);
  // Le texte invisible donne la largeur et la ligne de base exactes ; les colonnes roulent par-dessus.
  return (
    <span className={`roll ${className ?? ''}`}>
      <span className="roll-ghost">{text}</span>
      <span className="roll-live" aria-hidden="true">
        {chars.map((c, i) => {
          const key = chars.length - i;
          if (c >= '0' && c <= '9') {
            const fromRight = digitsTotal - seen++;
            return <Column key={`d${key}`} digit={Number(c)} index={fromRight - 1} first={!mounted.current} />;
          }
          return (
            <span key={`c${key}-${c}`} className="roll-char">
              {c}
            </span>
          );
        })}
      </span>
    </span>
  );
}
