import { existsSync } from "node:fs";
import path from "node:path";
// Type-only import: erased at compile time, never reaches `require()`. A real
// `import { defineConfig } from "drizzle-kit"` trips a tsx bug — confirmed on
// tsx 4.22.4 and latest 4.23.13 — where `require("drizzle-kit")` returns `{}`
// inside tsx's loader hook (which drizzle-kit's own CLI activates before
// loading this file), because of the package's dual require/import
// conditional exports. Plain `node -e "require('drizzle-kit')"` resolves it
// fine, so this is tsx-hook-specific, not a Node or package issue.
// drizzle-kit's `defineConfig` is a runtime no-op (`(config) => config`)
// purely for editor type-checking, so `satisfies Config` gets the same
// safety without the broken runtime import.
import type { Config } from "drizzle-kit";

// drizzle-kit runs standalone (not through db/client.ts), so it needs its own
// load of the repo-root .env — nothing else injects DATABASE_URL for it.
// process.cwd(), not __dirname/import.meta.dirname: neither reliably survives
// drizzle-kit's config bundler (this file's existing relative `schema`/`out`
// paths already assume cwd is apps/api, same as drizzle-kit's own docs — it's
// always invoked from the workspace directory).
const rootEnvPath = path.resolve(process.cwd(), "../../.env");
if (existsSync(rootEnvPath)) {
  process.loadEnvFile(rootEnvPath);
}

export default {
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
