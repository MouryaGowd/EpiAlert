import { defineConfig } from "vitest/config";

// Only the TypeScript sources under test/ are tests; never the compiled copies in lib/.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], exclude: ["lib/**", "node_modules/**"] },
});
