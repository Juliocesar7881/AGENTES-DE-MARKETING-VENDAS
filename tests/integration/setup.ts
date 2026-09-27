import { afterAll } from "vitest";
import { applyTestEnv } from "./test-env";

applyTestEnv();

afterAll(async () => {
  const { closeDb } = await import("@revenueos/database");
  await closeDb();
});
