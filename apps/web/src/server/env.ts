import { ensureRootEnv } from "@revenueos/shared/server";

/**
 * Next.js reads env files only from apps/web; RevenueOS keeps one .env at the
 * repository root. Configuration readers (database, crypto, core config) also
 * reload it lazily, which survives Next's env reset during hot reload.
 */
ensureRootEnv();
