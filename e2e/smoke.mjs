// Rauchtest: gebaute Einzeldatei ohne Internet laden, Beispielprojekt durchklicken, Laufzeitfehler sammeln.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const pwPath = process.env.PLAYWRIGHT_PATH || "playwright";
const { chromium } = require(pwPath);
const file = process.argv[2] || "dist/index.html";
const b = await chromium.launch();
const pg = await b.newPage({ acceptDownloads: true });
const errs = [];
pg.on("pageerror", e => errs.push(e.message));
const blocked = [];
await pg.route(/^https?:\/\/(?!localhost)/, r => { blocked.push(r.request().url()); r.abort(); });
await pg.goto(pathToFileURL(file).href);
const click = async sel => { await pg.locator(sel).first().click(); };
await click('[data-a="sample"]');
const out = {};
for (const t of ["uebersicht", "lv", "nt", "re", "vertrag", "ueb", "sic"]) {
  await click(`nav [data-v="${t}"]`);
  out[t] = (await pg.locator("main").innerText()).length;
}
await click('nav [data-v="re"]');
await pg.locator('[data-a="openinv"]').nth(1).click();
out.ledger = await pg.locator(".ledger").first().innerText();
await click('[data-a="uebopen"]');
out.modal = (await pg.locator(".modal").innerText()).slice(0, 60);
await click('[data-a="closemodal"]');
await click('nav [data-v="vertrag"]');
await pg.locator('select[data-b="proj:bundesland"]').selectOption("BY");
out.bundesland = await pg.locator('select[data-b="proj:bundesland"]').inputValue();
// Bibliotheken offline: PDF erzeugen (jsPDF), wieder einlesen (pdf.js), Excel-Mappe anlegen (SheetJS)
out.libs = await pg.evaluate(async () => {
  const doc = new window.jspdf.jsPDF(); doc.text("Prüfung", 20, 20);
  const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(doc.output("arraybuffer")), isEvalSupported: false }).promise;
  const page = await pdf.getPage(1); const txt = (await page.getTextContent()).items.map(i => i.str).join("");
  const wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet([["OZ", "Menge"], ["01.01", 3]]), "LV");
  const back = window.XLSX.read(window.XLSX.write(wb, { type: "array", bookType: "xlsx" }), { type: "array" });
  return { pdfSeiten: pdf.numPages, pdfText: txt, xlsx: back.SheetNames.join(",") };
});
if (out.libs.pdfSeiten !== 1 || !out.libs.pdfText.includes("Pr") || out.libs.xlsx !== "LV") errs.push("Bibliotheken: " + JSON.stringify(out.libs));
// Prüfvermerk und Sicherung herunterladen (lokale Datei: normaler Browser-Download)
await click('nav [data-v="re"]');
await pg.locator('[data-a="openinv"]').nth(1).click();
const [dl] = await Promise.all([pg.waitForEvent("download"), click('[data-a="dlreport"]')]);
const rep = readFileSync(await dl.path(), "utf8");
out.reportDatei = dl.suggestedFilename();
await click('[data-a="menu"]').catch(() => {});
const [bk] = await Promise.all([pg.waitForEvent("download"), click('[data-a="export"]')]);
const sich = JSON.parse(readFileSync(await bk.path(), "utf8"));
out.sicherung = { datei: bk.suggestedFilename(), projekte: (Array.isArray(sich) ? sich : sich.projects || []).length };
if (!out.sicherung.projekte) errs.push("Sicherung leer");
out.report = { version: /Programmversion \d+\.\d+\.\d+/.test(rep), vob: rep.includes("VOB/B 2016"), feiertage: rep.includes("Feiertagen Bayern") };
if (!out.report.version || !out.report.vob || !out.report.feiertage) errs.push("Prüfvermerk: " + JSON.stringify(out.report));
// Webschrift ist optional (ohne Internet greift die Systemschrift), alles andere muss eingebettet sein
const extern = blocked.filter(u => !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u));
if (extern.length) errs.push("Externe Abrufe: " + extern.join(", "));
console.log(JSON.stringify(out, null, 1));
console.log("errors", errs);
await b.close();
process.exit(errs.length ? 1 : 0);
