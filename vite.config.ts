import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'demo' ? [viteSingleFile()] : [])],
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
