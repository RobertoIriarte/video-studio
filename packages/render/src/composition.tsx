import { AbsoluteFill, Audio, Freeze, Img, OffthreadVideo, Sequence, interpolate, useCurrentFrame } from 'remotion';
import type { RenderManifest } from '@video-studio/contracts';
export type CompositionProps = { manifest: RenderManifest; sources: Record<string, string> };
function Visual({ shot, source }: { shot: RenderManifest['scenes'][number]['shots'][number]; source: string | undefined }) {
  const frame = useCurrentFrame(); const f = Math.min(frame, shot.durationInFrames - 1); const scale = shot.motion === 'PUSH_IN' ? interpolate(f, [0, shot.durationInFrames], [1, 1.08]) : shot.motion === 'PULL_OUT' ? interpolate(f, [0, shot.durationInFrames], [1.08, 1]) : 1;
  const opacity = shot.transition === 'DISSOLVE' && shot.startFrame > 0 ? Math.min(1, frame / Math.min(15, shot.durationInFrames)) : 1;
  const style = { width: '100%', height: '100%', objectFit: shot.fit, transform: `scale(${scale})` };
  return <AbsoluteFill style={{ opacity, backgroundColor: 'black', overflow: 'hidden' }}>{!source ? <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', color: 'white', fontSize: 40 }}>Archivo local no disponible en preview web</AbsoluteFill> : shot.type === 'VIDEO' ? <Freeze frame={f}><OffthreadVideo muted src={source} trimBefore={Math.round(shot.sourceStartMs * 30 / 1000)} style={style} /></Freeze> : <Img alt="" src={source} style={style} />}</AbsoluteFill>;
}
export function VideoComposition({ manifest, sources }: CompositionProps) {
  const all = manifest.scenes.flatMap((s) => s.shots);
  return <AbsoluteFill style={{ backgroundColor: '#000' }}>{all.map((s, i) => <Sequence key={s.shotId} from={s.startFrame} durationInFrames={s.durationInFrames + (all[i + 1]?.transition === 'DISSOLVE' ? Math.min(15, all[i + 1]!.durationInFrames) : 0)}><Visual shot={s} source={sources[s.assetId]} /></Sequence>)}
    {manifest.scenes.flatMap((s) => s.audio).filter((a) => !!sources[a.assetId]).map((a) => <Sequence key={a.linkId} from={a.startFrame} durationInFrames={a.durationInFrames}><Audio src={sources[a.assetId]!} trimBefore={Math.round(a.trimStartMs * 30 / 1000)} volume={(f) => 10 ** (a.gainDb / 20) * Math.min(1, a.fadeInFrames ? f / a.fadeInFrames : 1, a.fadeOutFrames ? (a.durationInFrames - f) / a.fadeOutFrames : 1)} /></Sequence>)}
    {manifest.overlays.map((o, i) => <Sequence key={i} from={o.startFrame} durationInFrames={o.durationInFrames}><AbsoluteFill style={{ justifyContent: o.position === 'TOP' ? 'flex-start' : 'flex-end', padding: 70, fontFamily: 'Arial, sans-serif', textAlign: 'center', color: '#fff', fontSize: o.fontSize, textShadow: '0 2px 5px #000' }}><div>{o.text}</div></AbsoluteFill></Sequence>)}
  </AbsoluteFill>;
}
import type {} from './remotion-types.js';
