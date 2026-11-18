import { z } from 'zod';
import { uuidSchema, revisionSchema, utcTimestampSchema } from './common.js';
import { contentHashSchema } from './catalog.js';
import { renderRecordSchema, renderManifestSchema } from './render.js';
export const youtubeMetadataSchema = z.strictObject({
  title:z.string().trim().min(1).max(100), description:z.string().trim().max(5000),
  tags:z.array(z.string().trim().min(1).max(100)).max(30).refine((v)=>v.join(',').length<=500),
  chapters:z.array(z.strictObject({sceneId:uuidSchema,startMs:z.int().nonnegative(),title:z.string().trim().min(1).max(100)})).min(1).max(100),
  thumbnailIdeas:z.array(z.string().trim().min(1).max(500)).max(5), disclosureSuggestions:z.array(z.string().trim().min(1).max(500)).max(10),
});
export const youtubeSaveSchema=z.strictObject({expectedRevision:revisionSchema,metadata:youtubeMetadataSchema,acknowledgeReview:z.literal(true)});
export const youtubePackageSchema=z.strictObject({id:uuidSchema,projectId:uuidSchema,renderId:uuidSchema,manifestId:uuidSchema,manifestHash:contentHashSchema,renderChecksum:contentHashSchema,versionNo:revisionSchema,contentHash:contentHashSchema,metadata:youtubeMetadataSchema,createdAt:utcTimestampSchema});
export const youtubeViewSchema=z.strictObject({revision:revisionSchema,render:renderRecordSchema,manifest:renderManifestSchema,draft:youtubeMetadataSchema,items:z.array(youtubePackageSchema).max(25),nextCursor:z.string().nullable()});
export const youtubeExportSchema=z.strictObject({package:youtubePackageSchema,render:renderRecordSchema,manifest:renderManifestSchema});
export type YoutubeMetadata=z.infer<typeof youtubeMetadataSchema>;

export function chapterText(data:YoutubeMetadata){return data.chapters.map((c)=>{const seconds=Math.floor(c.startMs/1000);const h=Math.floor(seconds/3600);return `${h?`${h}:`:''}${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')} ${c.title}`;}).join('\n');}
export function youtubeDescription(data:YoutubeMetadata){return [data.description,chapterText(data)].filter(Boolean).join('\n\n');}
