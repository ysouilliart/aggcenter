import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["aggc-cash", "aggc-supplier", "aggc-invoice", "aggc-people"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
