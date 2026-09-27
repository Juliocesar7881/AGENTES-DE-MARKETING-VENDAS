import type { Metadata } from "next";
import { OnboardingWizard } from "@/components/onboarding/wizard";
import { PageHeader } from "@/components/ui/misc";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "New business" };

export default async function OnboardingPage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="New business" description="About 5 minutes. Everything can be edited later." />
      <OnboardingWizard isDemoUser={user.isDemo} />
    </>
  );
}
