// Mémoire du coach, façon RAG (retrieval-augmented generation).
//
// Les données de la personne sont découpées en petits documents (une journée, une semaine,
// l'historique d'un exercice, le poids, le profil…). Avant chaque question, on choisit ceux
// qui y répondent et on ne donne qu'eux à Claude : réponses plus précises, moins de tokens.
//
// La recherche tourne sur le téléphone (BM25 + récence + quelques synonymes), sans serveur ni frais.
// L'interface Retriever permet plus tard de brancher une recherche par embeddings côté serveur
// (Workers AI + Vectorize), utile seulement quand il y aura beaucoup de texte libre (mois de conversations).
import { athleteSummary } from '../../shared/athlete';
import { catalogEntry, GROUP_NAMES } from '../../shared/catalog';
import { programText } from './ai';
import { addDays, diffDays, formatNumber, formatShort, mondayOf, WEEKDAY_NAMES, weekdayOf } from './date';
import { formatSets, fmtKg, dayValidated, mealsCount, ruleOf, sessionFor, totals } from './logic';
import { type AppState, WEIGHT_GOALS } from './store';
import { e1rm } from './strength';

export type DocKind = 'profile' | 'program' | 'day' | 'week' | 'lift' | 'body' | 'chat';

export interface KnowledgeDoc {
  id: string;
  kind: DocKind;
  /** Date de référence (jour, lundi de la semaine, dernière séance) pour la récence. */
  date?: string;
  title: string;
  text: string;
}

export interface Hit {
  doc: KnowledgeDoc;
  score: number;
}

export interface SearchOptions {
  /** Nombre maximum de documents. */
  k?: number;
  /** Nombre maximum de caractères au total. */
  budget?: number;
  today?: string;
}

/** Ce qu'un moteur de recherche doit savoir faire : local aujourd'hui, embeddings demain. */
export interface Retriever {
  search(query: string, opts?: SearchOptions): Promise<Hit[]>;
}

/* ---------- Découpage des données en documents ---------- */

const short = (d: string) => formatShort(d);

function dayDoc(s: AppState, date: string): KnowledgeDoc | null {
  const day = s.days[date];
  if (!day) return null;
  const session = sessionFor(s, date);
  const lines: string[] = [];
  const lifts: string[] = [];
  for (const [key, sets] of Object.entries(day.sets)) {
    const done = sets.filter((l) => l.done);
    if (!done.length) continue;
    const entry = catalogEntry(key, s.customExercises);
    lifts.push(`${entry?.name ?? key} : ${formatSets(done)}`);
  }
  lines.push(`${WEEKDAY_NAMES[weekdayOf(date)]} ${short(date)}, séance ${session.name} (${session.focus}) : ${day.mainDone ? 'faite' : 'pas terminée'}.`);
  if (lifts.length) lines.push(`Séries : ${lifts.join(' ; ')}.`);
  if (s.settings.modules.nutrition && day.meals.length) {
    const t = totals(day);
    lines.push(
      `Repas (${mealsCount(day)}) : ${day.meals.map((m) => m.label).join(', ')}. Total ${t.kcal} kcal, ${t.protein} g de protéines, ${t.carbs} g de glucides, ${t.fat} g de lipides.`,
    );
  }
  const habits = s.habits.filter((h) => day.habits[h.id]).map((h) => h.name);
  if (habits.length) lines.push(`Habitudes : ${habits.join(', ')}.`);
  const h = s.health[date];
  if (h?.steps !== undefined) lines.push(`Activité : ${h.steps} pas${h.active ? `, ${h.active} kcal actives` : ''}.`);
  const kg = s.body.weight[date];
  if (kg) lines.push(`Poids : ${formatNumber(kg, 1)} kg.`);
  if (dayValidated(s, date)) lines.push('Journée validée.');
  return { id: `day:${date}`, kind: 'day', date, title: `${WEEKDAY_NAMES[weekdayOf(date)]} ${short(date)} : ${session.name}`, text: lines.join('\n') };
}

function weekDocs(s: AppState, today: string, weeks: number): KnowledgeDoc[] {
  const out: KnowledgeDoc[] = [];
  const rule = ruleOf(s);
  let monday = mondayOf(today);
  let prevAvg: number | null = null;
  const avgWeight = (start: string) => {
    const v = Array.from({ length: 7 }, (_, i) => s.body.weight[addDays(start, i)]).filter((x): x is number => x !== undefined);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const docs: KnowledgeDoc[] = [];
  for (let w = 0; w < weeks; w++) {
    const dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).filter((d) => d <= today);
    const logged = dates.filter((d) => s.days[d]);
    if (logged.length) {
      const sessions = dates.filter((d) => s.days[d]?.mainDone).map((d) => sessionFor(s, d).name);
      const validated = dates.filter((d) => dayValidated(s, d, rule)).length;
      const fed = dates.filter((d) => (s.days[d]?.meals.length ?? 0) > 0);
      const kcal = fed.length ? Math.round(fed.reduce((a, d) => a + totals(s.days[d]).kcal, 0) / fed.length) : null;
      const prot = fed.length ? Math.round(fed.reduce((a, d) => a + totals(s.days[d]).protein, 0) / fed.length) : null;
      const steps = dates.map((d) => s.health[d]?.steps).filter((x): x is number => x !== undefined);
      const lines = [
        `Semaine du ${short(monday)} : ${sessions.length} séance(s) faite(s)${sessions.length ? ` (${sessions.join(', ')})` : ''}, ${validated}/${dates.length} journées validées.`,
      ];
      if (kcal !== null && s.settings.modules.nutrition) {
        lines.push(`Moyenne sur ${fed.length} jour(s) notés : ${kcal} kcal et ${prot} g de protéines par jour (objectif ${s.settings.targets.kcal} kcal, ${s.settings.targets.protein} g).`);
      }
      if (steps.length) lines.push(`Pas : ${Math.round(steps.reduce((a, b) => a + b, 0) / steps.length)} par jour en moyenne.`);
      const wAvg = avgWeight(monday);
      if (wAvg !== null) lines.push(`Poids moyen : ${formatNumber(wAvg, 1)} kg.`);
      docs.push({ id: `week:${monday}`, kind: 'week', date: monday, title: `Bilan semaine du ${short(monday)}`, text: lines.join('\n') });
    }
    monday = addDays(monday, -7);
  }
  // Variation de poids d'une semaine sur l'autre (de la plus ancienne à la plus récente).
  for (const doc of docs.reverse()) {
    const wAvg = avgWeight(doc.date!);
    if (wAvg !== null && prevAvg !== null) doc.text += `\nVariation : ${wAvg - prevAvg > 0 ? '+' : ''}${formatNumber(wAvg - prevAvg, 2)} kg sur la semaine.`;
    if (wAvg !== null) prevAvg = wAvg;
    out.unshift(doc);
  }
  return out;
}

function liftDocs(s: AppState): KnowledgeDoc[] {
  const history = new Map<string, { date: string; w: number; r: number; e: number }[]>();
  for (const [date, day] of Object.entries(s.days)) {
    for (const [key, sets] of Object.entries(day.sets)) {
      const best = sets
        .filter((l) => l.done && l.w !== undefined && l.r)
        .map((l) => ({ date, w: l.w!, r: l.r!, e: e1rm(l.w!, l.r!) }))
        .sort((a, b) => b.e - a.e)[0];
      if (best) history.set(key, [...(history.get(key) ?? []), best]);
    }
  }
  const docs: KnowledgeDoc[] = [];
  for (const [key, list] of history) {
    const entry = catalogEntry(key, s.customExercises);
    const name = entry?.name ?? key;
    const sorted = list.sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const record = [...sorted].sort((a, b) => b.e - a.e)[0];
    const lines = [
      `${name}${entry ? ` (${GROUP_NAMES[entry.group]}${entry.muscles ? `, ${entry.muscles}` : ''})` : ''} : ${sorted.length} séance(s) notée(s).`,
      `Record : ${fmtKg(record.w)} × ${record.r} le ${short(record.date)} (1RM estimé ${Math.round(record.e)} kg).`,
    ];
    if (sorted.length > 1) {
      const delta = last.e - first.e;
      const weeks = Math.max(1, Math.round(diffDays(last.date, first.date) / 7));
      lines.push(`Évolution du 1RM estimé : ${delta >= 0 ? '+' : ''}${Math.round(delta)} kg en ${weeks} semaine(s).`);
    }
    lines.push(`Dernières : ${sorted.slice(-6).map((x) => `${short(x.date)} ${fmtKg(x.w)} × ${x.r}`).join(' ; ')}.`);
    docs.push({ id: `lift:${key}`, kind: 'lift', date: last.date, title: `Historique ${name}`, text: lines.join('\n') });
  }
  return docs;
}

function bodyDoc(s: AppState, today: string): KnowledgeDoc | null {
  const entries = Object.entries(s.body.weight).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return null;
  const [d0, w0] = entries[0];
  const [d1, w1] = entries[entries.length - 1];
  const min = Math.min(...entries.map(([, w]) => w));
  const lines = [
    `Objectif : ${WEIGHT_GOALS[s.settings.weightGoal].label.toLowerCase()} (${formatNumber(WEIGHT_GOALS[s.settings.weightGoal].min, 1)} à ${formatNumber(WEIGHT_GOALS[s.settings.weightGoal].max, 1)} kg par semaine).`,
    `Poids : ${formatNumber(w0, 1)} kg le ${short(d0)}, ${formatNumber(w1, 1)} kg le ${short(d1)} (minimum ${formatNumber(min, 1)} kg), ${entries.length} pesées.`,
    `Dernières pesées : ${entries
      .slice(-8)
      .map(([d, w]) => `${short(d)} ${formatNumber(w, 1)}`)
      .join(' ; ')}.`,
  ];
  const waist = Object.entries(s.body.waist).sort(([a], [b]) => a.localeCompare(b));
  if (waist.length) lines.push(`Tour de taille : ${waist.slice(-4).map(([d, c]) => `${short(d)} ${formatNumber(c, 1)} cm`).join(' ; ')}.`);
  return { id: 'body', kind: 'body', date: d1 <= today ? d1 : today, title: 'Poids et mensurations', text: lines.join('\n') };
}

function profileDoc(s: AppState): KnowledgeDoc {
  const p = s.settings;
  const lines = [
    [p.name, p.age ? `${p.age} ans` : '', p.height ? `${p.height} cm` : ''].filter(Boolean).join(', ') || 'Profil non renseigné',
    `Objectif : ${WEIGHT_GOALS[p.weightGoal].label}.`,
  ];
  if (p.modules.nutrition) lines.push(`Cibles par jour : ${p.targets.kcal} kcal, ${p.targets.protein} g de protéines, ${p.targets.carbs} g de glucides, ${p.targets.fat} g de lipides.`);
  if (p.coachNotes.trim()) lines.push(`Notes : ${p.coachNotes.trim()}`);
  lines.push(athleteSummary(p.athlete, p.gym));
  return { id: 'profile', kind: 'profile', title: 'Profil', text: lines.join('\n') };
}

function chatDocs(s: AppState): KnowledgeDoc[] {
  const docs: KnowledgeDoc[] = [];
  for (let i = 0; i < s.coach.length - 1; i++) {
    const q = s.coach[i];
    const a = s.coach[i + 1];
    if (q.role !== 'user' || a.role !== 'assistant') continue;
    const date = new Date(q.at).toISOString().slice(0, 10);
    docs.push({ id: `chat:${q.at}`, kind: 'chat', date, title: `Échange du ${short(date)}`, text: `Question : ${q.content}\nRéponse : ${a.content.slice(0, 600)}` });
  }
  return docs;
}

/** Tous les documents, du plus récent au plus ancien. */
export function buildDocs(s: AppState, today: string, { days = 120, weeks = 16 } = {}): KnowledgeDoc[] {
  const dayList = Object.keys(s.days)
    .filter((d) => d <= today && d >= addDays(today, -days))
    .sort()
    .reverse()
    .map((d) => dayDoc(s, d))
    .filter((d): d is KnowledgeDoc => d !== null);
  const docs: KnowledgeDoc[] = [
    profileDoc(s),
    { id: 'program', kind: 'program', title: `Programme ${s.program.name}`, text: programText(s) },
    ...dayList,
    ...weekDocs(s, today, weeks),
    ...liftDocs(s),
    ...chatDocs(s),
  ];
  const body = bodyDoc(s, today);
  if (body) docs.push(body);
  return docs;
}

/* ---------- Recherche locale ---------- */

const STOP = new Set(
  'a au aux avec ce ces cette dans de des du elle en est et eux il je la le les leur lui ma mais me mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous y ai as avoir etre fait faire comment quoi quel quelle quels quelles est-ce ca cela plus moins bien tres trop peu me mon'.split(' '),
);

/** Mots de la question qui renvoient à d'autres mots des documents. */
const SYNONYMS: Record<string, string[]> = {
  pec: ['pecs', 'developpe', 'dips', 'ecarte', 'push'],
  pecs: ['developpe', 'dips', 'ecarte', 'push'],
  abdos: ['crunch', 'gainage', 'core'],
  pectoraux: ['pecs', 'developpe', 'dips', 'ecarte'],
  poitrine: ['pecs', 'developpe'],
  jambe: ['jambes', 'squat', 'presse', 'legs', 'lower'],
  cuisse: ['jambes', 'squat', 'quadriceps', 'ischios'],
  dos: ['tirage', 'rowing', 'traction', 'pull'],
  epaule: ['epaules', 'elevations', 'militaire', 'shoulder'],
  bras: ['curl', 'triceps', 'biceps'],
  abdo: ['abdos', 'crunch', 'gainage', 'core'],
  cou: ['nuque', 'neck'],
  poids: ['pesee', 'pesees', 'kg', 'balance'],
  balance: ['poids', 'pesee'],
  kilo: ['poids', 'kg'],
  manger: ['repas', 'kcal', 'proteines'],
  bouffe: ['repas', 'kcal'],
  calorie: ['kcal', 'repas'],
  proteine: ['proteines', 'repas'],
  nutrition: ['repas', 'kcal', 'proteines'],
  progres: ['record', 'evolution', '1rm'],
  progression: ['record', 'evolution', '1rm'],
  progresse: ['record', 'evolution', '1rm'],
  stagne: ['record', 'evolution', 'dernieres'],
  plateau: ['record', 'evolution', 'dernieres'],
  record: ['record', '1rm'],
  force: ['record', '1rm'],
  pas: ['pas', 'activite'],
  marche: ['pas', 'activite'],
  bilan: ['semaine', 'bilan'],
  semaine: ['semaine', 'bilan'],
  regulier: ['validees', 'semaine'],
  serie: ['validees', 'validee'],
  developpe: ['developpe'],
  bench: ['developpe', 'couche'],
  sdt: ['souleve', 'terre'],
};

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map((t) => (t.length > 4 && /[sx]$/.test(t) ? t.slice(0, -1) : t));
}

function expand(tokens: string[]): Map<string, number> {
  const weights = new Map<string, number>();
  for (const t of tokens) {
    weights.set(t, Math.max(weights.get(t) ?? 0, 1));
    for (const syn of SYNONYMS[t] ?? []) for (const x of tokenize(syn)) weights.set(x, Math.max(weights.get(x) ?? 0, 0.6));
  }
  return weights;
}

/** Indices de temps dans la question : « hier », « lundi », « cette semaine », « 12/10 ». */
function timeHints(query: string, today: string): { dates: Set<string>; week: boolean } {
  const q = normalize(query);
  const dates = new Set<string>();
  if (/\baujourd/.test(q)) dates.add(today);
  if (/\bhier\b/.test(q)) dates.add(addDays(today, -1));
  if (/\bavant-hier\b/.test(q)) dates.add(addDays(today, -2));
  WEEKDAY_NAMES.forEach((name, wd) => {
    if (new RegExp(`\\b${normalize(name)}\\b`).test(q)) {
      for (let i = 0; i < 7; i++) {
        const d = addDays(today, -i);
        if (weekdayOf(d) === wd) dates.add(d);
      }
    }
  });
  for (const m of q.matchAll(/\b(\d{1,2})\/(\d{1,2})\b/g)) {
    const year = today.slice(0, 4);
    dates.add(`${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  }
  return { dates, week: /\bsemaine|bilan|recap/.test(q) };
}

export class LocalRetriever implements Retriever {
  private index: { doc: KnowledgeDoc; tf: Map<string, number>; len: number }[];
  private df = new Map<string, number>();
  private avgLen: number;

  constructor(
    docs: KnowledgeDoc[],
    private today: string,
  ) {
    this.index = docs.map((doc) => {
      const tf = new Map<string, number>();
      const tokens = tokenize(`${doc.title} ${doc.title} ${doc.text}`);
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return { doc, tf, len: tokens.length };
    });
    this.avgLen = this.index.reduce((a, d) => a + d.len, 0) / Math.max(1, this.index.length);
  }

  searchSync(query: string, { k = 6, budget = 3500, today = this.today }: SearchOptions = {}): Hit[] {
    const terms = expand(tokenize(query));
    const hints = timeHints(query, today);
    const N = this.index.length;
    let scored: (Hit & { direct: boolean })[] = [];
    for (const { doc, tf, len } of this.index) {
      if (doc.kind === 'profile' || doc.kind === 'program') continue; // toujours fournis à part
      let score = 0;
      let direct = false;
      for (const [term, weight] of terms) {
        const f = tf.get(term);
        if (!f) continue;
        if (weight >= 1) direct = true;
        const idf = Math.log(1 + (N - (this.df.get(term) ?? 0) + 0.5) / ((this.df.get(term) ?? 0) + 0.5));
        score += weight * idf * ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (len / this.avgLen))));
      }
      if (doc.date && hints.dates.has(doc.date)) {
        score += 6;
        direct = true;
      }
      if (hints.week && doc.kind === 'week') {
        score += 3;
        direct = true;
      }
      if (score <= 0) continue;
      if (doc.date) score *= 1 + 0.6 * Math.exp(-Math.max(0, diffDays(today, doc.date)) / 21);
      scored.push({ doc, score, direct });
    }
    // Si des documents contiennent les mots mêmes de la question, les correspondances par synonyme seules passent après… ou dehors.
    if (scored.some((h) => h.direct)) scored = scored.filter((h) => h.direct);
    scored.sort((a, b) => b.score - a.score);
    // On écarte ce qui est loin derrière le meilleur résultat.
    if (scored.length) scored = scored.filter((h) => h.score >= scored[0].score * 0.3);
    // Rien ne correspond : on donne le plus récent (bilan de semaine et derniers jours).
    const picked: Hit[] = scored.length
      ? scored.map(({ doc, score }) => ({ doc, score }))
      : this.index
          .filter((d) => d.doc.kind === 'week' || d.doc.kind === 'day')
          .slice(0, 4)
          .map((d) => ({ doc: d.doc, score: 0 }));
    const out: Hit[] = [];
    let used = 0;
    for (const hit of picked) {
      const size = hit.doc.title.length + hit.doc.text.length + 4;
      if (out.length >= k || used + size > budget) continue;
      out.push(hit);
      used += size;
    }
    return out;
  }

  async search(query: string, opts?: SearchOptions): Promise<Hit[]> {
    return this.searchSync(query, opts);
  }
}

export function localRetriever(s: AppState, today: string): LocalRetriever {
  return new LocalRetriever(buildDocs(s, today), today);
}

/** Les extraits, prêts à glisser dans un prompt. */
export function memoryText(hits: Hit[]): string {
  return hits.map((h) => `[${h.doc.title}]\n${h.doc.text}`).join('\n\n');
}

/* ---------- Dossier pour un Projet Claude ---------- */

export const PROJECT_INSTRUCTIONS = `Tu es mon coach musculation et nutrition. Le fichier « Dossier Shred » contient mon profil, mon programme, mes séances, mes repas, mes records et mon poids, exportés depuis mon app.
- Appuie-toi sur ce dossier et cite les dates quand c'est utile. Si une information n'y est pas, dis-le au lieu de l'inventer.
- Réponds en français, en tutoyant, court et concret (lisible sur téléphone).
- Pas de régime très bas en calories, pas de perte de plus d'environ 1 % du poids par semaine. En cas de douleur ou de blessure, conseille de consulter un professionnel.
- Quand je t'envoie une photo de repas, estime les calories et les macros, une ligne par aliment, puis le total.`;

export function dossierMarkdown(s: AppState, today: string): string {
  const docs = buildDocs(s, today, { days: 90, weeks: 26 });
  const section = (title: string, kind: DocKind) => {
    const list = docs.filter((d) => d.kind === kind);
    return list.length ? `## ${title}\n\n${list.map((d) => `### ${d.title}\n${d.text}`).join('\n\n')}\n` : '';
  };
  const profile = docs.find((d) => d.kind === 'profile')!;
  return [
    `# Dossier Shred${s.settings.name ? ` de ${s.settings.name}` : ''}`,
    `Exporté le ${formatShort(today)}. Les journées sont listées de la plus récente à la plus ancienne.\n`,
    `## Profil\n\n${profile.text}\n`,
    `## Programme\n\n${programText(s)}\n`,
    section('Poids', 'body'),
    section('Records et progression', 'lift'),
    section('Bilans de semaine', 'week'),
    section('Journal', 'day'),
  ]
    .filter(Boolean)
    .join('\n');
}
