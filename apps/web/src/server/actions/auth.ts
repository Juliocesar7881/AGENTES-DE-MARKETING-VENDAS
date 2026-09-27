"use server";
import { redirect } from "next/navigation";
import { demoLogin, login, logout, signUp, createSession, userCount } from "@revenueos/core";
import { cookies } from "next/headers";
import { run, type ActionResult } from "../action";
import { clearSessionCookie, clientIp, SESSION_COOKIE, setSessionCookie, userAgent } from "../session";

function safeNext(next: unknown): string {
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/overview";
}

export async function loginAction(input: { email: string; password: string; next?: string }): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const s = await login(input, { ip: await clientIp(), userAgent: await userAgent() });
    await setSessionCookie(s.token, s.expiresAt);
    return null;
  });
  if (r.ok) redirect(safeNext(input.next));
  return r;
}

export async function signUpAction(input: { name: string; email: string; password: string }): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const ip = await clientIp();
    const user = await signUp(input, { ip });
    const s = await createSession(user.id, { ip, userAgent: await userAgent() });
    await setSessionCookie(s.token, s.expiresAt);
    return null;
  });
  if (r.ok) redirect((await userCount()) <= 1 ? "/setup" : "/onboarding");
  return r;
}

export async function demoAction(): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const s = await demoLogin({ ip: await clientIp(), userAgent: await userAgent() });
    await setSessionCookie(s.token, s.expiresAt);
    return null;
  });
  if (r.ok) redirect("/overview");
  return r;
}

export async function logoutAction(): Promise<void> {
  await logout((await cookies()).get(SESSION_COOKIE)?.value);
  await clearSessionCookie();
  redirect("/login");
}
