// Pour assembler le Worker hors de Cloudflare (tests sous Node) : « cloudflare:workers » n'existe que dans le
// runtime, on le remplace par des classes vides ; les pages .html importées par le Worker arrivent en texte,
// comme avec wrangler.
export const workerShims = {
  // Comme wrangler : les paquets sans « exports » sont trouvés par leur champ main.
  mainFields: ['module', 'main'],
  loader: { '.html': 'text' },
  // Comme en production (wrangler.jsonc) : le drapeau qui autorise les documents d'identité des clients OAuth.
  banner: { js: 'globalThis.Cloudflare ??= { compatibilityFlags: { global_fetch_strictly_public: true } };' },
  plugins: [
    {
      name: 'cloudflare-workers-stub',
      setup(b) {
        b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'cloudflare:workers', namespace: 'cf-stub' }));
        b.onLoad({ filter: /.*/, namespace: 'cf-stub' }, () => ({
          contents: 'export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }\nexport class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }\n',
          loader: 'js',
        }));
      },
    },
  ],
};
