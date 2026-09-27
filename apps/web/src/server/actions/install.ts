"use server";
import { AppError } from "@revenueos/shared";
import { run } from "../action";
import { assertSetupCode, DatabaseChoiceSchema, installState, InstallSchema, performInstall, testDatabase } from "../install";

async function assertNotInstalled(): Promise<void> {
  if ((await installState()).installed) throw new AppError({ code: "ALREADY_INSTALLED", userMessage: "RevenueOS is already installed. Sign in instead.", httpStatus: 409 });
}

/** Checks the one-time setup code shown by the server (no side effects). */
export async function checkSetupCodeAction(code: string) {
  return run(async () => {
    await assertNotInstalled();
    assertSetupCode(code);
    return true;
  });
}

export async function testDatabaseAction(code: string, choice: unknown) {
  return run(async () => {
    await assertNotInstalled();
    assertSetupCode(code);
    return testDatabase(DatabaseChoiceSchema.parse(choice));
  });
}

export async function installAction(code: string, input: unknown) {
  return run(async () => {
    assertSetupCode(code);
    return performInstall(InstallSchema.parse(input));
  }, "RevenueOS is installed");
}
