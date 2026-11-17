import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('smoke del workspace (sin servicios ni proveedores)', () => {
  it('pnpm descubre los ocho workspaces privados', () => {
    const pnpmPath = process.env.npm_execpath;
    if (!pnpmPath) throw new Error('Ejecutar mediante pnpm test para localizar pnpm.');

    const output = execFileSync(process.execPath, [pnpmPath, 'list', '-r', '--depth', '-1', '--json'], {
      encoding: 'utf8',
      cwd: new URL('..', import.meta.url),
    });
    const projects = JSON.parse(output) as { name: string; private: boolean }[];
    const workspaces = projects.filter(({ name }) => name.startsWith('@video-studio/'));

    expect(workspaces.map(({ name }) => name).sort()).toEqual([
      '@video-studio/api', '@video-studio/contracts', '@video-studio/domain',
      '@video-studio/local-agent', '@video-studio/providers', '@video-studio/render',
      '@video-studio/testkit', '@video-studio/web',
    ]);
    expect(workspaces.every(({ private: isPrivate }) => isPrivate)).toBe(true);
  });

  it('resuelve un paquete TypeScript interno mediante workspace:* sin build previo', async () => {
    // Verifica enlace y exports, no simula contratos de dominio todavía inexistentes.
    const contracts = await import('@video-studio/contracts');
    expect(contracts).toBeDefined();
  });
});
