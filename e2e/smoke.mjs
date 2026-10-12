// Rauchtest: gebaute Einzeldatei laden, Beispielprojekt durchklicken, Laufzeitfehler sammeln.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const pwPath = process.env.PLAYWRIGHT_PATH || "playwright";
const { chromium } = require(pwPath);
const file = process.argv[2] || "dist/index.html";
const b = await chromium.launch();
const pg = await b.newPage();
const errs = [];
pg.on("pageerror", e => errs.push(e.message));
await pg.route(/^https?:\/\/(?!localhost)/, r => r.abort());
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
console.log(JSON.stringify(out, null, 1));
console.log("errors", errs);
await b.close();
process.exit(errs.length ? 1 : 0);
