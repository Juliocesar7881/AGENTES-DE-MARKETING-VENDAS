import { parse } from "node-html-parser";
import { websiteInsights, type WebsiteText } from "@revenueos/agents";
import type { WebsiteInsightsOutput } from "@revenueos/shared";
import { safeFetch } from "@revenueos/shared/server";
import { resolveAI } from "../providers";

export interface WebsiteAnalysis {
  url: string;
  name: string | null;
  description: string | null;
  logoUrl: string | null;
  iconUrl: string | null;
  ogImage: string | null;
  colors: string[];
  themeColor: string | null;
  headings: string[];
  prices: string[];
  textSample: string;
  ai: WebsiteInsightsOutput | null;
  aiError: string | null;
}

function absolutize(href: string | undefined | null, base: string): string | null {
  if (!href) return null;
  try {
    const u = new URL(href, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function normHex(h: string): string {
  let x = h.toLowerCase();
  if (x.length === 4) x = `#${x[1]}${x[1]}${x[2]}${x[2]}${x[3]}${x[3]}`;
  return x;
}

/** Extracts brand signals from public HTML (pure; tested with fixtures). */
export function extractFromHtml(html: string, url: string): Omit<WebsiteAnalysis, "ai" | "aiError"> {
  const root = parse(html, { comment: false, blockTextElements: { script: false, style: true, noscript: false } });
  const meta = (sel: string) => root.querySelector(sel)?.getAttribute("content")?.trim() || null;
  const title = root.querySelector("title")?.text.trim() || null;
  const name = meta('meta[property="og:site_name"]') ?? meta('meta[name="application-name"]') ?? (title ? title.split(/[|\-–·]/)[0]!.trim() : null);
  const description = meta('meta[name="description"]') ?? meta('meta[property="og:description"]');
  const icons = root.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="shortcut icon"]');
  const apple = icons.find((l) => (l.getAttribute("rel") ?? "").includes("apple"));
  const iconUrl = absolutize((apple ?? icons[0])?.getAttribute("href"), url);
  const logoImg = root.querySelectorAll("img").find((i) => /logo/i.test(`${i.getAttribute("alt") ?? ""} ${i.getAttribute("class") ?? ""} ${i.getAttribute("src") ?? ""} ${i.getAttribute("id") ?? ""}`));
  const logoUrl = absolutize(logoImg?.getAttribute("src"), url);
  const ogImage = absolutize(meta('meta[property="og:image"]'), url);
  const themeColor = meta('meta[name="theme-color"]');
  const styleText = root.querySelectorAll("style").map((s) => s.text).join("\n") + " " + root.querySelectorAll("[style]").map((e) => e.getAttribute("style")).join(" ");
  const freq = new Map<string, number>();
  for (const m of styleText.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) {
    const c = normHex(m[0]);
    if (["#ffffff", "#000000", "#fff", "#000"].includes(c)) continue;
    freq.set(c, (freq.get(c) ?? 0) + 1);
  }
  const colors = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 6);
  root.querySelectorAll("script, style, noscript, svg, nav, footer").forEach((n) => n.remove());
  const headings = root
    .querySelectorAll("h1, h2, h3")
    .map((h) => h.text.replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 2 && t.length < 120)
    .slice(0, 20);
  const text = root.text.replace(/\s+/g, " ").trim();
  const prices = [...new Set([...text.matchAll(/R\$\s?\d{1,3}(?:\.\d{3})*(?:,\d{2})?/g)].map((m) => m[0]))].slice(0, 10);
  return { url, name, description, logoUrl, iconUrl, ogImage, colors: themeColor ? [normHex(themeColor), ...colors.filter((c) => c !== normHex(themeColor))].slice(0, 6) : colors, themeColor, headings, prices, textSample: text.slice(0, 12000) };
}

/**
 * "Analyze my website": SSRF-protected fetch of a PUBLIC page (no private
 * networks, no credentials, redirects re-validated), brand extraction, and an
 * optional structured summary with the classification model.
 */
export async function analyzeWebsite(rawUrl: string, opts: { useAI: boolean; workspace?: { id: string; environment: "LIVE" | "DEMO" } | null }): Promise<WebsiteAnalysis> {
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const res = await safeFetch(url, { maxBytes: 2 * 1024 * 1024, timeoutMs: 10_000 });
  if (!/html/i.test(res.contentType)) {
    return { url: res.url, name: null, description: null, logoUrl: null, iconUrl: null, ogImage: null, colors: [], themeColor: null, headings: [], prices: [], textSample: "", ai: null, aiError: "The URL did not return an HTML page." };
  }
  const base = extractFromHtml(res.body.toString("utf8"), res.url);
  let ai: WebsiteInsightsOutput | null = null;
  let aiError: string | null = null;
  if (opts.useAI) {
    try {
      const resolved = await resolveAI(opts.workspace ?? null, "classification");
      const page: WebsiteText = { url: base.url, title: base.name ?? "", description: base.description ?? "", headings: base.headings, text: base.textSample };
      ai = (await websiteInsights(resolved.runtime, page)).result.data;
    } catch (e) {
      aiError = e instanceof Error ? e.message : String(e);
    }
  }
  return { ...base, ai, aiError };
}
