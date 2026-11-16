// Secours en ligne de commande, si tu n'as pas l'app sous la main (tout se fait aussi dans Réglages, Testeurs).
//   npm run admin -- invite [prénom]   crée une invitation et affiche le message à envoyer
//   npm run admin -- reset <email>     crée un code pour changer un mot de passe oublié (le tien compris)
//   npm run admin -- users             liste les comptes
// Ajoute --local pour viser la base du serveur de développement (npm run dev:api).
import { spawn } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const local = args.includes('--local');
const [cmd, ...rest] = args.filter((a) => a !== '--local');
const WRANGLER = (process.env.SHRED_WRANGLER || 'npx wrangler').split(' ');
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const bold = (s) => `\x1b[1m${s}\x1b[0m`;

function secrets() {
  try {
    return JSON.parse(readFileSync(join(ROOT, '.shred-secrets.json'), 'utf8'));
  } catch {
    return {};
  }
}

/** Emails chiffrés au repos par le Worker (worker/seal.ts) : même clé, dérivée des secrets locaux. */
async function unseal(value) {
  if (typeof value !== 'string' || !value.startsWith('sealed:v1:')) return value;
  const sec = secrets();
  const root = sec.DATA_KEY || sec.VAPID_PRIVATE_KEY;
  if (!root) return '(chiffré)';
  try {
    const enc = new TextEncoder();
    const base = await crypto.subtle.importKey('raw', enc.encode(root), 'HKDF', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('shred:seal'), info: enc.encode('v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const [iv, ct] = value.slice('sealed:v1:'.length).split(':').map((x) => Buffer.from(x, 'base64url'));
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
  } catch {
    return '(chiffré)';
  }
}

function wrangler(params) {
  return new Promise((resolve, reject) => {
    const child = spawn(WRANGLER[0], [...WRANGLER.slice(1), ...params, '--binding', 'KV', local ? '--local' : '--remote'], {
      cwd: ROOT,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`wrangler a échoué (code ${code})`))));
  });
}

const code = () => {
  const c = Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${c.slice(0, 5)}-${c.slice(5)}`;
};
const sha = (t) => createHash('sha256').update(t).digest('hex');
const day = (s) => new Date(Date.now() + s * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

async function main() {
  const url = local ? 'http://localhost:8787' : (secrets().URL ?? 'https://ton-app.workers.dev');

  if (cmd === 'invite') {
    const note = rest.join(' ').slice(0, 40);
    const c = code();
    const created = new Date().toISOString();
    const ttl = 7 * 86400;
    await wrangler(['kv', 'key', 'put', `inv:${c.replace('-', '')}`, JSON.stringify({ by: 'cli', note, created }), '--ttl', String(ttl), '--metadata', JSON.stringify({ note, created })]);
    console.log(`\nInvitation ${bold(c)}${note ? ` pour ${note}` : ''}, valable jusqu’au ${day(ttl)}.\n`);
    console.log('Message à envoyer :\n');
    console.log(`Crée ton compte Shred ici : ${url}/?invite=${c}\nCode d’invitation : ${c}`);
    console.log('iPhone : ouvre le lien dans Safari, Partager, « Sur l’écran d’accueil ». Android : Chrome, menu ⋮, « Installer l’application ».\n');
    return;
  }

  if (cmd === 'reset') {
    const email = (rest[0] ?? '').trim().toLowerCase();
    if (!email.includes('@')) throw new Error('Usage : npm run admin -- reset ton@email.com');
    const id = await wrangler(['kv', 'key', 'get', `email:${sha(email)}`, '--text']).catch(() => '');
    if (!/^[0-9a-f]{16}$/.test(id)) throw new Error(`Aucun compte pour ${email}`);
    const c = code();
    await wrangler(['kv', 'key', 'put', `rst:${c.replace('-', '')}`, id, '--ttl', String(2 * 86400)]);
    console.log(`\nCode de réinitialisation pour ${email} : ${bold(c)} (48 h).`);
    console.log('Dans l’app : Me connecter, « Mot de passe oublié ? », email, code, nouveau mot de passe.');
    console.log('La sauvegarde en ligne, chiffrée avec l’ancien mot de passe, repartira des données du téléphone.\n');
    return;
  }

  if (cmd === 'users') {
    const raw = await wrangler(['kv', 'key', 'get', 'idx:users', '--text']).catch(() => '[]');
    let list = [];
    try {
      list = JSON.parse(raw || '[]');
    } catch {
      list = [];
    }
    if (!list.length) console.log('Aucun compte pour l’instant.');
    for (const u of list) console.log(`${u.role === 'admin' ? '★' : ' '} ${u.name.padEnd(16)} ${(await unseal(u.email)).padEnd(32)} inscrit le ${u.createdAt.slice(0, 10)}`);
    return;
  }

  console.log('Commandes : invite [prénom] · reset <email> · users   (ajoute --local pour le serveur de développement)');
}

main().catch((e) => {
  console.error(`\x1b[31mArrêt :\x1b[0m ${e.message}`);
  process.exit(1);
});
