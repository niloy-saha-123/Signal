import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    // Keep old compiled tests out of discovery when a developer switches to
    // this branch with a dist/ directory produced before tests moved out of src/.
    exclude: [...configDefaults.exclude, "dist/**"],
  },
});
