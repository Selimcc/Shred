// Vérifie le chiffrement Web Push (RFC 8291) et la signature VAPID du Worker
// contre une implémentation de référence (http_ece) et le crypto natif de Node.
import { build } from 'esbuild';
import { createECDH, createPublicKey, randomBytes, verify } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ece from 'http_ece';

const out = join(mkdtempSync(join(tmpdir(), 'shred-test-')), 'webpush.mjs');
await build({ entryPoints: ['worker/webpush.ts'], bundle: true, format: 'esm', platform: 'neutral', outfile: out, logLevel: 'error' });
const wp = await import(pathToFileURL(out).href);

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

// Abonnement simulé (côté navigateur)
const ua = createECDH('prime256v1');
ua.generateKeys();
const auth = randomBytes(16);
const sub = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
};

// Clés VAPID
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const vapid = { publicKey: Buffer.from(pubRaw).toString('base64url'), privateKey: jwk.d, subject: 'mailto:test@example.com' };

// 1. Base64url aller-retour
const sample = randomBytes(77);
check('base64url aller-retour', Buffer.from(wp.b64urlDecode(wp.b64urlEncode(sample))).equals(sample));

// 2. Chiffrement décodable par http_ece
const payload = { title: 'Ta série de 12 jours est en danger', body: 'Il te reste 3 h. Épaules, été, éàü 🔥', tag: 'evening' };
for (let i = 0; i < 20; i++) {
  const { init } = await wp.buildPushRequest(sub, payload, vapid);
  const body = Buffer.from(init.body);
  const clear = ece.decrypt(body, { version: 'aes128gcm', privateKey: ua, authSecret: auth });
  const decoded = JSON.parse(clear.toString('utf8'));
  if (JSON.stringify(decoded) !== JSON.stringify(payload)) {
    check(`déchiffrement #${i}`, false);
    break;
  }
  if (i === 19) check('chiffrement aes128gcm déchiffré par http_ece (20 essais)', true);
}

// 3. En-têtes et JWT VAPID
const { init } = await wp.buildPushRequest(sub, payload, vapid, { ttl: 60, urgency: 'high', topic: 'evening' });
const h = init.headers;
check('Content-Encoding aes128gcm', h['Content-Encoding'] === 'aes128gcm');
check('TTL / Urgency / Topic', h.TTL === '60' && h.Urgency === 'high' && h.Topic === 'evening');
const m = h.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
check('format Authorization', Boolean(m));
const [hdr, claims, sig] = m[1].split('.');
const header = JSON.parse(Buffer.from(hdr, 'base64url'));
const payloadJwt = JSON.parse(Buffer.from(claims, 'base64url'));
check('JWT header ES256', header.alg === 'ES256' && header.typ === 'JWT');
check('JWT aud = origine du endpoint', payloadJwt.aud === 'https://fcm.googleapis.com');
check('JWT exp ≤ 24 h', payloadJwt.exp - Date.now() / 1000 <= 24 * 3600 && payloadJwt.exp > Date.now() / 1000);
check('JWT sub', payloadJwt.sub === vapid.subject);
const pubKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' });
const valid = verify('sha256', Buffer.from(`${hdr}.${claims}`), { key: pubKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
check('signature ES256 valide', valid);
check('clé k = clé publique VAPID', m[2] === vapid.publicKey);

// 4. Clés invalides rejetées
let threw = false;
try {
  await wp.buildPushRequest({ ...sub, keys: { ...sub.keys, auth: 'abc' } }, payload, vapid);
} catch {
  threw = true;
}
check('secret auth invalide rejeté', threw);

console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent.');
process.exit(failures ? 1 : 0);
