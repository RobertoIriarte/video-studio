import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, copyFile, link, lstat, mkdir, open, realpath, statfs, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { uuidSchema } from '@video-studio/contracts';

export function contained(root: string, path: string) { const rel = relative(resolve(root), resolve(path)); if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('UNSAFE_PATH'); return resolve(path); }
export async function cacheRoot(root: string) {
  if (!isAbsolute(root)) throw new Error('ABSOLUTE_ROOT_REQUIRED'); let current = resolve(root);
  while (true) { try { const info = await lstat(current); if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('UNSAFE_ROOT'); const canonical = await realpath(current); if ((process.platform === 'win32' ? canonical.toLowerCase() : canonical) !== (process.platform === 'win32' ? current.toLowerCase() : current)) throw new Error('UNSAFE_ROOT'); break; } catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; const parent = resolve(current, '..'); if (parent === current) throw error; current = parent; } }
  await mkdir(root, { recursive: true, mode: 0o700 }); return realpath(root);
}
export async function assetDirectory(root: string, projectId: string, assetId: string) {
  uuidSchema.parse(projectId); uuidSchema.parse(assetId); const canonical = await cacheRoot(root); let dir = canonical;
  for (const part of ['projects', projectId, 'assets', assetId]) { dir = contained(canonical, join(dir, part)); await mkdir(dir, { mode: 0o700 }).catch((e: unknown) => { if (!(e && typeof e === 'object' && 'code' in e && e.code === 'EEXIST')) throw e; }); const info = await lstat(dir); if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('UNSAFE_PATH'); }
  return dir;
}
export async function fileHash(path: string) { const hash = createHash('sha256'); let bytes = 0; for await (const chunk of createReadStream(path)) { hash.update(chunk as Buffer); bytes += (chunk as Buffer).length; if (!Number.isSafeInteger(bytes) || bytes > 2 * 1024 ** 3) throw new Error('FILE_TOO_LARGE'); } return { checksum: hash.digest('hex'), bytes }; }
export async function diskFree(root: string) { const stats = await statfs(await cacheRoot(root)); const bytes = stats.bavail * stats.bsize; if (!Number.isSafeInteger(bytes)) throw new Error('INVALID_DISK_STATUS'); return bytes; }
export async function copyIntoCache(root: string, projectId: string, assetId: string, source: string, extension: string) {
  if (!isAbsolute(source) || !/^(png|jpg|webp|mp4|mp3|ogg|wav)$/.test(extension)) throw new Error('UNSAFE_INPUT'); const info = await lstat(source); if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > 2 * 1024 ** 3) throw new Error('INVALID_FILE');
  if (await diskFree(root) < info.size + 100 * 1024 ** 2) throw new Error('INSUFFICIENT_DISK'); const directory = await assetDirectory(root, projectId, assetId); const final = join(directory, `source.${extension}`); const temporary = contained(directory, join(directory, `${randomUUID()}.partial`));
  try {
    await access(final).then(() => { throw new Error('ASSET_EXISTS'); }, () => undefined); await copyFile(source, temporary, constants.COPYFILE_EXCL); const checked = await fileHash(temporary); await link(temporary, final); await unlink(temporary); return { path: final, ...checked };
  } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
}
export async function saveDownloaded(root: string, projectId: string, assetId: string, body: ReadableStream<Uint8Array>, maxBytes: number, expectedHash: string) {
  const directory = await assetDirectory(root, projectId, assetId); const final = join(directory, 'inspection.bin'); const temporary = contained(directory, join(directory, `${randomUUID()}.partial`));
  if (await diskFree(root) < maxBytes + 100 * 1024 ** 2) throw new Error('INSUFFICIENT_DISK');
  const handle = await open(temporary, 'wx', 0o600); await handle.close();
  let total = 0;
  async function* limited() { const reader = body.getReader(); try { while (true) { const part = await reader.read(); if (part.done) break; total += part.value.length; if (total > maxBytes) throw new Error('FILE_TOO_LARGE'); yield part.value; } } finally { await reader.cancel().catch(() => undefined); } }
  try { await pipeline(limited(), createWriteStream(temporary, { flags: 'r+' })); const checked = await fileHash(temporary); if (checked.checksum !== expectedHash || checked.bytes !== maxBytes) throw new Error('INVALID_MEDIA'); await link(temporary, final).catch(async (e: unknown) => { if (!(e && typeof e === 'object' && 'code' in e && e.code === 'EEXIST')) throw e; const info = await lstat(final); if (!info.isFile() || info.isSymbolicLink() || (await fileHash(final)).checksum !== expectedHash) throw new Error('IMMUTABLE_ASSET_CONFLICT'); }); await unlink(temporary); return final; }
  catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
}
