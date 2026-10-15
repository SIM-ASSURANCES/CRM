import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // « server-only » lève une erreur hors du serveur Next.js ; neutralisé pour les tests.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Les tests d'intégration partagent les mêmes tables et se nettoient avant chaque test : en parallèle, ils
    // s'effaceraient mutuellement des données. Les fichiers s'exécutent donc l'un après l'autre (la suite reste rapide).
    fileParallelism: false,
    // Les tests d'intégration importent toute la pile (Better Auth, Prisma) dans leur `beforeAll` : à froid (premier
    // lancement après un redémarrage, disque non mis en cache) cela dépasse les 10 s par défaut sans qu'aucun test soit
    // en cause. Les délais restent bornés pour qu'un vrai blocage échoue quand même.
    hookTimeout: 60_000,
    testTimeout: 30_000,
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
