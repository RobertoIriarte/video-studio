// Remotion declares multimedia modules; Vite's complete client types duplicate
// those declarations. Only the MODE environment field used by this application is declared here.
declare module '*.css';

interface ImportMeta { readonly env: { readonly MODE: string }; }
