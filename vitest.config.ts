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
    // `.tsx` aussi : les feuilles d'affichage se vérifient en les RENDANT, la
    // mise en page étant précisément ce qu'un ViewModel ne peut pas prouver.
    include: ["features/**/*.test.ts", "features/**/*.test.tsx"],
  },
})
