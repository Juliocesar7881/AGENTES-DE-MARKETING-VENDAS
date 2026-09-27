import { getDb, type Database } from "@revenueos/database";
import type { AIProvider } from "@revenueos/providers/ai";
import type { MessagingProvider } from "@revenueos/providers/messaging";
import type { PaymentProvider } from "@revenueos/providers/payment";
import type { SocialProvider } from "@revenueos/providers/social";
import type { StorageProvider } from "@revenueos/providers/storage";
import type { MessagingChannel, Platform } from "@revenueos/shared";

/**
 * Dependency container. Production uses the defaults; tests inject mocks with
 * failure modes (timeouts, rejected uploads, expired tokens) through overrides.
 */
export interface CoreOverrides {
  ai?: (ctx: { workspaceId: string | null; isDemo: boolean }) => AIProvider | null;
  social?: (ctx: { workspaceId: string; platform: Platform; isDemo: boolean }) => SocialProvider | null;
  messaging?: (ctx: { workspaceId: string; channel: MessagingChannel; isDemo: boolean }) => MessagingProvider | null;
  payment?: (ctx: { workspaceId: string; isDemo: boolean }) => PaymentProvider | null;
  storage?: () => StorageProvider;
}

interface CoreState {
  db: () => Database;
  now: () => Date;
  overrides: CoreOverrides;
  /** Identifier of the process running jobs (worker id or "cloud"). */
  runnerId: string;
  /** True inside the local worker (local files, Remotion, CLI provider available). */
  isLocalWorker: boolean;
}

const state: CoreState = {
  db: getDb,
  now: () => new Date(),
  overrides: {},
  runnerId: "cloud",
  isLocalWorker: false,
};

export function configureCore(opts: Partial<{ db: () => Database; now: () => Date; overrides: CoreOverrides; runnerId: string; isLocalWorker: boolean }>): void {
  if (opts.db) state.db = opts.db;
  if (opts.now) state.now = opts.now;
  if (opts.overrides) state.overrides = opts.overrides;
  if (opts.runnerId) state.runnerId = opts.runnerId;
  if (opts.isLocalWorker !== undefined) state.isLocalWorker = opts.isLocalWorker;
}

export function db(): Database {
  return state.db();
}

export function now(): Date {
  return state.now();
}

export function overrides(): CoreOverrides {
  return state.overrides;
}

export function runnerId(): string {
  return state.runnerId;
}

export function isLocalWorker(): boolean {
  return state.isLocalWorker;
}
