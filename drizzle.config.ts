import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit generates the plain SQL migrations in drizzle/ and maintains
 * drizzle/meta/_journal.json. The FTS5 migration (0001_search.sql) is
 * hand-written and registered in the journal as a custom migration; the JS
 * migrator in src/db/migrator.ts reads the journal and applies both kinds.
 *
 * There is no database URL here on purpose: migrations are applied at runtime
 * through the Rust pipe, never by drizzle-kit.
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  breakpoints: true,
  strict: true,
  verbose: true,
});
