import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  // Runtime migrations are reviewed SQL in ./migrations. Generated diffs stay separate
  // so drizzle-kit can never create a second initial migration that the runner applies.
  out: "./drizzle-generated",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "./data/dev-learning-harness.sqlite",
  },
});
