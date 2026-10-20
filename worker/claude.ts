import { programSummary } from '../shared/program';
import { type Env, HttpError } from './env';

const API_URL = 'https://api.anthropic.com/v1/messages';

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
}

async function callClaude(env: Env, body: Record<string, unknown>): Promise<ContentBlock[]> {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, 'ANTHROPIC_API_KEY manquant côté serveur');
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    console.error('Claude API', res.status, detail);
    if (res.status === 429 || res.status === 529) throw new HttpError(503, 'Claude est surchargé, réessaie dans une minute');
    throw new HttpError(502, `Erreur API Claude (${res.status})`);
  }
  const data = (await res.json()) as { content: ContentBlock[] };
  return data.content;
}

/* ---------- Analyse de repas ---------- */

export interface MealItem {
  name: string;
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface MealAnalysis {
  is_food: boolean;
  title: string;
  items: MealItem[];
  confidence: 'low' | 'medium' | 'high';
  advice: string;
}

export interface MealRequest {
  image: string; // base64 sans préfixe data:
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  note?: string;
  slot?: string;
  remaining?: { kcal: number; protein: number };
  /** Sèche, maintien ou prise de masse. */
  goal?: string;
}

const MEAL_TOOL = {
  name: 'report_meal',
  description: 'Enregistre l’estimation nutritionnelle du repas photographié.',
  input_schema: {
    type: 'object',
    properties: {
      is_food: { type: 'boolean', description: 'false si la photo ne montre pas de nourriture' },
      title: { type: 'string', description: 'Nom court du repas, ex. « Poulet, riz, haricots verts »' },
      items: {
        type: 'array',
        description: 'Un élément par aliment visible (sauces et huiles comprises)',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            grams: { type: 'number', description: 'Poids estimé de la portion, tel que servi' },
            kcal: { type: 'number' },
            protein: { type: 'number', description: 'grammes' },
            carbs: { type: 'number', description: 'grammes' },
            fat: { type: 'number', description: 'grammes' },
          },
          required: ['name', 'grams', 'kcal', 'protein', 'carbs', 'fat'],
        },
      },
      confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      advice: {
        type: 'string',
        description: 'Une phrase de conseil concret selon son objectif (25 mots max), tutoiement',
      },
    },
    required: ['is_food', 'title', 'items', 'confidence', 'advice'],
  },
};

const MEAL_SYSTEM = `Tu es nutritionniste du sport. Tu estimes les calories et macros d'un repas à partir d'une photo.
- Estime les portions avec les repères visibles : taille de l'assiette, couverts, main, box de meal prep (~750 ml).
- Si l'utilisateur donne des poids ou des ingrédients, ils priment sur ton estimation visuelle.
- Compte une quantité réaliste d'huile, de beurre et de sauce : c'est là que les estimations se trompent le plus.
- Valeurs pour la portion visible, arrondies à l'unité. Noms d'aliments en français.
- Si l'image ne montre pas de nourriture, is_food = false et items vide.`;

export function validateMeal(req: MealRequest) {
  if (typeof req.image !== 'string' || !req.image || req.image.length > 5_000_000) {
    throw new HttpError(400, 'Image manquante ou trop lourde');
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(req.mediaType)) {
    throw new HttpError(400, 'Format d’image non pris en charge');
  }
}

export async function analyzeMeal(env: Env, req: MealRequest): Promise<MealAnalysis> {
  validateMeal(req);
  if (env.MOCK_AI === '1') return mockMeal();

  const context = [
    req.slot ? `Créneau : ${req.slot}.` : '',
    req.goal ? `Objectif : ${String(req.goal).slice(0, 30)}.` : '',
    req.note ? `Précision de l'utilisateur : « ${req.note.slice(0, 300)} ».` : '',
    req.remaining
      ? `Il lui reste aujourd'hui environ ${Math.round(req.remaining.kcal)} kcal et ${Math.round(req.remaining.protein)} g de protéines.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  const content = await callClaude(env, {
    model: env.MODEL_VISION || 'claude-sonnet-5-5',
    max_tokens: 1024,
    system: MEAL_SYSTEM,
    tools: [MEAL_TOOL],
    tool_choice: { type: 'tool', name: 'report_meal' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: req.mediaType, data: req.image } },
          { type: 'text', text: `Analyse ce repas. ${context}` },
        ],
      },
    ],
  });

  const block = content.find((b) => b.type === 'tool_use' && b.name === 'report_meal');
  if (!block?.input) throw new HttpError(502, 'Réponse inattendue de Claude');
  return sanitizeMeal(block.input as MealAnalysis);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

function sanitizeMeal(m: MealAnalysis): MealAnalysis {
  return {
    is_food: Boolean(m.is_food),
    title: String(m.title ?? 'Repas').slice(0, 80),
    items: (Array.isArray(m.items) ? m.items : []).slice(0, 15).map((i) => ({
      name: String(i.name ?? 'Aliment').slice(0, 60),
      grams: num(i.grams),
      kcal: num(i.kcal),
      protein: num(i.protein),
      carbs: num(i.carbs),
      fat: num(i.fat),
    })),
    confidence: ['low', 'medium', 'high'].includes(m.confidence) ? m.confidence : 'medium',
    advice: String(m.advice ?? '').slice(0, 200),
  };
}

function mockMeal(): MealAnalysis {
  return {
    is_food: true,
    title: 'Poulet, riz, haricots verts (simulation)',
    items: [
      { name: 'Blanc de poulet grillé', grams: 140, kcal: 230, protein: 43, carbs: 0, fat: 5 },
      { name: 'Riz basmati cuit', grams: 220, kcal: 285, protein: 6, carbs: 62, fat: 1 },
      { name: 'Haricots verts', grams: 150, kcal: 45, protein: 3, carbs: 7, fat: 0 },
      { name: 'Huile d’olive', grams: 8, kcal: 72, protein: 0, carbs: 0, fat: 8 },
    ],
    confidence: 'medium',
    advice: 'Réponse simulée (MOCK_AI=1). Repas bien calibré pour ton objectif.',
  };
}

/* ---------- Coach ---------- */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CoachRequest {
  messages: ChatMessage[];
  context?: string;
  name?: string;
  /** Programme de l'utilisateur, résumé par l'app (il peut l'avoir entièrement modifié). */
  program?: string;
  /** Ce que l'utilisateur veut que le coach sache (objectif, goûts, contraintes). */
  notes?: string;
  /** Extraits de son historique choisis par l'app selon la question (recherche locale, façon RAG). */
  memory?: string;
}

function coachSystem(name?: string, program?: string, notes?: string): string {
  const who = name ? name : 'l’utilisateur';
  return `Tu es le coach musculation et nutrition de ${who}. Son programme, ses notes et ses données du jour sont fournis plus bas.

Style : français, tutoiement, direct et concret. Réponses courtes, lisibles sur téléphone (120 mots max sauf si on te demande plus). Pas de tableaux. Tu motives sans flatter : si une idée est mauvaise, dis-le.

Garde-fous :
- Pas de régime très bas en calories ni de perte plus rapide qu'environ 1 % du poids de corps par semaine. Pas de jeûne extrême, pas de produits dopants.
- Douleur articulaire ou blessure : arrêter l'exercice concerné et consulter un professionnel de santé. Tu ne poses pas de diagnostic.
- Tu peux adapter la séance du jour (temps limité, machine prise, fatigue) en restant dans l'esprit du programme.

${notes?.trim() ? `CE QU'IL VEUT QUE TU SACHES :\n${notes.trim().slice(0, 1200)}\n\n` : ''}${(program?.trim() || programSummary()).slice(0, 8000)}`;
}

export function normalizeMessages(input: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of input.slice(-16)) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const content = String(m.content ?? '').slice(0, 4000).trim();
    if (!content) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${content}`;
    else out.push({ role: m.role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  if (!out.length || out[out.length - 1].role !== 'user') throw new HttpError(400, 'Le dernier message doit venir de toi');
  return out;
}

export async function coachReply(env: Env, req: CoachRequest): Promise<string> {
  const messages = normalizeMessages(Array.isArray(req.messages) ? req.messages : []);
  if (env.MOCK_AI === '1') {
    const q = messages[messages.length - 1].content;
    return `Réponse simulée (MOCK_AI=1). Tu m’as écrit : « ${q.slice(0, 80)} ». Une fois ta clé API configurée, je te réponds pour de vrai.`;
  }
  const system = [
    { type: 'text', text: coachSystem(req.name?.slice(0, 40), req.program, req.notes) },
    { type: 'text', text: `ÉTAT DU JOUR (généré par l'app) :\n${String(req.context ?? 'indisponible').slice(0, 3000)}` },
  ];
  if (req.memory?.trim()) {
    system.push({
      type: 'text',
      text: `HISTORIQUE PERTINENT (extraits de ses données choisis selon la question ; appuie-toi dessus et cite les dates quand c'est utile) :\n${req.memory.trim().slice(0, 6000)}`,
    });
  }
  const content = await callClaude(env, {
    model: env.MODEL_COACH || 'claude-haiku-5-5',
    max_tokens: 800,
    system,
    messages,
  });
  const text = content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!text) throw new HttpError(502, 'Réponse vide de Claude');
  return text;
}
