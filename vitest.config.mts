import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Integration suites share a SQLite file; serialize migration/write setup.
  test: { fileParallelism: false, include: ["tests/**/*.test.ts"], env: { DATABASE_URL: "file:./data/test.db", ENABLE_AGENT_TRACE: "true" } },
});
