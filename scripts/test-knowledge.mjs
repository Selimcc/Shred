// Recherche dans l'historique (façon RAG) : les bons extraits remontent pour chaque question.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'shred-rag-'));
await build({
  stdin: {
    contents: `
      export { demoState } from './src/lib/demo-seed';
      export { initial } from './src/lib/store';
      export { buildDocs, localRetriever, dossierMarkdown, tokenize } from './src/lib/knowledge';
      export { claudePrompt, LINK_BUDGET } from './src/lib/ai';
      export { dayKey, addDays } from './src/lib/date';
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: join(dir, 'k.mjs'),
  logLevel: 'error',
  define: { 'import.meta.env': '{"MODE":"test"}' },
});
const k = await import(pathToFileURL(join(dir, 'k.mjs')).href);

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

const today = k.dayKey();
const s = k.demoState(k.initial());
const docs = k.buildDocs(s, today);
const kinds = docs.reduce((acc, d) => ({ ...acc, [d.kind]: (acc[d.kind] ?? 0) + 1 }), {});
check('historique découpé en documents', kinds.day > 20 && kinds.week >= 3 && kinds.lift > 10 && kinds.body === 1, JSON.stringify(kinds));

const r = k.localRetriever(s, today);
const top = (q, n = 3) => r.searchSync(q, { k: n }).map((h) => h.doc.title);

let t = top('Est-ce que je progresse au squat ?');
check('« progresse au squat » → historique du squat', t.slice(0, 2).some((x) => x.startsWith('Historique Squat')) && t[0].includes('quat'), t.join(' | '));

t = top('mes pecs stagnent', 4);
check('« pecs » → exercices des pectoraux', t.some((x) => /Développé|Dips|Écarté/i.test(x)), t.join(' | '));

t = top('fais le bilan de ma semaine');
check('« bilan de ma semaine » → bilan de semaine', t[0].startsWith('Bilan semaine'), t.join(' | '));

const yesterday = k.addDays(today, -1);
const hit = r.searchSync('qu’est-ce que j’ai fait hier ?', { k: 3 })[0];
check('« hier » → la journée d’hier', hit?.doc.date === yesterday, hit?.doc.title);

t = top('mon poids baisse assez vite ?');
check('« poids » → poids et mensurations', t.includes('Poids et mensurations'), t.join(' | '));

const hits = r.searchSync('squat', { k: 20, budget: 1200 });
const used = hits.reduce((a, h) => a + h.doc.title.length + h.doc.text.length + 4, 0);
check('le budget de caractères est respecté', used <= 1200 && hits.length >= 1, `${hits.length} extraits, ${used} caractères`);

check('accents et pluriels normalisés', k.tokenize('Épaules développés').join(' ') === 'epaule developpe');

const prompt = k.claudePrompt(s, today, 'Je progresse au squat ?', r.searchSync('Je progresse au squat ?', { k: 6, budget: 3000 }));
const link = `https://claude.ai/new?q=${encodeURIComponent(prompt)}`.length;
check('lien vers l’app Claude avec extraits, sous la limite', prompt.includes('Historique Squat') && link <= k.LINK_BUDGET, `${link} caractères`);

const md = k.dossierMarkdown(s, today);
check('dossier pour un Projet Claude', md.startsWith('# Dossier Shred') && md.includes('## Records et progression') && md.includes('## Journal'), `${Math.round(md.length / 1000)} k caractères`);

console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent.');
process.exit(failures ? 1 : 0);
