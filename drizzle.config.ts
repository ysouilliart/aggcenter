import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["aggc-cash"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
