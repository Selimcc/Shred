// Lecture des codes-barres : clé de contrôle, UPC-E, variantes pour Open Food Facts, double lecture, zone décodée.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'shred-barcode-'));
await build({ entryPoints: ['src/lib/barcode.ts'], bundle: true, format: 'esm', platform: 'node', outfile: join(dir, 'b.mjs'), logLevel: 'error' });
const k = await import(pathToFileURL(join(dir, 'b.mjs')).href);

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

check('EAN-13 valable (Nutella)', k.validBarcode('3017620422003'));
check('un chiffre faux est refusé', !k.validBarcode('3017620422004') && !k.validBarcode('3017620422013'));
check('deux chiffres inversés sont refusés', !k.validBarcode('3017620242003'));
check('EAN-8 valable', k.validBarcode('96385074'));
check('UPC-A valable (12 chiffres)', k.validBarcode('036000291452'));
check('UPC-E valable, développé en UPC-A', k.upcEtoA('04252614') === '042100005264' && k.validBarcode('04252614'));
check('longueurs non produit refusées', !k.validBarcode('1234567') && !k.validBarcode('12345678901') && !k.validBarcode('30176204220a3'));
check('UPC-A : essayé aussi avec un 0 devant', k.codeVariants('036000291452').join() === '036000291452,0036000291452');
check('EAN-13 en 0 : essayé aussi en 12 chiffres', k.codeVariants('0036000291452').join() === '0036000291452,036000291452');
check('UPC-E : essayé en version longue', k.codeVariants('04252614').includes('0042100005264'));

const ok = k.confirmer();
check('première lecture : pas encore acceptée', !ok('3017620422003', 0));
check('même code juste après : accepté', ok('3017620422003', 120));
const ok2 = k.confirmer();
ok2('3017620422003', 0);
check('code différent entre deux : on repart de zéro', !ok2('3017620422004', 100) && !ok2('5449000000996', 200) && ok2('5449000000996', 300));
const ok3 = k.confirmer();
ok3('3017620422003', 0);
check('deux lectures trop espacées : pas de validation', !ok3('3017620422003', 5000));
const ok4 = k.confirmer();
check('code à la clé fausse : jamais accepté, même répété', !ok4('3017620422004', 0) && !ok4('3017620422004', 50) && !ok4('3017620422004', 100));

// Vidéo 1080 x 1920 (iPhone en portrait) dans un cadre de 342 x 256.
const r1 = k.scanRegion({ w: 1080, h: 1920 }, { w: 342, h: 256 }, 1);
const r2 = k.scanRegion({ w: 1080, h: 1920 }, { w: 342, h: 256 }, 2);
check('zone centrée dans l’image', Math.abs(r1.x + r1.w / 2 - 540) < 1 && Math.abs(r1.y + r1.h / 2 - 960) < 1);
check('zone dans les limites de l’image', r1.x >= 0 && r1.y >= 0 && r1.x + r1.w <= 1080 && r1.y + r1.h <= 1920);
check('zoom 2× : moitié moins large, même centre', Math.abs(r2.w - r1.w / 2) < 1 && Math.abs(r2.x + r2.w / 2 - 540) < 1);
check('zone plus large que haute (un code-barres est horizontal)', r1.w > r1.h);

console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
process.exit(failures ? 1 : 0);
