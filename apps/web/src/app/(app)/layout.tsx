import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { shellData } from "@/server/queries";
import { requireUser } from "@/server/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireUser();
  const data = await shellData();
  return <AppShell data={data}>{children}</AppShell>;
}
