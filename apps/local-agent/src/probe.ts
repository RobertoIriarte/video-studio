import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import { mediaMetadataSchema } from '@video-studio/contracts';
import type { MediaMetadata } from '@video-studio/contracts';
import { fileHash } from './cache.js';
const execute = promisify(execFile);
export const defaultProbePath = () => process.env.VIDEO_STUDIO_FFPROBE_PATH ?? (process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'VideoStudio', 'tools', 'ffmpeg-9.0.2', 'ffmpeg-9.0.2-essentials_build', 'bin', 'ffprobe.exe') : '/usr/bin/ffprobe');
export async function probeVersion(binary = defaultProbePath()) { try { if (!isAbsolute(binary) || !(await lstat(binary)).isFile()) return null; const result = await execute(binary, ['-version'], { timeout: 10000, maxBuffer: 32768, windowsHide: true, shell: false }); return result.stdout.split('\n')[0]!.trim().slice(0, 200); } catch { return null; } }
export async function probeFile(path: string, mime: MediaMetadata['mime'], binary = defaultProbePath()): Promise<MediaMetadata> {
  if (!isAbsolute(binary) || !isAbsolute(path)) throw new Error('ABSOLUTE_PATH_REQUIRED'); const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 2 * 1024 ** 3) throw new Error('INVALID_MEDIA');
  const demuxers = { 'image/png': 'png_pipe', 'image/jpeg': 'jpeg_pipe', 'image/webp': 'webp_pipe', 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'video/mp4': 'mov,mp4,m4a,3gp,3g2,mj2' };
  const args = ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', demuxers[mime], '-probesize', '5242880', '-analyzeduration', '5000000', ...(mime === 'video/mp4' ? ['-enable_drefs', '0', '-use_absolute_path', '0'] : []), '-show_entries', 'format=format_name,duration:stream=codec_type,codec_name,width,height,duration', '-of', 'json', path];
  let raw: unknown; try { raw = JSON.parse((await execute(binary, args, { cwd: dirname(path), timeout: 15000, maxBuffer: 131072, windowsHide: true, shell: false })).stdout) as unknown; } catch { throw new Error('INVALID_MEDIA'); }
  const data = z.object({ format: z.object({ format_name: z.string(), duration: z.string().optional() }), streams: z.array(z.object({ codec_type: z.string(), codec_name: z.string(), width: z.number().optional(), height: z.number().optional(), duration: z.string().optional() })).min(1).max(16) }).parse(raw);
  const imageCodec = { 'image/png': 'png', 'image/jpeg': 'mjpeg', 'image/webp': 'webp' }; const type = mime.startsWith('image/') ? 'IMAGE' : mime.startsWith('video/') ? 'VIDEO' : 'AUDIO';
  const stream = data.streams.find((s) => s.codec_type === (type === 'AUDIO' ? 'audio' : 'video')); if (!stream) throw new Error('INVALID_MEDIA');
  if (type === 'IMAGE' && stream.codec_name !== imageCodec[mime as keyof typeof imageCodec]) throw new Error('INVALID_MEDIA');
  const formats = { 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'video/mp4': 'mp4' }; if (type !== 'IMAGE' && !data.format.format_name.split(',').includes(formats[mime as keyof typeof formats])) throw new Error('INVALID_MEDIA');
  const width = type === 'AUDIO' ? null : stream.width ?? null; const height = type === 'AUDIO' ? null : stream.height ?? null; const durationMs = type === 'IMAGE' ? null : Math.round(Number(data.format.duration ?? stream.duration) * 1000);
  if (type !== 'AUDIO' && (!width || !height || width > 8192 || height > 8192 || width * height > 16777216)) throw new Error('INVALID_MEDIA'); if (durationMs !== null && (!Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > 21600000)) throw new Error('INVALID_MEDIA');
  return mediaMetadataSchema.parse({ mime, type, ...(await fileHash(path)), width, height, durationMs });
}
