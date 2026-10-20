// Simule le cron des rappels : KV en mémoire, faux service push, déchiffrement côté « téléphone ».
import { build } from 'esbuild';
import { createECDH, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ece from 'http_ece';

const out = join(mkdtempSync(join(tmpdir(), 'shred-rem-')), 'reminders.mjs');
await build({ entryPoints: ['worker/reminders.ts'], bundle: true, format: 'esm', platform: 'neutral', outfile: out, logLevel: 'error' });
const { runRemindersFor } = await import(pathToFileURL(out).href);

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

// Téléphone simulé
const ua = createECDH('prime256v1');
ua.generateKeys();
const auth = randomBytes(16);
const sub = { endpoint: 'https://push.example.com/abc', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const pub = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url');

const kv = new Map();
const store = {
  get: async (k) => kv.get(k) ?? null,
  put: async (k, v) => void kv.set(k, v),
  delete: async (k) => void kv.delete(k),
};
const env = { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: jwk.d, VAPID_SUBJECT: 'mailto:test@example.com' };

let received = [];
let pushStatus = 201;
globalThis.fetch = async (url, init) => {
  const msg = JSON.parse(ece.decrypt(Buffer.from(init.body), { version: 'aes128gcm', privateKey: ua, authSecret: auth }).toString());
  received.push(msg);
  return new Response('', { status: pushStatus });
};

const setState = (s) => kv.set('state', JSON.stringify({ date: '2026-10-13', label: 'Pull', mainDone: false, meals: 0, validated: false, streak: 4, banked: 4, ...s }));
const at = async (iso) => {
  received = [];
  return runRemindersFor(env, store, new Date(iso));
};

kv.set('sub', JSON.stringify(sub));
setState({});

// Mardi 13 octobre 2026, Paris = UTC+2
let sent = await at('2026-10-13T06:00:00Z');
check('08:00 : rappel du matin envoyé', sent.includes('morning') && received[0]?.title === 'Aujourd’hui : Pull', received[0]?.title);
check('matin : série mentionnée', /4 jours/.test(received[0]?.body ?? ''), received[0]?.body);
sent = await at('2026-10-13T06:10:00Z');
check('08:10 : pas de doublon', sent.length === 0 && received.length === 0);
sent = await at('2026-10-13T05:45:00Z');
check('07:45 : rien (hors fenêtre)', sent.length === 0);

setState({ meals: 1 });
sent = await at('2026-10-13T11:30:00Z');
check('13:30 avec 1 repas : rappel midi', sent.includes('lunch'), received[0]?.title);

setState({ meals: 3 });
sent = await at('2026-10-13T16:00:00Z');
check('18:00 séance non faite : rappel séance', sent.includes('training'), received[0]?.title);

setState({ mainDone: true, meals: 3, validated: true, streak: 5 });
sent = await at('2026-10-13T19:30:00Z');
check('21:30 journée validée : silence', sent.length === 0 && received.length === 0);

// Lendemain : journée non validée le soir
kv.set('state', JSON.stringify({ date: '2026-10-13', label: 'Pull', mainDone: true, meals: 3, validated: true, streak: 5, banked: 4 }));
sent = await at('2026-10-14T19:30:00Z');
check('mercredi 21:30, rien fait : alerte série', sent.includes('evening') && /5 jours/.test(received[0]?.title ?? ''), received[0]?.title);
check('soir : séance du planning (Legs) citée', /séance Legs/.test(received[0]?.body ?? ''), received[0]?.body);

sent = await at('2026-10-15T06:00:00Z');
check('jeudi matin : jour de repos', /Repos actif/.test(received[0]?.title ?? ''), received[0]?.title);

pushStatus = 410;
sent = await at('2026-10-16T06:00:00Z');
check('abonnement expiré (410) supprimé', !kv.has('sub'));

kv.set('sub', JSON.stringify({ ...sub, keys: { ...sub.keys, auth: 'xx' } }));
pushStatus = 201;
kv.delete('sent:2026-10-17:morning');
// Module nutrition coupé : pas de rappel de midi
kv.set('sub', JSON.stringify(sub));
kv.set('cfg', JSON.stringify({ meals: 0 }));
kv.set('state', JSON.stringify({ date: '2026-10-18', label: 'Lower', lifting: true, mainDone: false, meals: 0, validated: false, streak: 2, banked: 2 }));
sent = await at('2026-10-18T11:30:00Z');
check('nutrition coupée : pas de rappel de midi', !sent.includes('lunch'));
sent = await at('2026-10-18T19:30:00Z');
check('nutrition coupée : le soir ne parle pas des repas', sent.includes('evening') && !/repas/.test(received[0]?.body ?? ''), received[0]?.body);
kv.delete('cfg');

let crashed = false;
try {
  await at('2026-10-17T06:00:00Z');
} catch {
  crashed = true;
}
check('clé d’abonnement corrompue : pas de crash', !crashed);

console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent.');
process.exit(failures ? 1 : 0);
