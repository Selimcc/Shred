// Garde-fou du dépôt public : aucun secret ni fichier de secrets ne doit être commité.
//   node scripts/check-secrets.mjs            fichiers suivis par git (CI)
//   node scripts/check-secrets.mjs --staged   ce qui va être commité (hook pre-commit)
//   node scripts/check-secrets.mjs --history  tout l'historique, commit par commit
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

/** Fichiers qui ne doivent jamais entrer dans le dépôt, quel que soit leur contenu. */
const FORBIDDEN_FILES = [
  /(^|\/)\.dev\.vars$/,
  /(^|\/)\.dev\.vars\.(?!example$)[^/]+$/,
  /(^|\/)\.shred-secrets\.json$/,
  /(^|\/)\.secrets-[^/]*\.json$/,
  /(^|\/)\.env(\.(?!example$)[^/]+)?$/,
  /\.(pem|p8|p12|pfx|key|keystore|jks|mobileprovision)$/i,
];

/** Formats de clés connus. Les valeurs de test du dépôt (« admin-code-123 »…) ne ressemblent à aucun. */
const PATTERNS = [
  ['clé Anthropic', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['clé Resend', /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/],
  ['jeton GitHub', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/],
  ['clé AWS', /\bAKIA[0-9A-Z]{16}\b/],
  ['clé Google', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['jeton Slack', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['clé privée', /-----BEGIN (RSA |EC |OPENSSH |PGP |)PRIVATE KEY-----/],
  ['jeton Cloudflare', /\b(CLOUDFLARE_API_TOKEN|CF_API_TOKEN)\s*[=:]\s*["']?[A-Za-z0-9_-]{35,}/],
  ['secret Strava', /\bSTRAVA_CLIENT_SECRET\s*[=:]\s*["']?[a-f0-9]{40}\b/],
  ['clé VAPID privée', /\bVAPID_PRIVATE_KEY\s*[=:]\s*["']?[A-Za-z0-9_-]{43}\b/],
];

const SKIP = /(^|\/)(package-lock\.json|scripts\/check-secrets\.mjs)$|\.(png|jpe?g|webp|gif|ico|woff2?|ttf|mp3|mp4|pdf)$/i;

function scan(label, files, read) {
  const found = [];
  for (const file of files) {
    if (!file.endsWith('.example') && FORBIDDEN_FILES.some((re) => re.test(file))) found.push(`${label}${file} : fichier de secrets`);
    if (SKIP.test(file)) continue;
    let text;
    try {
      text = read(file);
    } catch {
      continue;
    }
    if (text.includes('\0')) continue;
    text.split('\n').forEach((line, i) => {
      for (const [name, re] of PATTERNS) if (re.test(line)) found.push(`${label}${file}:${i + 1} : ${name}`);
    });
  }
  return found;
}

const mode = process.argv[2] ?? '';
let found = [];

if (mode === '--history') {
  const commits = git('rev-list', '--all').split('\n').filter(Boolean);
  const seen = new Set();
  for (const c of commits) {
    const blobs = git('ls-tree', '-r', c).split('\n').filter(Boolean).map((l) => l.match(/^\S+ blob (\S+)\t(.+)$/)).filter(Boolean);
    const fresh = blobs.filter(([, sha, path]) => !seen.has(`${sha}:${path}`) && seen.add(`${sha}:${path}`));
    found.push(...scan(`${c.slice(0, 7)} `, fresh.map(([, , p]) => p), (p) => git('show', `${c}:${p}`)));
  }
  console.log(`${commits.length} commits analysés.`);
} else if (mode === '--staged') {
  const files = git('diff', '--cached', '--name-only', '--diff-filter=ACMR').split('\n').filter(Boolean);
  found = scan('', files, (p) => git('show', `:${p}`));
} else {
  const files = git('ls-files').split('\n').filter(Boolean);
  found = scan('', files, (p) => readFileSync(p, 'utf8'));
}

found = [...new Set(found)];
if (found.length) {
  console.error(`Secret possible dans le dépôt (public) :\n  ${found.join('\n  ')}`);
  console.error('Retire-le, puis change ce secret : tout ce qui a été poussé doit être considéré comme lu.');
  process.exit(1);
}
console.log('Aucun secret trouvé.');
