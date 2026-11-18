export const sceneComponents = ['NARRATION', 'VISUAL', 'VOICE', 'TIMING', 'MUSIC', 'AMBIENCE', 'EDIT'] as const;
export type SceneComponent = typeof sceneComponents[number];
export function changedComponents(before: Record<SceneComponent, string>, after: Record<SceneComponent, string>): SceneComponent[] {
  const changed = sceneComponents.filter((c) => before[c] !== after[c]);
  if (changed.includes('VOICE') && !changed.includes('TIMING')) changed.push('TIMING');
  return changed;
}
export function affectedJobKinds(components: readonly SceneComponent[]): string[] {
  const kinds = new Set<string>();
  for (const c of components) {
    for (const k of ['EDIT', 'QA', 'RENDER', 'SEO']) kinds.add(k);
    if (['NARRATION', 'VISUAL', 'TIMING'].includes(c)) { kinds.add('ASSET'); kinds.add('DIRECTION'); }
    if (['NARRATION', 'VOICE'].includes(c)) kinds.add('VOICE');
    if (['NARRATION', 'VOICE', 'TIMING'].includes(c)) kinds.add('ALIGNMENT');
    if (['MUSIC', 'AMBIENCE'].includes(c)) kinds.add('ASSET');
  }
  return [...kinds];
}
export function scopeComponents(scope: string): SceneComponent[] {
  switch (scope) {
    case 'ALL': return [...sceneComponents]; case 'VISUAL': return ['VISUAL']; case 'NARRATION': return ['NARRATION']; case 'VOICE': return ['VOICE', 'TIMING'];
    case 'MUSIC': return ['MUSIC']; case 'AMBIENCE': return ['AMBIENCE']; case 'EDIT': return ['EDIT']; default: throw new Error('INVALID_SCOPE');
  }
}
