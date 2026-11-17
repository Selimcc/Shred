// Écran « Nouvelle version » : Pulse, une barre qui avance par étapes, puis l'app se recharge seule.
import { useEffect, useState } from 'react';
import { onUpdate, type UpdateStep } from '../lib/update';
import { Pulse } from './Pulse';
import { tr } from '../../shared/i18n';

const STEPS: Record<UpdateStep, { pct: number; text: string }> = {
  checking: { pct: 8, text: tr('Vérification…') },
  download: { pct: 45, text: tr('Téléchargement des nouveautés…') },
  install: { pct: 82, text: tr('Installation…') },
  restart: { pct: 100, text: tr('C’est prêt') },
};

export function UpdateScreen() {
  const [u, setU] = useState<{ step: UpdateStep; version: string } | null>(null);
  useEffect(() => onUpdate(setU), []);
  if (!u) return null;
  const step = STEPS[u.step];
  return (
    <div className="update-screen" role="alertdialog" aria-live="assertive" aria-label={tr('Mise à jour de Shred')}>
      <div className="update-box">
        <Pulse mood="cheer" size={120} />
        <h1 className="display">{tr('Nouvelle version')}</h1>
        <p className="muted">{tr('Shred {version} s’installe. Tes données restent sur ton téléphone.', { version: u.version })}</p>
        <div className="update-bar" role="progressbar" aria-valuenow={step.pct} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: `${step.pct}%` }} />
        </div>
        <span className="small faint">{step.text}</span>
      </div>
    </div>
  );
}
