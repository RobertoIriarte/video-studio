import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('setup externo conserva secretos sin imprimirlos ni admitir paths internos disfrazados', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'video-studio-config-test-')), 'private.env');
  const run = (path: string) => spawnSync(process.execPath, ['infra/scripts/private-env.mjs'], { encoding: 'utf8', env: { ...process.env, VIDEO_STUDIO_ENV_FILE: path } });
  const first = run(file); expect(first.status).toBe(0);
  const contents = readFileSync(file, 'utf8');
  const secret = contents.match(/^AUTH_SECRET=(.+)$/m)?.[1]; expect(secret).toHaveLength(64);
  expect(first.stdout).not.toContain(secret); expect(first.stderr).toBe('');
  expect(run(file).status).toBe(0); expect(readFileSync(file, 'utf8')).toBe(contents);
  expect(run(resolve('..private-test.env')).status).not.toBe(0);
});
