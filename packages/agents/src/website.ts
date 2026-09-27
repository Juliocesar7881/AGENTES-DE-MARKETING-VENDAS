import { CompositionProposalSchema, WebsiteInsightsOutputSchema, type CompositionProposal, type ContentBrief, type WebsiteInsightsOutput } from "@revenueos/shared";
import { renderBusinessBlock, type BusinessContext } from "./context";
import { mockWebsiteInsights } from "./mock/review";
import { COMPOSITION_PROMPT_VERSION, COMPOSITION_SYSTEM, WEBSITE_PROMPT_VERSION, WEBSITE_SYSTEM } from "./prompts/review.v1";
import { runAgent, type AgentResult, type AgentRuntime } from "./runtime";

export interface WebsiteText {
  url: string;
  title: string;
  description: string;
  headings: string[];
  text: string;
}

/** Classification-model call that turns public website text into onboarding suggestions. */
export function websiteInsights(rt: AgentRuntime, page: WebsiteText): Promise<AgentResult<WebsiteInsightsOutput>> {
  return runAgent(rt, {
    agent: "STRATEGIST",
    task: "onboarding.website_insights",
    promptVersion: WEBSITE_PROMPT_VERSION,
    system: [{ text: WEBSITE_SYSTEM }],
    messages: [
      {
        role: "user",
        content: `URL: ${page.url}\nTitle: ${page.title}\nMeta description: ${page.description}\nHeadings: ${page.headings.join(" | ")}\n\nVisible text (truncated):\n${page.text.slice(0, 12000)}`,
      },
    ],
    schema: WebsiteInsightsOutputSchema,
    schemaName: "website_insights",
    inputSummary: `website ${page.url}`,
    mock: () => mockWebsiteInsights(page),
  });
}

const MOCK_COMPOSITION = `import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export default function Composition(props: { spec: { hook: { text: string }; brand: { primaryColor: string; backgroundColor: string; textColor: string }; cta: { text: string } } }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200 } });
  const outro = interpolate(frame, [durationInFrames - fps * 2, durationInFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: props.spec.brand.backgroundColor, alignItems: "center", justifyContent: "center", padding: 96 }}>
      <div style={{ color: props.spec.brand.textColor, fontSize: 96, fontWeight: 800, textAlign: "center", transform: \`scale(\${0.8 + s * 0.2})\`, opacity: s * (1 - outro) }}>
        {props.spec.hook.text}
      </div>
      <div style={{ position: "absolute", bottom: 360, color: props.spec.brand.primaryColor, fontSize: 64, fontWeight: 700, opacity: outro }}>
        {props.spec.cta.text}
      </div>
    </AbsoluteFill>
  );
}
`;

/** ADVANCED CREATIVE: Claude proposes a brand-new Remotion composition (validated in a sandbox before use). */
export function proposeComposition(rt: AgentRuntime, ctx: BusinessContext, brief: ContentBrief): Promise<AgentResult<CompositionProposal>> {
  return runAgent(rt, {
    agent: "CREATIVE",
    task: "creative.advanced_composition",
    promptVersion: COMPOSITION_PROMPT_VERSION,
    system: [{ text: COMPOSITION_SYSTEM }, { text: renderBusinessBlock(ctx), cache: true }],
    messages: [{ role: "user", content: `Design a new composition for this brief:\n${JSON.stringify(brief, null, 2)}` }],
    schema: CompositionProposalSchema,
    schemaName: "composition_proposal",
    inputSummary: `advanced composition for "${brief.hook}"`,
    mock: () => ({ name: "Hook Spotlight", description: "Minimal kinetic hook with CTA outro (demo).", code: MOCK_COMPOSITION }),
  });
}
