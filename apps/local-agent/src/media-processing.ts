import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { renderTechnicalSchema, renderAnalysisSchema } from '@video-studio/contracts';
import { defaultProbePath, probeFile } from './probe.js';
const execute = promisify(execFile);
export const defaultFfmpeg = (probe = defaultProbePath()) => join(dirname(probe),process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
export class OutputQaError extends Error {constructor(readonly reason:'CONTENT_DEFECTS'|'AUDIO_MEASUREMENT_FAILED'|'OUTPUT_PROFILE',readonly analysis:z.infer<typeof renderAnalysisSchema>){super(reason);}}
export async function inspectTimelineDefects(path:string,binary?:string,signal?:AbortSignal){
  const result=await ffmpeg(['-protocol_whitelist','file,pipe','-i',path,'-vf','blackdetect=d=0.1:pix_th=0.10','-af','silencedetect=noise=-50dB:d=2','-f','null','-'],binary,signal);let blackFrameMs=0;let longestSilenceMs=0;let blackStartMs:number|null=null;let silenceStartMs:number|null=null;
  for(const m of result.stderr.matchAll(/black_start:([\d.]+) black_end:[\d.]+ black_duration:([\d.]+)/gu)){blackFrameMs+=Number(m[2])*1000;blackStartMs??=Number(m[1])*1000;}
  for(const m of result.stderr.matchAll(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/gu)){const duration=Number(m[2])*1000;if(duration>longestSilenceMs){longestSilenceMs=duration;silenceStartMs=Number(m[1])*1000-duration;}}
  return renderAnalysisSchema.parse({blackFrameMs:Math.round(blackFrameMs),longestSilenceMs:Math.round(longestSilenceMs),blackStartMs,silenceStartMs:silenceStartMs===null?null:Math.max(0,silenceStartMs)});
}
export async function ffmpeg(args: string[], binary = defaultFfmpeg(), signal?: AbortSignal) {
  return execute(binary,['-hide_banner','-nostdin','-nostats',...args],{ windowsHide:true,shell:false,timeout:21600000,maxBuffer:1048576,...(signal ? {signal}: {}) });
}
export async function measureLoudness(path: string, binary?: string, signal?: AbortSignal) {
  const result = await ffmpeg(['-protocol_whitelist','file,pipe','-i',path,'-vn','-af','loudnorm=I=-14:TP=-1:LRA=11:print_format=json','-f','null','-'],binary,signal);
  const match = result.stderr.match(/\{\s*"input_i"[\s\S]*?\}/u); if (!match) throw new Error('INVALID_AUDIO_MEASUREMENT');
  const data = z.object({input_i:z.string(),input_tp:z.string(),input_lra:z.string(),input_thresh:z.string(),target_offset:z.string()}).parse(JSON.parse(match[0]));
  if (Object.values(data).some((v) => !Number.isFinite(Number(v)))) throw new Error('SILENT_OR_INVALID_AUDIO'); return data;
}
export async function normalizeAudio(input: string, output: string, binary?: string, signal?: AbortSignal) {
  const m = await measureLoudness(input,binary,signal).catch(async(e:unknown)=>{if(e instanceof Error&&e.message==='SILENT_OR_INVALID_AUDIO')throw new OutputQaError('AUDIO_MEASUREMENT_FAILED',await inspectTimelineDefects(input,binary,signal));throw e;}); const filter = `loudnorm=I=-14:TP=-1:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  await ffmpeg(['-y','-protocol_whitelist','file,pipe','-i',input,'-map','0:v:0','-map','0:a:0','-c:v','copy','-af',filter,'-c:a','aac','-b:a','192k','-ar','48000','-map_metadata','-1','-fflags','+bitexact','-movflags','+faststart',output],binary,signal);
}
export async function inspectRender(path: string, probe = defaultProbePath(), encoder = defaultFfmpeg(probe), signal?: AbortSignal) {
  const analysis=await inspectTimelineDefects(path,encoder,signal);if(analysis.blackFrameMs>200||analysis.longestSilenceMs>2000)throw new OutputQaError('CONTENT_DEFECTS',analysis);
  const metadata = await probeFile(path,'video/mp4',probe);
  const result = await execute(probe,['-v','error','-protocol_whitelist','file,pipe','-show_entries','stream=codec_type,codec_name,pix_fmt,r_frame_rate,nb_frames','-of','json',path],{windowsHide:true,shell:false,timeout:15000,maxBuffer:65536,...(signal ? {signal}: {})});
  const data = z.object({streams:z.array(z.object({codec_type:z.string(),codec_name:z.string(),pix_fmt:z.string().optional(),r_frame_rate:z.string().optional(),nb_frames:z.string().optional()}))}).parse(JSON.parse(result.stdout)); const video = data.streams.find((s) => s.codec_type === 'video')!; const audio = data.streams.find((s) => s.codec_type === 'audio'); const loudness = await measureLoudness(path,encoder,signal);
  const technical = renderTechnicalSchema.parse({videoCodec:video?.codec_name,audioCodec:audio?.codec_name,pixelFormat:video?.pix_fmt,fps:video?.r_frame_rate === '30/1' ? 30 : 0,frames:Number(video?.nb_frames),loudnessI:Number(loudness.input_i),truePeakDbtp:Number(loudness.input_tp),engine:'Remotion 4.0.544 + FFmpeg local (two-pass loudnorm)',analysisVersion:1,blackFrameMs:analysis.blackFrameMs,longestSilenceMs:analysis.longestSilenceMs});
  return {metadata,technical};
}
