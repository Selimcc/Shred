// Réception des données Santé (Raccourci iPhone) et passages à la salle.
import { build } from 'esbuild';
import { createECDH, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ece from 'http_ece';

const dir = mkdtempSync(join(tmpdir(), 'shred-health-'));
await build({ entryPoints: ['worker/health.ts', 'worker/reminders.ts'], bundle: true, format: 'esm', platform: 'neutral', outdir: dir, logLevel: 'error' });
const h = await import(pathToFileURL(join(dir, 'health.js')).href);
const r = await import(pathToFileURL(join(dir, 'reminders.js')).href);

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

// Formats envoyés par les Raccourcis
check('nombre brut', h.toNumber(8432, 200000) === 8432);
check('texte « 8 432 » (espace insécable)', h.toNumber('8 432', 200000) === 8432);
check('texte « 412,6 kcal »', h.toNumber('412,6 kcal', 20000) === 413);
check('valeur absurde rejetée', h.toNumber(999999, 200000) === undefined);
check('texte vide rejeté', h.toNumber('', 200000) === undefined);

const kv = new Map();
const store = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => void kv.set(k, v), delete: async (k) => void kv.delete(k) };
const env = {};
const now = new Date('2026-10-13T11:00:00Z'); // 13:00 à Paris
let saved = await h.ingestHealth(store, { steps: '5 120', active_kcal: 210.4, resting_kcal: '1 702' }, now);
check('envoi de midi enregistré', saved.date === '2026-10-13' && saved.steps === 5120 && saved.activeKcal === 210 && saved.restingKcal === 1702);
saved = await h.ingestHealth(store, { steps: 0, active_kcal: 0 }, new Date('2026-10-13T19:00:00Z'));
check('envoi vide (iPhone verrouillé) n’écrase pas', saved.steps === 5120 && saved.activeKcal === 210);
saved = await h.ingestHealth(store, { steps: 9105, active_kcal: '455' }, new Date('2026-10-13T19:05:00Z'));
check('nouveaux totaux pris en compte', saved.steps === 9105 && saved.activeKcal === 455 && saved.restingKcal === 1702);
saved = await h.ingestHealth(store, { steps: 9300 }, new Date('2026-10-13T19:10:00Z'));
check('envoi rapproché, petit écart : pas d’écriture', saved.skipped === true && saved.steps === 9105);
saved = await h.ingestHealth(store, { steps: 10400 }, new Date('2026-10-13T19:12:00Z'));
check('gros écart : écrit tout de suite', !saved.skipped && saved.steps === 10400);
saved = await h.ingestHealth(store, { steps: 10600 }, new Date('2026-10-13T19:30:00Z'));
check('un quart d’heure plus tard : écrit', !saved.skipped && saved.steps === 10600);
let threw = false;
try {
  await h.ingestHealth(store, { foo: 1 }, now);
} catch {
  threw = true;
}
check('corps sans valeur rejeté', threw);

// Passage à la salle + notification
const ua = createECDH('prime256v1');
ua.generateKeys();
const auth = randomBytes(16);
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
env.VAPID_PUBLIC_KEY = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url');
env.VAPID_PRIVATE_KEY = jwk.d;
kv.set('sub', JSON.stringify({ endpoint: 'https://push.example.com/x', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } }));
kv.set('state', JSON.stringify({ date: '2026-10-13', label: 'Pull', mainDone: false, meals: 2, validated: false, streak: 4, banked: 4 }));
let received = [];
globalThis.fetch = async (_url, init) => {
  received.push(JSON.parse(ece.decrypt(Buffer.from(init.body), { version: 'aes128gcm', privateKey: ua, authSecret: auth }).toString()));
  return new Response('', { status: 201 });
};
const res = await h.gymEvent(env, store, 'in', new Date('2026-10-13T16:40:00Z'));
check('arrivée à la salle notée', res.gym.in && res.gym.visits === 1);
check('notification « Pull t’attend »', res.notified && /Pull/.test(received[0]?.body ?? ''), received[0]?.body);

// Rappel de séance supprimé quand on est déjà à la salle
const cfg = { ...r.DEFAULT_CFG };
const st = JSON.parse(kv.get('state'));
const gym = JSON.parse(kv.get('gym:2026-10-13'));
check('pas de rappel « séance » à la salle', r.buildReminder('training', cfg, st, '2026-10-13', 2, 1080, { gym }) === null);
const out = await h.gymEvent(env, store, 'out', new Date('2026-10-13T18:05:00Z'));
check('départ noté', !!out.gym.out);

// Rappel du soir avec les pas restants
const evening = r.buildReminder('evening', cfg, st, '2026-10-13', 2, 1290, { health: { steps: 6200, at: '' } });
check('le soir : pas restants mentionnés', /1 800 pas/.test(evening?.body ?? ''), evening?.body);
const rest = r.buildReminder('training', cfg, { ...st, label: 'Repos actif' }, '2026-10-15', 4, 1080, { health: { steps: 3000, at: '' } });
check('repos actif : rappel de marche', /5 000 pas/.test(rest?.body ?? ''), rest?.body);

// Historique récent
const recent = await h.recentHealth(store, 14, new Date('2026-10-13T20:00:00Z'));
check('historique : santé et salle du jour', recent.days['2026-10-13']?.health?.steps === 10600 && !!recent.days['2026-10-13']?.gym?.out);

// Sommeil, cœur, exercice (Raccourci étendu)
check('sommeil en heures décimales', h.sleepMinutes({ sleep_h: '7,5' }) === 450);
check('sommeil « 6 h 45 »', h.sleepMinutes({ sleep_h: '6 h 45' }) === 405);
check('sommeil en minutes', h.sleepMinutes({ sleep_min: 412 }) === 412);
check('valeurs en liste ou en objet, clés avec espace : lues', (() => { const b = h.cleanBody({ 'steps ': [{ value: '8 432 pas' }], Active_Kcal: { quantity: 412 } }); return h.toNumber(b.steps, 1e6) === 8432 && h.toNumber(b.active_kcal, 1e6) === 412; })());
check('nom et valeur inversés dans le raccourci : remis dans le bon sens', (() => { const b = h.cleanBody({ '3588': 'steps', '158,698': 'active_kcal', '': 'exercise_min', '2,74': 'distance_km' }); return h.toNumber(b.steps, 1e6) === 3588 && h.toNumber(b.active_kcal, 1e6) === 159 && h.toDecimal(b.distance_km, 300) === 2.7 && h.toNumber(b.exercise_min, 1440) === undefined; })());
check('sommeil en secondes (durée de Raccourcis)', h.sleepMinutes({ sleep_min: 27120 }) === 452 && h.sleepMinutes({ sleep_min: '27 120' }) === 452);
check('sommeil « 7:32:00 »', h.sleepMinutes({ sleep_min: '7:32:00' }) === 452 && h.sleepMinutes({ sleep_min: '7:32' }) === 452);
const morning = await h.ingestHealth(store, { date: '2026-10-13', sleep_h: '7,2', resting_hr: '56 bpm', hrv: '63', exercise_min: 12, distance_km: '3,4 km' }, new Date('2026-10-13T20:30:00Z'));
check('sommeil et cœur enregistrés', morning.sleepMin === 432 && morning.restingHr === 56 && morning.hrv === 63, JSON.stringify(morning));
check('distance décimale', morning.distanceKm === 3.4);
check('les pas déjà reçus restent', morning.steps === 10600);

console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent.');
process.exit(failures ? 1 : 0);
