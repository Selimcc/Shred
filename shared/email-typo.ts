// « selim@gmial.com » → « selim@gmail.com ? » : les fautes de frappe les plus courantes dans l'adresse,
// repérées avant l'inscription (c'est avec cet email qu'on se connectera ensuite).
const DOMAINS = [
  'gmail.com', 'hotmail.com', 'hotmail.fr', 'outlook.com', 'outlook.fr', 'live.fr', 'live.com', 'yahoo.com', 'yahoo.fr',
  'icloud.com', 'me.com', 'orange.fr', 'free.fr', 'sfr.fr', 'laposte.net', 'wanadoo.fr', 'bbox.fr', 'proton.me', 'protonmail.com', 'gmx.fr',
];

function distance(a: string, b: string): number {
  // Levenshtein avec transposition (gmial ↔ gmail compte pour une faute).
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** L'adresse corrigée si le domaine ressemble de très près à un domaine courant, sinon null. */
export function emailSuggestion(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const local = email.slice(0, at);
  let domain = email.slice(at + 1);
  if (!domain || DOMAINS.includes(domain)) return null;
  // Point oublié ou en trop : « gmailcom », « gmail.con », « gmail..com ».
  domain = domain.replace(/\.{2,}/g, '.').replace(/\.(con|cm|co|cmo|ocm|vom)$/, '.com').replace(/\.(fe|fg|f)$/, '.fr');
  if (!domain.includes('.')) domain = domain.replace(/(com|fr|net|me)$/, '.$1');
  let best: string | null = null;
  let bestD = 3;
  for (const d of DOMAINS) {
    const dist = distance(domain, d);
    if (dist < bestD) {
      best = d;
      bestD = dist;
    }
  }
  if (!best || best === email.slice(at + 1) || bestD > (best.length > 8 ? 2 : 1)) return null;
  return `${local}@${best}`;
}
