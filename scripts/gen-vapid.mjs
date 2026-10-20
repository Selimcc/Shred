// Génère une paire de clés VAPID (P-256) au format attendu par le Worker.
// Usage : npm run vapid
const { subtle } = globalThis.crypto;
const b64url = (buf) => Buffer.from(buf).toString('base64url');

const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await subtle.exportKey('jwk', pair.privateKey);
const pub = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));

console.log('Copie ces deux valeurs dans tes secrets (wrangler secret put …) et dans .dev.vars :\n');
console.log(`VAPID_PUBLIC_KEY=${b64url(pub)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
