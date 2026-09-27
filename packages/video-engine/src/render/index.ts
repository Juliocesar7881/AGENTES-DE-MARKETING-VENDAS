/* Node-only rendering API used by the local worker. */
export { renderVideo, thumbnailFrame, type RenderVideoOptions, type RenderVideoResult } from "./render";
export { getBundle, ENGINE_ROOT, PUBLIC_DIR } from "./bundle";
export { probeVideo, validateVideo, type ProbeResult, type ValidationCheck, type VideoExpectations } from "./probe";
export { extractFrames, type FrameStats } from "./frames";
export { runContentQA, type QaInput, type QaResult, type QaCheck } from "./qa";
export { locateFfmpeg, ffmpegVersion, runBinary } from "./ffmpeg";
export { startAssetServer } from "./asset-server";
export { generateAmbientTrack } from "./audio";
export { staticAnalyze, typecheckComposition, validateComposition, ALLOWED_IMPORTS, type SandboxReport } from "./sandbox";
export { renderCompositionTest } from "./composition-test";
