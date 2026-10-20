import { useEffect, useState } from 'react';
import { dayKey } from './date';

/** Clé du jour courant, mise à jour à minuit et au retour dans l'app. */
export function useToday(): string {
  const [today, setToday] = useState(dayKey());
  useEffect(() => {
    const refresh = () => setToday(dayKey());
    const id = setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return today;
}
