import { afterEach, describe, expect, it } from "vitest";
import { captionLink, resetConfigCache } from "@revenueos/core";
import { isPublicAppUrl } from "@revenueos/shared";

describe("links in public captions", () => {
  const saved = process.env.APP_URL;
  afterEach(() => {
    process.env.APP_URL = saved;
    resetConfigCache();
  });

  it("never publishes a localhost/LAN address", () => {
    for (const u of ["http://localhost:3000", "https://localhost", "http://192.168.0.10:3000", "https://10.0.0.5", "http://example.com"]) expect(isPublicAppUrl(u)).toBe(false);
    expect(isPublicAppUrl("https://revenue.minhaempresa.com.br")).toBe(true);
  });

  it("without a public address: direct WhatsApp link carrying the video's code (or the website)", () => {
    process.env.APP_URL = "http://localhost:3000";
    resetConfigCache();
    const wa = captionLink({ whatsappNumber: "+55 (11) 99999-0000", website: null }, "K7QM2X");
    expect(wa).toMatch(/^https:\/\/wa\.me\/5511999990000\?text=/);
    expect(decodeURIComponent(wa!)).toContain("código K7QM2X");
    expect(captionLink({ whatsappNumber: null, website: "https://clinica.com.br" }, "K7QM2X")).toBe("https://clinica.com.br");
    expect(captionLink({ whatsappNumber: null, website: null }, "K7QM2X")).toBeNull();
  });

  it("with a public address: the tracked link (clicks are counted)", () => {
    process.env.APP_URL = "https://revenue.minhaempresa.com.br";
    resetConfigCache();
    expect(captionLink({ whatsappNumber: "5511999990000", website: null }, "K7QM2X")).toBe("https://revenue.minhaempresa.com.br/r/K7QM2X");
  });
});

describe("YouTube metadata", () => {
  it("sends every tag (without #, deduplicated) within YouTube's 500-character budget", async () => {
    const { youtubeTags } = await import("@revenueos/providers");
    expect(youtubeTags(["#bitcoin", "#Bitcoin", "cripto", "#preço do bitcoin"])).toEqual(["bitcoin", "cripto", "preço do bitcoin"]);
    const long = Array.from({ length: 15 }, (_, i) => `#${String(i).padStart(2, "0")}${"x".repeat(38)}`);
    const tags = youtubeTags(long);
    expect(tags.length).toBeLessThan(15);
    expect(tags.join(",").length).toBeLessThanOrEqual(500);
  });
});
