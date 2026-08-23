import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Resolve the "@/*" path alias (mirrors tsconfig) without an extra plugin.
const root = fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]$/, "")

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      // `server-only` lève volontairement à l'import : c'est ainsi qu'il
      // interdit d'entraîner un module serveur dans un bundle navigateur. Next
      // le neutralise par la condition de résolution `react-server`, que Vitest
      // n'applique pas — il tomberait donc sur la version qui lève, et un
      // fichier de test entier disparaîtrait de la suite sans que le total
      // signale autre chose qu'un chiffre plus petit.
      //
      // Aiguillé vers `empty.js`, la variante que Next lui-même utilise côté
      // serveur, plutôt que vers un stub maison : c'est le paquet qui décide de
      // ce qu'est un module serveur vide, pas nous.
      "server-only": `${root}/node_modules/server-only/empty.js`,
    },
  },
  test: {
    environment: "node",
    // `.tsx` aussi : les feuilles d'affichage se vérifient en les RENDANT, la
    // mise en page étant précisément ce qu'un ViewModel ne peut pas prouver.
    include: ["features/**/*.test.ts", "features/**/*.test.tsx"],
  },
})
