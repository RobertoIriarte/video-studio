import { assetSchema, assetInputSchema, importInputSchema, uuidSchema } from '@video-studio/contracts';
import { copyIntoCache } from './cache.js';
import { probeFile } from './probe.js';
import type { AgentClient } from './client.js';
import type { AgentConfig } from './config.js';
import { writeConfig } from './config.js';

// Only an explicit local CLI path is accepted. The API never supplies filesystem paths.
export async function importLocalFile(client: AgentClient, config: AgentConfig, input?: { file: string; projectId: string; mime: string; source: string; rights: boolean }) {
  let pending = config.pendingAsset;
  if (!pending) {
    if (!input || !input.rights) throw new Error('EXPLICIT_FILE_AND_RIGHTS_REQUIRED');
    const projectId = uuidSchema.parse(input.projectId); const mime = importInputSchema.shape.mime.parse(input.mime); const assetId = crypto.randomUUID();
    const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav' };
    const copied = await copyIntoCache(config.mediaRoot, projectId, assetId, input.file, extensions[mime]);
    const metadata = await probeFile(copied.path, mime, config.ffprobe);
    pending = { projectId, assetId, operation: crypto.randomUUID(), asset: assetInputSchema.parse({ ...metadata, origin: 'MANUAL', license: { source: input.source, note: '', rightsAcknowledged: true }, prompt: null }) };
    config = { ...config, pendingAsset: pending }; await writeConfig(config);
  }
  const result = await client.call('/agents/assets/register', assetSchema, { projectId: pending.projectId, assetId: pending.assetId, asset: pending.asset }, pending.operation);
  const { pendingAsset: _pending, ...next } = config; void _pending; await writeConfig(next); return result;
}
