import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "rvos_session";
/** Pages reachable without a session (API routes enforce their own auth). */
const PUBLIC_PREFIXES = ["/login", "/signup", "/l/", "/r/", "/demo/checkout/", "/checkout/", "/legal"];

/**
 * Runs before every page: per-request CSP nonce, and a cheap redirect to
 * /login when there is no session cookie. The session itself is validated
 * server-side in the layouts (database lookup), never trusted from the cookie alone.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`) || pathname === p.replace(/\/$/, ""));
  if (!isPublic && !request.cookies.get(SESSION_COOKIE)?.value) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname + search)}` : "";
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV !== "production";
  const https = (process.env.APP_URL ?? "").startsWith("https://");
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes are used by charts, the video player and animations.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    // Local worker previews (127.0.0.1) and signed storage URLs.
    "media-src 'self' blob: https: http://127.0.0.1:* http://localhost:*",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|video-fonts|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
