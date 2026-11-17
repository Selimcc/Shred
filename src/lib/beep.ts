// Bips du mode séance (fin du repos, fin d'un gainage) : deux notes courtes générées sur place, aucun fichier.
// iOS n'ouvre le son qu'après un geste : primeAudio() se lance au tap qui valide la série.
let ctx: AudioContext | null = null;

export function primeAudio() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  } catch {
    ctx = null;
  }
}

/** `tick` : décompte des 3 dernières secondes. `end` : c'est reparti. */
export function beep(kind: 'tick' | 'end') {
  if (!ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime + 0.01;
  const notes: [number, number, number][] =
    kind === 'end'
      ? [
          [880, 0, 0.16],
          [1318.5, 0.17, 0.3],
        ]
      : [[660, 0, 0.09]];
  for (const [freq, at, len] of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + at);
    gain.gain.exponentialRampToValueAtTime(kind === 'end' ? 0.3 : 0.18, t0 + at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + at);
    osc.stop(t0 + at + len + 0.02);
  }
}
