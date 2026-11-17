// Traductions : liste des textes à traduire et contrôle des dictionnaires.
//   node scripts/i18n.mjs keys            → les clés (JSON) : texte français, pluriel, fichiers
//   node scripts/i18n.mjs check [--strict] → clés manquantes, en trop, variables différentes, par langue
// Les textes de l'app sont les appels tr('…') et tn(n, '…', '…') ; ceux du serveur, say('…') et les messages des
// HttpError. La bibliothèque d'exercices et les modèles de programme sont des données traduites à l'affichage :
// leurs noms, consignes et muscles sont relevés directement.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseAst } from 'rolldown/parseAst';

const ROOT = new URL('..', import.meta.url).pathname;
export const LANGS = ['en', 'es', 'pt', 'de', 'it'];

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f) && !f.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const str = (n) => (n?.type === 'Literal' && typeof n.value === 'string' ? n.value : n?.type === 'TemplateLiteral' && !n.expressions.length ? n.quasis[0].value.cooked : null);

function visit(node, fn) {
  if (!node || typeof node.type !== 'string') return;
  fn(node);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) for (const c of v) visit(c, fn);
    else if (v && typeof v.type === 'string') visit(v, fn);
  }
}

/** Les clés d'un ensemble de fichiers. `server` : say() et HttpError ; sinon tr() et tn(). */
function collect(files, { server = false } = {}) {
  const keys = new Map();
  const add = (fr, file, plural) => {
    if (!fr || !fr.trim()) return;
    const k = keys.get(fr) ?? { fr, files: new Set() };
    if (plural) k.one = plural;
    k.files.add(relative(ROOT, file));
    keys.set(fr, k);
  };
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const ast = parseAst(src, { lang: file.endsWith('x') ? 'tsx' : 'ts' }, file);
    const rel = relative(ROOT, file);
    visit(ast, (n) => {
      if (n.type === 'CallExpression' && n.callee.type === 'Identifier') {
        const name = n.callee.name;
        if (!server && name === 'tr') add(str(n.arguments[0]), file);
        if (!server && name === 'tn') {
          const one = str(n.arguments[1]);
          const other = str(n.arguments[2]);
          if (one !== null && other !== null) add(other, file, one);
        }
        if (server && (name === 'say' || name === 'T')) add(str(n.arguments[0]), file);
        if (server && name === 'tx') add(str(n.arguments[1]), file);
        if (server && name === 'txn') {
          const one = str(n.arguments[2]);
          const other = str(n.arguments[3]);
          if (one !== null && other !== null) add(other, file, one);
        }
        // Données traduites à l'affichage : bibliothèque d'exercices.
        if (!server && rel === 'shared/catalog.ts' && (name === 'c' || name === 'e')) {
          const a = n.arguments;
          add(str(a[1]), file);
          if (a[4]?.type === 'ArrayExpression') for (const m of a[4].elements) add(str(m), file);
          add(str(a[5]), file);
          const extra = a[7];
          if (extra?.type === 'ObjectExpression') for (const p of extra.properties) if (p.key?.name === 'note') add(str(p.value), file);
        }
      }
      if (server && n.type === 'NewExpression' && n.callee.type === 'Identifier' && n.callee.name === 'HttpError') add(str(n.arguments[1]), file);
      // Modèles de programme : noms, objectifs, descriptions, consignes.
      if (!server && rel === 'shared/templates.ts' && n.type === 'Property' && ['name', 'focus', 'description', 'days', 'note'].includes(n.key?.name)) add(str(n.value), file);
    });
  }
  return keys;
}

export function appKeys() {
  return collect([...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'shared'))]);
}

export function serverKeys() {
  return collect(walk(join(ROOT, 'worker')), { server: true });
}

const vars = (s) => [...new Set((s.match(/\{\w+\}/g) ?? []).sort())].join(',');

/** Ce qui ne va pas dans un dictionnaire : clés manquantes, inutiles, variables qui ne correspondent pas. */
export function audit(keys, dict) {
  const missing = [];
  const badVars = [];
  for (const [fr, k] of keys) {
    const t = dict[fr];
    if (t === undefined) {
      missing.push(fr);
      continue;
    }
    const forms = typeof t === 'string' ? [t] : [t.one, t.other];
    const want = k.one !== undefined ? [k.one, fr] : [fr];
    if (typeof t !== 'string' && k.one === undefined) badVars.push(`${fr} (pluriel inattendu)`);
    for (const f of forms) if (typeof f !== 'string' || vars(f) !== vars(want[want.length - 1])) badVars.push(fr);
  }
  const unused = Object.keys(dict).filter((k) => !keys.has(k));
  return { missing, unused, badVars: [...new Set(badVars)] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  if (cmd === 'keys') {
    const which = process.argv[3] === 'server' ? serverKeys() : appKeys();
    console.log(JSON.stringify([...which.values()].map((k) => ({ fr: k.fr, ...(k.one !== undefined ? { one: k.one } : {}), files: [...k.files] })), null, 1));
  } else if (cmd === 'check') {
    const strict = process.argv.includes('--strict');
    let bad = 0;
    for (const [label, keys, dir] of [
      ['app', appKeys(), 'src/locales'],
      ['serveur', serverKeys(), 'worker/locales'],
    ]) {
      for (const l of LANGS) {
        let dict = {};
        try {
          dict = JSON.parse(readFileSync(join(ROOT, dir, `${l}.json`), 'utf8'));
        } catch {
          // dictionnaire absent : tout manque
        }
        const r = audit(keys, dict);
        const n = r.missing.length + r.badVars.length + (strict ? r.unused.length : 0);
        bad += n;
        console.log(`${label} ${l} : ${keys.size} clés, ${r.missing.length} manquantes, ${r.badVars.length} variables à revoir, ${r.unused.length} en trop`);
        for (const m of r.badVars.slice(0, 10)) console.log(`  variables : ${m}`);
      }
    }
    process.exit(bad ? 1 : 0);
  } else console.log('node scripts/i18n.mjs keys [server] | check [--strict]');
}
