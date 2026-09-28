/* Browser-safe exports (Remotion Player previews in the web app). Node rendering lives in ./render. */
export { RevenueOSVideo, computePlacements, type RevenueOSVideoProps } from "./Video";
export { buildTheme, TEMPLATE_STYLES, type Theme, type TemplateStyle } from "./theme";
export { FONT_FILES, fontStack } from "./fonts";
export { fitFontSize, computeLayout, contrastRatio, readableOn } from "./utils";
export { SAMPLE_SPEC } from "./sample";
export * from "./transitions";
