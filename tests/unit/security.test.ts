import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertSafeSvg, validateUpload } from "@revenueos/core";
import { verifyMetaSignature, parseWhatsAppWebhook } from "@revenueos/providers/messaging";
import { MercadoPagoProvider, MockPaymentProvider, StripeProvider } from "@revenueos/providers/payment";
import { assertSafeKey, fileUrlSignature } from "@revenueos/providers/storage";
import { AppError } from "@revenueos/shared";
import { assertPublicUrl, decryptSecret, encryptSecret, hashPassword, isPrivateAddress, pkcePair, signPayload, verifyPassword, verifySignedPayload } from "@revenueos/shared/server";

const KEY = randomBytes(32);

describe("secrets at rest (AES-256-GCM)", () => {
  it("round-trips and uses a fresh IV every time", () => {
    const a = encryptSecret("EAAtoken-123", KEY);
    const b = encryptSecret("EAAtoken-123", KEY);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(decryptSecret(a, KEY)).toBe("EAAtoken-123");
  });
  it("detects tampering", () => {
    const a = encryptSecret("secret", KEY);
    const tampered = { ...a, ciphertext: Buffer.from(Buffer.from(a.ciphertext, "base64").map((x, i) => (i === 0 ? x ^ 1 : x))).toString("base64") };
    expect(() => decryptSecret(tampered, KEY)).toThrow();
    expect(() => decryptSecret(a, randomBytes(32))).toThrow();
  });
});

describe("passwords and signed payloads", () => {
  it("hashes with scrypt and verifies", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
  it("rejects modified signed payloads", () => {
    const token = signPayload({ ws: "a", exp: Date.now() + 1000 }, "k");
    expect(verifySignedPayload(token, "k")).toMatchObject({ ws: "a" });
    expect(verifySignedPayload(token.replace(/.$/, (c) => (c === "A" ? "B" : "A")), "k")).toBeNull();
    expect(verifySignedPayload(token, "other")).toBeNull();
  });
  it("creates RFC 7636 PKCE pairs", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).not.toBe(verifier);
  });
});

describe("SSRF protection", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.5.4", "192.168.0.10", "169.254.169.254", "0.0.0.0", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "100.64.0.1"])("treats %s as private", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("treats %s as public", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
  it.each(["http://localhost/", "http://127.0.0.1:3000/admin", "http://169.254.169.254/latest/meta-data", "file:///etc/passwd", "ftp://example.com", "http://[::1]/", "http://user:pass@example.com/"])("blocks %s", async (url) => {
    await expect(assertPublicUrl(url)).rejects.toBeInstanceOf(AppError);
  });
});

describe("uploads", () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);
  it("accepts a real PNG", () => {
    expect(validateUpload("logo.png", "image/png", png).mime).toBe("image/png");
  });
  it("rejects a renamed file (magic bytes mismatch)", () => {
    expect(() => validateUpload("logo.png", "image/png", Buffer.from("MZ executable"))).toThrow(/content does not match/);
  });
  it("rejects MIME/extension mismatch and unknown extensions", () => {
    expect(() => validateUpload("logo.png", "image/jpeg", png)).toThrow();
    expect(() => validateUpload("run.exe", "application/octet-stream", png)).toThrow(/not supported/);
    expect(() => validateUpload("../../etc/passwd.png", "image/png", png)).toThrow();
  });
  it("rejects SVG with scripts or external references", () => {
    expect(() => assertSafeSvg('<svg><script>alert(1)</script></svg>')).toThrow();
    expect(() => assertSafeSvg('<svg onload="x()"></svg>')).toThrow();
    expect(() => assertSafeSvg('<svg><image href="https://evil.example/x.png"/></svg>')).toThrow();
    expect(() => assertSafeSvg('<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>')).not.toThrow();
  });
});

describe("storage keys and signed file URLs", () => {
  it("rejects path traversal", () => {
    expect(() => assertSafeKey("../secrets")).toThrow();
    expect(() => assertSafeKey("workspaces/a/../../x")).toThrow();
    expect(() => assertSafeKey("/etc/passwd")).toThrow();
    expect(assertSafeKey("workspaces/abc/thumbs/x.jpg")).toBe("workspaces/abc/thumbs/x.jpg");
  });
  it("binds signatures to key and expiry", () => {
    const s = fileUrlSignature("a/b.mp4", 100, "k");
    expect(fileUrlSignature("a/b.mp4", 101, "k")).not.toBe(s);
    expect(fileUrlSignature("a/c.mp4", 100, "k")).not.toBe(s);
  });
});

describe("webhook signatures", () => {
  it("verifies Meta X-Hub-Signature-256", () => {
    const body = JSON.stringify({ entry: [] });
    const sig = "sha256=" + createHmac("sha256", "app-secret").update(body).digest("hex");
    expect(verifyMetaSignature(body, sig, "app-secret")).toBe(true);
    expect(verifyMetaSignature(body + " ", sig, "app-secret")).toBe(false);
    expect(verifyMetaSignature(body, sig, "other")).toBe(false);
    expect(verifyMetaSignature(body, undefined, "app-secret")).toBe(false);
  });

  it("parses WhatsApp messages with referral data", () => {
    const events = parseWhatsAppWebhook({
      entry: [{ changes: [{ value: { metadata: { phone_number_id: "123" }, contacts: [{ wa_id: "5511999", profile: { name: "Ana" } }], messages: [{ id: "wamid.1", from: "5511999", timestamp: "1790000000", type: "text", text: { body: "Oi (código ABC234)" }, referral: { source_id: "ad1", source_type: "ad" } }] } }] }],
    });
    expect(events[0]).toMatchObject({ kind: "message", accountId: "123", from: "5511999", fromName: "Ana", text: "Oi (código ABC234)" });
  });

  it("verifies Mercado Pago x-signature manifest", () => {
    const mp = new MercadoPagoProvider({ accessToken: "APP_USR-x", webhookSecret: "mp-secret" });
    const manifest = "id:12345;request-id:req-1;ts:1700000000;";
    const v1 = createHmac("sha256", "mp-secret").update(manifest).digest("hex");
    const req = { rawBody: JSON.stringify({ data: { id: "12345" }, type: "payment" }), headers: { "x-signature": `ts=1700000000,v1=${v1}`, "x-request-id": "req-1" }, query: { "data.id": "12345" } };
    expect(mp.verifyWebhook(req).valid).toBe(true);
    expect(mp.verifyWebhook({ ...req, headers: { ...req.headers, "x-request-id": "req-2" } }).valid).toBe(false);
  });

  it("verifies Stripe signatures and rejects replays", () => {
    const st = new StripeProvider({ secretKey: "sk_test_x", webhookSecret: "whsec_test" });
    const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1" } } });
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", "whsec_test").update(`${t}.${body}`).digest("hex");
    expect(st.verifyWebhook({ rawBody: body, headers: { "stripe-signature": `t=${t},v1=${sig}` }, query: {} }).valid).toBe(true);
    const old = t - 3600;
    const oldSig = createHmac("sha256", "whsec_test").update(`${old}.${body}`).digest("hex");
    expect(st.verifyWebhook({ rawBody: body, headers: { "stripe-signature": `t=${old},v1=${oldSig}` }, query: {} }).reason).toMatch(/tolerance/);
  });

  it("mock payments go through the same signature check", () => {
    const mock = new MockPaymentProvider("secret", "http://localhost:3000");
    const req = mock.buildWebhook({ eventId: "e1", externalReference: "rv_1", providerPaymentId: "p1", status: "APPROVED", amountCents: 9900, currency: "BRL" });
    expect(mock.verifyWebhook(req).valid).toBe(true);
    expect(mock.verifyWebhook({ ...req, rawBody: req.rawBody.replace("9900", "990000") }).valid).toBe(false);
  });
});
