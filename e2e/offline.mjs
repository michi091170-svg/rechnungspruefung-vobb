// Desktop-Fassung ohne KI: Auftragsschreiben und Rechnung als reine Scans einlesen, Positionen erkennen und prüfen.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const file = process.argv[2] || "dist/index.html";
const b = await chromium.launch();
const errs = [];

const shot = async html => {
  const d = await b.newPage({ viewport: { width: 1240, height: 1754 } });
  await d.setContent(`<body style="font:23px Arial;padding:90px;color:#222">${html}</body>`);
  const png = await d.screenshot({ type: "png" }); await d.close(); return png.toString("base64");
};
const tab = rows => `<table style="font-size:23px;width:100%;border-collapse:collapse">${rows.map(r => `<tr>${r.map((c, i) => `<td style="padding:4px 8px" align="${i > 1 ? "right" : "left"}">${c}</td>`).join("")}</tr>`).join("")}</table>`;
const auftrag = await shot(`<h2>Auftragsschreiben</h2><p>Bauvorhaben: Kita Sonnenschein, Neubau</p><p>Vergabe-Nr.: 2026-117</p><p>Die VOB/B ist Vertragsbestandteil.</p>
${tab([["Pos.", "Bezeichnung", "Menge", "EH", "EP", "GP"], ["02.010", "Mauerwerk KS 17,5 cm", "300,00", "m²", "58,40", "17.520,00"], ["02.020", "Stahlbetondecke C25/30", "90,00", "m³", "312,00", "28.080,00"]])}
<p style="margin-top:30px">Auftragssumme netto 45.600,00 €</p>`);
const rechnung = await shot(`<h2>3. Abschlagsrechnung</h2><p>Rechnungsdatum: 01.07.2026</p>
${tab([["Pos.", "Bezeichnung", "Menge", "EH", "EP", "GP"], ["02.010", "Mauerwerk KS 17,5 cm", "250,00", "m²", "58,40", "14.600,00"], ["02.020", "Stahlbetondecke C25/30", "84,50", "m³", "320,00", "27.040,00"]])}
<p style="margin-top:30px">Nettosumme 41.640,00</p>`);

const pg = await b.newPage();
pg.on("pageerror", e => errs.push(e.message));
const blocked = [];
await pg.route(/^https?:\/\/(?!localhost)/, r => { blocked.push(r.request().url()); r.abort(); });
await pg.goto(pathToFileURL(file).href);
const toPdf = b64 => pg.evaluate(async b64 => {
  const d = new window.jspdf.jsPDF({ unit: "pt", format: "a4" }); d.addImage("data:image/png;base64," + b64, "PNG", 0, 0, 595.28, 841.89);
  const u = new Uint8Array(d.output("arraybuffer")); let s = ""; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s);
}, b64);
const out = {};
const t0 = Date.now();
await pg.setInputFiles("#lvFile", { name: "Auftrag.pdf", mimeType: "application/pdf", buffer: Buffer.from(await toPdf(auftrag), "base64") });
await pg.waitForSelector('[data-a="auftragapply"]', { timeout: 120000 }).catch(() => {});
out.auftrag = (await pg.locator(".modal").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 900);
for (const w of ["Kita Sonnenschein", "2026-117", "02.010", "02.020", "Mauerwerk"]) if (!out.auftrag.includes(w)) errs.push("Auftrag: fehlt " + w);
await pg.locator('[data-a="auftragapply"]').click().catch(e => errs.push("Übernehmen: " + e.message));
await pg.setInputFiles("#invFile", { name: "AR3.pdf", mimeType: "application/pdf", buffer: Buffer.from(await toPdf(rechnung), "base64") });
await pg.waitForSelector('[data-k="scan"] tbody tr', { timeout: 120000 }).catch(() => {});
out.rechnung = (await pg.locator('[data-k="scan"]').innerText().catch(() => "")).replace(/\s+/g, " ");
out.protokoll = await pg.evaluate(() => [...document.querySelectorAll(".logp .hint")].map(x => x.textContent));
out.sekunden = Math.round((Date.now() - t0) / 1000);
const proj = await pg.evaluate(() => { for (const k of Object.keys(localStorage)) { try { const v = JSON.parse(localStorage.getItem(k)); if (Array.isArray(v) && v[0] && v[0].positions) return v[0]; } catch (e) {} } return null; });
const lv = (proj && proj.positions || []).map(x => [x.oz, x.eh, x.menge, x.ep].join(" "));
const inv = proj && proj.rechnungen[0]; const marks = (inv && inv.scan && inv.scan.marks || []).filter(m => m.kind === "pos");
out.lv = lv; out.marks = marks.map(m => [m.oz, m.menge, m.ep, m.betrag, m.posId ? "zugeordnet" : "ohne LV"].join(" "));
if (lv.join("|") !== "02.010 m² 300 58.4|02.020 m³ 90 312") errs.push("LV falsch übernommen: " + lv.join(" | "));
if (out.marks.join("|") !== "02.010 250 58.4 14600 zugeordnet|02.020 84.5 320 27040 zugeordnet") errs.push("Rechnungspositionen: " + out.marks.join(" | "));
if (!inv || inv.nr !== "3. AR" || inv.aufmass[proj.positions[0].id].an !== 250) errs.push("Rechnungskopf bzw. Menge AN nicht übernommen");
if (!/LV-EP abweichend/.test(out.rechnung)) errs.push("Abweichender EP bei 02.020 nicht gemeldet");
const extern = blocked.filter(u => !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u));
if (extern.length) errs.push("Externe Abrufe: " + extern.join(", "));
console.log(JSON.stringify(out, null, 1));
console.log("errors", errs);
await b.close();
process.exit(errs.length ? 1 : 0);
