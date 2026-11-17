// Le serveur MCP de Shred : ce que Claude appelle quand la personne a ajouté Shred comme connecteur.
// JSON-RPC sur HTTP (transport « Streamable HTTP » sans session ni flux) : un POST, une réponse JSON.
// Lecture seule. Deux outils ont une carte interactive (MCP Apps) : la séance du jour et le récap du mois.
import cardsHtml from './mcp-ui/cards.html';
import {
  BadInput,
  type ConnectorProps,
  exerciseHistory,
  journal,
  loadUserData,
  profile,
  recap,
  Reconnect,
  search,
  today,
  type ToolOutput,
  type UserData,
} from './connector';
import type { Env } from './env';
import { capDaily } from './usage';
import { VERSION } from './version';

/** Versions du protocole MCP comprises, la plus récente d'abord. */
export const MCP_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const UI_MIME = 'text/html;profile=mcp-app';

const INSTRUCTIONS = `Shred is the user's own fitness app: strength training (sessions, sets, loads, records), nutrition, daily streak, body weight and endurance. Every tool is read-only and returns the user's data as of the last sync from their phone (stated at the end of each result).
Use get_today for today's (or one day's) planned session and what is done; get_exercise_history for progress on one lift; get_days for a short journal; search_history for open questions about the past; get_month_recap for a month summary; get_profile for goals, program and strength profile.
The data is in French; answer in the user's language. Loads are in kg.`;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  ui?: string;
  run: (d: UserData, args: Record<string, unknown>, appUrl: string) => ToolOutput;
}

const DATE = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };

export const TOOLS: ToolDef[] = [
  {
    name: 'get_today',
    title: 'Séance du jour',
    description:
      "Today's planned workout in Shred (or another day's with `date`): each exercise with its sets × reps, the suggested load, the sets already logged, plus the streak, the day's calories and protein against targets, and the latest weigh-in. Shows a card in the conversation.",
    inputSchema: { type: 'object', properties: { date: { ...DATE, description: 'Day to show, YYYY-MM-DD. Defaults to today in the user’s time zone.' } }, additionalProperties: false },
    ui: 'ui://shred/today',
    run: (d, a, url) => today(d, a, url),
  },
  {
    name: 'get_month_recap',
    title: 'Récap du mois',
    description:
      "The month in review, like the recap in the app: sessions and weekly average, tonnage, records with their gains, exercise of the month, heaviest session, favourite day and time, longest run of validated days, weight change, trophies, comparison with the previous month, and the user's 'profile of the month'. Shows a card in the conversation.",
    inputSchema: {
      type: 'object',
      properties: { month: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$', description: 'Month, YYYY-MM. Defaults to the current month.' } },
      additionalProperties: false,
    },
    ui: 'ui://shred/recap',
    run: (d, a, url) => recap(d, a, url),
  },
  {
    name: 'search_history',
    title: 'Chercher dans l’historique',
    description:
      'Searches the whole training and nutrition history (days, weekly reviews, per-exercise histories, weight, past coach exchanges) and returns the most relevant excerpts. Use it for open questions such as "when did I last train legs", "how was my protein last week", "my best bench".',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for, in plain words (French or English).' },
        limit: { type: 'integer', minimum: 1, maximum: 12, description: 'Maximum excerpts, 6 by default.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    run: (d, a) => search(d, a),
  },
  {
    name: 'get_exercise_history',
    title: 'Historique d’un exercice',
    description:
      'Every logged session of one exercise (matched by name, e.g. "squat", "développé couché", "tractions"), with all sets, the best set and estimated 1RM per session, the trend and the all-time record.',
    inputSchema: {
      type: 'object',
      properties: {
        exercise: { type: 'string', description: 'Exercise name or part of it.' },
        weeks: { type: 'integer', minimum: 1, maximum: 104, description: 'How far back, in weeks. 12 by default.' },
      },
      required: ['exercise'],
      additionalProperties: false,
    },
    run: (d, a) => exerciseHistory(d, a),
  },
  {
    name: 'get_days',
    title: 'Journal',
    description:
      'Day-by-day journal for up to 31 days: session and whether it was completed, sets per exercise, meals with calories and macros, habits, steps and weight. Defaults to the last 7 days.',
    inputSchema: {
      type: 'object',
      properties: { from: { ...DATE, description: 'First day, YYYY-MM-DD.' }, to: { ...DATE, description: 'Last day, YYYY-MM-DD. Defaults to today.' } },
      additionalProperties: false,
    },
    run: (d, a) => journal(d, a),
  },
  {
    name: 'get_profile',
    title: 'Profil et programme',
    description:
      "The user's profile and goals (weight goal, daily nutrition targets, notes for the coach, sport profile and gym), the full training program and weekly schedule, weight and waist history, strength grades per muscle group, streak and trophies.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: (d) => profile(d),
  },
];

const RESOURCES = [
  { uri: 'ui://shred/today', name: 'today-card', title: 'Carte de la séance du jour', card: 'today' },
  { uri: 'ui://shred/recap', name: 'recap-card', title: 'Carte du récap du mois', card: 'recap' },
];

function listTools() {
  return TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { title: t.title, ...READ_ONLY },
    // MCP Apps : la carte qui affiche le résultat (et l'ancienne clé, pour les hôtes qui la lisent encore).
    ...(t.ui ? { _meta: { ui: { resourceUri: t.ui }, 'ui/resourceUri': t.ui } } : {}),
  }));
}

function readResource(uri: string) {
  const r = RESOURCES.find((x) => x.uri === uri);
  if (!r) return null;
  return {
    contents: [
      {
        uri: r.uri,
        mimeType: UI_MIME,
        text: cardsHtml.replace('data-card="today"', `data-card="${r.card}"`),
        // Sans cadre, fond transparent : la carte se fond dans la conversation, aux couleurs de Claude. Seule adresse
        // extérieure : la police de Claude (Anthropic Sans), que l'hôte fournit.
        _meta: { ui: { prefersBorder: false, csp: { resourceDomains: ['https://assets.claude.ai'] } } },
      },
    ],
  };
}

interface RpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

class RpcError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

/**
 * Une requête au point MCP, déjà authentifiée (le jeton a été vérifié par le fournisseur OAuth).
 * `revoke` retire l'autorisation quand elle ne peut plus servir (mot de passe changé, compte supprimé).
 */
export async function mcpFetch(req: Request, env: Env, props: ConnectorProps, revoke: () => Promise<void>): Promise<Response> {
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  const header = req.headers.get('mcp-protocol-version');
  if (header && !MCP_VERSIONS.includes(header) && header < MCP_VERSIONS[MCP_VERSIONS.length - 1]) {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: `Unsupported protocol version ${header}` } }, 400);
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }
  const batch = Array.isArray(body);
  const messages = (batch ? body : [body]) as RpcMessage[];
  const appUrl = new URL(req.url).origin;
  let data: Promise<UserData> | null = null;
  const load = () => (data ??= loadUserData(env, props));

  const replies: unknown[] = [];
  try {
    for (const m of messages) {
      // Notifications (initialized, cancelled…) et réponses : rien à renvoyer.
      if (!m || typeof m !== 'object' || m.id === undefined || m.id === null || typeof m.method !== 'string') continue;
      try {
        replies.push({ jsonrpc: '2.0', id: m.id, result: await handle(m.method, m.params ?? {}, { load, appUrl, count: () => capDaily(env, props.uid, 'mcp') }) });
      } catch (e) {
        if (e instanceof Reconnect) throw e;
        const err = e instanceof RpcError ? e : new RpcError(-32603, 'Internal error');
        if (!(e instanceof RpcError)) console.error('MCP', e);
        replies.push({ jsonrpc: '2.0', id: m.id, error: { code: err.code, message: err.message } });
      }
    }
  } catch (e) {
    // La clé de la sauvegarde ne sert plus : l'autorisation est retirée, Claude redemandera la connexion.
    await revoke().catch(() => undefined);
    // En-tête en ASCII seulement ; le détail, en français, est dans le corps.
    return json({ error: 'invalid_token', error_description: `Reconnecte Shred : ${(e as Error).message}` }, 401, {
      'WWW-Authenticate': 'Bearer error="invalid_token", error_description="Authorization no longer valid, reconnect Shred"',
    });
  }
  if (!replies.length) return new Response(null, { status: 202 });
  return json(batch ? replies : replies[0]);
}

interface CallContext {
  load: () => Promise<UserData>;
  appUrl: string;
  /** Compte l'appel dans la limite du jour (le serveur déchiffre la sauvegarde à chaque fois). */
  count: () => Promise<void>;
}

async function handle(method: string, params: Record<string, unknown>, { load, appUrl, count }: CallContext): Promise<unknown> {
  switch (method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      return {
        protocolVersion: MCP_VERSIONS.includes(asked) ? asked : MCP_VERSIONS[0],
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false } },
        serverInfo: { name: 'shred', title: 'Shred', version: VERSION },
        instructions: INSTRUCTIONS,
      };
    }
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: listTools() };
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) throw new RpcError(-32602, `Unknown tool: ${String(params.name).slice(0, 60)}`);
      const args = params.arguments && typeof params.arguments === 'object' ? (params.arguments as Record<string, unknown>) : {};
      try {
        await count();
      } catch {
        return { content: [{ type: 'text', text: 'Limite du jour atteinte pour le connecteur Shred, réessaie demain.' }], isError: true };
      }
      const d = await load();
      try {
        const out = tool.run(d, args, appUrl);
        return { content: [{ type: 'text', text: out.text }], ...(out.card ? { structuredContent: out.card } : {}), isError: false };
      } catch (e) {
        if (e instanceof BadInput) return { content: [{ type: 'text', text: e.message }], isError: true };
        throw e;
      }
    }
    case 'resources/list':
      return {
        resources: RESOURCES.map((r) => ({ uri: r.uri, name: r.name, title: r.title, mimeType: UI_MIME, _meta: { ui: { prefersBorder: false } } })),
      };
    case 'resources/read': {
      const res = readResource(String(params.uri ?? ''));
      if (!res) throw new RpcError(-32002, 'Resource not found');
      return res;
    }
    case 'resources/templates/list':
      return { resourceTemplates: [] };
    case 'prompts/list':
      return { prompts: [] };
    case 'logging/setLevel':
      return {};
    default:
      throw new RpcError(-32601, `Method not found: ${method.slice(0, 60)}`);
  }
}
