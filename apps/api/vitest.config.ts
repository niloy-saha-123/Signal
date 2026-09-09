import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // `npm run build` compiles src/**/*.test.ts into dist/ too (they have to stay in
    // tsconfig's include so typecheck covers them). Without this, a test run after a
    // build collects the stale compiled copies and fails them all on `require`.
    exclude: [...configDefaults.exclude, "dist/**"],
  },
});
