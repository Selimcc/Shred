// Disques : gains par journée validée, bonus de paliers, plafond, rythme de la série.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'shred-plates-'));
await build({ entryPoints: { p: 'shared/plates.ts' }, bundle: true, format: 'esm', platform: 'node', outdir: dir, logLevel: 'error' });
const k = await import(pathToFileURL(join(dir, 'p.js')).href);

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};
const day = (n) => new Date(Date.UTC(2026, 10, 1 + n)).toISOString().slice(0, 10);

let r = k.claimPlates(undefined, day(0), 1);
check('première journée : 5 de départ + 1', r.wallet.bal === 6 && r.gained === 1 && r.bonus === 0);
r = k.claimPlates(r.wallet, day(0), 1);
check('même jour : rien de plus', r.gained === 0 && r.wallet.bal === 6);
let w = r.wallet;
let total = 0;
for (let i = 1; i < 7; i++) {
  r = k.claimPlates(w, day(i), i + 1);
  w = r.wallet;
  total += r.bonus;
}
check('7 jours d’affilée : +1 par jour et 3 de bonus', w.bal === 6 + 6 + 3 && total === 3, String(w.bal));
r = k.claimPlates(w, day(9), 10);
check('trois jours sans synchro, série cohérente : les trois jours comptent', r.gained === 3 && r.wallet.bal === 18, JSON.stringify(r));
r = k.claimPlates(r.wallet, day(10), 30);
check('série qui saute de 10 à 30 en un jour : un disque, pas de palier', r.gained === 1 && r.bonus === 0);
r = k.claimPlates({ bal: 29, day: day(20), streak: 13 }, day(21), 14);
check('plafond de 30 : le bonus qui dépasse est perdu', r.wallet.bal === 30 && r.gained === 1 && r.bonus === 0, JSON.stringify(r));
r = k.claimPlates({ bal: 4, day: day(3), streak: 20 }, day(4), 1);
check('série repartie de zéro : un disque, la série est notée', r.gained === 1 && r.wallet.streak === 1);
r = k.claimPlates({ bal: 4 }, day(4), 0);
check('journée non validée : rien', r.gained === 0 && !r.wallet.day);
check('paliers', k.streakBonus(7) === 3 && k.streakBonus(30) === 5 && k.streakBonus(365) === 15 && k.streakBonus(465) === 15 && k.streakBonus(8) === 0);
check('prochain palier', JSON.stringify(k.nextBonus(8)) === JSON.stringify({ days: 14, plates: 3 }) && k.nextBonus(400).days === 465);
check('mise : 1, 3 avec un gage, 0 pour une revanche', k.stakeOf(false) === 1 && k.stakeOf(true) === 3 && k.stakeOf(true, true) === 0);
check('ajout borné', k.addPlates({ bal: 29 }, 5).bal === 30 && k.addPlates({ bal: 1 }, -3).bal === 0);

if (failures) {
  console.error(`\n${failures} échec(s)`);
  process.exit(1);
}
console.log('\nDisques : tout est bon.');
