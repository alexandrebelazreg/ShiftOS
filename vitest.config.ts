import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Resolve the "@/*" path alias (mirrors tsconfig) without an extra plugin.
const root = fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]$/, "")

export default defineConfig({
  resolve: {
    alias: { "@": root },
  },
  test: {
    environment: "node",
    include: ["features/**/*.test.ts"],
  },
})
