// Texterkennung auf dem Gerät: reiner Scan (PDF nur mit Bild, keine Textebene) in einer Ansicht ohne KI-Bilderkennung.
// Die KI-Schnittstelle wird simuliert; geprüft wird, dass der Scan ohne Internet auf dem Gerät gelesen und nur Text übergeben wird.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const file = process.argv[2] || "dist/index.html";
const b = await chromium.launch();
const errs = [];

// 1. „Gescannte“ Rechnungsseite als Bild erzeugen
const doc = await b.newPage({ viewport: { width: 1240, height: 1754 } });
await doc.setContent(`<body style="font:24px Arial;padding:90px;color:#111">
<h2>Abschlagsrechnung Nr. 3</h2><p>Bauvorhaben Kita Sonnenschein, Rohbau</p>
<table style="font-size:24px;border-collapse:collapse;width:100%">
<tr><th align=left>Pos.</th><th align=left>Bezeichnung</th><th>Menge</th><th>EH</th><th align=right>EP</th><th align=right>GP</th></tr>
<tr><td>02.010</td><td>Mauerwerk KS 17,5 cm</td><td>250,00</td><td>m²</td><td align=right>58,40</td><td align=right>14.600,00</td></tr>
<tr><td>02.020</td><td>Stahlbetondecke C25/30</td><td>84,50</td><td>m³</td><td align=right>312,00</td><td align=right>26.364,00</td></tr>
</table><p style="margin-top:40px">Nettosumme 40.964,00 EUR</p></body>`);
const png = await doc.screenshot({ type: "png" });
await doc.close();

// 2. App ohne Internet öffnen, KI ohne Bildfähigkeit simulieren
const pg = await b.newPage();
pg.on("pageerror", e => errs.push(e.message));
const blocked = [];
await pg.route(/^https?:\/\/(?!localhost)/, r => { blocked.push(r.request().url()); r.abort(); });
await pg.addInitScript(() => {
  localStorage.setItem("rp.vobb.kiok.v1", "1");
  window.__prompts = [];
  const sample = async (prompt, o) => { window.__prompts.push({ prompt, images: (o && o.images || []).length }); return { text: '{"vertrag":{"projekt":"Kita Sonnenschein"},"positionen":[{"oz":"02.010","kurztext":"Mauerwerk KS 17,5 cm","eh":"m²","menge":250,"ep":58.4}]}', truncated: false }; };
  sample.limits = async () => ({});
  window.claude = { use: async name => name === "sample" ? sample : null };
});
await pg.goto(pathToFileURL(file).href);
const pdf = await pg.evaluate(async b64 => {
  const d = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
  d.addImage("data:image/png;base64," + b64, "PNG", 0, 0, 595.28, 841.89);
  const u = new Uint8Array(d.output("arraybuffer")); let s = ""; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192));
  return btoa(s);
}, png.toString("base64"));
const t0 = Date.now();
await pg.setInputFiles("#lvFile", { name: "Auftrag-Scan.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf, "base64") });
await pg.waitForFunction(() => window.__prompts.length > 0 || /nicht möglich|kein lesbarer Text/.test(document.body.innerText), null, { timeout: 120000 });
const out = await pg.evaluate(() => ({ prompts: window.__prompts, log: [...document.querySelectorAll(".logp .hint")].map(x => x.textContent) }));
out.sekunden = Math.round((Date.now() - t0) / 1000);
const p = out.prompts[0];
if (!p) errs.push("Keine Anfrage an die KI – Protokoll: " + out.log.join(" | "));
else {
  if (p.images) errs.push("Es wurden Bilder übertragen");
  for (const w of ["Mauerwerk", "02.010", "58,40", "14.600,00", "Stahlbetondecke", "26.364,00", "(Texterkennung)"]) if (!p.prompt.includes(w)) errs.push("Im erkannten Text fehlt: " + w);
}
const extern = blocked.filter(u => !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u));
if (extern.length) errs.push("Externe Abrufe: " + extern.join(", "));
console.log(JSON.stringify({ sekunden: out.sekunden, protokoll: out.log, text: p && p.prompt.slice(p.prompt.indexOf("--- TEXT ---")) }, null, 1));
console.log("errors", errs);
await b.close();
process.exit(errs.length ? 1 : 0);
