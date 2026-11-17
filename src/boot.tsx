import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { UpdateScreen } from './components/UpdateScreen';
import { DEMO } from './lib/api';
import { isNative } from './lib/native';
import { startSync } from './lib/sync';
import './styles.css';
import './styles/season.css';
import './styles/motion.css';
import { carryInvite } from './lib/install';
import { startUpdates } from './lib/update';
import { moveSessionToCookie } from './lib/account';
import { startGlide } from './lib/motion';

carryInvite();

startSync();
startUpdates();
startGlide();
void moveSessionToCookie();

// Dans l'app iPhone, pas de service worker : l'app est déjà installée et hors ligne.
if (!DEMO && !isNative() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('Service worker non enregistré', e));
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <UpdateScreen />
  </StrictMode>,
);
