import { youtubeMetadataSchema } from '@video-studio/contracts';
import type { RenderManifest, YoutubeMetadata } from '@video-studio/contracts';
export function validateYoutubeTimeline(m:RenderManifest,data:YoutubeMetadata){
  youtubeMetadataSchema.parse(data);
  if(data.chapters.length!==m.scenes.length||data.chapters.some((c,i)=>c.sceneId!==m.scenes[i]!.sceneId||c.startMs!==Math.floor(m.scenes[i]!.startFrame*1000/30)))throw new Error('INVALID_CHAPTER_TIMELINE');
}
export function youtubeDraft(m:RenderManifest,title:string,sections:{stableKey:string;title:string}[],keys:Map<string,string>):YoutubeMetadata{
  return youtubeMetadataSchema.parse({title:title.slice(0,100)||'Video',description:'',tags:[],chapters:m.scenes.map((s,i)=>({sceneId:s.sceneId,startMs:Math.floor(s.startFrame*1000/30),title:(sections.find((v)=>v.stableKey===keys.get(s.sceneId))?.title??`Escena ${i+1}`).slice(0,100)})),thumbnailIdeas:['Elegir un fotograma autorizado del render y añadir un título breve y legible.'],disclosureSuggestions:['Revisar atribuciones, licencias y divulgación de contenido sintético según los recursos utilizados.']});
}
export {chapterText,youtubeDescription} from '@video-studio/contracts';
