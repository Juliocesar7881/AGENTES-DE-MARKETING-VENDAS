import type { CalculateMetadataFunction } from "remotion";
import { Composition, staticFile } from "remotion";
import { RevenueOSVideo, type RevenueOSVideoProps } from "../Video";
import { SAMPLE_SPEC } from "../sample";

export const COMPOSITION_ID = "RevenueOSVideo";

const calculateMetadata: CalculateMetadataFunction<RevenueOSVideoProps> = ({ props }) => {
  const spec = props.spec;
  return {
    width: spec.width,
    height: spec.height,
    fps: spec.fps,
    durationInFrames: Math.max(1, Math.round(spec.duration * spec.fps)),
    props: { ...props, fontBaseUrl: props.fontBaseUrl ?? staticFile("fonts") },
  };
};

export function RemotionRoot() {
  return (
    <Composition
      id={COMPOSITION_ID}
      component={RevenueOSVideo}
      width={SAMPLE_SPEC.width}
      height={SAMPLE_SPEC.height}
      fps={SAMPLE_SPEC.fps}
      durationInFrames={Math.round(SAMPLE_SPEC.duration * SAMPLE_SPEC.fps)}
      defaultProps={{ spec: SAMPLE_SPEC, assets: {}, fontBaseUrl: undefined }}
      calculateMetadata={calculateMetadata}
    />
  );
}
