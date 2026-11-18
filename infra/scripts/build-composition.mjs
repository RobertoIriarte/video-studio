import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(new URL('../../apps/local-agent/package.json',import.meta.url));
const { bundle } = await import(pathToFileURL(require.resolve('@remotion/bundler')).href);
export async function buildComposition(outDir=fileURLToPath(new URL('../../apps/local-agent/dist/composition',import.meta.url))) { return bundle({ entryPoint: fileURLToPath(new URL('../../packages/render/src/root.tsx',import.meta.url)), outDir, publicDir: null, enableCaching: true, webpackOverride: (config) => ({ ...config, resolve: { ...config.resolve, extensionAlias: { ...config.resolve?.extensionAlias, '.js': ['.ts','.tsx','.js'] } } }) }); }
if (process.argv[1] === fileURLToPath(import.meta.url)) await buildComposition();
