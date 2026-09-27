/** Creates the local database if it does not exist (used by `pnpm setup`; localhost only). */
import postgres from "postgres";
import { loadEnv } from "./env";

loadEnv();
const name = process.argv[2] ?? "revenueos";
if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error("invalid database name");
const url = new URL(process.env.DATABASE_URL!);
url.pathname = "/postgres";
const sql = postgres(url.toString(), { max: 1, onnotice: () => {}, connect_timeout: 8 });
try {
  const rows = await sql`select 1 from pg_database where datname = ${name}`;
  if (rows.length === 0) {
    await sql.unsafe(`create database "${name}"`);
    console.info(`✔ Created database ${name}`);
  } else console.info(`✔ Database ${name} exists`);
} catch (e) {
  console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
