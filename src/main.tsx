import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DEMO } from './lib/api';
import { isNative } from './lib/native';
import { startSync } from './lib/sync';
import './styles.css';
import { carryInvite } from './lib/install';

carryInvite();

startSync();

// Dans l'app iPhone, pas de service worker : l'app est déjà installée et hors ligne.
if (!DEMO && !isNative() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('Service worker non enregistré', e));
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
