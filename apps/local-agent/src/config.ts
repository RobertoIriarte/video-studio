import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readFile, writeFile, rename, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assetInputSchema } from '@video-studio/contracts';
import { z } from 'zod';
import { cacheRoot } from './cache.js';

export const agentConfigSchema = z.strictObject({ origin: z.string(), mediaRoot: z.string(), agentId: z.uuid().optional(), token: z.string().regex(/^[a-f0-9]{64}$/).optional(), ffprobe: z.string().optional(), claimOperation: z.uuid().optional(), pendingAsset: z.strictObject({ projectId: z.uuid(), assetId: z.uuid(), operation: z.uuid(), asset: assetInputSchema }).optional(), pairing: z.object({ code: z.string().regex(/^[a-f0-9]{64}$/), name: z.string(), operation: z.uuid() }).optional() });
export type AgentConfig = z.infer<typeof agentConfigSchema>;
const profile = () => process.env.LOCALAPPDATA ?? join(homedir(), '.local', 'share');
export const defaultConfigPath = () => process.env.VIDEO_STUDIO_AGENT_CONFIG ?? join(profile(), 'VideoStudio', 'agent.json');
export const defaultMediaRoot = () => join(profile(), 'VideoStudio', 'media');
function allowedConfig(path: string) { if (!isAbsolute(path)) throw new Error('ABSOLUTE_CONFIG_REQUIRED'); const repo = resolve(fileURLToPath(new URL('../../../', import.meta.url))); const rel = relative(repo, path); if (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) throw new Error('SECRET_CONFIG_MUST_BE_OUTSIDE_REPOSITORY'); }
export async function readConfig(path = defaultConfigPath()) { allowedConfig(path); const info = await lstat(path); if (info.isSymbolicLink() || !info.isFile()) throw new Error('UNSAFE_CONFIG'); return agentConfigSchema.parse(JSON.parse(await readFile(path, 'utf8')) as unknown); }
export async function writeConfig(config: AgentConfig, path = defaultConfigPath()) { allowedConfig(path); const parent = await cacheRoot(dirname(path)); const temporary = join(parent, `agent-${crypto.randomUUID()}.partial`); await writeFile(temporary, JSON.stringify(agentConfigSchema.parse(config)), { flag: 'wx', mode: 0o600 }); await rename(temporary, path); }
