// Datos de presentación locales. No son DTO de API ni estado persistido.
export const projects = [
  { id: 'oceanos', title: 'El silencio de los océanos', subtitle: 'Un viaje a las profundidades que aún no conocemos.', category: 'Documental cinematográfico', mode: 'Supervisado', minutes: 15, theme: 'ocean', label: 'En producción', tone: 'violet', completed: 12, total: 24, updated: '2026-11-17' },
  { id: 'bosques', title: 'La memoria del bosque', subtitle: 'Las historias que se esconden bajo nuestras raíces.', category: 'Realista premium', mode: 'Supervisado', minutes: 12, theme: 'forest', label: 'En revisión', tone: 'amber', completed: 20, total: 20, updated: '2026-11-16' },
  { id: 'cosmos', title: 'Más allá de la última estrella', subtitle: 'Una mirada al límite de nuestro universo.', category: 'Explicativo', mode: 'Automático', minutes: 20, theme: 'cosmos', label: 'Borrador', tone: 'neutral', completed: 0, total: 0, updated: '2026-11-15' },
  { id: 'ciudad', title: 'Cuando la ciudad duerme', subtitle: 'La vida invisible que comienza al caer la noche.', category: 'Terror / misterio', mode: 'Supervisado', minutes: 10, theme: 'city', label: 'Finalizado', tone: 'green', completed: 22, total: 22, updated: '2026-11-14' },
];

export type ProjectFixture = (typeof projects)[number];

export const projectSections = [
  { path: '', label: 'Resumen', description: 'El estado de tu historia, de un vistazo.' },
  { path: 'research', label: 'Investigación', description: 'Fuentes, afirmaciones y notas que sostienen la historia.' },
  { path: 'script', label: 'Guion', description: 'La estructura narrativa y las versiones de tu guion.' },
  { path: 'direction', label: 'Dirección', description: 'El lenguaje visual, las escenas y el plan de tomas.' },
  { path: 'scenes', label: 'Escenas', description: 'Cada pieza de la historia, en orden.' },
  { path: 'voice', label: 'Voz', description: 'Narración, segmentos y sincronización.' },
  { path: 'assets', label: 'Recursos', description: 'Los recursos visuales y sonoros del proyecto.' },
  { path: 'edit', label: 'Montaje', description: 'Orden, transiciones y ritmo audiovisual.' },
  { path: 'qa', label: 'Calidad', description: 'Incidencias y revisión antes de exportar.' },
  { path: 'render', label: 'Render', description: 'La salida final, producida por tu agente local.' },
  { path: 'youtube', label: 'YouTube', description: 'Título, descripción y capítulos para acompañar tu video.' },
];

export function sceneFixtures(count: number, completed: number) {
  const titles = ['Un mundo por descubrir', 'La primera señal', 'Debajo de la superficie', 'El equilibrio invisible', 'Una nueva perspectiva', 'Lo que queda por contar'];
  return Array.from({ length: count }, (_, index) => ({
    id: `escena-${index + 1}`, number: index + 1,
    title: titles[index % titles.length] ?? 'Escena de muestra',
    start: index * 30, end: (index + 1) * 30, shots: index % 2 + 2,
    label: index < completed ? 'Lista' : index === completed ? 'En revisión' : 'Pendiente',
    tone: index < completed ? 'green' : index === completed ? 'amber' : 'neutral',
  }));
}

export function timecode(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
