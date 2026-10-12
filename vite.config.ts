/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Ergebnis ist eine einzelne HTML-Datei (dist/index.html), die unverändert als
// claude.ai-Artifact veröffentlicht oder lokal im Browser geöffnet werden kann.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: { target: "es2020", outDir: "dist", emptyOutDir: true },
  test: { globals: true, environment: "node", include: ["tests/**/*.test.ts"] },
});
