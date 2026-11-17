// L'app iPhone (et Android) : la même app web, embarquée dans une coque native qui donne accès à
// Apple Santé (HealthKit) sans raccourci. Construire : npm run build:ios (voir docs/IOS.md).
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'fr.shred.app',
  appName: 'Shred',
  webDir: 'dist-native',
  backgroundColor: '#161413',
  ios: {
    contentInset: 'never',
    backgroundColor: '#161413',
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
