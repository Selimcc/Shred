// Connecter Claude (ou un autre client MCP) à un compte Shred, avec OAuth 2.1 : le client s'inscrit (document
// d'identité publié, CIMD, ou inscription dynamique), la personne se connecte et accepte dans l'app, Claude reçoit
// un jeton qui n'ouvre que le point MCP, en lecture.
//
// La clé de la sauvegarde (« data », tirée du mot de passe sur le téléphone) est confiée au moment de l'accord.
// Le fournisseur la range chiffrée avec une clé que seul le jeton peut déballer : le serveur ne garde que des
// empreintes de jetons, donc sans jeton présenté, personne ne peut la lire. Changer de mot de passe la rend
// inutilisable (époque du compte), et l'autorisation est alors retirée.
import { AuthorizationError, CimdFetchError, getOAuthApi, type OAuthHelpers, OAuthProvider, type OAuthProviderOptions } from '@cloudflare/workers-oauth-provider';
import { unseal } from '../src/lib/crypto';
import type { ConnectorProps } from './connector';
import { type Env, HttpError, json, readJson } from './env';
import { mcpFetch } from './mcp';
import { capDaily } from './usage';
import { getAccount, sha256hex, type User } from './users';

export const MCP_PATH = '/api/mcp';
export const SCOPE = 'shred:read';
const AUTHORIZE = '/api/oauth/authorize';
const TOKEN = '/api/oauth/token';
const REGISTER = '/api/oauth/register';

type OEnv = Env & { OAUTH_KV: KVNamespace };
/** Le fournisseur range ses clients, accords et empreintes de jetons dans le même KV (préfixes client:, grant:, token:). */
const withKv = (env: Env): OEnv => ({ ...env, OAUTH_KV: env.KV });

function options(origin: string): OAuthProviderOptions<OEnv> {
  return {
    apiRoute: MCP_PATH,
    apiHandler: {
      fetch: (req: Request, env: OEnv, ctx: ExecutionContext) => {
        const c = ctx as ExecutionContext & { props: ConnectorProps; auth?: { token: string } };
        return mcpFetch(req, env, c.props, async () => {
          const api = getOAuthApi(options(origin), env);
          const t = c.auth?.token ? await api.unwrapToken(c.auth.token) : null;
          if (t) await api.revokeGrant(t.grantId, t.userId);
        });
      },
    },
    defaultHandler: { fetch: async () => new Response('Introuvable', { status: 404 }) },
    authorizeEndpoint: AUTHORIZE,
    tokenEndpoint: TOKEN,
    clientRegistrationEndpoint: REGISTER,
    scopesSupported: [SCOPE],
    requiredScopes: [SCOPE],
    resourceMetadata: { resource: `${origin}${MCP_PATH}`, authorization_servers: [origin], resource_name: 'Shred', bearer_methods_supported: ['header'] },
    clientIdMetadataDocumentEnabled: true,
    // Jeton d'accès de 4 h, renouvelé tant que le connecteur sert au moins une fois tous les 60 jours.
    accessTokenTTL: 4 * 3600,
    refreshTokenTTL: 60 * 86400,
    refreshTokenIdleTTL: 60 * 86400,
  };
}

const providers = new Map<string, OAuthProvider<OEnv>>();
function provider(origin: string): OAuthProvider<OEnv> {
  let p = providers.get(origin);
  if (!p) providers.set(origin, (p = new OAuthProvider(options(origin))));
  return p;
}

export const oauthApi = (env: Env, origin: string): OAuthHelpers => getOAuthApi(options(origin), withKv(env));

/** Ce que le fournisseur traite lui-même : découverte, jetons, inscription des clients, point MCP. */
export function isConnectorPath(pathname: string): boolean {
  return pathname === MCP_PATH || pathname.startsWith(`${MCP_PATH}/`) || pathname === TOKEN || pathname === REGISTER || pathname.startsWith('/.well-known/oauth-');
}

export function connectorFetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  return provider(new URL(req.url).origin).fetch(req, withKv(env), ctx);
}

/* ---------- Consentement ---------- */

interface ConsentInfo {
  name: string;
  /** Domaine vérifié du client (document d'identité publié), sinon absent : le nom est alors déclaratif. */
  domain?: string;
  host: string;
  loopback: boolean;
}

const consentKey = async (handle: string) => `mcpc:${await sha256hex(handle)}`;

function errorPage(text: string, status = 400): Response {
  const esc = text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shred</title><body style="font-family:system-ui,sans-serif;background:#161413;color:#f5efe7;display:grid;place-items:center;min-height:90vh;margin:0;padding:24px"><div style="max-width:420px"><h1 style="font-size:1.3rem">Connexion impossible</h1><p style="color:#b7ada2">${esc}</p><p><a href="/" style="color:#f2bd2c">Ouvrir Shred</a></p></div>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );
}

/**
 * GET /api/oauth/authorize : Claude ouvre cette adresse. La demande est vérifiée (client, adresse de retour,
 * PKCE), liée à ce navigateur par un cookie, puis l'app affiche la demande d'accès (/?connect=…).
 */
export async function authorizeStart(req: Request, env: Env, url: URL): Promise<Response> {
  const api = oauthApi(env, url.origin);
  try {
    const request = await api.parseAuthRequest(req);
    const details = await api.describeConsent(request);
    const consent = await api.beginConsent(request);
    const info: ConsentInfo = { name: details.clientName.slice(0, 80), host: details.redirectHost.slice(0, 120), loopback: details.redirectIsLoopback };
    if (details.clientDomain) info.domain = details.clientDomain.slice(0, 120);
    await env.KV.put(await consentKey(consent.handle), JSON.stringify(info), { expirationTtl: 900 });
    consent.headers.set('Location', `${url.origin}/?connect=${encodeURIComponent(consent.handle)}`);
    return new Response(null, { status: 302, headers: consent.headers });
  } catch (e) {
    if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
    if (e instanceof AuthorizationError) return errorPage(e.description ?? 'Demande de connexion invalide.');
    if (e instanceof CimdFetchError) return errorPage('L’application qui demande l’accès n’a pas pu être vérifiée.');
    throw e;
  }
}

/** GET /api/oauth/consent?h=… : ce que l'app montre sur la demande d'accès (qui demande, où partent les jetons). */
export async function consentInfo(env: Env, url: URL): Promise<Response> {
  const handle = url.searchParams.get('h') ?? '';
  if (!handle || handle.length > 200) throw new HttpError(400, 'Demande invalide');
  const info = await env.KV.get(await consentKey(handle));
  if (!info) throw new HttpError(410, 'Cette demande a expiré : relance la connexion depuis Claude.');
  return json({ ...JSON.parse(info), scope: SCOPE });
}

/**
 * POST /api/oauth/authorize : la personne connectée accepte (avec la clé de sa sauvegarde) ou refuse.
 * Réponse : l'adresse de retour vers le client, que l'app ouvre.
 */
export async function authorizeDecision(req: Request, env: Env, user: User, url: URL): Promise<Response> {
  const body = await readJson<{ handle?: string; approve?: boolean; key?: string }>(req.clone(), 4_000);
  const handle = typeof body.handle === 'string' ? body.handle : '';
  if (!handle || handle.length > 200) throw new HttpError(400, 'Demande invalide');
  const api = oauthApi(env, url.origin);
  const stored = await env.KV.get(await consentKey(handle));
  if (!stored) throw new HttpError(410, 'Cette demande a expiré : relance la connexion depuis Claude.');
  const info = JSON.parse(stored) as ConsentInfo;
  try {
    if (!body.approve) {
      const denied = await api.denyConsent(req, handle);
      await env.KV.delete(await consentKey(handle));
      return withCookies(json({ redirectTo: denied.redirectTo }), denied.headers);
    }
    await capDaily(env, user.id, 'connect');
    const key = typeof body.key === 'string' ? body.key : '';
    const acct = await getAccount(env, user.id);
    if (!acct) throw new HttpError(404, 'Compte introuvable');
    // La clé doit ouvrir la sauvegarde du compte : sinon Claude ne pourrait rien lire.
    const raw = await env.KV.get(`u:${user.id}:backup`);
    if (!raw) throw new HttpError(409, 'Aucune sauvegarde sur ton compte pour l’instant : ouvre Shred sur ton téléphone, attends la synchro, puis réessaie.');
    try {
      const box = JSON.parse(raw) as { iv: string; data: string; gz?: boolean };
      await unseal(key, { iv: box.iv, data: box.data, gz: Boolean(box.gz) });
    } catch {
      throw new HttpError(403, 'Ta sauvegarde est chiffrée avec un autre mot de passe : reconnecte-toi dans Shred, puis réessaie.');
    }
    const approved = await api.approveConsent(req, handle, { scope: [SCOPE] });
    const props: ConnectorProps = { uid: user.id, key, epoch: acct.epoch };
    const { redirectTo } = await api.completeAuthorization({
      request: approved.request,
      userId: user.id,
      metadata: { name: info.name, domain: info.domain ?? null, host: info.host },
      scope: [SCOPE],
      props,
    });
    await env.KV.delete(await consentKey(handle));
    return withCookies(json({ redirectTo }), approved.headers);
  } catch (e) {
    if (e instanceof AuthorizationError) throw new HttpError(400, 'Cette demande a déjà servi ou a été ouverte dans un autre navigateur : relance la connexion depuis Claude.');
    throw e;
  }
}

function withCookies(res: Response, headers: Headers): Response {
  for (const c of headers.getSetCookie()) res.headers.append('Set-Cookie', c);
  return res;
}

/* ---------- Applications connectées (Réglages) ---------- */

export async function connectorRoutes(req: Request, env: Env, user: User, url: URL): Promise<Response | null> {
  const { pathname } = url;
  if (pathname === '/api/connector' && req.method === 'GET') {
    const api = oauthApi(env, url.origin);
    const list = await api.listUserGrants(user.id);
    return json({
      url: `${url.origin}${MCP_PATH}`,
      clients: list.items.map((g) => ({
        id: g.id,
        name: String(g.metadata?.name ?? g.clientId).slice(0, 80),
        domain: g.metadata?.domain ?? null,
        since: g.createdAt * 1000,
      })),
    });
  }
  const m = pathname.match(/^\/api\/connector\/([A-Za-z0-9_-]{1,100})$/);
  if (m && req.method === 'DELETE') {
    await oauthApi(env, url.origin).revokeGrant(m[1], user.id);
    return json({ ok: true });
  }
  return null;
}
