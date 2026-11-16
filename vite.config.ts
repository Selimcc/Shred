import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/**
 * Identifiant de ce build : la version, et le commit (Cloudflare Workers Builds le fournit) ou l'heure.
 * L'app compare le sien à /version.json, servi par le déploiement en ligne, pour se mettre à jour seule.
 */
const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;
function commit(): string {
  const env = process.env.WORKERS_CI_COMMIT_SHA || process.env.GITHUB_SHA;
  if (env) return env.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return Date.now().toString(36);
  }
}
const BUILD = `${version}+${commit()}`;

function versionFile(): Plugin {
  return {
    name: 'shred-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version, build: BUILD }) });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'demo' ? [viteSingleFile()] : [versionFile()])],
  define: { __BUILD__: JSON.stringify(BUILD), __VERSION__: JSON.stringify(version) },
  build: {
    // native : la version embarquée dans l'app iPhone (Capacitor), qui parle au Worker par VITE_API_BASE.
    outDir: mode === 'demo' ? 'dist-demo' : mode === 'native' ? 'dist-native' : 'dist',
    // En mode démo tout est inliné dans un seul fichier HTML (aperçu partageable).
    copyPublicDir: mode !== 'demo',
  },
  server: {
    // En dev : `npm run dev:api` lance le Worker sur 8787, Vite lui relaie /api.
    proxy: { '/api': 'http://localhost:8787' },
  },
}));
