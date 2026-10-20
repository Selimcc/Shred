// Mise en ligne de Shred en une commande : npm run setup
// Relançable sans risque : les clés déjà créées sont réutilisées.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-terminal';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONFIG = join(ROOT, 'wrangler.jsonc');
const SECRETS = join(ROOT, '.shred-secrets.json');
const WRANGLER = process.env.SHRED_WRANGLER || 'npx wrangler';
const KV_PLACEHOLDER = 'REMPLACE_PAR_TON_ID_KV';

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

let stepNo = 0;
const step = (title) => console.log(`\n${bold(`${++stepNo}/6  ${title}`)}`);

function fail(message, hint) {
  console.error(`\n${red('Arrêt :')} ${message}`);
  if (hint) console.error(hint);
  process.exit(1);
}

/**
 * Lance une commande. Avec capture, la sortie (y compris les erreurs) s'affiche quand même en direct.
 * Sans capture, la commande parle directement au terminal et peut poser ses questions.
 */
function run(cmd, { capture = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, {
      cwd: ROOT,
      shell: true,
      stdio: ['inherit', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    });
    let out = '';
    child.stdout?.on('data', (chunk) => {
      out += chunk;
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      out += chunk;
      process.stderr.write(chunk);
    });
    child.on('close', (code) => resolve({ code: code ?? 1, out: stripAnsi(out) }));
    child.on('error', () => resolve({ code: 1, out }));
  });
}

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function vapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { VAPID_PUBLIC_KEY: Buffer.from(pub).toString('base64url'), VAPID_PRIVATE_KEY: jwk.d };
}

function readSecrets() {
  try {
    return JSON.parse(readFileSync(SECRETS, 'utf8'));
  } catch {
    return {};
  }
}

function setVar(config, name, value) {
  const re = new RegExp(`("${name}"\\s*:\\s*)"[^"]*"`);
  if (!re.test(config)) fail(`variable ${name} introuvable dans wrangler.jsonc`);
  return config.replace(re, `$1${JSON.stringify(value)}`);
}

async function main() {
  console.log(bold('\nMise en ligne de Shred'));
  console.log(dim('Compte 2 à 5 minutes. Tu peux relancer cette commande sans risque.'));

  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) fail(`Node ${process.versions.node} est trop ancien.`, 'Installe la version LTS depuis https://nodejs.org puis relance.');

  const secrets = readSecrets();
  let config = readFileSync(CONFIG, 'utf8');

  /* 1. Compte Cloudflare */
  step('Connexion à Cloudflare');
  const who = await run(`${WRANGLER} whoami`, { capture: true });
  if (who.code !== 0 || /not authenticated|not logged in/i.test(who.out)) {
    console.log('Ton navigateur va s’ouvrir : connecte-toi et clique sur « Allow ».');
    const login = await run(`${WRANGLER} login`);
    if (login.code !== 0) fail('connexion à Cloudflare impossible.', 'Relance la commande et accepte l’accès dans le navigateur.');
  } else {
    console.log(green('Déjà connecté.'));
  }

  /* 2. Base KV */
  step('Base de données (comptes, sauvegardes, rappels)');
  if (config.includes(KV_PLACEHOLDER)) {
    let id;
    const created = await run(`${WRANGLER} kv namespace create shred-kv --update-config=false`, { capture: true });
    id = created.out.match(/"?id"?\s*[:=]\s*"([0-9a-f]{32})"/)?.[1];
    if (!id) {
      // Déjà créée lors d'un essai précédent : on la retrouve.
      const list = await run(`${WRANGLER} kv namespace list`, { capture: true });
      try {
        const json = JSON.parse(list.out.slice(list.out.indexOf('['), list.out.lastIndexOf(']') + 1));
        id = json.find((ns) => String(ns.title).includes('shred-kv'))?.id;
      } catch {
        id = undefined;
      }
    }
    if (!id) fail('impossible de créer la base KV.', 'Vérifie ta connexion Cloudflare (npx wrangler whoami) puis relance.');
    config = config.replace(KV_PLACEHOLDER, id);
    writeFileSync(CONFIG, config);
    console.log(green(`Base créée (${id.slice(0, 8)}…).`));
  } else {
    console.log(green('Déjà configurée.'));
  }

  /* 3. Email pour les notifications */
  step('Email pour les notifications');
  const subject = config.match(/"VAPID_SUBJECT"\s*:\s*"([^"]*)"/)?.[1] ?? '';
  if (!subject || subject.includes('exemple.com') || subject.includes('example.com')) {
    console.log(dim('Apple l’exige pour envoyer les notifications. Il n’est montré à personne.'));
    let email = process.env.SHRED_EMAIL ?? secrets.EMAIL ?? '';
    while (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      email = await ask('Ton email : ');
    }
    config = setVar(config, 'VAPID_SUBJECT', `mailto:${email}`);
    writeFileSync(CONFIG, config);
    secrets.EMAIL = email;
  }
  console.log(green('OK.'));

  /* 4. Clé API Claude */
  step('Clé API Claude');
  if (!secrets.ANTHROPIC_API_KEY) {
    console.log(dim('Pour l’analyse des photos et le coach. Entrée sans rien taper = IA simulée, à ajouter plus tard.'));
    let key = process.env.SHRED_API_KEY ?? (await ask('Clé (sk-ant-…) : '));
    if (key && !key.startsWith('sk-ant-')) {
      console.log(red('Cette clé ne commence pas par sk-ant-, elle est ignorée.'));
      key = '';
    }
    if (key) secrets.ANTHROPIC_API_KEY = key;
  }
  config = setVar(config, 'MOCK_AI', secrets.ANTHROPIC_API_KEY ? '0' : '1');
  writeFileSync(CONFIG, config);
  console.log(secrets.ANTHROPIC_API_KEY ? green('IA réelle activée.') : 'IA simulée pour l’instant.');

  if (!secrets.VAPID_PUBLIC_KEY) Object.assign(secrets, await vapidKeys());
  // Code qui crée ton compte administrateur. Reprend l'ancien code d'accès s'il existe.
  secrets.ADMIN_CODE ??= secrets.APP_TOKEN ?? randomBytes(12).toString('base64url');
  delete secrets.APP_TOKEN;
  delete secrets.USERS;
  writeFileSync(SECRETS, JSON.stringify(secrets, null, 2));

  /* 5. Construction */
  step('Construction de l’app');
  const build = await run('npm run build');
  if (build.code !== 0) fail('la construction a échoué (voir les erreurs au-dessus).');

  /* 6. Mise en ligne avec les secrets */
  step('Mise en ligne');
  const tmp = join(ROOT, `.secrets-${randomBytes(4).toString('hex')}.json`);
  const upload = { ADMIN_CODE: secrets.ADMIN_CODE, VAPID_PUBLIC_KEY: secrets.VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: secrets.VAPID_PRIVATE_KEY };
  if (secrets.ANTHROPIC_API_KEY) upload.ANTHROPIC_API_KEY = secrets.ANTHROPIC_API_KEY;
  writeFileSync(tmp, JSON.stringify(upload));
  const deployCmd = `${WRANGLER} deploy --secrets-file "${tmp}"`;
  let deploy;
  try {
    deploy = await run(deployCmd, { capture: true });
    if (deploy.code !== 0 && /workers\.dev subdomain/i.test(deploy.out)) {
      // Compte Cloudflare neuf : il faut d'abord choisir son sous-domaine workers.dev, une seule fois.
      console.log(`\n${bold('Choisis ton sous-domaine workers.dev')} (une seule fois, il fait partie de l’adresse de l’app).`);
      console.log(`Réponds ${bold('y')} à la question de Cloudflare, puis tape un nom court, par exemple ton prénom.`);
      console.log(dim('L’adresse sera alors https://shred.<ce-nom>.workers.dev\n'));
      const interactive = await run(deployCmd);
      // Seconde mise en ligne, rapide, pour lire l'adresse de l'app.
      deploy = interactive.code === 0 ? await run(deployCmd, { capture: true }) : interactive;
    }
  } finally {
    rmSync(tmp, { force: true });
  }
  if (deploy.code !== 0) {
    fail(
      'la mise en ligne a échoué (voir les erreurs au-dessus).',
      'Si Cloudflare demande un sous-domaine workers.dev : dash.cloudflare.com, Workers et Pages, choisis-en un, puis relance npm run setup.',
    );
  }
  const url = deploy.out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i)?.[0] ?? secrets.URL;
  if (url) secrets.URL = url;
  writeFileSync(SECRETS, JSON.stringify(secrets, null, 2));

  console.log(`\n${green(bold('Shred est en ligne.'))}\n`);
  if (url) {
    const adminLink = `${url}/?invite=${encodeURIComponent(secrets.ADMIN_CODE)}`;
    console.log(`Adresse             ${bold(url)}`);
    console.log(`Code administrateur ${bold(secrets.ADMIN_CODE)}\n`);
    console.log('Scanne ce QR code avec l’appareil photo de ton téléphone : il ouvre l’app avec ton code admin déjà rempli.\n');
    qrcode.generate(adminLink, { small: true });
  } else {
    console.log('Adresse : copie l’URL en .workers.dev affichée au-dessus.');
    console.log(`Code administrateur : ${bold(secrets.ADMIN_CODE)}`);
  }
  console.log(`\n1. Sur l’iPhone, ouvre le lien dans ${bold('Safari')} (Android : Chrome).`);
  console.log('2. « Créer mon compte » : prénom, email, mot de passe. Le code admin fait de toi l’administrateur.');
  console.log('3. iPhone : Partager, « Sur l’écran d’accueil », puis ouvre l’app depuis l’icône pour les rappels.');
  console.log('4. Pour tes amis : Réglages, Testeurs, « Créer » une invitation et l’envoyer.');
  console.log(dim(`\nCode admin et clés gardés dans ${SECRETS} (ne le partage pas : il crée des comptes administrateur).`));
}

main().catch((e) => fail(e?.message ?? String(e)));
