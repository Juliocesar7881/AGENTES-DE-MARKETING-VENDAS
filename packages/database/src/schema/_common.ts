import { timestamp, uuid } from "drizzle-orm/pg-core";

export const pk = () => uuid("id").primaryKey().defaultRandom();

export const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
