"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getAISettings, resetConfigCache, resetStorageSingleton, testAnthropic, testPaymentProvider, testSocialAccount, testWhatsApp } from "@revenueos/core";
import { and, eq, getDb, inArray, integrations, socialAccounts } from "@revenueos/database";
import { SupabaseStorageProvider } from "@revenueos/providers/storage";
import { AppError, serializeError } from "@revenueos/shared";
import { envFileWritable, updateEnvFile } from "@revenueos/shared/server";
import { z } from "zod";
import { run } from "../action";
import { workerStatuses } from "../queries";
import { listWorkspaces, requireAdmin } from "../session";

function assertWritable(): void {
  if (!envFileWritable()) {
    throw new AppError({ code: "READ_ONLY", userMessage: "This server cannot change its own configuration (e.g. Vercel). Set the environment variable in your hosting provider and redeploy.", httpStatus: 400 });
  }
}

const AppUrlSchema = z
  .string()
  .trim()
  .url("Enter a full address, e.g. https://revenue.example.com")
  .regex(/^https?:\/\//, "Use http:// or https://")
  .max(300);

/** Changes the dashboard address used in tracked links, OAuth redirects and webhooks. */
export async function saveAppUrlAction(url: string) {
  return run(async () => {
    await requireAdmin();
    assertWritable();
    const clean = AppUrlSchema.parse(url).replace(/\/$/, "");
    updateEnvFile({ APP_URL: clean, NEXT_PUBLIC_APP_URL: clean });
    resetConfigCache();
    resetStorageSingleton();
    revalidatePath("/", "layout");
    return { appUrl: clean };
  }, "Dashboard address saved");
}

const StorageSchema = z.discriminatedUnion("driver", [
  z.object({ driver: z.literal("local") }),
  z.object({
    driver: z.literal("supabase"),
    supabaseUrl: z
      .string()
      .trim()
      .url()
      .regex(/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i, "Use the Project URL, e.g. https://abcd1234.supabase.co"),
    serviceRoleKey: z.string().trim().max(2000).optional(),
    bucket: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-_]{1,62}$/, "Lowercase letters, numbers, - and _")
      .default("revenueos"),
  }),
]);

/** Switches file storage (local disk ↔ Supabase Storage). Supabase is tested with a real upload first. */
export async function saveStorageAction(input: unknown) {
  return run(async () => {
    await requireAdmin();
    assertWritable();
    const data = StorageSchema.parse(input);
    if (data.driver === "local") {
      updateEnvFile({ STORAGE_DRIVER: "local" });
    } else {
      const key = data.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
      if (!key) throw new AppError({ code: "VALIDATION", userMessage: "Paste the service_role key (Project Settings → API).", httpStatus: 400 });
      const provider = new SupabaseStorageProvider(data.supabaseUrl.replace(/\/$/, ""), key, data.bucket);
      const probe = `healthchecks/${randomUUID()}.txt`;
      try {
        await provider.put(probe, Buffer.from("revenueos storage check"), "text/plain");
        await provider.delete(probe);
      } catch (e) {
        throw new AppError({ code: "STORAGE_TEST", userMessage: `Supabase Storage test failed: ${serializeError(e).userMessage}`, httpStatus: 400 });
      }
      updateEnvFile({ STORAGE_DRIVER: "supabase", SUPABASE_URL: data.supabaseUrl.replace(/\/$/, ""), SUPABASE_SERVICE_ROLE_KEY: key, SUPABASE_STORAGE_BUCKET: data.bucket });
    }
    resetConfigCache();
    resetStorageSingleton();
    revalidatePath("/setup");
    return { driver: data.driver };
  }, "Storage saved and tested");
}

export interface CheckResult {
  group: string;
  label: string;
  ok: boolean;
  message: string;
}

/** Runs every connection test for real (Claude, worker, each business's accounts, payments, WhatsApp). */
export async function testEverythingAction() {
  return run(async () => {
    const user = await requireAdmin();
    const results: CheckResult[] = [];
    const push = (group: string, label: string, ok: boolean, message: string) => results.push({ group, label, ok, message });

    const ai = await getAISettings();
    const workers = await workerStatuses();
    const online = workers.find((w) => w.online);
    push("System", "Local worker", Boolean(online), online ? `${online.name} is online` : workers.length ? "Installed but offline — start it (RevenueOS.bat or start-worker.bat)" : "Not installed yet");
    if (ai.provider === "claude-code-cli") push("System", "Claude (Claude Code CLI)", Boolean(online), online ? "Runs on the online worker" : "Needs the local worker online");
    else {
      const t = await testAnthropic(user.id).catch((e) => ({ ok: false, message: serializeError(e).userMessage }));
      push("System", "Claude (Anthropic API)", t.ok, t.message);
    }

    const live = (await listWorkspaces()).filter((w) => w.environment === "LIVE");
    if (!live.length) push("Businesses", "Live business", false, "Create your first business");
    for (const ws of live) {
      const accounts = await getDb()
        .select()
        .from(socialAccounts)
        .where(and(eq(socialAccounts.workspaceId, ws.id), eq(socialAccounts.enabled, true), eq(socialAccounts.isDemo, false)));
      if (!accounts.length) push(ws.name, "Social accounts", false, "No account connected");
      for (const a of accounts) {
        const r = await testSocialAccount(a.id, user.id).catch((e) => ({ status: "ERROR", error: serializeError(e).userMessage, test: null }));
        push(ws.name, `${a.platform.charAt(0)}${a.platform.slice(1).toLowerCase()} @${a.username}`, r.status === "CONNECTED", r.status === "CONNECTED" ? "Authenticated, permissions and publishing OK" : (r.error ?? r.status));
      }
      const ints = await getDb()
        .select()
        .from(integrations)
        .where(and(eq(integrations.workspaceId, ws.id), inArray(integrations.key, ["mercadopago", "stripe", "whatsapp"])));
      if (!ints.some((i) => i.key === "mercadopago" || i.key === "stripe")) push(ws.name, "Payments", false, "No payment provider — checkout links cannot be sent");
      for (const i of ints) {
        if (i.key === "whatsapp") {
          const r = await testWhatsApp(ws.id, user.id).catch((e) => ({ ok: false, message: serializeError(e).userMessage }));
          push(ws.name, "WhatsApp", r.ok, r.message);
        } else {
          const provider = i.key === "mercadopago" ? "MERCADOPAGO" : "STRIPE";
          const r = await testPaymentProvider(ws.id, provider, user.id).catch((e) => ({ ok: false, message: serializeError(e).userMessage }));
          push(ws.name, provider === "MERCADOPAGO" ? "Mercado Pago" : "Stripe", r.ok, r.message);
        }
      }
    }
    revalidatePath("/setup");
    return results;
  });
}
