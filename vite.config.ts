/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

/**
 * Ersetzt beim Build die CDN-Skripte aus index.html durch die gleichnamigen Dateien aus node_modules
 * und bettet die Excel-Bibliothek mit ein. Die fertige HTML-Datei braucht so kein Internet mehr
 * (Ausnahme: die KI-Auswertung und der Kontospeicher, die nur innerhalb von claude.ai verfügbar sind).
 */
function inlineLibraries(): Plugin {
  const libs: Record<string, string> = {
    "pdf.js/3.11.174/pdf.min.js": "pdfjs-dist/build/pdf.min.js",
    "pdf.js/3.11.174/pdf.worker.min.js": "pdfjs-dist/build/pdf.worker.min.js",
    "jspdf.umd.min.js": "jspdf/dist/jspdf.umd.min.js",
    "tesseract.js@7.0.0/dist/tesseract.min.js": "tesseract.js/dist/tesseract.min.js",
  };
  // Texterkennung auf dem Gerät: Worker, Rechenkern (WebAssembly ohne SIMD, läuft auf jedem aktuellen Browser) und
  // deutsche Sprachdaten werden als nicht ausgeführte Datenblöcke eingebettet und erst bei Bedarf in einen Worker geladen.
  const tessData = () => [
    `<script type="text/x-tess" id="tess-worker">${read("tesseract.js/dist/worker.min.js")}</script>`,
    `<script type="text/x-tess" id="tess-core">${read("tesseract.js-core/tesseract-core-lstm.wasm.js")}</script>`,
    `<script type="text/x-tess" id="tess-deu">${readFileSync(new URL("./node_modules/@tesseract.js-data/deu/4.0.0_best_int/deu.traineddata.gz", import.meta.url)).toString("base64")}</script>`,
  ].join("\n");
  // „</script“ würde das Skript-Element vorzeitig beenden. U+FFFD (in den SheetJS-Codepage-Tabellen) kommt nur
  // in Zeichenketten vor und wird als gleichwertige Escape-Folge geschrieben, damit die Datei als Artifact zulässig ist.
  const read = (rel: string) => readFileSync(new URL("./node_modules/" + rel, import.meta.url), "utf8")
    .replace(/<\/script/gi, "<\\/script")
    .replace(/\uFFFD/g, "\\uFFFD");
  const tag = (rel: string) => `<script data-lib="${rel.split("/")[0]}">${read(rel)}</script>`;
  return {
    name: "inline-libraries",
    apply: "build",
    transformIndexHtml(html) {
      let out = html.replace(/<script src="https:\/\/cdn[^"]+"><\/script>/g, m => {
        const key = Object.keys(libs).find(k => m.includes(k));
        if (!key) throw new Error("Unbekanntes CDN-Skript in index.html: " + m);
        return tag(libs[key]);
      });
      // Ersetzung als Funktion: Bibliothekscode enthält „$1“ & Co., die als Ersetzungsmuster gelten würden
      out = out.replace(/<script type="module"/, m => `${tag("xlsx/dist/xlsx.full.min.js")}\n${tessData()}\n${m}`);
      return out;
    },
  };
}

// Ergebnis ist eine einzelne HTML-Datei (dist/index.html), die unverändert als
// claude.ai-Artifact veröffentlicht oder lokal im Browser geöffnet werden kann.
export default defineConfig({
  plugins: [inlineLibraries(), viteSingleFile()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { target: "es2020", outDir: "dist", emptyOutDir: true },
  test: { globals: true, environment: "node", include: ["tests/**/*.test.ts"] },
});
