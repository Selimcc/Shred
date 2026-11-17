// Les fichiers .html importés depuis le Worker arrivent en texte (règle par défaut de wrangler).
declare module '*.html' {
  const content: string;
  export default content;
}
