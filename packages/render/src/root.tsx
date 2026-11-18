import { Composition, registerRoot } from 'remotion';
import { renderManifestSchema } from '@video-studio/contracts';
import { VideoComposition } from './composition';
function Input(props: Record<string, unknown>) {
  const sources = Object.fromEntries(Object.entries(props.sources ?? {}).filter((entry): entry is [string,string] => typeof entry[1] === 'string'));
  return <VideoComposition manifest={renderManifestSchema.parse(props.manifest)} sources={sources} />;
}
registerRoot(() => <Composition id="VideoStudio" component={Input} width={1920} height={1080} fps={30} durationInFrames={30} calculateMetadata={({ props }) => ({ durationInFrames: renderManifestSchema.parse(props.manifest).durationInFrames })} />);
