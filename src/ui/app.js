// Oberfläche der Rechnungsprüfung. Rechenlogik und Stammdaten liegen in src/core (TypeScript, getestet).
import {
  ATV, GRUNDLAGEN, INV_ART, INV_STATUS, NT_STATUS, UEB, UEB_GRUND, UEB_KIND,
  addDays, addWerktage, calcAll, calcInv, chain, daysBetween, ensureSic, esc,
  eur, evalExpr, fmtD, fmtF, fmtIn, fmtN, migrateProject, newProject,
  nlNT, num, numOrNull, round2, sampleProject, seOn, shiftWeekend, sicCalc,
  sicHints, toISODate, todayISO, topTerms, uebItemCalc, uebKey, uebResult, uebRules,
  uid, unitKind, yearEnd3,
} from "../core/index.ts";

const $ = s => document.querySelector(s);


/* ---------- Zustand & Speicherung ---------- */
const LS_KEY = "rp.vobb.projects.v1", UI_KEY = "rp.vobb.ui.v1";
const S = { projects: [], cur: null, tab: "uebersicht", inv: null, menu: false, confirm: null, mode: "local" };
let COL = null, saveTimer = null; const pending = new Set();
function lsLoad(){ try { const a = JSON.parse(localStorage.getItem(LS_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch(e){ return []; } }
function lsSave(){ try { localStorage.setItem(LS_KEY, JSON.stringify(S.projects)); } catch(e){} }
function uiSave(){ try { localStorage.setItem(UI_KEY, JSON.stringify({cur:S.cur, tab:S.tab, inv:S.inv})); } catch(e){} }
function uiLoad(){ try { Object.assign(S, JSON.parse(localStorage.getItem(UI_KEY) || "{}")); } catch(e){} }
function save(p){
  if (p) { p.updated = Date.now(); pending.add(p.id); }
  lsSave(); uiSave();
  if (COL) { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 700); }
}
async function flush(){
  const ids = [...pending]; pending.clear();
  for (const id of ids) {
    const p = S.projects.find(x => x.id === id);
    try { if (p) await COL.doc("p_" + id).set({ json: JSON.stringify(p), updated: new Date().toISOString() }); }
    catch(e){ toast("Speichern im Konto fehlgeschlagen – lokal gesichert."); }
  }
}
async function removeRemote(id){ if (COL) { try { await COL.doc("p_" + id).delete(); } catch(e){} } }
async function connect(){
  if (!window.claude || typeof window.claude.use !== "function") return;
  try {
    const [db, user] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
    if (!db || !user) return;
    const id = await user.id(); if (!id) return;
    const col = db.collection("data/users/" + id);
    const snap = await col.get();
    const remote = snap.docs.map(d => { try { return JSON.parse(d.data().json); } catch(e){ return null; } }).filter(Boolean);
    const byId = new Map(remote.map(p => [p.id, p]));
    COL = col;
    for (const lp of S.projects) {
      const rp = byId.get(lp.id);
      if (!rp || (lp.updated || 0) > (rp.updated || 0)) { byId.set(lp.id, lp); pending.add(lp.id); }
    }
    S.projects = [...byId.values()].sort((a,b) => (a.name||"").localeCompare(b.name||"", "de"));
    S.mode = "db";
    if (!S.projects.find(p => p.id === S.cur)) S.cur = S.projects[0]?.id || null;
    lsSave(); if (pending.size) flush();
    render();
  } catch(e){ /* lokal weiterarbeiten */ }
}
const cp = () => S.projects.find(p => p.id === S.cur) || null;


/* ---------- UI-Bausteine ---------- */
const inText = (b, v, ph = "") => `<input class="in" data-b="${b}" value="${esc(v)}" placeholder="${esc(ph)}">`;
const inNum = (b, v, d = 3, min = 0, ph = "") => `<input class="in num" data-b="${b}" data-t="num" inputmode="decimal" value="${esc(fmtIn(v, d, min))}" placeholder="${esc(ph)}">`;
const inDate = (b, v) => `<input class="in" type="date" data-b="${b}" value="${esc(v)}">`;
const chk = (b, v, label) => `<label class="c"><input type="checkbox" data-b="${b}" data-t="bool" ${v ? "checked" : ""}><span>${label}</span></label>`;
const sel = (b, opts, v) => `<select class="in" data-b="${b}">${opts.map(o => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(val) === String(v) ? "selected" : ""}>${esc(lab)}</option>`; }).join("")}</select>`;
const fld = (label, input, hint = "") => `<label class="f"><span>${label}</span>${input}${hint ? `<small>${hint}</small>` : ""}</label>`;
const statusTag = s => { const m = {bezahlt:"ok",freigegeben:"ok",beauftragt:"ok",abgelehnt:"cut","in Prüfung":"warn","Angebot eingegangen":"warn",angekündigt:"warn"}; return `<span class="tag ${m[s]||""}">${esc(s)}</span>`; };

function render(){
  const p = cp();
  const scroll = window.scrollY;
  const tws = [...document.querySelectorAll(".tw[data-k]")].map(el => [el.dataset.k, el.scrollLeft]);
  $("#app").innerHTML = header(p) + (p ? nav() : "") + (S.scanBusy ? `<div class="hint info busy" role="status" style="margin:0">${esc(S.scanBusy)} ${scanCtl ? `<button class="btn sm" data-a="scanstop">Abbrechen</button>` : ""}</div>` : "") + (!S.scanBusy && S.log && S.log.length > 1 ? logPanel() : "") + (p ? `<main>${body(p)}</main>` : `<main>${emptyState()}</main>`) + modalHTML();
  window.scrollTo(0, scroll);
  tws.forEach(([k, l]) => { const el = document.querySelector(`.tw[data-k="${k}"]`); if (el) el.scrollLeft = l; });
  afterRender();
}
function header(p){
  const opts = S.projects.map(x => `<option value="${esc(x.id)}" ${x.id === S.cur ? "selected" : ""}>${esc(x.name)}</option>`).join("");
  return `<header class="top" style="position:sticky">
    <div class="brand"><strong>Rechnungsprüfung</strong><span class="muted">kumuliert nach VOB/B · für die externe Bauleitung</span></div>
    <div class="projbar" style="position:relative">
      ${S.projects.length ? `<select class="in" id="projSel" aria-label="Projekt wählen">${opts}</select>` : ""}
      <button class="btn" data-a="newproj">Neues Projekt</button>
      <button class="btn ghost" data-a="menu" aria-expanded="${S.menu}">Mehr</button>
      ${S.menu ? `<div class="menu" role="menu">
        <button data-a="export">Sicherung herunterladen (JSON)</button>
        <button data-a="import">Sicherung einlesen</button>
        <button data-a="newprojauftrag">Neues Projekt aus Auftragsschreiben</button>
        <button data-a="sample">Beispielprojekt laden</button>
        ${p ? `<button class="d" data-a="delproj">${S.confirm === "proj" ? "Wirklich löschen? Erneut tippen" : "Projekt löschen"}</button>` : ""}
      </div>` : ""}
    </div>
    <div class="store">${S.mode === "db" ? "<b>Gespeichert in deinem Konto</b> – privat, auf allen Geräten verfügbar." : "Gespeichert in diesem Browser. Regelmäßig eine Sicherung herunterladen."} · Texterkennung: ${SAMPLE ? (imagesAvailable() ? "<b>verfügbar</b> (Scans und PDFs)" : "<b>nur für PDFs mit Textebene</b> – Bilderkennung von Scans ist in dieser Ansicht nicht verfügbar") : SAMPLE_CHECKED ? '<span class="neg">nicht verfügbar – App über den claude.ai-Link öffnen und angemeldet sein</span>' : "wird geprüft …"}</div>
  </header>`;
}
function nav(){
  const T = [["uebersicht","Übersicht"],["lv","Leistungsverzeichnis"],["nt","Nachträge"],["re","Rechnungen"],["vertrag","Vertrag & Konditionen"],["ueb","Aufmaßregeln (VOB/C)"],["sic","Vertragserfüllungsbürgschaft"]];
  return `<nav class="tabs">${T.map(([k,l]) => `<button data-a="tab" data-v="${k}" ${S.tab === k ? 'aria-current="page"' : ""}>${l}</button>`).join("")}</nav>`;
}
function emptyState(){
  return `<div class="empty sec"><h2>Noch kein Projekt angelegt</h2>
  <p class="muted">Lege ein Projekt an, erfasse das Leistungsverzeichnis und prüfe Abschlags- und Schlussrechnungen kumuliert mit Aufmaß, Einbehalten, Skonto und Nachträgen.</p>
  <div style="max-width:560px;margin:18px auto 0">${dropZone("Mit dem Auftragsschreiben starten", "Scan des Auftragsschreibens mit angehängtem LV – Projekt, Vertragsbedingungen und Positionen werden erkannt. Alternativ GAEB, Excel oder CSV.", "lvpick")}</div>
  <div class="row" style="justify-content:center;margin-top:14px"><button class="btn" data-a="newproj">Leeres Projekt anlegen</button><button class="btn ghost" data-a="sample">Beispielprojekt laden</button></div></div>`;
}
function body(p){
  if (S.tab === "lv") return tabLV(p);
  if (S.tab === "nt") return tabNT(p);
  if (S.tab === "re") return tabRE(p);
  if (S.tab === "vertrag") return tabVertrag(p);
  if (S.tab === "sic") return tabSicherheit(p);
  if (S.tab === "ueb") return tabUeb(p);
  return tabUebersicht(p);
}

/* ---------- Übersicht ---------- */
function tabUebersicht(p){
  const C = calcAll(p); const last = C.out[C.out.length - 1];
  const stand = last ? last.sumGP : 0;
  const prog = C.auftragGesamt > 0 ? stand / C.auftragGesamt * 100 : 0;
  const gezahlt = C.out.reduce((s,r) => s + (r.paidRecorded ? r.paid : 0), 0);
  const skontoSum = C.out.reduce((s,r) => s + r.skPaid, 0);
  const offen = C.out.filter(r => !r.paidRecorded && r.inv.status !== "bezahlt" && r.zF.d).sort((a,b) => a.zF.d.localeCompare(b.zF.d));
  const t = todayISO();
  return `<h2>${esc(p.name)}</h2>
  <div class="grid2">
    <div class="sec"><h3>Auftrag und Leistungsstand</h3><div class="kv">
      <div>Hauptauftrag (netto)</div><div>${eur(C.auftragNetto)}</div>
      <div>Beauftragte Nachträge (netto)</div><div>${eur(C.ntBeauftragt)}</div>
      <div>Auftragssumme gesamt (netto)</div><div>${eur(C.auftragGesamt)}</div>
      ${num(p.auftragssummeLaut) ? `<div>Auftragssumme lt. Auftragsschreiben (netto)</div><div>${eur(p.auftragssummeLaut)}${Math.abs(num(p.auftragssummeLaut) - C.auftragNetto) >= 1 && Math.abs(num(p.auftragssummeLaut) - round2(C.auftragNetto * (1 - num(p.nachlass)/100))) >= 1 ? ` <span class="tag warn">weicht vom LV ab</span>` : ""}</div>` : ""}
      <div>Offene Nachtragsangebote (netto)</div><div>${eur(C.ntOffen)}</div>
      <div>Prognose inkl. offener Nachträge (netto)</div><div>${eur(C.auftragGesamt + C.ntOffen)}</div>
      <div>Leistungsstand geprüft, kumuliert (netto)</div><div>${eur(stand)}</div>
      <div>Leistungsstand in % der Auftragssumme</div><div>${fmtN(prog,1)} %</div>
    </div></div>
    <div class="sec"><h3>Zahlungen und Einbehalte</h3><div class="kv">
      <div>Aktueller Einbehalt (brutto)</div><div>${eur(last ? last.se : 0)}</div>
      <div>Mängeleinbehalt aktuell</div><div>${eur(last ? last.maengel : 0)}</div>
      <div>Gezahlt an AN (erfasst)</div><div>${eur(gezahlt)}</div>
      <div>Genutztes Skonto</div><div>${eur(skontoSum)}</div>
      <div>Zuletzt festgestellter Zahlbetrag</div><div>${eur(last ? last.zahlbetrag : 0)}</div>
    </div></div>
  </div>
  <div class="sec"><h3>Anstehende Fristen</h3>
    ${offen.length ? `<div class="tw"><table><thead><tr><th>Rechnung</th><th>Zugang</th><th>Skontofrist</th><th>Fälligkeit</th><th class="r">Resttage</th><th class="r">Zahlbetrag</th></tr></thead><tbody>
    ${offen.map(r => { const d = daysBetween(t, r.zF.d); return `<tr><td><button class="btn sm ghost" data-a="openinv" data-id="${r.inv.id}">${esc(r.inv.nr)}</button></td><td>${fmtD(r.inv.eingang)}</td><td>${r.skontoMoeglich ? fmtD(r.skF.d) : "–"}</td><td>${fmtD(r.zF.d)}</td><td class="r days ${d < 0 ? "neg" : d <= 3 ? "" : ""}">${d < 0 ? `${-d} Tage überfällig` : d + " Tage"}</td><td class="r">${eur(r.zahlbetrag)}</td></tr>`; }).join("")}
    </tbody></table></div>` : `<p class="muted">Keine offenen Zahlungsfristen.</p>`}
  </div>
  <div class="sec"><h3>Rechnungsverlauf (kumuliert)</h3>
    ${C.out.length ? `<div class="tw"><table><thead><tr><th>Nr.</th><th>Art</th><th>Zugang</th><th class="r">Stand AN netto</th><th class="r">Stand geprüft netto</th><th class="r">Brutto kum.</th><th class="r">Einbehalt</th><th class="r">Vorzahlungen</th><th class="r">Zahlbetrag</th><th>Status</th></tr></thead><tbody>
    ${C.out.map(r => `<tr><td class="nw"><button class="btn sm ghost" data-a="openinv" data-id="${r.inv.id}">${esc(r.inv.nr)}</button></td><td>${esc(r.inv.art)}</td><td>${fmtD(r.inv.eingang)}</td><td class="r">${eur(r.sumAN)}</td><td class="r">${eur(r.sumGP)}</td><td class="r">${eur(r.cGP.brutto)}</td><td class="r">${eur(r.se)}</td><td class="r">${eur(r.vor)}</td><td class="r"><b>${eur(r.zahlbetrag)}</b></td><td>${statusTag(r.inv.status)}</td></tr>`).join("")}
    </tbody></table></div>` : `<p class="muted">Noch keine Rechnung erfasst. <button class="btn sm" data-a="tab" data-v="re">Zu den Rechnungen</button></p>`}
  </div>`;
}

/* ---------- Leistungsverzeichnis ---------- */
function tabLV(p){
  const ntOpts = [["","Hauptauftrag"], ...p.nachtraege.map(n => [n.id, n.nr + " – " + n.titel])];
  const sumH = p.positions.filter(x => !x.nt).reduce((s,x) => s + round2(num(x.menge)*num(x.ep)), 0);
  const sumN = p.positions.filter(x => x.nt).reduce((s,x) => s + round2(num(x.menge)*num(x.ep)), 0);
  return `<div class="row sp"><h2>Leistungsverzeichnis</h2><div class="row"><button class="btn" data-a="lvimport">Positionen einfügen</button><button class="btn pri" data-a="addpos">Position hinzufügen</button></div></div>
  <div class="sec" style="padding:12px">${dropZone("Auftragsschreiben / Leistungsverzeichnis einlesen", "Scan des Auftragsschreibens mit angehängtem LV, GAEB DA XML (X83, X84, X86), Excel, CSV oder Projektdatei (.json)", "lvpick")}</div>
  <div class="sec">
  <p class="muted" style="font-size:.86rem">Einheitspreise netto laut Auftrag. Nachtragspositionen der jeweiligen Nachtragsnummer zuordnen – sie werden in der Rechnungsprüfung nur anerkannt, wenn der Nachtrag beauftragt ist.</p>
  ${p.positions.length ? `<div class="tw" data-k="lv"><table><thead><tr><th style="min-width:90px">OZ</th><th style="min-width:220px">Kurztext</th><th style="min-width:64px">Einheit</th><th class="r" style="min-width:90px">LV-Menge</th><th class="r" style="min-width:100px">EP (€)</th><th class="r">GP (€)</th><th style="min-width:170px">Zuordnung</th><th></th></tr></thead><tbody>
  ${p.positions.map(x => `<tr><td>${inText(`pos:${x.id}:oz`, x.oz)}</td><td>${inText(`pos:${x.id}:text`, x.text)}</td><td>${inText(`pos:${x.id}:eh`, x.eh)}</td><td>${inNum(`pos:${x.id}:menge`, x.menge, 3)}</td><td>${inNum(`pos:${x.id}:ep`, x.ep, 2, 2)}</td><td class="r nw">${eur(round2(num(x.menge)*num(x.ep)))}</td><td>${sel(`pos:${x.id}:nt`, ntOpts, x.nt)}</td><td><button class="x" data-a="delpos" data-id="${x.id}" aria-label="Position löschen">${S.confirm === "pos"+x.id ? "Löschen?" : "×"}</button></td></tr>`).join("")}
  <tr class="sum"><td colspan="5">Hauptauftrag netto</td><td class="r nw">${eur(sumH)}</td><td colspan="2"></td></tr>
  <tr><td colspan="5" class="muted">Nachtragspositionen netto (LV-Mengen)</td><td class="r nw muted">${eur(sumN)}</td><td colspan="2"></td></tr>
  </tbody></table></div>` : `<p class="muted">Noch keine Positionen. Füge Positionen einzeln hinzu oder kopiere sie aus einer Tabelle (Spalten: OZ, Kurztext, Einheit, Menge, EP).</p>`}
  </div>`;
}

/* ---------- Nachträge ---------- */
function tabNT(p){
  const C = calcAll(p); const last = C.out[C.out.length - 1];
  const sumBy = st => p.nachtraege.filter(n => st.includes(n.status));
  const posSum = n => p.positions.filter(x => x.nt === n.id).reduce((s,x) => s + round2(num(x.menge)*num(x.ep)), 0);
  const abgerechnet = n => last ? last.rows.filter(r => r.pos.nt === n.id).reduce((s,r) => s + r.bGP, 0) : 0;
  const hints = [];
  p.nachtraege.forEach(n => {
    if (n.grundlage === "2-6" && !n.anzeige) hints.push(["cut", `<b>${esc(n.nr)}:</b> § 2 Abs. 6 Nr. 1 VOB/B – der Vergütungsanspruch für zusätzliche Leistungen setzt voraus, dass der AN ihn vor Beginn der Ausführung ankündigt. Datum der Ankündigung fehlt.`]);
    if ((n.grundlage === "2-5" || n.grundlage === "2-6") && n.status !== "beauftragt" && n.status !== "abgelehnt") hints.push(["info", `<b>${esc(n.nr)}:</b> Die Vereinbarung über den neuen Preis soll möglichst vor der Ausführung getroffen werden (§ 2 Abs. 5 S. 2 / Abs. 6 Nr. 2 VOB/B). Preisermittlung auf Basis der Urkalkulation anfordern.`]);
    if (n.grundlage === "2-8") hints.push(["info", `<b>${esc(n.nr)}:</b> Leistungen ohne Auftrag werden nur vergütet, wenn der AG sie nachträglich anerkennt oder sie notwendig waren, dem mutmaßlichen Willen entsprachen und unverzüglich angezeigt wurden (§ 2 Abs. 8 Nr. 2 VOB/B).`]);
    if (num(n.geprueft) > num(n.angebot) && num(n.angebot) > 0) hints.push(["warn", `<b>${esc(n.nr)}:</b> geprüfter Betrag übersteigt das Angebot.`]);
    if (n.status === "beauftragt" && abgerechnet(n) > (num(n.geprueft) || num(n.angebot)) + 0.01) hints.push(["warn", `<b>${esc(n.nr)}:</b> abgerechnete Nachtragspositionen (${eur(abgerechnet(n))}) übersteigen den beauftragten Betrag.`]);
  });
  return `<div class="row sp"><h2>Nachtragsmanagement</h2><button class="btn pri" data-a="addnt">Nachtrag anlegen</button></div>
  <div class="sec" style="padding:12px">${dropZone("Nachtragsangebot einlesen", "PDF oder Scan – Nachtrag mit Anspruchsgrundlage, Angebotssumme und Positionen wird angelegt", "ntpick")}</div>
  <div class="sec">
  ${p.nachtraege.length ? `<div class="tw" data-k="nt"><table><thead><tr><th style="min-width:70px">Nr.</th><th style="min-width:200px">Bezeichnung</th><th style="min-width:220px">Anspruchsgrundlage</th><th>Angekündigt</th><th>Angebot vom</th><th class="r" style="min-width:110px">Angebot netto</th><th class="r" style="min-width:110px">Geprüft netto</th><th style="min-width:150px">Status</th><th class="r">Pos.-Summe LV</th><th class="r">Abgerechnet (geprüft)</th><th style="min-width:180px">Bemerkung</th><th></th></tr></thead><tbody>
  ${p.nachtraege.map(n => `<tr><td>${inText(`nt:${n.id}:nr`, n.nr)}</td><td>${inText(`nt:${n.id}:titel`, n.titel)}</td><td>${sel(`nt:${n.id}:grundlage`, GRUNDLAGEN, n.grundlage)}</td><td>${inDate(`nt:${n.id}:anzeige`, n.anzeige)}</td><td>${inDate(`nt:${n.id}:angebotDatum`, n.angebotDatum)}</td><td>${inNum(`nt:${n.id}:angebot`, n.angebot, 2, 2)}</td><td>${inNum(`nt:${n.id}:geprueft`, n.geprueft, 2, 2)}</td><td>${sel(`nt:${n.id}:status`, NT_STATUS, n.status)}</td><td class="r nw">${eur(posSum(n))}</td><td class="r nw">${eur(abgerechnet(n))}</td><td>${inText(`nt:${n.id}:bem`, n.bem)}</td><td><button class="x" data-a="delnt" data-id="${n.id}" aria-label="Nachtrag löschen">${S.confirm === "nt"+n.id ? "Löschen?" : "×"}</button></td></tr>`).join("")}
  </tbody></table></div>` : `<p class="muted">Noch keine Nachträge. Lege Nachträge mit Anspruchsgrundlage an und ordne im Leistungsverzeichnis die zugehörigen Positionen zu.</p>`}
  </div>
  <div class="grid2">
    <div class="sec"><h3>Summen</h3><div class="kv">
      <div>Beauftragt (${sumBy(["beauftragt"]).length})</div><div>${eur(C.ntBeauftragt)}</div>
      <div>Offen / in Prüfung (${sumBy(["angekündigt","Angebot eingegangen","in Prüfung","zurückgestellt"]).length})</div><div>${eur(C.ntOffen)}</div>
      <div>Abgelehnt (${sumBy(["abgelehnt"]).length})</div><div>${eur(sumBy(["abgelehnt"]).reduce((s,n) => s + num(n.angebot), 0))}</div>
      <div>Nachtragsquote (beauftragt / Hauptauftrag)</div><div>${C.auftragNetto ? fmtN(C.ntBeauftragt / C.auftragNetto * 100, 1) : "0"} %</div>
    </div><small>Beauftragte Nachträge gehen mit dem geprüften Betrag (sonst Angebotsbetrag) in die Auftragssumme ein.</small></div>
    <div class="sec"><h3>Hinweise</h3>${hints.length ? `<div class="hints">${hints.map(([l,t]) => `<div class="hint ${l}">${t}</div>`).join("")}</div>` : `<p class="muted">Keine Auffälligkeiten.</p>`}</div>
  </div>`;
}

/* ---------- Rechnungen ---------- */
function tabRE(p){
  const C = calcAll(p);
  const idx = p.rechnungen.findIndex(r => r.id === S.inv);
  if (idx >= 0) return invoiceEditor(p, C, idx);
  return `<div class="row sp"><h2>Rechnungen</h2><div class="row"><button class="btn" data-a="addinv" data-v="Schlussrechnung">Schlussrechnung anlegen</button><button class="btn pri" data-a="addinv" data-v="Abschlagsrechnung">Abschlagsrechnung anlegen</button></div></div>
  <div class="sec" style="padding:12px">${dropZone("Rechnungen einlesen", "PDF oder Scan – auch mehrere Dateien auf einmal. Je Datei wird eine Rechnung angelegt, Positionen erkannt und die Mengen AN übernommen.", "invpick")}</div>
  <div class="sec">
  <p class="muted" style="font-size:.86rem">Jede Rechnung wird kumuliert geprüft: Gesamtleistung bis heute, abzüglich Einbehalte und aller bisherigen Zahlungen. Eine neue Rechnung übernimmt die Mengen der Vorrechnung als Ausgangsstand.</p>
  ${C.out.length ? `<div class="tw"><table><thead><tr><th>Nr.</th><th>Art</th><th>Zugang</th><th>Fälligkeit</th><th class="r">Stand geprüft netto</th><th class="r">Zahlbetrag festgestellt</th><th>Hinweise</th><th>Status</th><th></th></tr></thead><tbody>
  ${C.out.map(r => { const nc = r.hints.filter(h => h.lvl === "cut").length, nw = r.hints.filter(h => h.lvl === "warn").length; return `<tr><td class="nw"><b>${esc(r.inv.nr)}</b></td><td>${esc(r.inv.art)}</td><td>${fmtD(r.inv.eingang)}</td><td>${fmtD(r.zF.d)}</td><td class="r">${eur(r.sumGP)}</td><td class="r"><b>${eur(r.zahlbetrag)}</b></td><td class="nw">${nc ? `<span class="tag cut">${nc} Kürzung${nc>1?"en":""}</span> ` : ""}${nw ? `<span class="tag warn">${nw} prüfen</span>` : ""}</td><td>${statusTag(r.inv.status)}</td><td><button class="btn sm" data-a="openinv" data-id="${r.inv.id}">Prüfen</button></td></tr>`; }).join("")}
  </tbody></table></div>` : `<p class="muted">Noch keine Rechnung erfasst.${p.positions.length ? "" : " Erfasse zuerst das Leistungsverzeichnis."}</p>`}
  </div>`;
}
function invoiceEditor(p, C, idx){
  const r = C.out[idx], inv = r.inv, I = inv.id;
  const t = todayISO();
  const ust = p.rc13b ? "USt – § 13b UStG (Reverse Charge)" : `+ Umsatzsteuer ${fmtN(p.ust,2)} %`;
  const L = (label, a, b, cls = "") => `<div class="lr ${cls}"><span>${label}</span><span>${a}</span><span>${b}</span></div>`;
  const dz = r.zF.d ? daysBetween(t, r.zF.d) : null, ds = r.skF.d ? daysBetween(t, r.skF.d) : null;
  const rowsHTML = r.rows.map(x => {
    const cls = x.flags.includes("cut") ? "cut" : x.flags.includes("warn") ? "flag" : "";
    const hasF = x.a.formel && String(x.a.formel).trim();
    const diff = round2(x.bGP - x.bAN);
    return `<tr class="${cls}"><td class="nw"><b>${esc(x.pos.oz)}</b>${x.nt ? `<br><span class="tag ${x.ntOk ? "ok" : "cut"}">${esc(x.nt.nr)}</span>` : ""}</td>
    <td style="min-width:180px">${esc(x.pos.text)}</td><td>${esc(x.pos.eh)}</td><td class="r nw">${fmtN(x.pos.menge)}</td><td class="r nw">${eur(x.pos.ep)}</td>
    <td>${inNum(`am:${I}:${x.pos.id}:an`, x.a.an, 3)}</td>
    <td style="min-width:200px"><div style="display:flex;gap:4px;align-items:center">${inText(`am:${I}:${x.pos.id}:formel`, x.a.formel || "", "z. B. 12,5*3,2+4*2")}${unitKind(x.pos.eh) ? `<button class="btn sm" data-a="uebopen" data-id="${I}" data-v="${x.pos.id}" title="Übermessungsrechner nach Abschnitt 5 ATV" aria-label="Übermessungsrechner für Pos. ${esc(x.pos.oz)}">Ü</button>` : ""}</div></td>
    <td>${hasF ? `<input class="in num" disabled value="${esc(x.fErr ? "Fehler" : fmtIn(x.gp,3))}">` : inNum(`am:${I}:${x.pos.id}:gp`, x.a.gp, 3)}</td>
    <td class="r nw">${eur(x.bAN)}</td><td class="r nw"><b>${eur(x.bGP)}</b></td><td class="r nw ${diff < 0 ? "neg" : diff > 0 ? "pos" : ""}">${diff ? eur(diff) : "–"}</td>
    <td style="min-width:90px">${inText(`am:${I}:${x.pos.id}:blatt`, x.a.blatt || "")}</td><td style="min-width:200px">${inText(`am:${I}:${x.pos.id}:bem`, x.a.bem || "", "Begründung bei Kürzung")}</td></tr>`;
  }).join("");
  return `<div class="row sp"><div class="row"><button class="btn ghost" data-a="closeinv">Alle Rechnungen</button><h2 style="margin:0">${esc(inv.nr)} · ${esc(inv.art)}</h2></div>
    <div class="row"><button class="btn" data-a="print" data-id="${I}">Prüfvermerk drucken</button><button class="btn" data-a="dlreport" data-id="${I}">Prüfvermerk herunterladen</button><button class="btn ghost" data-a="csv" data-id="${I}">CSV</button></div></div>
  <div class="sec"><h3>Rechnungsdaten</h3><div class="fields">
    ${fld("Rechnungsnummer", inText(`inv:${I}:nr`, inv.nr))}
    ${fld("Art", sel(`inv:${I}:art`, INV_ART, inv.art))}
    ${fld("Rechnungsdatum", inDate(`inv:${I}:datum`, inv.datum))}
    ${fld("Zugang beim AG", inDate(`inv:${I}:eingang`, inv.eingang), "Maßgeblich für Fälligkeit und Skontofrist")}
    ${fld("Geforderter Zahlbetrag lt. AN (brutto)", inNum(`inv:${I}:forderung`, inv.forderung, 2, 2))}
    ${fld("Pauschaler Abschlag lt. AN (netto, kumuliert)", inNum(`inv:${I}:pauschalAN`, inv.pauschalAN, 2, 2), "Nur bei Abschlägen ohne Positionsaufstellung")}
    ${fld("davon anerkannt (netto, kumuliert)", inNum(`inv:${I}:pauschalGP`, inv.pauschalGP, 2, 2))}
    ${fld("Prüfdatum", inDate(`inv:${I}:pruefdatum`, inv.pruefdatum))}
    ${fld("Status", sel(`inv:${I}:status`, INV_STATUS, inv.status))}
  </div><div style="margin-top:12px">${chk(`inv:${I}:gemAufmass`, inv.gemAufmass, "Aufmaß gemeinsam mit dem AN festgestellt (§ 14 Abs. 2 VOB/B)")}</div></div>
  ${scanSection(p, r, inv)}

  <div class="sec"><div class="row sp"><h3 style="margin:0">Aufmaß und Positionsprüfung (kumulierte Mengen)</h3><div class="row"><button class="btn sm pri" data-a="ampick" data-id="${I}">Aufmaßblätter einlesen</button><button class="btn sm" data-a="copyan" data-id="${I}">Leere geprüfte Mengen aus AN-Mengen übernehmen</button></div></div>
  <p class="muted" style="font-size:.84rem;margin-top:6px">Mengen jeweils als Gesamtstand seit Baubeginn. Aufmaßformel ersetzt die manuell geprüfte Menge. Abrechnung nach Abschnitt 5 der ATV ${esc(p.atv)} (VOB/C). Mit „Ü“ rechnest du Öffnungen und Aussparungen nach den Übermessungsregeln.</p>
  ${p.positions.length ? `<div class="tw" data-k="am"><table><thead><tr><th>OZ</th><th>Kurztext</th><th>EH</th><th class="r">LV-Menge</th><th class="r">EP</th><th class="r" style="min-width:95px">Menge AN</th><th>Aufmaßformel</th><th class="r" style="min-width:95px">Menge geprüft</th><th class="r">Betrag AN</th><th class="r">Betrag geprüft</th><th class="r">Differenz</th><th>Aufmaßblatt</th><th>Bemerkung</th></tr></thead><tbody>
  ${rowsHTML}
  <tr class="sum"><td colspan="8">Summe netto (kumuliert)</td><td class="r nw">${eur(r.sumAN)}</td><td class="r nw">${eur(r.sumGP)}</td><td class="r nw ${r.sumGP - r.sumAN < 0 ? "neg" : ""}">${eur(round2(r.sumGP - r.sumAN))}</td><td colspan="2"></td></tr>
  </tbody></table></div>` : `<p class="muted">Keine LV-Positionen vorhanden. <button class="btn sm" data-a="tab" data-v="lv">Leistungsverzeichnis erfassen</button></p>`}
  </div>

  <div class="grid2">
    <div>
      <div class="ledger">
        <h3>Prüfergebnis</h3>
        ${L("", "AN", "geprüft", "h")}
        ${L("Leistungsstand kumuliert (netto)", eur(r.cAN.net), eur(r.cGP.net))}
        ${num(inv.pauschalAN) || num(inv.pauschalGP) ? L("davon pauschaler Abschlag ohne Aufstellung", eur(num(inv.pauschalAN)), eur(num(inv.pauschalGP)), "sub") : ""}
        ${num(p.nachlass) ? L(`./. Nachlass ${fmtN(p.nachlass,2)} %${nlNT(p) ? "" : " (nur Hauptauftrag)"}`, eur(-r.cAN.nl), eur(-r.cGP.nl), "sub") : ""}
        ${num(p.umlage) ? L(`./. Umlage ${fmtN(p.umlage,2)} % (${esc(p.umlageText)})`, eur(-r.cAN.ul), eur(-r.cGP.ul), "sub") : ""}
        ${L("Netto", eur(r.cAN.n2), eur(r.cGP.n2))}
        ${L(ust, eur(r.cAN.ust), eur(r.cGP.ust), "sub")}
        ${L("Brutto kumuliert", eur(r.cAN.brutto), eur(r.cGP.brutto), "tot")}
        ${L("./. " + r.seLabel, "", eur(-r.se))}
        ${r.maengel ? L("./. Mängeleinbehalt (§ 641 Abs. 3 BGB)", "", eur(-r.maengel)) : ""}
        ${r.sonst ? L("./. " + esc(inv.sonstText || "sonstige Abzüge"), "", eur(-r.sonst)) : ""}
        ${L("Anerkannt nach Einbehalten", "", eur(r.nachAbzug), "tot")}
        ${L(`./. bisherige Zahlungen (${idx} Vorrechnung${idx === 1 ? "" : "en"})`, "", eur(-r.vor))}
        <div class="zahl"><span>Zahlbetrag dieser Rechnung (brutto)</span><span class="v ${r.zahlbetrag < 0 ? "neg" : ""}">${eur(r.zahlbetrag)}</span></div>
        ${r.skontoMoeglich ? `<div style="margin-top:10px">
          ${L(`./. Skonto ${fmtN(p.skontoSatz,2)} % bei Zahlung bis ${fmtD(r.skF.d)}`, "", eur(-r.skonto), "sub")}
          ${!p.freistellung ? L("./. Bauabzugsteuer 15 % (§ 48 EStG)", "", eur(-r.baMit), "sub") : ""}
          ${L("Auszahlung an AN mit Skonto", "", eur(r.auszMit), "tot")}
          ${L("Auszahlung an AN ohne Skonto", "", eur(r.auszOhne), "sub")}
        </div>` : (!p.freistellung ? `<div style="margin-top:10px">${L("./. Bauabzugsteuer 15 % (§ 48 EStG)", "", eur(-r.baOhne), "sub")}${L("Auszahlung an AN", "", eur(r.auszOhne), "tot")}</div>` : "")}
      </div>
      <div class="sec" style="margin-top:16px"><h3>Abzüge (kumulierter Stand)</h3><div class="fields">
        ${fld("Mängeleinbehalt brutto (€)", inNum(`inv:${I}:maengel`, inv.maengel, 2, 2), "In der Regel das Doppelte der Mängelbeseitigungskosten (§ 641 Abs. 3 BGB)")}
        ${fld("Sonstige Abzüge brutto (€)", inNum(`inv:${I}:sonst`, inv.sonst, 2, 2))}
        ${fld("Bezeichnung sonstige Abzüge", inText(`inv:${I}:sonstText`, inv.sonstText, "z. B. Vertragsstrafe (§ 11 VOB/B)"))}
      </div></div>
    </div>
    <div>
      <div class="sec"><h3>Fristen</h3><div class="kv">
        <div>Zugang</div><div>${fmtD(inv.eingang)}</div>
        <div>Skontofrist (${esc(p.skontoTage)} Tage)</div><div>${r.skontoMoeglich && r.skF.d ? fmtD(r.skF.d) + (r.skF.shifted ? " *" : "") : "–"}</div>
        <div>Fälligkeit (${r.isSchluss ? p.fristSchluss : p.fristAbschlag} Tage, § 16 VOB/B)</div><div>${r.zF.d ? fmtD(r.zF.d) + (r.zF.shifted ? " *" : "") : "–"}</div>
        ${!r.paidRecorded && dz !== null ? `<div>Verbleibend bis Fälligkeit</div><div class="${dz < 0 ? "neg" : ""}">${dz < 0 ? -dz + " Tage überfällig" : dz + " Tage"}</div>` : ""}
        ${!r.paidRecorded && ds !== null && r.skontoMoeglich ? `<div>Verbleibend bis Skontofrist</div><div class="${ds < 0 ? "neg" : ""}">${ds < 0 ? "abgelaufen" : ds + " Tage"}</div>` : ""}
      </div>${r.skF.shifted || r.zF.shifted ? `<small>* Fristende fiel auf ein Wochenende und wurde nach § 193 BGB auf den nächsten Werktag verschoben. Feiertage bitte selbst prüfen.</small>` : ""}</div>
      <div class="sec"><h3>Zahlung erfassen</h3><div class="fields">
        ${fld("Zahlungsdatum", inDate(`inv:${I}:zahlDatum`, inv.zahlDatum))}
        ${fld("Ausgezahlt an AN (€)", inNum(`inv:${I}:zahlBetrag`, inv.zahlBetrag, 2, 2), p.freistellung ? "" : "Ohne abgeführte Bauabzugsteuer")}
        ${fld("Tatsächlich abgezogenes Skonto (€)", inNum(`inv:${I}:skontoIst`, inv.skontoIst, 2, 2), "Leer = zulässiges Skonto, wenn Haken gesetzt")}
      </div><div style="margin-top:10px">${chk(`inv:${I}:skontoGezogen`, inv.skontoGezogen, `Skonto gezogen (${eur(r.skonto)})`)}</div>
      <small>${r.paidRecorded ? `Angerechnet auf Folgerechnungen: ${eur(r.anrechnung)} (Zahlung ${eur(r.paid)}${r.baPaid ? ` + Bauabzugsteuer ${eur(r.baPaid)}` : ""}${r.skPaid ? ` + Skonto ${eur(r.skPaid)}` : ""}).` : `Ohne erfasste Zahlung wird der festgestellte Zahlbetrag (${eur(Math.max(0,r.zahlbetrag))}) auf Folgerechnungen angerechnet.`}</small></div>
      <div class="sec"><h3>Prüfbemerkung</h3><textarea class="in" rows="3" data-b="inv:${I}:bem" placeholder="Erscheint im Prüfvermerk">${esc(inv.bem)}</textarea></div>
    </div>
  </div>
  <div class="sec"><h3>Hinweise zur Prüfung</h3><div class="hints">${r.hints.sort((a,b) => ({cut:0,warn:1,info:2}[a.lvl] - {cut:0,warn:1,info:2}[b.lvl])).map(h => `<div class="hint ${h.lvl}">${h.t}</div>`).join("")}</div></div>
  <div class="row" style="justify-content:flex-end"><button class="btn danger" data-a="delinv" data-id="${I}">${S.confirm === "inv"+I ? "Wirklich löschen? Folgerechnungen werden neu berechnet" : "Rechnung löschen"}</button></div>`;
}

/* ---------- Vertragserfüllungsbürgschaft (BGB) ---------- */
const triSel = (b, v, labels = ["ja","nein"]) => `<select class="in" data-b="${b}" data-t="tri"><option value="" ${v == null ? "selected" : ""}>– bitte wählen –</option><option value="1" ${v === true ? "selected" : ""}>${labels[0]}</option><option value="0" ${v === false ? "selected" : ""}>${labels[1]}</option></select>`;
/* ---------- Aufmaßregeln / Übermessung ---------- */
function tabUeb(p){
  const atv = S.uebAtv && UEB[S.uebAtv] ? S.uebAtv : p.atv;
  const d = UEB[atv] || {};
  const name = (ATV.find(x => x[0] === atv) || [atv, ""])[1];
  const kinds = ["m2","m3","m"].filter(k => d[k]);
  const nOv = Object.keys(p.ueb || {}).length;
  const tbl = k => { const rl = uebRules(p, atv, k); return `<h3 style="margin-top:14px">${UEB_KIND[k]}</h3><div class="tw"><table><thead><tr><th>Übermessen werden</th><th class="r" style="min-width:110px">Grenzwert (≤)</th><th>Kriterium</th><th>Stand</th></tr></thead><tbody>
    ${rl.map(r => `<tr><td>${esc(r.lbl)}</td><td>${inNum(`ueb:${r.key}`, r.ovr ? r.g : "", 3, 0, r.def == null ? "eintragen" : fmtIn(r.def, 3))}</td>
    <td class="nw">${{f:"Einzelfläche a×b",v:"Einzelvolumen a×b×c",q:"Querschnitt a×b (je m)",w:"Einzelbreite",l:"Einzellänge"}[r.mode]} in ${{f:"m²",v:"m³",q:"m²",w:"m",l:"m"}[r.mode]}</td>
    <td>${r.ovr ? `<span class="tag">projektbezogen geändert</span>` : r.def == null ? `<span class="tag cut">nicht hinterlegt</span>` : r.st === "v" ? `<span class="tag ok">Normwert</span>` : `<span class="tag warn">abgleichen</span>`}</td></tr>`).join("")}
    </tbody></table></div>`; };
  return `<h2>Aufmaßregeln nach VOB/C</h2>
  <div class="sec"><div class="fields">
    ${fld("Gewerk / ATV", `<select class="in" id="uebAtvSel">${ATV.map(([k,l]) => `<option value="${esc(k)}" ${k === atv ? "selected" : ""}>${esc(k + " – " + l)}${k === p.atv ? " (Projekt)" : ""}</option>`).join("")}</select>`, atv === p.atv ? "Vertragsgewerk dieses Projekts" : `Projektgewerk ist ${esc(p.atv)} – Rechner und Prüfhinweise verwenden das Projektgewerk`)}
  </div>
  <p class="muted" style="font-size:.86rem;margin-top:10px">ATV ${esc(atv)} ${esc(name)}, Abschnitt 5 „Abrechnung“. Ein eigener Grenzwert gilt nur für dieses Projekt – etwa wenn das LV abweichende Abrechnungsregeln enthält. Feld leeren, um zum Normwert zurückzukehren.</p>
  ${kinds.length ? kinds.map(tbl).join("") : `<p class="muted">Für dieses Gewerk sind keine Übermessungsgrenzen hinterlegt.</p>`}
  ${(d.notes || []).length ? `<h3 style="margin-top:14px">Einzelregelungen</h3><ul style="margin:0;padding-left:18px;font-size:.9rem">${d.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
  ${nOv ? `<div class="row" style="margin-top:12px"><button class="btn sm ghost" data-a="uebreset">${nOv} projektbezogene Grenzwerte zurücksetzen</button></div>` : ""}
  </div>
  <div class="sec"><h3>Grundsätze</h3><div class="hints">${UEB_GRUND.map(t => `<div class="hint info">${esc(t)}</div>`).join("")}</div></div>
  <div class="sec"><h3>So nutzt du die Regeln in der Prüfung</h3><ul style="margin:0;padding-left:18px;font-size:.9rem">
    <li>Im Aufmaß einer Rechnung neben der Aufmaßformel auf <b>Ü</b> tippen. Bruttomaß eingeben und jede Öffnung bzw. Aussparung mit Maßen erfassen. Der Rechner entscheidet je Einzelgröße „übermessen“ oder „abziehen“ und schreibt Formel und Begründung in die Zeile.</li>
    <li>Enthält eine Aufmaßformel einen Abzug, der unter der Übermessungsgrenze liegt, erscheint ein gelber Prüfhinweis. Eine solche Kürzung wäre ohne abweichende LV-Regelung angreifbar.</li>
    <li>Ob der AN zu große Öffnungen übermessen hat, lässt sich nur am Plan oder vor Ort feststellen – dafür den Rechner mit den Planmaßen nutzen.</li>
  </ul></div>`;
}
function uebOpen(p, invId, posId){
  if (!p) return;
  const inv = p.rechnungen.find(x => x.id === invId), pos = p.positions.find(x => x.id === posId); if (!inv || !pos) return;
  const kind = unitKind(pos.eh); if (!kind) { toast("Übermessung nur für m, m² und m³"); return; }
  const a = (inv.aufmass || {})[posId] || {};
  const rlAll = uebRules(p, p.atv, kind);
  const r0 = (/boden|dielung|estrich|schüttung|schuettung|belag|podest/i.test(pos.text || "") && rlAll.find(r => r.id === "boden")) || rlAll[0];
  const prevF = a.formel && String(a.formel).trim() ? String(a.formel) : (num(a.gp) ? fmtIn(num(a.gp), 3) : (num(a.an) ? fmtIn(num(a.an), 3) : ""));
  const need = kind === "m" ? 1 : kind === "m2" ? 2 : 3;
  const keep = [], items = [];
  topTerms(prevF).forEach(t => {
    const f = /[()+\-\/]/.test(t.text) ? null : t.text.split("*");
    if (t.sign < 0 && f && (f.length === need || (f.length === need + 1 && /^\d+$/.test(f[0])))) {
      const n = f.length > need ? Number(f.shift()) : 1;
      items.push({ bez:"", a:f[0] || "", b:f[1] || "", c:f[2] || "", n, r: r0 ? r0.id : "" });
    } else keep.push((t.sign < 0 ? "-" : keep.length ? "+" : "") + t.text);
  });
  if (!items.length) items.push({ bez:"", a:"", b:"", c:"", n:1, r: r0 ? r0.id : "" });
  S.modal = { kind:"ueb", kindU: kind, invId, posId, brutto: keep.join(""), split: items.some(x => x.a), items };
  render();
}
function uebModal(m){
  const p = cp(); const pos = p.positions.find(x => x.id === m.posId);
  const mm = { ...m, kind: m.kindU };
  const R = uebResult(p, mm);
  const k = m.kindU;
  const dimH = k === "m" ? ["Länge"] : k === "m2" ? ["Breite","Höhe / Länge"] : ["Länge","Breite","Höhe / Tiefe"];
  const dimK = ["a","b","c"].slice(0, dimH.length);
  const inU = (key, v, ph = "", w = "") => `<input class="in" data-u="${key}" value="${esc(v)}" placeholder="${esc(ph)}" ${w ? `style="min-width:${w}"` : ""}>`;
  const rows = R.items.map((x, i) => `<div style="border:1px solid var(--line);border-radius:4px;padding:10px;margin-top:8px;background:var(--field)">
    <div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end">
      <label class="f"><span>Bezeichnung</span>${inU(`i:${i}:bez`, x.it.bez, "z. B. Treppenöffnung")}</label>
      <button class="btn sm ghost" data-a="uebdel" data-v="${i}" aria-label="Aussparung entfernen">Entfernen</button>
    </div>
    <label class="f" style="margin-top:8px"><span>Regel</span><select class="in" data-u="i:${i}:r">${R.rules.map(r => `<option value="${esc(r.id)}" ${r.id === (x.rule && x.rule.id) ? "selected" : ""}>${esc(r.lbl)}${r.g != null ? " (≤ " + fmtN(r.g, 3) + ")" : " (Grenzwert fehlt)"}</option>`).join("")}</select></label>
    <div style="display:grid;grid-template-columns:repeat(${dimK.length + 1},minmax(0,1fr));gap:8px;margin-top:8px;align-items:end">
      ${dimK.map((d, n) => `<label class="f"><span>${dimH[n]} [m]</span>${inU(`i:${i}:${d}`, x.it[d], "0,00")}</label>`).join("")}
      <label class="f"><span>Anzahl</span>${inU(`i:${i}:n`, x.it.n, "1")}</label>
    </div>
    <div class="row sp" style="margin-top:8px"><span class="muted" style="font-size:.86rem">Einzelgröße ${x.ok ? fmtN(x.size, 3) + " " + x.unitS : "–"}</span>${!x.ok ? "" : x.missing ? `<span class="tag cut">Grenzwert fehlt</span>` : x.ab ? `<span class="tag cut">abziehen: ${fmtN(x.deduct, 3)} ${R.unitL}</span>` : `<span class="tag ok">übermessen</span>`}</div>
  </div>`).join("");
  const noRules = !R.rules.length;
  return `<div class="modal" role="dialog" aria-modal="true"><div class="box" style="max-width:640px">
  <h3>Übermessung · Pos. ${esc(pos.oz)}</h3>
  <p class="muted" style="font-size:.86rem">${esc(pos.text)} · ${esc(pos.eh)} · ${UEB_KIND[k]} nach Abschnitt 5 ATV ${esc(p.atv)}. Je Aussparung die kleinsten Maße eingeben; Ausdrücke wie 2*0,885 sind erlaubt.</p>
  ${noRules ? `<div class="hint warn">Für ${esc(p.atv)} sind keine Übermessungsgrenzen für ${UEB_KIND[k]} hinterlegt. Grenzwerte im Reiter „Aufmaßregeln (VOB/C)“ eintragen oder das Gewerk unter „Vertrag & Konditionen“ prüfen.</div>` : `
  <label class="f" style="margin:10px 0"><span>Bruttomaß ohne Abzüge (Formel)</span>${inU("brutto", m.brutto, "z. B. 4,42*9,24+7,98*1,74")}<small>${R.brutto == null ? "" : isNaN(R.brutto) ? '<span class="neg">Formel nicht auswertbar</span>' : "= " + fmtN(R.brutto, 3) + " " + R.unitL + (m.split ? " · Abzüge aus der bisherigen Formel wurden unten als Aussparungen übernommen." : "")}</small></label>
  <h3 style="margin:12px 0 0">Öffnungen und Aussparungen</h3>${rows}
  <div class="row" style="margin-top:8px"><button class="btn sm" data-a="uebadd">Aussparung hinzufügen</button></div>
  <div class="ledger" style="margin-top:12px">
    <div class="lr"><span>Bruttomaß</span><span></span><span>${R.brutto != null && !isNaN(R.brutto) ? fmtN(R.brutto, 3) + " " + R.unitL : "–"}</span></div>
    <div class="lr sub"><span>./. Abzüge über der Grenze</span><span></span><span>${fmtN(-R.abz, 3)} ${R.unitL}</span></div>
    <div class="lr tot"><span>Menge geprüft</span><span></span><span>${R.netto != null && !isNaN(R.netto) ? fmtN(R.netto, 3) + " " + R.unitL : "–"}</span></div>
  </div>
  <p style="font-size:.84rem;margin-top:8px"><b>Formel:</b> <code>${esc(R.formel || "–")}</code><br><b>Bemerkung:</b> ${esc(R.bem)}</p>
  ${R.missing ? `<div class="hint warn">Für mindestens eine Regel fehlt der Grenzwert – diese Aussparung wird nicht abgezogen.</div>` : ""}`}
  <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost" data-a="closemodal">Abbrechen</button>${noRules ? "" : `<button class="btn pri" data-a="uebapply" ${R.netto == null || isNaN(R.netto) ? "disabled" : ""}>In „Menge geprüft“ übernehmen</button>`}</div>
  </div></div>`;
}
function uebSet(el, enter){
  const m = S.modal, key = el.dataset.u, v = el.value;
  if (key === "brutto") m.brutto = v;
  else { const [, i, f] = key.split(":"); const it = m.items[Number(i)]; if (it) it[f] = f === "n" ? (num(v) || 1) : v; }
  setTimeout(() => {
    const ae = document.activeElement, fk = enter ? key : (ae && ae.dataset ? ae.dataset.u : null);
    render();
    if (fk) { const n = document.querySelector(`[data-u="${CSS.escape(fk)}"]`); if (n) { let t = n; if (enter) { const all = [...document.querySelectorAll("input[data-u]")]; t = all[all.indexOf(n) + 1] || n; } t.focus({preventScroll:true}); if (t.select) try { t.select(); } catch(_){} } }
  }, 0);
}
function uebApply(p){
  const m = S.modal; const inv = p.rechnungen.find(x => x.id === m.invId); if (!inv) return;
  const R = uebResult(p, { ...m, kind: m.kindU }); if (R.netto == null || isNaN(R.netto)) return;
  inv.aufmass = inv.aufmass || {}; const a = inv.aufmass[m.posId] = inv.aufmass[m.posId] || {};
  a.formel = R.formel; a.gp = R.netto;
  const keep = String(a.bem || "").split(" · ").filter(t => t.trim() && !t.startsWith("Übermessung nach"));
  a.bem = [...keep, R.bem].join(" · ");
  S.modal = null; save(p); render(); toast(`Menge geprüft: ${fmtN(R.netto, 3)} ${R.unitL}`);
}
function tabSicherheit(p){
  const K = sicCalc(p), s = K.s, H = sicHints(p, K), B = k => `sic:${k}`;
  let ergebnis, cls;
  if (K.p650m) { ergebnis = `Gesetzlicher Anspruch nach § 650m Abs. 2 BGB: Sicherheit in Höhe von ${eur(K.soll)}.`; cls = "info"; }
  else if (s.vereinbart === true) { ergebnis = `Vertraglicher Anspruch auf Vertragserfüllungssicherheit: ${eur(K.soll)}.`; cls = "info"; }
  else if (s.vereinbart === false && s.verbraucher !== null && s.vbv !== null) { ergebnis = "Kein Anspruch auf eine Vertragserfüllungssicherheit: nicht vereinbart und kein Verbraucherbauvertrag."; cls = "warn"; }
  else { ergebnis = "Bewertung noch offen – Angaben ergänzen."; cls = "warn"; }
  const statusOpts = ["angefordert","liegt vor","zurückgegeben","in Anspruch genommen"];
  return `<h2>Vertragserfüllungsbürgschaft</h2>
  <div class="grid2">
  <div class="sec"><h3>Anspruch auf Sicherheit</h3><div class="fields">
    ${fld("Besteller ist Verbraucher (§ 13 BGB)", triSel(B("verbraucher"), s.verbraucher))}
    ${fld("Verbraucherbauvertrag (§ 650i BGB)", triSel(B("vbv"), s.vbv), "Neubau oder erhebliche Umbaumaßnahme aus einer Hand – nicht bei Einzelgewerken")}
    ${fld("Sicherheit vertraglich vereinbart", triSel(B("vereinbart"), s.vereinbart))}
    ${fld("Vereinbarung als", sel(B("klausel"), [["agb","AGB des Auftraggebers"],["individuell","individuell ausgehandelt"]], s.klausel))}
    ${fld("Vereinbarte Höhe (%)", inNum(B("satz"), s.satz, 2))}
    ${fld("Bezugsgröße", sel(B("basis"), [["brutto","Auftragssumme brutto"],["netto","Auftragssumme netto"]], s.basis))}
  </div><div style="margin-top:10px">${chk(B("zweckMaengel"), s.zweckMaengel, "Sicherungszweck umfasst auch Mängelansprüche nach Abnahme")}</div>
  <div class="hint ${cls}" style="margin-top:12px"><b>Ergebnis:</b> ${ergebnis}</div></div>
  <div class="sec"><h3>Höhe und Deckung</h3><div class="kv">
    <div>Auftragssumme ursprünglich (${s.basis})</div><div>${eur(K.urspr)}</div>
    <div>inkl. beauftragter Nachträge (${s.basis})</div><div>${eur(K.ges)}</div>
    <div>Erhöhung durch Nachträge</div><div>${fmtN(K.erh,1)} %${K.erh > 10 ? ' <span class="tag warn">> 10 %</span>' : ""}</div>
    <div>Soll-Sicherheit</div><div>${eur(K.soll)}</div>
    <div>Vorliegende Bürgschaften</div><div>${eur(K.vorh)}</div>
    <div>Deckung</div><div class="${K.soll && K.vorh < K.soll ? "neg" : ""}">${K.soll ? fmtN(K.vorh / K.soll * 100, 0) + " %" : "–"}</div>
    ${K.p650m ? `<div>Abschlagszahlungen / 90 %-Grenze (§ 650m Abs. 1)</div><div class="${K.abschl > K.grenze90 ? "neg" : ""}">${eur(K.abschl)} / ${eur(K.grenze90)}</div>` : ""}
  </div>${K.sollTxt ? `<small>${esc(K.sollTxt)}</small>` : ""}</div>
  </div>

  <div class="sec"><div class="row sp"><h3 style="margin:0">Bürgschaftsurkunden</h3><button class="btn pri" data-a="sbadd">Bürgschaft erfassen</button></div>
  ${s.buergschaften.length ? s.buergschaften.map((b, i) => { const X = k => `sb:${b.id}:${k}`; return `<div class="sec" style="margin:12px 0 0;background:var(--field)">
    <div class="row sp"><b>Bürgschaft ${i + 1}</b><button class="x" data-a="sbdel" data-id="${b.id}" aria-label="Bürgschaft löschen">${S.confirm === "sb" + b.id ? "Löschen?" : "×"}</button></div>
    <div class="fields" style="margin-top:8px">
      ${fld("Bürge (Bank/Versicherer)", inText(X("buerge"), b.buerge))}
      ${fld("Bürgschafts-Nr.", inText(X("nr"), b.nr))}
      ${fld("Ausgestellt am", inDate(X("datum"), b.datum))}
      ${fld("Eingegangen am", inDate(X("eingang"), b.eingang))}
      ${fld("Höchstbetrag (€)", inNum(X("betrag"), b.betrag, 2, 2))}
      ${fld("Befristet bis (leer = unbefristet)", inDate(X("befristetBis"), b.befristetBis))}
      ${fld("Status", sel(X("status"), statusOpts, b.status))}
      ${fld("Zurückgegeben am", inDate(X("rueckgabe"), b.rueckgabe))}
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;margin-top:10px">
      ${chk(X("selbstschuldnerisch"), b.selbstschuldnerisch, "Selbstschuldnerisch – Verzicht auf Einrede der Vorausklage (§§ 771, 773 BGB)")}
      ${chk(X("erstesAnfordern"), b.erstesAnfordern, "Auf erstes Anfordern")}
      ${chk(X("verz770"), b.verz770, "Verzicht auf Einrede der Aufrechenbarkeit (§ 770 Abs. 2 BGB)")}
      ${chk(X("tauglich"), b.tauglich, "Tauglicher Bürge (Kreditinstitut/Kreditversicherer, EU-Zulassung)")}
      ${chk(X("original"), b.original, "Original-Urkunde liegt vor")}
    </div>
    <div style="margin-top:8px">${fld("Bemerkung", inText(X("bem"), b.bem))}</div></div>`; }).join("") : `<p class="muted" style="margin-top:8px">Noch keine Bürgschaft erfasst.</p>`}
  </div>

  <div class="sec"><div class="row sp"><h3 style="margin:0">Gesicherte Forderungen / Inanspruchnahme</h3><button class="btn" data-a="sfadd">Forderung erfassen</button></div>
  <p class="muted" style="font-size:.84rem;margin-top:6px">z. B. Mehrkosten der Ersatzvornahme, Überzahlung, Verzugsschaden, Vertragsstrafe.</p>
  ${s.forderungen.length ? `<div class="tw"><table><thead><tr><th style="min-width:220px">Forderung</th><th class="r" style="min-width:110px">Betrag (€)</th><th>Fällig am</th><th>Verjährung Bürgschaftsanspruch</th><th></th></tr></thead><tbody>
  ${s.forderungen.map(f => `<tr><td>${inText(`sf:${f.id}:text`, f.text)}</td><td>${inNum(`sf:${f.id}:betrag`, f.betrag, 2, 2)}</td><td>${inDate(`sf:${f.id}:faellig`, f.faellig)}</td><td class="nw">${f.faellig ? fmtD(yearEnd3(f.faellig)) : "–"}</td><td><button class="x" data-a="sfdel" data-id="${f.id}" aria-label="Forderung löschen">×</button></td></tr>`).join("")}
  <tr class="sum"><td>Summe</td><td class="r">${eur(K.ford)}</td><td colspan="3"></td></tr></tbody></table></div>` : ""}
  <div class="fields" style="margin-top:10px">
    ${fld("AN erfolglos zur Zahlung aufgefordert am", inDate(B("hauptschuldnerGemahnt"), s.hauptschuldnerGemahnt))}
    ${fld("Konto für Zahlung durch den Bürgen", inText(B("konto"), s.konto, "IBAN des Auftraggebers"))}
    ${fld("Frist in Schreiben", inDate(B("fristAnf"), s.fristAnf || addDays(todayISO(), 14)))}
  </div></div>

  <div class="sec"><h3>Schreiben</h3><div class="row">
    <button class="btn" data-a="sicbrief" data-v="anf">Aufforderung zur Stellung der Sicherheit</button>
    <button class="btn" data-a="sicbrief" data-v="inan">Inanspruchnahme des Bürgen</button>
    <button class="btn" data-a="sicbrief" data-v="rueck">Rückgabe der Bürgschaft</button>
  </div><small>Entwürfe zur Anpassung – vor Versand rechtlich prüfen.</small></div>

  <div class="sec"><h3>Rechtliche Hinweise</h3><div class="hints">${H.map(([l, t]) => `<div class="hint ${l}">${t}</div>`).join("")}</div></div>
  <p class="muted" style="font-size:.8rem">Keine Rechtsberatung; maßgeblich sind der konkrete Vertrag und die Bürgschaftsurkunde.</p>`;
}
function sicBrief(p, kind){
  const K = sicCalc(p), s = K.s; const b = s.buergschaften.find(x => x.status === "liegt vor") || s.buergschaften[0] || {};
  const frist = fmtD(s.fristAnf || addDays(todayISO(), 14)); const kopf = `Bauvorhaben: ${p.name}${p.ort ? ", " + p.ort : ""}\nVertrag: ${p.vergabeNr || "–"}${p.vertragsdatum ? " vom " + fmtD(p.vertragsdatum) : ""}\nAuftraggeber: ${p.ag || "–"}\nAuftragnehmer: ${p.an || "–"}\n`;
  const gruss = `\nMit freundlichen Grüßen\n\n${p.bauleiter ? p.bauleiter + " (Bauleitung) im Auftrag des Auftraggebers" : ""}`;
  if (kind === "anf") return { title:"Aufforderung zur Stellung der Sicherheit", text:`${kopf}\nBetreff: Stellung einer Vertragserfüllungssicherheit\n\nSehr geehrte Damen und Herren,\n\ngemäß ${K.p650m ? "§ 650m Abs. 2 BGB" : "der vertraglichen Vereinbarung"} haben Sie eine Sicherheit für die rechtzeitige Herstellung des Werks ohne wesentliche Mängel in Höhe von ${eur(K.soll)} zu leisten.\n\nWir fordern Sie auf, bis zum ${frist} eine schriftliche, selbstschuldnerische und unbefristete Bürgschaft eines in der EU zugelassenen Kreditinstituts oder Kreditversicherers unter Verzicht auf die Einrede der Vorausklage (§ 771 BGB) im Original vorzulegen.${K.p650m ? "\n\nBis zur Stellung der Sicherheit behalten wir uns vor, Abschlagszahlungen bis zur Höhe der Sicherheit zurückzuhalten (§ 650m Abs. 2 BGB)." : ""}${p.vobB !== false ? "\n\nGemäß § 17 VOB/B haben Sie die Wahl zwischen Einbehalt, Hinterlegung und Bürgschaft und können eine Sicherheit durch eine andere ersetzen (Abs. 3). Eine Bürgschaft muss schriftlich, unter Verzicht auf die Einrede der Vorausklage, unbefristet und nicht auf erstes Anfordern ausgestellt sein (Abs. 4)." : ""}\n${gruss}` };
  if (kind === "inan") return { title:"Inanspruchnahme des Bürgen", text:`An: ${b.buerge || "[Bürge]"}\n\n${kopf}\nBetreff: Inanspruchnahme aus Bürgschaft Nr. ${b.nr || "[Nr.]"} vom ${b.datum ? fmtD(b.datum) : "[Datum]"} über höchstens ${b.betrag ? eur(b.betrag) : "[Betrag]"}\nHauptschuldner: ${p.an || "[AN]"}\n\nSehr geehrte Damen und Herren,\n\nhiermit nehmen wir Sie aus der oben genannten Bürgschaft in Höhe von ${eur(Math.min(K.ford, num(b.betrag) || K.ford))} in Anspruch.\n\nGesicherte Forderungen:\n${s.forderungen.map(f => `– ${f.text || "–"}: ${eur(f.betrag)}${f.faellig ? " (fällig seit " + fmtD(f.faellig) + ")" : ""}`).join("\n") || "– [Forderungen]"}\n\nDer Hauptschuldner wurde${s.hauptschuldnerGemahnt ? " mit Schreiben vom " + fmtD(s.hauptschuldnerGemahnt) : ""} unter Fristsetzung erfolglos zur Zahlung aufgefordert.\n\nBitte überweisen Sie den Betrag bis zum ${frist} auf folgendes Konto: ${s.konto || "[IBAN]"}.\n\nAnlagen: Kopie der Bürgschaftsurkunde, Nachweise der Forderungen\n${gruss}` };
  return { title:"Rückgabe der Bürgschaft", text:`An: ${p.an || "[AN]"}\n\n${kopf}\nBetreff: Rückgabe der Vertragserfüllungsbürgschaft Nr. ${b.nr || "[Nr.]"} (${b.buerge || "[Bürge]"}) über ${b.betrag ? eur(b.betrag) : "[Betrag]"}\n\nSehr geehrte Damen und Herren,\n\ndie Abnahme der Leistungen ist am ${p.abnahme ? fmtD(p.abnahme) : "[Datum]"} erfolgt. Die bis zur Abnahme entstandenen gesicherten Ansprüche sind erfüllt${num(p.gwSatz) > 0 || p.gwBuergschaft ? " und die Sicherheit für Mängelansprüche ist gestellt" : ""}.\n\nAnliegend erhalten Sie die Original-Bürgschaftsurkunde zurück.\n${gruss}` };
}

/* ---------- Vertrag ---------- */
function tabVertrag(p){
  const P = k => `proj:${k}`;
  return `<h2>Vertrag und Konditionen</h2>
  <div class="sec" style="padding:12px">${dropZone("Auftragsschreiben einlesen", "Vertragsbedingungen (Einbehalt, Skonto, Fristen, Nachlass, Vertragsstrafe …) und angehängtes LV werden erkannt", "lvpick")}</div>
  ${p.vobB === false ? `<div class="hint cut" style="margin-bottom:12px">VOB/B ist laut Vertrag nicht vereinbart. Es gilt BGB-Bauvertragsrecht (§§ 631 ff., 650a ff. BGB); die VOB/B-Hinweise dieser Software gelten dann nur, soweit vertraglich übernommen.</div>` : ""}
  <div class="sec"><h3>Projekt und Beteiligte</h3><div class="fields">
    ${fld("Projektbezeichnung", inText(P("name"), p.name))}
    ${fld("Auftraggeber", inText(P("ag"), p.ag))}
    ${fld("Auftragnehmer", inText(P("an"), p.an))}
    ${fld("Baustelle", inText(P("ort"), p.ort))}
    ${fld("Vergabe-/Vertragsnummer", inText(P("vergabeNr"), p.vergabeNr))}
    ${fld("Bauleitung (Prüfer)", inText(P("bauleiter"), p.bauleiter))}
    ${fld("Vertragsdatum", inDate(P("vertragsdatum"), p.vertragsdatum))}
    ${fld("Abnahme (§ 12 VOB/B)", inDate(P("abnahme"), p.abnahme))}
    ${fld("Auftragssumme netto lt. Auftrag (€)", inNum(P("auftragssummeLaut"), p.auftragssummeLaut, 2, 2))}
    ${fld("Gewerk / ATV (VOB/C)", sel(P("atv"), ATV.map(([k,l]) => [k, k + " – " + l]), p.atv), "Aufmaß- und Abrechnungsregeln nach Abschnitt 5 der ATV")}
  </div><div style="margin-top:12px">${chk(P("vobB"), p.vobB !== false, "VOB/B als Vertragsbestandteil vereinbart")}</div>
  <div class="fields" style="margin-top:12px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">
    ${fld("Vertragsstrafe", `<textarea class="in" rows="2" data-b="${P("vertragsstrafe")}">${esc(p.vertragsstrafe || "")}</textarea>`, "Vorbehalt bei Abnahme erforderlich (§ 11 Abs. 4 VOB/B)")}
    ${fld("Ausführungsfristen", `<textarea class="in" rows="2" data-b="${P("ausfuehrung")}">${esc(p.ausfuehrung || "")}</textarea>`)}
    ${fld("Weitere Vertragsbedingungen", `<textarea class="in" rows="2" data-b="${P("vertragshinweise")}">${esc(p.vertragshinweise || "")}</textarea>`)}
  </div></div>
  <div class="grid2">
  <div class="sec"><h3>Preise und Steuer</h3><div class="fields">
    ${fld("Nachlass (%)", inNum(P("nachlass"), p.nachlass, 3), "Bezugsbasis siehe Schalter unten")}
    ${fld("Umlage (%)", inNum(P("umlage"), p.umlage, 3), "Nur wenn vertraglich vereinbart")}
    ${fld("Bezeichnung Umlage", inText(P("umlageText"), p.umlageText))}
    ${fld("Umsatzsteuer (%)", inNum(P("ust"), p.ust, 2))}
  </div><div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">
    ${chk(P("nachlassNT"), nlNT(p), "Nachlass gilt auch für Nachtragsleistungen")}
    <small style="margin-top:-4px">Nur ankreuzen, wenn der Vertrag oder die Nachtragsvereinbarung das vorsieht. Ohne Regelung strittig: Fortschreibung über die Preisermittlungsgrundlage (§ 2 Abs. 5/6 VOB/B) gegen Beschränkung auf die Angebotssumme.</small>
    ${chk(P("rc13b"), p.rc13b, "Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG) – keine USt")}
    ${chk(P("freistellung"), p.freistellung, "Freistellungsbescheinigung nach § 48b EStG liegt vor")}
  </div><div class="fields" style="margin-top:10px">${fld("Freistellung gültig bis", inDate(P("freistellungBis"), p.freistellungBis))}</div></div>

  <div class="sec"><h3>Sicherheiten (§ 17 VOB/B)</h3>
    ${chk(P("seVereinbart"), seOn(p), "Sicherheitsleistung vertraglich vereinbart (§ 17 Abs. 1 Nr. 1 VOB/B)")}
    <small>Ohne Vereinbarung kein Einbehalt. Wird mit „Sicherheit vertraglich vereinbart“ im Reiter Vertragserfüllungsbürgschaft abgeglichen.</small>
    <div class="fields" style="margin-top:10px">
    ${fld("Einbehalt je Abschlagsrechnung (%)", inNum(P("seSatz"), p.seSatz, 2), "§ 17 Abs. 6 Nr. 1: höchstens 10 % je Zahlung")}
    ${fld("Vereinbarte Sicherheitssumme (% Auftrag brutto)", inNum(P("seDeckel"), p.seDeckel, 2), "0 = keine Obergrenze; Einbehalt endet bei Erreichen")}
    ${fld("Sicherheit für Mängelansprüche bei Schlussrechnung (%)", inNum(P("gwSatz"), p.gwSatz, 2))}
  </div><div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">
    ${chk(P("seBuergschaft"), p.seBuergschaft, "Vertragserfüllungssicherheit durch Bürgschaft gestellt – kein Einbehalt")}
    ${chk(P("gwBuergschaft"), p.gwBuergschaft, "Mängelsicherheit durch Bürgschaft abgelöst")}
  </div>${num(p.seSatz) > 10 ? `<div class="hint cut" style="margin-top:10px">Einbehalt über 10 % je Zahlung widerspricht § 17 Abs. 6 Nr. 1 VOB/B.</div>` : ""}${seOn(p) && (num(p.seSatz) > 5 || num(p.gwSatz) > 3) ? `<div class="hint info" style="margin-top:10px">Öffentliche Auftraggeber: Vertragserfüllungssicherheit soll 5 %, Mängelsicherheit 3 % der Auftrags- bzw. Abrechnungssumme nicht überschreiten (§ 9c Abs. 2 VOB/A).</div>` : ""}</div>

  <div class="sec"><h3>Skonto (§ 16 Abs. 5 Nr. 2 VOB/B)</h3>
    ${chk(P("skontoVereinbart"), p.skontoVereinbart, "Skonto ist vertraglich vereinbart")}
    <small>Ohne ausdrückliche Vereinbarung sind Skontoabzüge unzulässig (§ 16 Abs. 5 Nr. 2 VOB/B). Voreinstellung für neue Projekte: nicht vereinbart.</small>
    <div class="fields" style="margin-top:10px">
    ${fld("Skontosatz (%)", inNum(P("skontoSatz"), p.skontoSatz, 2), "Üblich 2–5 % (Erfahrungswert, keine Normvorgabe)")}
    ${fld("Skontofrist (Kalendertage ab Zugang)", inNum(P("skontoTage"), p.skontoTage, 0))}
    </div><div style="margin-top:10px">${chk(P("skontoAbschlag"), p.skontoAbschlag, "Skonto auch auf Abschlagsrechnungen vereinbart")}</div>
    ${p.skontoVereinbart && (num(p.skontoSatz) < 2 || num(p.skontoSatz) > 5) ? `<div class="hint warn" style="margin-top:10px">Skontosatz außerhalb der üblichen Spanne von 2–5 % – Vereinbarung prüfen.</div>` : ""}</div>

  <div class="sec"><h3>Zahlungsfristen (§ 16 VOB/B)</h3><div class="fields">
    ${fld("Abschlagszahlung (Tage nach Zugang)", inNum(P("fristAbschlag"), p.fristAbschlag, 0), "VOB/B: 21 Tage (§ 16 Abs. 1 Nr. 3)")}
    ${fld("Schlusszahlung (Tage nach Zugang)", inNum(P("fristSchluss"), p.fristSchluss, 0), "VOB/B: 30 Tage, max. 60 bei ausdrücklicher Vereinbarung")}
  </div>${num(p.fristAbschlag) > 21 ? `<div class="hint warn" style="margin-top:10px">Abweichung von § 16 Abs. 1 Nr. 3 VOB/B – nur bei wirksamer Vereinbarung; die VOB/B gilt dann ggf. nicht mehr „als Ganzes“ (AGB-Inhaltskontrolle).</div>` : ""}${num(p.fristSchluss) > 60 ? `<div class="hint cut" style="margin-top:10px">Mehr als 60 Tage sind nach § 16 Abs. 3 Nr. 1 VOB/B nicht vorgesehen.</div>` : ""}</div>
  </div>
  <p class="muted" style="font-size:.8rem">Die Software unterstützt die fachtechnische und rechnerische Prüfung. Sie ersetzt keine Rechtsberatung; maßgeblich sind der konkrete Bauvertrag und dessen Vorrang vor der VOB/B (§ 1 Abs. 2 VOB/B).</p>`;
}

/* ---------- Prüfvermerk / Export ---------- */
function reportHTML(p, C, idx){
  const r = C.out[idx], inv = r.inv;
  const rows = r.rows.filter(x => x.an || x.gp);
  const tr = (a, b, c, s = "") => `<tr${s ? ` style="${s}"` : ""}><td>${a}</td><td class="r">${b}</td><td class="r">${c}</td></tr>`;
  const ustL = p.rc13b ? "USt (§ 13b UStG – Steuerschuldnerschaft des Leistungsempfängers)" : `Umsatzsteuer ${fmtN(p.ust,2)} %`;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Prüfvermerk ${esc(inv.nr)} – ${esc(p.name)}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px;font-size:11pt}h1{font-size:16pt;margin:0 0 4px}h2{font-size:12pt;margin:18px 0 6px;border-bottom:1.5px solid #111;padding-bottom:3px}table{border-collapse:collapse;width:100%;font-size:9.5pt}th,td{border-bottom:1px solid #bbb;padding:4px 5px;text-align:left;vertical-align:top}th{border-bottom:1.5px solid #111}.r{text-align:right;white-space:nowrap}.meta td{border:0;padding:2px 8px 2px 0}.tot td{font-weight:bold;border-top:1.5px solid #111}.box{border:3px double #111;padding:10px 14px;margin-top:10px}.sig{display:flex;gap:40px;margin-top:40px}.sig div{flex:1;border-top:1px solid #111;padding-top:4px;font-size:9pt}ul{padding-left:18px;font-size:9.5pt}@page{size:A4;margin:15mm}</style></head><body>
<h1>Prüfvermerk zur ${esc(inv.art)} Nr. ${esc(inv.nr)}</h1>
<table class="meta"><tr><td>Bauvorhaben:</td><td><b>${esc(p.name)}</b> ${esc(p.ort)}</td></tr><tr><td>Auftraggeber:</td><td>${esc(p.ag)}</td></tr><tr><td>Auftragnehmer:</td><td>${esc(p.an)}</td></tr><tr><td>Vertrag:</td><td>${esc(p.vergabeNr)} ${p.vertragsdatum ? "vom " + fmtD(p.vertragsdatum) : ""} – VOB/B, VOB/C ${esc(p.atv)}</td></tr><tr><td>Konditionen:</td><td>Skonto ${p.skontoVereinbart ? `vereinbart (${fmtN(p.skontoSatz,2)} %, ${esc(p.skontoTage)} Tage${p.skontoAbschlag ? ", auch auf Abschläge" : ", nur Schlussrechnung"})` : "nicht vereinbart"} · Sicherheitsleistung ${seOn(p) ? "vereinbart" : "nicht vereinbart"}${num(p.nachlass) ? ` · Nachlass ${fmtN(p.nachlass,2)} % ${nlNT(p) ? "inkl. Nachträge" : "nur Hauptauftrag"}` : ""}</td></tr><tr><td>Rechnung:</td><td>vom ${fmtD(inv.datum)}, Zugang ${fmtD(inv.eingang)}, geprüft am ${fmtD(inv.pruefdatum || todayISO())}${inv.gemAufmass ? ", gemeinsames Aufmaß (§ 14 Abs. 2 VOB/B)" : ""}</td></tr></table>
<h2>Positionsprüfung (kumulierte Mengen)</h2>
<table><thead><tr><th>OZ</th><th>Kurztext</th><th>EH</th><th class="r">EP</th><th class="r">Menge AN</th><th class="r">Menge geprüft</th><th class="r">Betrag AN</th><th class="r">Betrag geprüft</th><th>Aufmaß / Bemerkung</th></tr></thead><tbody>
${rows.map(x => `<tr><td>${esc(x.pos.oz)}</td><td>${esc(x.pos.text)}${x.nt ? ` (${esc(x.nt.nr)}${x.ntOk ? "" : " – nicht beauftragt"})` : ""}</td><td>${esc(x.pos.eh)}</td><td class="r">${eur(x.pos.ep)}</td><td class="r">${fmtN(x.an)}</td><td class="r">${fmtN(x.gp)}</td><td class="r">${eur(x.bAN)}</td><td class="r">${eur(x.bGP)}</td><td>${esc([x.a.blatt, x.a.formel, x.a.bem].filter(Boolean).join(" · "))}</td></tr>`).join("")}
${num(inv.pauschalAN) || num(inv.pauschalGP) ? `<tr><td colspan="6">Pauschaler Abschlag ohne Positionsaufstellung (kumuliert)</td><td class="r">${eur(num(inv.pauschalAN))}</td><td class="r">${eur(num(inv.pauschalGP))}</td><td>§ 16 Abs. 1 Nr. 1 VOB/B</td></tr>` : ""}
<tr class="tot"><td colspan="6">Summe netto</td><td class="r">${eur(r.sumAN)}</td><td class="r">${eur(r.sumGP)}</td><td></td></tr></tbody></table>
<h2>Ermittlung des Zahlbetrags</h2>
<table><thead><tr><th></th><th class="r">AN</th><th class="r">geprüft</th></tr></thead><tbody>
${tr("Leistungsstand kumuliert netto", eur(r.cAN.net), eur(r.cGP.net))}
${num(p.nachlass) ? tr(`./. Nachlass ${fmtN(p.nachlass,2)} %${nlNT(p) ? " (inkl. Nachträge)" : " (nur Hauptauftrag)"}`, eur(-r.cAN.nl), eur(-r.cGP.nl)) : ""}
${num(p.umlage) ? tr(`./. Umlage ${fmtN(p.umlage,2)} % (${esc(p.umlageText)})`, eur(-r.cAN.ul), eur(-r.cGP.ul)) : ""}
${tr("Netto", eur(r.cAN.n2), eur(r.cGP.n2))}${tr(ustL, eur(r.cAN.ust), eur(r.cGP.ust))}
${tr("<b>Brutto kumuliert</b>", eur(r.cAN.brutto), "<b>" + eur(r.cGP.brutto) + "</b>")}
${tr("./. " + r.seLabel, "", eur(-r.se))}
${r.maengel ? tr("./. Mängeleinbehalt (§ 641 Abs. 3 BGB)", "", eur(-r.maengel)) : ""}
${r.sonst ? tr("./. " + esc(inv.sonstText || "sonstige Abzüge"), "", eur(-r.sonst)) : ""}
${tr("Anerkannt nach Einbehalten", "", eur(r.nachAbzug))}
${tr("./. bisherige Zahlungen", "", eur(-r.vor))}
</tbody></table>
<div class="box"><table><tbody>
${tr("<b>Festgestellter Zahlbetrag (brutto)</b>", "", "<b>" + eur(r.zahlbetrag) + "</b>")}
${r.skontoMoeglich ? tr(`./. Skonto ${fmtN(p.skontoSatz,2)} % bei Zahlung bis ${fmtD(r.skF.d)}`, "", eur(-r.skonto)) : ""}
${!p.freistellung ? tr("./. Bauabzugsteuer 15 % (§ 48 EStG), an Finanzamt abzuführen", "", eur(-(r.skontoMoeglich ? r.baMit : r.baOhne))) : ""}
${tr(r.skontoMoeglich ? "Auszahlung an AN bei Skontoabzug" : "Auszahlung an AN", "", eur(r.skontoMoeglich ? r.auszMit : r.auszOhne))}
${tr("Fälligkeit (§ 16 VOB/B)", "", fmtD(r.zF.d))}
${inv.forderung ? tr("Geforderter Zahlbetrag lt. Rechnung", "", eur(num(inv.forderung))) : ""}
</tbody></table></div>
${inv.bem ? `<h2>Prüfbemerkung</h2><p>${esc(inv.bem).replace(/\n/g,"<br>")}</p>` : ""}
<h2>Hinweise</h2><ul>${r.hints.map(h => `<li>${h.t}</li>`).join("")}</ul>
<p style="font-size:9pt">Fachtechnisch und rechnerisch geprüft. Der Prüfvermerk der Bauleitung ist eine Empfehlung an den Auftraggeber und stellt kein Anerkenntnis gegenüber dem Auftragnehmer dar; die Zahlungsfreigabe obliegt dem Auftraggeber.</p>
<div class="sig"><div>Ort, Datum, Unterschrift Bauleitung${p.bauleiter ? "<br>" + esc(p.bauleiter) : ""}</div><div>Freigabe Auftraggeber</div></div>
</body></html>`;
}
function csvFor(p, C, idx){
  const r = C.out[idx]; const q = v => `"${String(v ?? "").replace(/"/g,'""')}"`; const n = v => fmtIn(v, 3);
  const lines = [["OZ","Kurztext","EH","LV-Menge","EP","Menge AN","Aufmaßformel","Menge geprüft","Betrag AN","Betrag geprüft","Differenz","Aufmaßblatt","Bemerkung"].map(q).join(";")];
  r.rows.forEach(x => lines.push([x.pos.oz, x.pos.text, x.pos.eh, n(x.pos.menge), fmtIn(x.pos.ep,2,2), n(x.an), x.a.formel || "", n(x.gp), fmtIn(x.bAN,2,2), fmtIn(x.bGP,2,2), fmtIn(round2(x.bGP-x.bAN),2,2), x.a.blatt || "", x.a.bem || ""].map(q).join(";")));
  lines.push(""); [["Summe netto AN", r.sumAN],["Summe netto geprüft", r.sumGP],["Brutto kumuliert", r.cGP.brutto],["Einbehalt", r.se],["Mängeleinbehalt", r.maengel],["Sonstige Abzüge", r.sonst],["Bisherige Zahlungen", r.vor],["Zahlbetrag", r.zahlbetrag],["Skonto", r.skonto]].forEach(([a,b]) => lines.push(q(a) + ";" + q(fmtIn(b,2,2))));
  return "\ufeff" + lines.join("\r\n");
}
async function download(filename, data){
  let dl = null;
  if (window.claude && typeof window.claude.use === "function") { try { dl = await window.claude.use("downloads"); } catch(e){} }
  if (dl) {
    try { await dl.save({ filename, data }); toast("Datei gespeichert"); return; }
    catch(e){ if (e && e.code === "declined") { toast("Speichern abgebrochen"); return; } if (e && e.code === "too_large") { toast("Datei ist zu groß zum Speichern"); return; } }
  }
  if (typeof data !== "string") { toast("Speichern ist in dieser Ansicht nicht verfügbar."); return; }
  S.modal = { title: filename, text: data, hint: "Direktes Speichern ist hier nicht verfügbar. Inhalt kopieren und als Datei sichern." }; render();
}
function modalHTML(){
  if (!S.modal) return "";
  const m = S.modal;
  if (m.kind === "lvpreview") {
    const noEp = m.rows.filter(r => r.ep == null).length;
    return `<div class="modal" role="dialog" aria-modal="true"><div class="box"><h3>Positionen übernehmen</h3><p class="muted" style="font-size:.86rem">${esc(m.source)} · ${m.rows.length} Positionen erkannt${noEp ? ` · ${noEp} ohne Einheitspreis (z. B. X83 ohne Preise)` : ""}</p>
    ${lvRowsTable(m.rows)}
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost" data-a="closemodal">Abbrechen</button><button class="btn pri" data-a="lvapply">Auswahl übernehmen</button></div></div></div>`;
  }
  if (m.kind === "auftrag") return auftragModal(m);
  if (m.kind === "aufmass") return aufmassModal(m);
  if (m.kind === "nachtrag") return nachtragModal(m);
  if (m.kind === "doctype") return doctypeModal();
  if (m.kind === "ueb") return uebModal(m);
  if (m.kind === "lvimport") return `<div class="modal" role="dialog" aria-modal="true"><div class="box"><h3>Positionen einfügen</h3><p class="muted" style="font-size:.86rem">Je Zeile eine Position, Spalten durch Tabulator oder Semikolon getrennt: OZ, Kurztext, Einheit, Menge, EP. Direkt aus Excel kopierbar.</p><textarea class="in" id="lvText" placeholder="01.001;Baustelleneinrichtung;psch;1;4500,00"></textarea><div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn ghost" data-a="closemodal">Abbrechen</button><button class="btn pri" data-a="lvdo">Positionen übernehmen</button></div></div></div>`;
  return `<div class="modal" role="dialog" aria-modal="true"><div class="box"><h3>${esc(m.title)}</h3><p class="muted" style="font-size:.86rem">${esc(m.hint || "")}</p><textarea class="in" readonly>${esc(m.text)}</textarea><div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" data-a="copymodal">Kopieren</button><button class="btn pri" data-a="closemodal">Schließen</button></div></div></div>`;
}
function toast(msg){ const t = document.createElement("div"); t.className = "toast"; t.setAttribute("role","status"); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }

/* ---------- Ereignisse ---------- */
function applyBind(el){
  const b = el.dataset.b; if (!b) return false;
  const t = el.dataset.t || "text";
  let v = t === "bool" ? el.checked : t === "num" ? (el.value.trim() === "" ? "" : num(el.value)) : el.value;
  const p = cp(); if (!p) return false;
  const parts = b.split(":");
  const numericProj = ["ust","nachlass","umlage","seSatz","seDeckel","gwSatz","skontoSatz","skontoTage","fristAbschlag","fristSchluss"];
  if (parts[0] === "proj") { if (numericProj.includes(parts[1]) && v === "") v = 0; p[parts[1]] = v; if (parts[1] === "seVereinbart") ensureSic(p).vereinbart = v; }
  else if (parts[0] === "pos") { const x = p.positions.find(o => o.id === parts[1]); if (x) x[parts[2]] = (v === "" && ["menge","ep"].includes(parts[2])) ? 0 : v; }
  else if (parts[0] === "ueb") { p.ueb = p.ueb || {}; const k = b.slice(4); if (v === "" || v === null) delete p.ueb[k]; else p.ueb[k] = v; }
  else if (parts[0] === "nt") { const x = p.nachtraege.find(o => o.id === parts[1]); if (x) x[parts[2]] = v; }
  else if (parts[0] === "inv") { const x = p.rechnungen.find(o => o.id === parts[1]); if (x) x[parts[2]] = v; }
  else if (parts[0] === "am") {
    const x = p.rechnungen.find(o => o.id === parts[1]); if (!x) return false;
    x.aufmass = x.aufmass || {}; const a = x.aufmass[parts[2]] = x.aufmass[parts[2]] || {};
    a[parts[3]] = v;
    if (parts[3] === "formel") { const r = evalExpr(v); if (r !== null && !isNaN(r)) a.gp = r; }
  }
  else if (parts[0] === "sic" || parts[0] === "sb" || parts[0] === "sf") {
    const sc = ensureSic(p); if (t === "tri") v = el.value === "" ? null : el.value === "1";
    if (parts[0] === "sic") { sc[parts[1]] = (v === "" && parts[1] === "satz") ? 0 : v; if (parts[1] === "vereinbart" && typeof v === "boolean") p.seVereinbart = v; }
    else { const arr = parts[0] === "sb" ? sc.buergschaften : sc.forderungen; const x = arr.find(o => o.id === parts[1]); if (!x) return false; x[parts[2]] = v; }
  }
  else if (parts[0] === "mk") {
    const x = p.rechnungen.find(o => o.id === parts[1]); const m = x && x.scan && x.scan.marks.find(o => o.id === parts[2]); if (!m) return false;
    m[parts[3]] = (v === "" && parts[3] !== "posId") ? null : v;
    if (parts[3] === "posId") { const pos = p.positions.find(o => o.id === v); if (pos && m.manual) { m.oz = pos.oz; m.text = pos.text; } }
  }
  save(p); return true;
}
document.addEventListener("change", e => {
  const el = e.target;
  if (el.id === "projSel") { S.cur = el.value; S.inv = null; S.confirm = null; uiSave(); render(); return; }
  if (el.id === "importFile") { importFile(el.files[0]); el.value = ""; return; }
  if (el.id === "scanFile") { const f = el.files[0]; el.value = ""; if (f && S.scanTarget) { S.inv = S.scanTarget; handleFiles([f], "inv"); } return; }
  if (el.id === "lvFile") { const fs = [...el.files]; el.value = ""; if (!fs.length) S.forceNewProject = false; handleFiles(fs, "lv"); return; }
  if (el.id === "ntFile") { const fs = [...el.files]; el.value = ""; handleFiles(fs, "nt"); return; }
  if (el.id === "amFile") { const fs = [...el.files]; el.value = ""; handleFiles(fs, "am"); return; }
  if (el.id === "invFile") { const fs = [...el.files]; el.value = ""; handleFiles(fs, "newinv"); return; }
  if (el.id === "afTarget") { S.modal.target = el.value; render(); return; }
  if (el.id === "uebAtvSel") { S.uebAtv = el.value; render(); return; }
  if (el.dataset && el.dataset.u && S.modal && S.modal.kind === "ueb") { uebSet(el); return; }
  if (el.id === "placeSel") { S.placeMode = el.value || null; if (S.placeMode) S.editMarks = false; render(); return; }
  if (applyBind(el)) setTimeout(() => {
    const fb = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.b : null;
    render();
    if (fb) { const n = document.querySelector(`[data-b="${CSS.escape(fb)}"]`); if (n) { n.focus({preventScroll:true}); if (n.select && n.type !== "date") try { n.select(); } catch(_){} } }
  }, 0);
});
document.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.matches("input.in[data-b]")) { e.preventDefault(); const el = e.target; const b = el.dataset.b; if (applyBind(el)) { render(); const n = document.querySelector(`[data-b="${CSS.escape(b)}"]`); if (n) n.focus({preventScroll:true}); } }
  if (e.key === "Enter" && e.target.dataset && e.target.dataset.u && S.modal && S.modal.kind === "ueb") { e.preventDefault(); uebSet(e.target, true); }
  if (e.key === "Escape" && (S.modal || S.menu)) { S.modal = null; S.menu = false; render(); }
});
document.addEventListener("click", e => {
  const el = e.target.closest("[data-a]");
  if (!el) { if (S.menu && !e.target.closest(".menu")) { S.menu = false; render(); } return; }
  const a = el.dataset.a, id = el.dataset.id, p = cp();
  const confirmOnce = key => { if (S.confirm === key) { S.confirm = null; return true; } S.confirm = key; render(); return false; };
  switch (a) {
    case "tab": S.tab = el.dataset.v; S.inv = null; S.confirm = null; uiSave(); render(); window.scrollTo(0,0); break;
    case "menu": S.menu = !S.menu; render(); break;
    case "newproj": { const np = newProject(); S.projects.push(np); S.cur = np.id; S.tab = "vertrag"; S.inv = null; S.menu = false; save(np); render(); toast("Projekt angelegt – Vertragsdaten erfassen"); break; }
    case "sample": { const sp = sampleProject(); S.projects.push(sp); S.cur = sp.id; S.tab = "uebersicht"; S.inv = null; S.menu = false; save(sp); render(); break; }
    case "delproj": if (p && confirmOnce("proj")) { S.projects = S.projects.filter(x => x.id !== p.id); removeRemote(p.id); S.cur = S.projects[0]?.id || null; S.menu = false; S.inv = null; save(); render(); toast("Projekt gelöscht"); } break;
    case "export": S.menu = false; download(`Rechnungspruefung_Sicherung_${todayISO()}.json`, JSON.stringify({app:"rechnungspruefung-vobb", version:1, exported:new Date().toISOString(), projects:S.projects}, null, 2)); render(); break;
    case "import": S.menu = false; render(); $("#importFile").click(); break;
    case "addpos": p.positions.push({id:uid(), oz:"", text:"", eh:"", menge:0, ep:0, nt:""}); save(p); render(); break;
    case "delpos": if (confirmOnce("pos"+id)) { p.positions = p.positions.filter(x => x.id !== id); p.rechnungen.forEach(r => { if (r.aufmass) delete r.aufmass[id]; }); save(p); render(); } break;
    case "lvimport": S.modal = {kind:"lvimport"}; render(); setTimeout(() => $("#lvText")?.focus(), 0); break;
    case "lvdo": { const txt = $("#lvText").value; let n = 0; txt.split(/\r?\n/).forEach(line => { if (!line.trim()) return; const c = line.split(line.includes("\t") ? "\t" : ";").map(s => s.trim()); if (c.length < 2) return; p.positions.push({id:uid(), oz:c[0]||"", text:c[1]||"", eh:c[2]||"", menge:num(c[3]), ep:num(c[4]), nt:""}); n++; }); S.modal = null; save(p); render(); toast(`${n} Position${n === 1 ? "" : "en"} übernommen`); break; }
    case "addnt": { const k = p.nachtraege.length + 1; p.nachtraege.push({id:uid(), nr:"NT " + String(k).padStart(2,"0"), titel:"", grundlage:"2-6", anzeige:"", angebotDatum:"", angebot:0, geprueft:0, status:"angekündigt", bem:""}); save(p); render(); break; }
    case "delnt": if (confirmOnce("nt"+id)) { p.nachtraege = p.nachtraege.filter(x => x.id !== id); p.positions.forEach(x => { if (x.nt === id) x.nt = ""; }); save(p); render(); } break;
    case "addinv": { const inv = createInvoice(p, el.dataset.v); S.inv = inv.id; render(); window.scrollTo(0,0); break; }
    case "lvpick": $("#lvFile").click(); break;
    case "invpick": $("#invFile").click(); break;
    case "lvall": document.querySelectorAll("[data-lvrow]").forEach(c => c.checked = el.dataset.v === "1"); break;
    case "lvapply": { const r = applyLVRows(p, S.modal.rows); S.modal = null; save(p); render(); toast(`${r.nNew} Position${r.nNew === 1 ? "" : "en"} übernommen${r.nUpd ? `, ${r.nUpd} aktualisiert` : ""}`); break; }
    case "auftragapply": {
      const M = S.modal; let tp = (M.target === "new" || !p) ? null : p; let nf = 0;
      if (!tp) { tp = newProject(M.pname || "Neues Projekt"); S.projects.push(tp); S.cur = tp.id; }
      document.querySelectorAll("[data-af]").forEach(c => { if (!c.checked) return; const x = M.fields[+c.dataset.af]; if (!x) return; tp[x.prop] = x.val; if (x.prop === "skontoSatz" && x.val > 0) tp.skontoVereinbart = true; if (["seSatz","seDeckel","gwSatz"].includes(x.prop) && x.val > 0) tp.seVereinbart = true; nf++; });
      const r = applyLVRows(tp, M.rows); S.modal = null; S.inv = null; S.tab = r.nNew || r.nUpd ? "lv" : "vertrag"; save(tp); render();
      logAdd("ok", `Übernommen in „${tp.name}“: ${nf} Vertragsangaben, ${r.nNew} neue Positionen${r.nUpd ? `, ${r.nUpd} aktualisiert` : ""}.`);
      toast(`${nf} Vertragsangabe${nf === 1 ? "" : "n"} und ${r.nNew} Position${r.nNew === 1 ? "" : "en"} übernommen – bitte unter „Vertrag & Konditionen“ prüfen`); break;
    }
    case "sbadd": ensureSic(p).buergschaften.push({ id:uid(), buerge:"", nr:"", datum:"", eingang:"", betrag:"", befristetBis:"", status:"angefordert", rueckgabe:"", selbstschuldnerisch:true, erstesAnfordern:false, verz770:false, tauglich:true, original:false, bem:"" }); save(p); render(); break;
    case "sbdel": if (confirmOnce("sb" + id)) { const sc = ensureSic(p); sc.buergschaften = sc.buergschaften.filter(b => b.id !== id); save(p); render(); } break;
    case "sfadd": ensureSic(p).forderungen.push({ id:uid(), text:"", betrag:"", faellig:"" }); save(p); render(); break;
    case "sfdel": { const sc = ensureSic(p); sc.forderungen = sc.forderungen.filter(x => x.id !== id); save(p); render(); break; }
    case "sicbrief": { const b = sicBrief(p, el.dataset.v); S.modal = { title:b.title, text:b.text, hint:"Entwurf – Platzhalter in eckigen Klammern ergänzen. Kopieren und in die Korrespondenz übernehmen." }; render(); break; }
    case "logclose": S.log = []; render(); break;
    case "amapply": applyAufmass(p); break;
    case "ntapply": applyNachtrag(p); break;
    case "doctype": { const files = PENDING_FILES; PENDING_FILES = []; S.modal = null; render(); handleFiles(files, el.dataset.v); break; }
    case "ntpick": $("#ntFile").click(); break;
    case "ampick": S.inv = id; $("#amFile").click(); break;
    case "newprojauftrag": S.forceNewProject = true; S.menu = false; render(); $("#lvFile").click(); break;
    case "openinv": S.placeMode = null; S.editMarks = false; S.tab = "re"; S.inv = id; S.confirm = null; uiSave(); render(); window.scrollTo(0,0); break;
    case "closeinv": S.inv = null; S.confirm = null; uiSave(); render(); break;
    case "delinv": if (confirmOnce("inv"+id)) { p.rechnungen = p.rechnungen.filter(x => x.id !== id); S.inv = null; save(p); render(); toast("Rechnung gelöscht"); } break;
    case "copyan": { const inv = p.rechnungen.find(x => x.id === id); let n = 0; for (const [k, v] of Object.entries(inv.aufmass || {})) { if ((v.gp === "" || v.gp == null) && !v.formel && v.an !== "" && v.an != null) { v.gp = v.an; n++; } } save(p); render(); toast(`${n} Menge${n === 1 ? "" : "n"} übernommen`); break; }
    case "print": { const C = calcAll(p); const i = p.rechnungen.findIndex(x => x.id === id); const html = reportHTML(p, C, i); const bodyPart = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>")); const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>") + 8).replace(/body\{/, "#print{"); $("#print").innerHTML = style + bodyPart; setTimeout(() => { try { window.print(); } catch(_) { toast("Drucken nicht verfügbar – Prüfvermerk herunterladen"); } }, 50); break; }
    case "dlreport": { const C = calcAll(p); const i = p.rechnungen.findIndex(x => x.id === id); download(`Pruefvermerk_${(p.rechnungen[i].nr || "Rechnung").replace(/[^\w.-]+/g,"_")}.html`, reportHTML(p, C, i)); break; }
    case "csv": { const C = calcAll(p); const i = p.rechnungen.findIndex(x => x.id === id); download(`Pruefung_${(p.rechnungen[i].nr || "Rechnung").replace(/[^\w.-]+/g,"_")}.csv`, csvFor(p, C, i)); break; }
    case "scanpick": S.scanTarget = id; $("#scanFile").click(); break;
    case "scanocr": recognize(id); break;
    case "scanstop": if (scanCtl) scanCtl.abort(); break;
    case "scanedit": S.editMarks = !S.editMarks; S.placeMode = null; render(); break;
    case "scanpdf": exportScanPDF(id); break;
    case "scandel": { const inv = p.rechnungen.find(x => x.id === id); if (inv && inv.scan) { inv.scan.marks = inv.scan.marks.filter(m => m.id !== el.dataset.v); save(p); render(); } break; }
    case "scanan": { const inv = p.rechnungen.find(x => x.id === id); let n = 0; inv.aufmass = inv.aufmass || {}; (inv.scan?.marks || []).forEach(m => { if (m.kind === "pos" && m.posId && m.menge != null) { const a = inv.aufmass[m.posId] = inv.aufmass[m.posId] || {}; a.an = m.menge; n++; } }); save(p); render(); toast(`${n} Menge${n === 1 ? "" : "n"} als „Menge AN“ übernommen`); break; }
    case "closemodal": S.modal = null; render(); break;
    case "uebopen": uebOpen(p, id, el.dataset.v); break;
    case "uebadd": { const r0 = uebRules(p, p.atv, S.modal.kindU)[0]; S.modal.items.push({ bez:"", a:"", b:"", c:"", n:1, r: r0 ? r0.id : "" }); render(); break; }
    case "uebdel": S.modal.items.splice(Number(el.dataset.v), 1); render(); break;
    case "uebapply": uebApply(p); break;
    case "uebreset": if (p) { p.ueb = {}; save(p); render(); toast("Grenzwerte auf Normwerte zurückgesetzt"); } break;
    case "copymodal": { const ta = document.querySelector(".modal textarea"); ta.select(); try { navigator.clipboard.writeText(ta.value).then(() => toast("Kopiert"), () => { document.execCommand("copy"); toast("Kopiert"); }); } catch(_) { document.execCommand("copy"); toast("Kopiert"); } break; }
  }
});
function importFile(file){
  if (!file) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const d = JSON.parse(rd.result); const arr = Array.isArray(d) ? d : d.projects;
      if (!Array.isArray(arr)) throw 0;
      let n = 0;
      arr.forEach(pr => { if (!pr || !pr.id || !Array.isArray(pr.positions)) return; const merged = migrateProject(pr); const i = S.projects.findIndex(x => x.id === merged.id); if (i >= 0) S.projects[i] = merged; else S.projects.push(merged); save(merged); n++; });
      const last = arr.filter(pr => pr && pr.id && Array.isArray(pr.positions)).pop();
      if (last) { S.cur = last.id; S.tab = "uebersicht"; S.inv = null; S.modal = null; uiSave(); }
      else if (!S.cur && S.projects[0]) S.cur = S.projects[0].id;
      render(); window.scrollTo(0, 0); toast(n ? `${n} Projekt${n === 1 ? "" : "e"} eingelesen und geöffnet` : "Die Datei enthält kein Projekt");
    } catch(e){ toast("„" + (file.name || "Datei") + "“ ist keine gültige Projektdatei (.json) dieser Anwendung."); }
  };
  rd.readAsText(file);
}

/* ---------- PDF / Scan einlesen, erkennen, markieren ---------- */
const SCAN = {}; let SAMPLE = null, SAMPLE_LIMITS = null, scanCtl = null, DRAG = null;
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
let SAMPLE_CHECKED = false;
async function initSample(){
  if (!window.claude || typeof window.claude.use !== "function") { SAMPLE_CHECKED = true; render(); return; }
  try { SAMPLE = await window.claude.use("sample"); if (SAMPLE) SAMPLE_LIMITS = await SAMPLE.limits().catch(() => null); } catch(e){}
  SAMPLE_CHECKED = true; render();
}
const clamp = (v, a, b, d) => { v = Number(v); return isFinite(v) ? Math.min(b, Math.max(a, v)) : d; };
function ozEq(a, b){
  if (!a || !b) return false;
  const n = s => String(s).trim().replace(/\s+/g, "").replace(/[.\-/]+$/, "");
  const A = n(a), B = n(b); if (A === B) return true;
  const sa = A.split(/[.\-/]/), sb = B.split(/[.\-/]/);
  if (sa.length !== sb.length) return false;
  return sa.every((x, i) => /^\d+$/.test(x) && /^\d+$/.test(sb[i]) ? parseInt(x,10) === parseInt(sb[i],10) : x.toUpperCase() === sb[i].toUpperCase());
}
function matchPos(p, oz, lvOz){ const f = o => o ? p.positions.find(x => ozEq(x.oz, o)) : null; return (f(lvOz) || f(oz) || {}).id || ""; }
function ensureScan(inv){ inv.scan = inv.scan || { name:"", pageCount:0, marks:[] }; inv.scan.marks = inv.scan.marks || []; return inv.scan; }
function ensureStamp(sc){ if (!sc.marks.find(m => m.kind === "stamp")) sc.marks.push({ id:uid(), kind:"stamp", page:Math.max(0,(sc.pageCount||1)-1), x:0.6, y:0.84 }); }

async function renderFilePages(file, onProgress){
  const pages = [];
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (isPdf) {
    if (!window.pdfjsLib) throw new Error("PDF-Bibliothek nicht geladen");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const doc = await window.pdfjsLib.getDocument({ data:new Uint8Array(await file.arrayBuffer()), isEvalSupported:false }).promise;
    const n = Math.min(doc.numPages, 40);
    for (let i = 1; i <= n; i++) {
      const pg = await doc.getPage(i); const v1 = pg.getViewport({ scale:1 });
      const vp = pg.getViewport({ scale: Math.min(2.5, 1500 / v1.width) });
      const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext:ctx, viewport:vp }).promise;
      const lines = await pageLines(pg, v1);
      pages.push({ canvas:c, wPt:v1.width, hPt:v1.height, lines });
      onProgress && onProgress(i, n);
    }
    if (doc.numPages > 40) toast("Nur die ersten 40 Seiten wurden geladen");
  } else if (/^image\/(jpeg|png|webp)$/.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name)) {
    const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("Bild nicht lesbar")); im.src = url; });
    const sc = Math.min(1, 1800 / img.naturalWidth); const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0,0,c.width,c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    pages.push({ canvas:c, wPt:595.28, hPt:595.28 * c.height / c.width });
  } else throw new Error("Bitte eine PDF-, JPG- oder PNG-Datei wählen");
  return pages;
}
async function loadScan(file, invId){
  const p = cp(); const inv = p && p.rechnungen.find(r => r.id === invId); if (!inv || !file) return false;
  S.scanBusy = "Datei wird geladen …"; render();
  let ok = false;
  try {
    const pages = await renderFilePages(file, (i, n) => { S.scanBusy = `Seite ${i} von ${n} geladen …`; render(); });
    SCAN[invId] = { name:file.name, pages };
    const sc = ensureScan(inv);
    if (sc.pageCount && sc.pageCount !== pages.length) toast("Seitenzahl weicht von der gespeicherten Erkennung ab – Markierungen prüfen");
    sc.name = file.name; sc.pageCount = pages.length; ensureStamp(sc);
    sc.marks.forEach(m => { if (m.page >= pages.length) m.page = pages.length - 1; });
    save(p); ok = true;
  } catch(e){ toast("Datei konnte nicht gelesen werden: " + (e && e.message ? e.message : "unbekannter Fehler")); }
  S.scanBusy = null; render(); return ok;
}
function toJpeg(canvas, maxBytes){
  return new Promise(async res => {
    let q = 0.85, c = canvas;
    for (let k = 0; k < 5; k++) {
      const b = await new Promise(r => c.toBlob(r, "image/jpeg", q));
      if (!maxBytes || (b && b.size <= maxBytes) || k === 4) return res(b);
      q = Math.max(0.5, q - 0.1);
      if (k >= 2) { const s = document.createElement("canvas"); s.width = Math.round(c.width * .75); s.height = Math.round(c.height * .75); s.getContext("2d").drawImage(c, 0, 0, s.width, s.height); c = s; }
    }
  });
}
async function recognize(invId, opts = {}){
  const p = cp(); const inv = p && p.rechnungen.find(r => r.id === invId); const st = SCAN[invId];
  if (!SAMPLE || !st || !inv) return;
  logReset(`Rechnung ${inv.nr}: ${st.name}`);
  const lv = p.positions.map(x => `${x.oz} | ${x.text} | ${x.eh} | EP ${x.ep}`).join("\n").slice(0, 20000);
  const out = []; let failed = false;
  scanCtl = new AbortController();
  try {
    await ocrDispatch(st.pages, "Rechnung wird gelesen", desc => `Bilder: ${desc}. Es handelt sich um eine eingescannte Bau-Rechnung (Abschlags-, Teilschluss- oder Schlussrechnung nach VOB/B).
Extrahiere jede Leistungsposition (Zeile mit Ordnungszahl bzw. Pos.-Nr., Menge, Einheitspreis und Gesamtbetrag) sowie die Summenzeilen.
Zahlen im Dokument sind deutsch formatiert (1.234,56). Gib sie als JSON-Zahlen mit Punkt als Dezimaltrenner zurück. Nicht lesbare Werte: null. Erfinde nichts.
"bild" = Nummer des Bildes, in dem die Zeile steht. Koordinaten als Anteil der Größe DIESES Bildes (0 = oben bzw. links, 1 = unten bzw. rechts), drei Nachkommastellen:
y = vertikale Mitte der Zeile (bei mehrzeiligen Positionen die Zeile mit den Beträgen), h = Zeilenhöhe, x_links = Beginn der Pos.-Nr., x_rechts = rechtes Ende des Gesamtbetrags.
Ordne jede Position, wenn eindeutig möglich, einer OZ aus dem folgenden Auftrags-LV zu (Feld lv_oz, sonst null):
${lv || "(kein LV erfasst)"}

JSON-Form:
{"rechnung":{"nr":"3. AR","art":"Abschlagsrechnung","datum":"2026-07-01","zahlbetrag":12345.67},"kumuliert":true,"zeilen":[{"bild":1,"oz":"02.010","lv_oz":"02.010","text":"Mauerwerk KS 17,5 cm","eh":"m²","menge":250,"ep":58.4,"betrag":14600,"y":0.412,"h":0.014,"x_links":0.06,"x_rechts":0.94}],"summen":[{"art":"netto","wert":30099.36,"bild":2,"y":0.610,"h":0.014,"x_links":0.5,"x_rechts":0.94}]}
rechnung.art ist "Abschlagsrechnung", "Teilschlussrechnung" oder "Schlussrechnung"; rechnung ist null, wenn in diesen Bildern kein Rechnungskopf steht. summen.art ist "netto" (Nettosumme), "brutto" (Bruttobetrag inkl. USt) oder "zahlbetrag" (angeforderter Betrag nach Abzug von Vorzahlungen und Einbehalten). kumuliert = true, wenn die Mengen den Gesamtstand seit Baubeginn darstellen, false wenn nur der Abrechnungszeitraum abgerechnet ist.`, { split:true, perCall:2 }, out);
  } catch(e){ failed = true; logAdd("cut", ocrErr(e)); toast(ocrErr(e)); }
  scanCtl = null;
  if (out.length) {
    const merged = { rechnung:null, kumuliert:true, zeilen:[], summen:[] };
    out.forEach(({ d, metas, lineMap }) => {
      const map = z => {
        if (lineMap) {
          let L = lineMap[String(z.zeile || "").trim().toUpperCase()];
          if (!L && z.oz) L = Object.values(lineMap).find(x => x.text.replace(/\s+/g, "").startsWith(String(z.oz).replace(/\s+/g, "")));
          if (L) return Object.assign({}, z, { page:L.page + 1, y:L.y, h:Math.max(L.h * 1.2, .008), x_links:Math.max(0, L.x0 - .005), x_rechts:Math.min(1, L.x1 + .005) });
          return Object.assign({}, z, { page:1, y:.5, h:.014 });
        }
        const bi = Math.round(clamp(z && z.bild, 1, metas.length, 1)) - 1; const m = metas[bi]; const f = m.y1 - m.y0; return Object.assign({}, z, { page:m.page + 1, y:m.y0 + clamp(z.y, 0, 1, .5) * f, h:clamp(z.h, .003, .1, .014) * f }); };
      if (d.rechnung && !merged.rechnung) merged.rechnung = d.rechnung;
      if (d.kumuliert === false) merged.kumuliert = false;
      (Array.isArray(d.zeilen) ? d.zeilen : []).forEach(z => z && typeof z === "object" && merged.zeilen.push(map(z)));
      (Array.isArray(d.summen) ? d.summen : []).forEach(z => z && typeof z === "object" && merged.summen.push(map(z)));
    });
    const dd = (arr, key) => { const res = []; arr.forEach(z => { if (!res.some(o => o.page === z.page && key(o) === key(z) && Math.abs(o.y - z.y) < 0.04)) res.push(z); }); return res; };
    const ozN = o => String(o || "").trim().replace(/\s+/g, "").split(/[.\-/]/).map(x => /^\d+$/.test(x) ? String(parseInt(x, 10)) : x.toUpperCase()).join(".");
    merged.zeilen = dd(merged.zeilen, z => ozN(z.oz) + "|" + String(z.betrag ?? ""));
    merged.summen = dd(merged.summen, z => z.art + "|" + z.wert);
    const n = applyRecognition(p, inv, merged, st.pages.length);
    const unm = inv.scan.marks.filter(m => m.kind === "pos" && !m.posId).length;
    logAdd(n ? "ok" : "cut", `${n} Position${n === 1 ? "" : "en"} erkannt${unm ? `, davon ${unm} ohne LV-Zuordnung` : ""}.`);
    if (!p.positions.length) logAdd("warn", "Im Projekt ist noch kein LV erfasst – Positionen können nicht zugeordnet und geprüft werden. Zuerst Auftragsschreiben/LV einlesen.");
    if (inv.scan.kumuliert === false) logAdd("warn", "Rechnung weist offenbar nur den Abrechnungszeitraum aus – Mengen wurden nicht automatisch als kumulierte Menge AN übernommen.");
    if (opts.auto) {
      let k = 0; inv.aufmass = inv.aufmass || {};
      inv.scan.marks.forEach(m => { if (m.kind === "pos" && m.posId && m.menge != null && inv.scan.kumuliert !== false) { const a = inv.aufmass[m.posId] = inv.aufmass[m.posId] || {}; a.an = m.menge; k++; } });
      const h = inv.scan.header;
      if (h && INV_ART.includes(h.art)) inv.art = h.art;
      if (h && h.nr) inv.nr = h.nr.slice(0, 40);
      if (k) logAdd("ok", `${k} Mengen als „Menge AN“ übernommen.`);
      save(p);
      toast(`${inv.nr}: ${n} Position${n === 1 ? "" : "en"} erkannt${k ? `, ${k} Mengen AN übernommen` : ""}. Zugangsdatum und Zuordnung prüfen.`);
    } else toast(`${n} Position${n === 1 ? "" : "en"} erkannt – bitte kontrollieren`);
  } else if (!failed) logAdd("cut", "Keine auswertbare Antwort erhalten – Scanqualität prüfen (mind. 300 dpi, gerade eingelegt).");
  S.scanBusy = null; render();
}
function applyRecognition(p, inv, d, pageCount){
  const sc = ensureScan(inv);
  const keep = sc.marks.filter(m => m.manual || m.kind === "stamp");
  const geo = z => ({ page: Math.round(clamp(z.page, 1, pageCount, 1)) - 1, y: clamp(z.y, 0, 1, .5), h: clamp(z.h, .006, .05, .014), xL: clamp(z.x_links, 0, 1, .05), xR: clamp(z.x_rechts, 0, 1, .95) });
  const rows = (Array.isArray(d && d.zeilen) ? d.zeilen : []).filter(z => z && typeof z === "object").map(z => Object.assign({ id:uid(), kind:"pos", oz:String(z.oz ?? "").slice(0,30), text:String(z.text ?? "").slice(0,140), eh:String(z.eh ?? "").slice(0,12), menge:numOrNull(z.menge), ep:numOrNull(z.ep), betrag:numOrNull(z.betrag), posId:matchPos(p, z.oz, z.lv_oz) }, geo(z)));
  const sums = (Array.isArray(d && d.summen) ? d.summen : []).filter(z => z && ["netto","brutto","zahlbetrag"].includes(z.art)).map(z => Object.assign({ id:uid(), kind:z.art, wert:numOrNull(z.wert) }, geo(z)));
  sc.marks = [...rows, ...sums, ...keep]; sc.kumuliert = d && d.kumuliert !== false; sc.header = d && d.rechnung ? { nr:String(d.rechnung.nr ?? ""), art:String(d.rechnung.art ?? ""), datum:String(d.rechnung.datum ?? ""), zahlbetrag:numOrNull(d.rechnung.zahlbetrag) } : null;
  if (sc.header) {
    if ((inv.forderung === "" || inv.forderung == null) && sc.header.zahlbetrag) inv.forderung = sc.header.zahlbetrag;
    if (!inv.datum && toISODate(sc.header.datum)) inv.datum = toISODate(sc.header.datum);
  }
  ensureStamp(sc); save(p); return rows.length;
}
function markStatus(p, R, m){
  const E = x => eur(x);
  if (m.kind === "pos") {
    const row = m.posId ? R.rows.find(x => x.pos.id === m.posId) : null;
    if (!row) return { st:"unk", label:"nicht im Auftrags-LV", text:"nicht im Auftrag – nicht anerkannt" };
    if (row.nt && !row.ntOk) return { st:"cut", label:`${row.nt.nr} nicht beauftragt`, text:`${row.nt.nr} nicht beauftragt: ${E(0)}` };
    const claimed = m.betrag != null ? m.betrag : row.bAN;
    const epDiff = m.ep != null && Math.abs(m.ep - num(row.pos.ep)) > 0.005;
    if (Math.abs(claimed - row.bGP) < 0.01 && !epDiff) return { st:"ok", label:"richtig" };
    const t = `geprüft: ${fmtN(row.gpA)} ${row.pos.eh} × ${E(row.pos.ep)} = ${E(row.bGP)}`;
    return { st:"cut", label: row.bGP < claimed ? `gekürzt um ${E(round2(claimed - row.bGP))}` : "geändert", text:t, epDiff };
  }
  const cmp = (claim, an, gp, label) => {
    if (claim == null) return { st:"note", label:"ohne Wert", text:`${label}: ${E(gp)}` };
    if (Math.abs(claim - gp) < 0.01) return { st:"ok", label:"richtig" };
    return { st:"cut", label:`Differenz ${E(round2(gp - claim))}`, text:`${label}: ${E(gp)}` };
  };
  if (m.kind === "netto") {
    const useN2 = m.wert != null && Math.abs(m.wert - R.cAN.n2) < Math.abs(m.wert - R.cAN.net);
    return cmp(m.wert, 0, useN2 ? R.cGP.n2 : R.cGP.net, "geprüft netto");
  }
  if (m.kind === "brutto") return cmp(m.wert, 0, R.cGP.brutto, "geprüft brutto");
  if (m.kind === "zahlbetrag") return cmp(m.wert, 0, R.zahlbetrag, "festgestellter Zahlbetrag");
  return { st:"none" };
}
function drawCheck(ctx, cx, cy, s, col, lw){
  ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath(); ctx.moveTo(cx - s*.5, cy); ctx.lineTo(cx - s*.12, cy + s*.4); ctx.lineTo(cx + s*.55, cy - s*.5); ctx.stroke(); ctx.restore();
}
function labelText(ctx, txt, xRight, y, fs, col){
  ctx.save(); ctx.font = `bold ${fs}px Arial, Helvetica, sans-serif`;
  const w = ctx.measureText(txt).width; let x = xRight - w; if (x < 4) x = 4;
  ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.fillRect(x - 4, y - fs, w + 8, fs * 1.3);
  ctx.fillStyle = col; ctx.textBaseline = "alphabetic"; ctx.fillText(txt, x, y); ctx.restore();
}
function stampBox(W){ return { w: W * 0.36, h: W * 0.13 }; }
function drawAnnot(ctx, W, H, p, inv, R, pageIdx){
  const k = W / 1000, RED = "#C8102E", GREEN = "#138A36", INK = "#1F3A93";
  const marks = (inv.scan && inv.scan.marks || []).filter(m => m.page === pageIdx);
  for (const m of marks) {
    if (m.kind === "stamp") continue;
    const s = markStatus(p, R, m); const y = m.y * H, h = Math.max(m.h * H, 12 * k), xL = m.xL * W, xR = Math.max(m.xR * W, xL + 40 * k);
    const fs = Math.round(Math.max(13 * k, Math.min(h * .95, 20 * k)));
    const cs = Math.max(h * 1.25, 18 * k); const cx = Math.max(xL - cs * .75, cs * .6);
    if (s.st === "ok") drawCheck(ctx, cx, y, cs, GREEN, 3.2 * k);
    else if (s.st === "cut") {
      ctx.save(); ctx.strokeStyle = RED; ctx.lineWidth = 2.6 * k; ctx.beginPath(); ctx.moveTo(xL, y); ctx.lineTo(xR, y); ctx.stroke(); ctx.restore();
      labelText(ctx, s.text, xR, y + h * .5 + fs * 1.05, fs, RED);
    } else if (s.st === "unk") {
      ctx.save(); ctx.strokeStyle = RED; ctx.lineWidth = 2.6 * k; ctx.setLineDash([8*k, 5*k]); ctx.beginPath(); ctx.moveTo(xL, y); ctx.lineTo(xR, y); ctx.stroke(); ctx.restore();
      labelText(ctx, "? " + s.text, xR, y + h * .5 + fs * 1.05, fs, RED);
    } else if (s.st === "note") labelText(ctx, s.text, xR, y + h * .5 + fs * 1.05, fs, RED);
  }
  const stp = marks.find(m => m.kind === "stamp");
  if (stp) {
    const { w, h } = stampBox(W); const x = clamp(stp.x, 0, 1, .6) * W, y = clamp(stp.y, 0, 1, .84) * H;
    const bx = Math.min(x, W - w - 4), by = Math.min(y, H - h - 4);
    ctx.save(); ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.fillRect(bx, by, w, h);
    ctx.strokeStyle = INK; ctx.lineWidth = 2.4 * k; ctx.strokeRect(bx, by, w, h); ctx.lineWidth = 1 * k; ctx.strokeRect(bx + 5*k, by + 5*k, w - 10*k, h - 10*k);
    ctx.fillStyle = INK; const lh = h / 5.2; let ty = by + lh * 1.25;
    ctx.font = `bold ${Math.round(lh*.8)}px Arial, Helvetica, sans-serif`; ctx.fillText("Fachtechnisch und rechnerisch geprüft", bx + 12*k, ty);
    ctx.font = `${Math.round(lh*.72)}px Arial, Helvetica, sans-serif`; ty += lh;
    ctx.fillText(`Festgestellter Zahlbetrag: ${eur(R.zahlbetrag)}`, bx + 12*k, ty); ty += lh;
    const f = num(inv.forderung); ctx.fillText(f > 0 ? `Gefordert: ${eur(f)} · Kürzung: ${eur(round2(f - R.zahlbetrag))}` : `Leistungsstand geprüft netto: ${eur(R.sumGP)}`, bx + 12*k, ty); ty += lh;
    ctx.fillText(`${fmtD(inv.pruefdatum || todayISO())} · Bauleitung ${p.bauleiter || ""}`.trim(), bx + 12*k, ty);
    ctx.restore();
  }
}
function afterRender(){
  const cs = document.querySelectorAll("canvas.scanc"); if (!cs.length) return;
  const p = cp(); if (!p) return; const C = calcAll(p);
  cs.forEach(c => drawPreview(c, p, C));
}
function drawPreview(c, p, C){
  const invId = c.dataset.inv, i = +c.dataset.page, st = SCAN[invId]; if (!st || !st.pages[i]) return;
  const idx = p.rechnungen.findIndex(r => r.id === invId); if (idx < 0) return;
  const src = st.pages[i].canvas; if (c.width !== src.width) { c.width = src.width; c.height = src.height; }
  const ctx = c.getContext("2d"); ctx.drawImage(src, 0, 0);
  drawAnnot(ctx, c.width, c.height, p, p.rechnungen[idx], (C || calcAll(p)).out[idx], i);
}
function canvasPoint(c, e){ const r = c.getBoundingClientRect(); return { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height }; }
document.addEventListener("click", e => {
  const c = e.target.closest && e.target.closest("canvas.scanc"); if (!c || !S.placeMode) return;
  const p = cp(); const inv = p.rechnungen.find(r => r.id === c.dataset.inv); if (!inv) return;
  const { fx, fy } = canvasPoint(c, e); const sc = ensureScan(inv); const pm = S.placeMode;
  const base = { id:uid(), manual:true, page:+c.dataset.page, y:fy, h:.014, xL:Math.max(.03, Math.min(fx, .5)), xR:.95 };
  if (pm.startsWith("k:")) sc.marks.push(Object.assign(base, { kind:pm.slice(2), wert:null }));
  else { const pos = p.positions.find(x => x.id === pm); sc.marks.push(Object.assign(base, { kind:"pos", posId:pm, oz:pos ? pos.oz : "", text:pos ? pos.text : "", eh:pos ? pos.eh : "", menge:null, ep:null, betrag:null })); }
  S.placeMode = null; save(p); render();
});
document.addEventListener("pointerdown", e => {
  const c = e.target.closest && e.target.closest("canvas.scanc.edit"); if (!c) return;
  const p = cp(); const inv = p.rechnungen.find(r => r.id === c.dataset.inv); if (!inv || !inv.scan) return;
  const { fx, fy } = canvasPoint(c, e); const page = +c.dataset.page; const W = c.width, H = c.height;
  const marks = inv.scan.marks.filter(m => m.page === page);
  const stp = marks.find(m => m.kind === "stamp"); let target = null;
  if (stp) { const b = stampBox(W); if (fx >= stp.x && fx <= stp.x + b.w / W && fy >= stp.y && fy <= stp.y + b.h / H) target = stp; }
  if (!target) { let best = 0.02; for (const m of marks) if (m.kind !== "stamp") { const d = Math.abs(m.y - fy); if (d < best) { best = d; target = m; } } }
  if (!target) return;
  e.preventDefault(); c.setPointerCapture && c.setPointerCapture(e.pointerId);
  DRAG = { c, p, inv, m: target, dx: fx - (target.x ?? 0), dy: fy - target.y };
});
document.addEventListener("pointermove", e => {
  if (!DRAG) return; e.preventDefault();
  const { fx, fy } = canvasPoint(DRAG.c, e);
  DRAG.m.y = clamp(fy - DRAG.dy, 0, 1, DRAG.m.y);
  if (DRAG.m.kind === "stamp") DRAG.m.x = clamp(fx - DRAG.dx, 0, 1, DRAG.m.x);
  drawPreview(DRAG.c, DRAG.p);
});
document.addEventListener("pointerup", () => { if (DRAG) { save(DRAG.p); DRAG = null; } });
document.addEventListener("pointercancel", () => { if (DRAG) { save(DRAG.p); DRAG = null; } });
async function exportScanPDF(invId){
  const p = cp(); const idx = p.rechnungen.findIndex(r => r.id === invId); const st = SCAN[invId];
  if (!st) { toast("Bitte zuerst die Rechnungsdatei auswählen"); return; }
  if (!window.jspdf) { toast("PDF-Bibliothek nicht geladen"); return; }
  const R = calcAll(p).out[idx]; const inv = p.rechnungen[idx]; let doc = null;
  st.pages.forEach((pg, i) => {
    const c = document.createElement("canvas"); c.width = pg.canvas.width; c.height = pg.canvas.height;
    const ctx = c.getContext("2d"); ctx.drawImage(pg.canvas, 0, 0); drawAnnot(ctx, c.width, c.height, p, inv, R, i);
    const w = pg.wPt, h = pg.hPt, o = w > h ? "l" : "p";
    if (!doc) doc = new window.jspdf.jsPDF({ unit:"pt", format:[w, h], orientation:o, compress:true }); else doc.addPage([w, h], o);
    doc.addImage(c.toDataURL("image/jpeg", 0.82), "JPEG", 0, 0, w, h);
  });
  doc.setProperties({ title:`Geprüfte Rechnung ${inv.nr} – ${p.name}`, subject:"Rechnungsprüfung nach VOB/B" });
  download(`Geprueft_${(inv.nr || "Rechnung").replace(/[^\w.-]+/g, "_")}.pdf`, doc.output("blob"));
}
function scanSection(p, R, inv){
  const I = inv.id, st = SCAN[I], sc = inv.scan; const marks = sc ? sc.marks.filter(m => m.kind !== "stamp") : [];
  const posOpts = [["", "– keine Zuordnung –"], ...p.positions.map(x => [x.id, `${x.oz} ${x.text}`.slice(0, 60)])];
  const kindL = { netto:"Summe netto", brutto:"Summe brutto", zahlbetrag:"Zahlbetrag" };
  const tagFor = s => s.st === "ok" ? `<span class="tag ok">✓ richtig</span>` : s.st === "cut" ? `<span class="tag cut">${esc(s.label)}</span>` : s.st === "unk" ? `<span class="tag cut">? ${esc(s.label)}</span>` : `<span class="tag">${esc(s.label || "")}</span>`;
  const rows = marks.map(m => { const s = markStatus(p, R, m); const B = f => `mk:${I}:${m.id}:${f}`; return m.kind === "pos"
    ? `<tr><td>${m.page + 1}</td><td class="nw">${esc(m.oz)}</td><td style="min-width:160px">${esc(m.text)}</td><td>${inNum(B("menge"), m.menge, 3)}</td><td>${inNum(B("ep"), m.ep, 2, 2)}${s.epDiff ? `<small class="neg">LV-EP abweichend</small>` : ""}</td><td>${inNum(B("betrag"), m.betrag, 2, 2)}</td><td style="min-width:180px">${sel(B("posId"), posOpts, m.posId)}</td><td>${tagFor(s)}</td><td><button class="x" data-a="scandel" data-id="${I}" data-v="${m.id}" aria-label="Markierung entfernen">×</button></td></tr>`
    : `<tr><td>${m.page + 1}</td><td colspan="2"><b>${kindL[m.kind]}</b></td><td></td><td></td><td>${inNum(B("wert"), m.wert, 2, 2)}</td><td></td><td>${tagFor(s)}</td><td><button class="x" data-a="scandel" data-id="${I}" data-v="${m.id}" aria-label="Markierung entfernen">×</button></td></tr>`; }).join("");
  const nOk = marks.filter(m => markStatus(p, R, m).st === "ok").length, nCut = marks.filter(m => ["cut","unk"].includes(markStatus(p, R, m).st)).length;
  return `<div class="sec"><div class="row sp"><h3 style="margin:0">Rechnung als PDF oder Scan</h3>${st ? `<button class="btn" data-a="scanpick" data-id="${I}">Andere Datei wählen</button>` : ""}</div>
  <p class="muted" style="font-size:.84rem;margin-top:6px">Gescannte Rechnung einlesen, Positionen automatisch erkennen und dem LV zuordnen. Nach der Prüfung erhalten richtige Positionen einen grünen Haken, gekürzte werden rot durchgestrichen und mit dem geprüften Betrag versehen.</p>
  ${!st && !S.scanBusy ? `<div style="margin:10px 0">${dropZone("Rechnung einlesen", "PDF, JPG oder PNG – Positionen werden automatisch erkannt", `scanpick" data-id="${I}`)}</div>` : ""}
  ${st ? `<p style="font-size:.88rem"><b>${esc(st.name)}</b> · ${st.pages.length} Seite${st.pages.length === 1 ? "" : "n"}</p>` : sc && sc.name ? `<div class="hint info">Erkennung zu „${esc(sc.name)}“ ist gespeichert. Datei erneut auswählen, um die Seiten anzuzeigen und die geprüfte PDF zu erzeugen.</div>` : ""}
  ${st && !S.scanBusy ? `<div class="row" style="margin-top:10px">${SAMPLE ? `<button class="btn pri" data-a="scanocr" data-id="${I}">${marks.some(m => !m.manual) ? "Positionen neu erkennen" : "Positionen erkennen"}</button>` : `<span class="muted" style="font-size:.84rem">Automatische Texterkennung ist in dieser Ansicht nicht verfügbar – Markierungen per Tipp setzen.</span>`}</div>` : ""}
  ${sc && sc.kumuliert === false ? `<div class="hint warn" style="margin-top:10px">Die Rechnung weist offenbar nur den Abrechnungszeitraum aus. Die Prüfung arbeitet kumuliert – Mengen vor der Übernahme mit dem Stand der Vorrechnung zusammenführen.</div>` : ""}
  ${marks.length ? `<div class="tw" data-k="scan" style="margin-top:12px"><table><thead><tr><th>Seite</th><th>OZ lt. Rechnung</th><th>Text</th><th class="r" style="min-width:90px">Menge</th><th class="r" style="min-width:95px">EP</th><th class="r" style="min-width:105px">Betrag</th><th>LV-Zuordnung</th><th>Ergebnis</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
  <p style="font-size:.86rem;margin-top:8px"><span class="tag ok">${nOk} richtig</span> <span class="tag cut">${nCut} gekürzt / abweichend</span></p>
  <div class="row" style="margin-top:8px"><button class="btn" data-a="scanan" data-id="${I}">Erkannte Mengen als „Menge AN“ übernehmen</button></div>` : ""}
  ${st ? `<div class="row" style="margin-top:14px;align-items:flex-end">
    <label class="f" style="flex:1;min-width:220px"><span>Markierung per Tipp setzen</span><select class="in" id="placeSel">${[["","Position oder Summe wählen …"],["k:netto","Summe netto"],["k:brutto","Summe brutto"],["k:zahlbetrag","Zahlbetrag"],...p.positions.map(x => [x.id, `${x.oz} ${x.text}`.slice(0,60)])].map(([v,l]) => `<option value="${esc(v)}" ${S.placeMode === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
    <button class="btn ${S.editMarks ? "pri" : ""}" data-a="scanedit" aria-pressed="${!!S.editMarks}">${S.editMarks ? "Verschieben beenden" : "Markierungen verschieben"}</button>
    <button class="btn pri" data-a="scanpdf" data-id="${I}">Geprüfte Rechnung als PDF</button></div>
    ${S.placeMode ? `<div class="hint warn" style="margin-top:8px">Tippe in der Rechnung auf die Zeile, an der die Markierung erscheinen soll.</div>` : S.editMarks ? `<div class="hint info" style="margin-top:8px">Markierungen und Prüfstempel mit dem Finger oder der Maus an die richtige Stelle ziehen.</div>` : ""}
    <div class="scanpages">${st.pages.map((_, i) => `<canvas class="scanc ${S.editMarks ? "edit" : ""} ${S.placeMode ? "place" : ""}" data-inv="${I}" data-page="${i}" aria-label="Seite ${i + 1} der Rechnung mit Prüfmarkierungen"></canvas>`).join("")}</div>` : ""}
  </div>`;
}

/* ---------- Dateiimport: Drag & Drop, GAEB, Excel/CSV, LV-Scan ---------- */
const XLSX_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
function loadScript(src){ return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`) && window.XLSX) return res(); const s = document.createElement("script"); s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error("Bibliothek konnte nicht geladen werden")); document.head.appendChild(s); }); }
const extOf = f => ((f.name || "").split(".").pop() || "").toLowerCase();
const isPdfImg = f => f.type === "application/pdf" || /^image\/(jpeg|png|webp)$/.test(f.type) || ["pdf","jpg","jpeg","png","webp"].includes(extOf(f));
const isGAEB = f => /^(x8\d|p8\d|xml)$/.test(extOf(f));
const isTable = f => ["xlsx","xls","ods","csv","txt"].includes(extOf(f));

function parseGAEB(text){
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("GAEB-Datei ist kein gültiges XML (GAEB 90/2000 wird nicht unterstützt – bitte als GAEB DA XML exportieren)");
  const all = n => [...doc.getElementsByTagName("*")].filter(e => e.localName === n);
  const kid = (el, n) => el ? [...el.children].find(c => c.localName === n) : null;
  const txt = el => el ? el.textContent.replace(/\s+/g, " ").trim() : "";
  const pf = el => { const t = txt(el); if (!t) return null; const v = parseFloat(t.replace(",", ".")); return isFinite(v) ? v : null; };
  const rows = all("Item").map(it => {
    const parts = []; let e = it;
    while (e && e.nodeType === 1) { if ((e.localName === "Item" || e.localName === "BoQCtgy") && e.getAttribute("RNoPart") != null) parts.unshift(e.getAttribute("RNoPart").trim()); e = e.parentElement; }
    const desc = kid(it, "Description");
    const outl = desc ? [...desc.getElementsByTagName("*")].find(x => x.localName === "OutlTxt" || x.localName === "TextOutlTxt") : null;
    const det = desc ? [...desc.getElementsByTagName("*")].find(x => x.localName === "DetailTxt") : null;
    let text = txt(outl) || txt(det); if (text.length > 160) text = text.slice(0, 157) + "…";
    return { oz: parts.join("."), text, eh: txt(kid(it, "QU")), menge: pf(kid(it, "Qty")), ep: pf(kid(it, "UP")) };
  }).filter(r => r.oz);
  const name = txt(all("NamePrj")[0]) || txt(all("LblPrj")[0]);
  const kind = (txt(all("DP")[0]) || "");
  return { rows, name, kind };
}
function parseCSV(text){
  const lines = text.replace(/^\ufeff/, "").split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const first = lines[0]; const cnt = ch => first.split(ch).length - 1;
  const d = cnt("\t") > cnt(";") && cnt("\t") > cnt(",") ? "\t" : cnt(";") >= cnt(",") ? ";" : ",";
  return lines.map(l => { const out = []; let cur = "", q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"' && l[i+1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === d) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out; });
}
async function parseTable(file){
  let A;
  if (["csv","txt"].includes(extOf(file))) A = parseCSV(await file.text());
  else {
    await loadScript(XLSX_URL); if (!window.XLSX) throw new Error("Excel-Bibliothek nicht geladen");
    const wb = window.XLSX.read(new Uint8Array(await file.arrayBuffer()), { type:"array" });
    A = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1, raw:true, defval:"" });
  }
  let hi = -1, col = { oz:0, text:1, eh:2, menge:3, ep:4 };
  for (let r = 0; r < Math.min(A.length, 40); r++) {
    const row = A[r].map(c => String(c).trim().toLowerCase()); const f = re => row.findIndex(c => re.test(c));
    const c = { oz:f(/^(oz|pos\.?|pos\.?-?nr\.?|position|ordnungszahl|nr\.?)$/), text:f(/kurztext|bezeichnung|leistung|beschreibung|^text$/), eh:f(/^(eh|einheit|me|einh\.?|mengeneinheit)$/), menge:f(/^(lv-)?menge|^anzahl$/), ep:f(/^e\.?p\.?(\s|$|\()|einheitspreis|einzelpreis/) };
    if (c.oz >= 0 && (c.menge >= 0 || c.ep >= 0)) { hi = r; col = c; break; }
  }
  const val = (row, i) => i >= 0 ? row[i] : "";
  const toN = v => typeof v === "number" ? v : (String(v ?? "").trim() === "" ? null : num(v));
  return A.slice(hi + 1).map(row => ({ oz:String(val(row, col.oz) ?? "").trim(), text:String(val(row, col.text) ?? "").trim().slice(0,160), eh:String(val(row, col.eh) ?? "").trim(), menge:toN(val(row, col.menge)), ep:toN(val(row, col.ep)) }))
    .filter(r => r.oz && (r.menge != null || r.ep != null));
}
/* ---------- Texterkennung: Auftragsschreiben, Aufmaßblätter, Nachtragsangebote ---------- */
function ocrErr(e){ const m = { not_granted:"Die Texterkennung wurde nicht erlaubt.", rate_limited:"Zu viele Anfragen – bitte kurz warten und erneut versuchen.", invalid_json:"Die Antwort war nicht auswertbar – bitte erneut versuchen.", cancelled:"Erkennung abgebrochen.", no_image:NOIMG_MSG }; if (isImageBlocked(e) && !(e && e.code === "no_image")) return "Bilderkennung ist in dieser Ansicht nicht verfügbar. " + "Abhilfe: " + NOIMG_MSG.split("Abhilfe: ")[1]; return m[e && e.code] || (e && e.message) || "Texterkennung fehlgeschlagen."; }
async function renderFilesPages(files){
  const all = [];
  for (const f of files) { const pg = await renderFilePages(f, (i, n) => { S.scanBusy = `„${f.name}“: Seite ${i} von ${n} geladen …`; render(); }); pg.forEach(x => all.push(x)); }
  return all;
}
/* ---------- Textebene aus PDFs (Fallback ohne Bilderkennung) ---------- */
let IMG_BLOCKED = false;
const imagesAvailable = () => !IMG_BLOCKED && !!(SAMPLE_LIMITS && SAMPLE_LIMITS.images);
const pageHasText = pg => !!(pg && pg.lines && pg.lines.reduce((s, l) => s + l.text.length, 0) > 40);
const NOIMG_MSG = "Reiner Scan ohne Textebene – die Bilderkennung ist in dieser Ansicht nicht verfügbar. Abhilfe: den Scan als durchsuchbare PDF speichern (Texterkennung/OCR am Kopierer bzw. Scanner, Adobe Scan, Microsoft Lens oder Acrobat „Text erkennen“) und erneut einlesen. Alternativ den Scan im Claude-Chat hochladen und dort eine Projektdatei (.json) erstellen lassen – diese über „Mehr → Sicherung einlesen“ oder per Drag & Drop einspielen.";
async function pageLines(pg, v1){
  let tc; try { tc = await pg.getTextContent(); } catch(e){ return []; }
  const items = [];
  for (const it of tc.items || []) {
    if (!it.str || !it.str.trim()) continue;
    const tx = it.transform[4], ty = it.transform[5], fh = Math.abs(it.transform[3]) || Math.abs(it.transform[0]) || 10;
    const [vx, vy] = v1.convertToViewportPoint(tx, ty); const [vx1] = v1.convertToViewportPoint(tx + (it.width || 0), ty);
    items.push({ x:Math.min(vx, vx1) / v1.width, x1:Math.max(vx, vx1) / v1.width, y:(vy - fh * 0.35) / v1.height, h:fh / v1.height, s:it.str });
  }
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of items) { let L = lines.find(l => Math.abs(l.y - it.y) < Math.max(0.004, it.h * 0.45)); if (!L) { L = { y:it.y, h:it.h, parts:[] }; lines.push(L); } L.parts.push(it); }
  return lines.map(L => {
    L.parts.sort((a, b) => a.x - b.x); let txt = "", last = null;
    for (const q of L.parts) { if (last !== null) { const gap = q.x - last; txt += gap > 0.02 ? "   " : gap > 0.003 ? " " : ""; } txt += q.s; last = q.x1; }
    return { y:L.y, h:L.h, x0:L.parts[0].x, x1:Math.max(...L.parts.map(q => q.x1)), text:txt.trim() };
  }).filter(l => l.text).sort((a, b) => a.y - b.y);
}
const TEXTMODE_NOTE = '\nTextmodus: Gib bei Positionen, Zeilen und Summen zusätzlich das Feld "zeile" mit der Kennung der Zeile an, in der die Beträge stehen (z. B. "S1Z12"). Die Felder "bild", "y", "h", "x_links" und "x_rechts" entfallen.';
async function ocrBatchText(idxs, pages, promptFor, depth = 0){
  const lineMap = {};
  const blocks = idxs.map(i => `=== Seite ${i + 1} ===\n` + pages[i].lines.map((l, k) => { const id = `S${i + 1}Z${k + 1}`; lineMap[id] = { page:i, y:l.y, h:l.h, x0:l.x0, x1:l.x1, text:l.text }; return `${id}: ${l.text}`; }).join("\n")).join("\n\n");
  const a = idxs[0] + 1, b = idxs[idxs.length - 1] + 1; const pl = a === b ? `Seite ${a}` : `Seite ${a}–${b}`;
  const desc = `keine – stattdessen folgt unten der aus der PDF extrahierte Text (${pl}). Jede Zeile beginnt mit einer Kennung S<Seite>Z<Zeile>; Tabellenspalten sind durch Leerzeichen getrennt`;
  let r, parsed;
  try {
    r = await SAMPLE(promptFor(desc) + TEXTMODE_NOTE + "\n\nAntworte ausschließlich mit dem JSON-Objekt, ohne Erläuterungen und ohne Markdown.\n\n--- TEXT ---\n" + blocks, { signal:scanCtl.signal, cache:false });
    parsed = tolerantJSON(r.text);
  } catch(e){
    if (e && e.code === "invalid_json" && idxs.length > 1 && depth < 2) { logAdd("warn", `${pl}: Antwort nicht auswertbar – Seiten werden einzeln wiederholt`); const m = Math.ceil(idxs.length / 2); return [...await ocrBatchText(idxs.slice(0, m), pages, promptFor, depth + 1), ...await ocrBatchText(idxs.slice(m), pages, promptFor, depth + 1)]; }
    if (e && e.code === "invalid_json") { logAdd("cut", `${pl}: Antwort nicht auswertbar. Beginn der Antwort: „${String(e.text || "").slice(0, 160)}“`); return []; }
    throw e;
  }
  if ((r.truncated || parsed.salvaged) && idxs.length > 1 && depth < 2) { logAdd("warn", `${pl}: Antwort zu lang – Seiten werden einzeln wiederholt`); const m = Math.ceil(idxs.length / 2); return [...await ocrBatchText(idxs.slice(0, m), pages, promptFor, depth + 1), ...await ocrBatchText(idxs.slice(m), pages, promptFor, depth + 1)]; }
  const d = parsed.value || {}; const n = (Array.isArray(d.zeilen) ? d.zeilen.length : 0) + (Array.isArray(d.positionen) ? d.positionen.length : 0);
  logAdd(r.truncated || parsed.salvaged ? "warn" : "info", `${pl}: ${n} Positionen/Zeilen gelesen (Textebene)${r.truncated || parsed.salvaged ? " – Antwort unvollständig, lesbare Teile übernommen" : ""}`);
  return [{ d, metas:null, lineMap }];
}
async function ocrPagesText(idxs, pages, label, promptFor, out){
  let batch = [], chars = 0;
  const flush = async () => { if (!batch.length) return; const a = batch[0] + 1, b = batch[batch.length - 1] + 1; S.scanBusy = `${label} – Seite ${a}${b !== a ? "–" + b : ""} von ${pages.length} …`; render(); (await ocrBatchText(batch, pages, promptFor)).forEach(x => out.push(x)); batch = []; chars = 0; };
  for (const i of idxs) { const c = pages[i].lines.reduce((s, l) => s + l.text.length + 10, 0); if (batch.length && (chars + c > 30000 || batch.length >= 3)) await flush(); batch.push(i); chars += c; }
  await flush();
}
const isImageBlocked = e => /image/i.test(String((e && (e.message || e.code)) || "")) && !/json/i.test(String(e && e.code || ""));
async function ocrDispatch(pages, label, promptFor, opts, out){
  const all = pages.map((_, i) => i), withText = all.filter(i => pageHasText(pages[i]));
  let mode = withText.length === pages.length ? "text" : imagesAvailable() ? "image" : withText.length ? "text" : "none";
  if (mode === "image") {
    logAdd("info", "Verfahren: Bilderkennung der Seiten");
    try { await ocrPages(pages, label, promptFor, opts, out); return; }
    catch(e){
      if (!isImageBlocked(e)) throw e;
      IMG_BLOCKED = true; out.length = 0; render();
      logAdd("warn", "Bilderkennung ist in dieser Ansicht nicht verfügbar – es wird die Textebene der PDF verwendet.");
      mode = withText.length ? "text" : "none";
    }
  }
  if (mode === "none") { const err = new Error(NOIMG_MSG); err.code = "no_image"; throw err; }
  logAdd("info", "Verfahren: Textebene der PDF (exakte Zeilenpositionen)");
  const missing = all.filter(i => !pageHasText(pages[i]));
  if (missing.length) logAdd("cut", `Seite ${missing.map(i => i + 1).join(", ")}: keine Textebene (reiner Scan) – ${imagesAvailable() ? "nicht ausgewertet" : "in dieser Ansicht nicht lesbar. " + "Abhilfe: " + NOIMG_MSG.split("Abhilfe: ")[1]}`);
  await ocrPagesText(withText, pages, label, promptFor, out);
}

/* ---------- Erkennungskern: Seitenhälften, robuste JSON-Auswertung, Protokoll ---------- */
function logReset(title){ S.log = [{ lvl:"info", msg:title, t:new Date().toLocaleTimeString("de-DE") }]; S.logOpen = null; }
function logAdd(lvl, msg){ (S.log = S.log || []).push({ lvl, msg, t:new Date().toLocaleTimeString("de-DE") }); }
function logPanel(){
  const bad = S.log.filter(l => l.lvl === "cut" || l.lvl === "warn").length;
  const open = S.logOpen == null ? bad > 0 : S.logOpen;
  return `<div class="logw"><details class="logp" ${open ? "open" : ""}><summary>Protokoll der letzten Erkennung${bad ? ` – ${bad} Hinweis${bad > 1 ? "e" : ""}` : " – ohne Auffälligkeiten"}</summary>
  <div class="hints" style="margin-top:8px">${S.log.map(l => `<div class="hint ${l.lvl === "ok" ? "info" : l.lvl}">${esc(l.t)} · ${esc(l.msg)}</div>`).join("")}</div>
  <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn sm ghost" data-a="logclose">Protokoll schließen</button></div></details></div>`;
}
document.addEventListener("toggle", e => { if (e.target && e.target.classList && e.target.classList.contains("logp")) S.logOpen = e.target.open; }, true);
function splitPage(pg, pageIdx, split){
  const c = pg.canvas;
  if (!split || !c.height || c.height < c.width * 1.25) return [{ canvas:c, page:pageIdx, y0:0, y1:1, part:"" }];
  const mk = (a, b, part) => { const s = document.createElement("canvas"); s.width = c.width; s.height = Math.round(c.height * (b - a)); s.getContext("2d").drawImage(c, 0, Math.round(c.height * a), c.width, s.height, 0, 0, s.width, s.height); return { canvas:s, page:pageIdx, y0:a, y1:b, part }; };
  return [mk(0, 0.55, "obere Hälfte"), mk(0.45, 1, "untere Hälfte")];
}
function extractBalanced(t, start){
  let depth = 0, inStr = false, escp = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) { if (escp) escp = false; else if (ch === "\\") escp = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === "{" || ch === "[") depth++; else if (ch === "}" || ch === "]") { depth--; if (depth === 0) return t.slice(start, i + 1); }
  }
  return null;
}
function tolerantJSON(text){
  let t = String(text || "").trim(); const fence = t.match(/```(?:json)?\s*([\s\S]*?)(```|$)/); if (fence) t = fence[1].trim();
  const i = t.search(/[\[{]/);
  if (i >= 0) { const whole = extractBalanced(t, i); if (whole) { try { return { value:JSON.parse(whole), salvaged:false }; } catch(e){} } }
  const out = {}; let found = false;
  for (const key of ["zeilen","positionen","summen"]) {
    const m = new RegExp('"' + key + '"\\s*:\\s*\\[').exec(t); if (!m) continue;
    let j = m.index + m[0].length; const arr = [];
    while (j < t.length) { const k = t.indexOf("{", j); if (k < 0 || t.slice(j, k).includes("]")) break; const obj = extractBalanced(t, k); if (!obj) break; try { arr.push(JSON.parse(obj)); } catch(e){} j = k + obj.length; }
    if (arr.length) { out[key] = arr; found = true; }
  }
  for (const key of ["rechnung","vertrag","nachtrag"]) { const m = new RegExp('"' + key + '"\\s*:\\s*\\{').exec(t); if (!m) continue; const obj = extractBalanced(t, m.index + m[0].length - 1); if (obj) { try { out[key] = JSON.parse(obj); found = true; } catch(e){} } }
  const g = /"gemeinsam"\s*:\s*(true|false)/.exec(t); if (g) out.gemeinsam = g[1] === "true";
  const k2 = /"kumuliert"\s*:\s*(true|false)/.exec(t); if (k2) out.kumuliert = k2[1] === "true";
  if (!found) { const err = new Error("Antwort nicht auswertbar"); err.code = "invalid_json"; err.text = t; throw err; }
  return { value:out, salvaged:true };
}
const OVERLAP_NOTE = "Bei Seitenhälften überlappen sich die Bildränder: eine Zeile, die in zwei Bildern vorkommt, nur einmal angeben – in dem Bild, in dem sie vollständig lesbar ist.";
async function ocrBatch(batch, promptFor, depth = 0){
  const blobs = await Promise.all(batch.map(m => toJpeg(m.canvas, SAMPLE_LIMITS?.images?.maxInputBytes)));
  const desc = batch.map((m, i) => `Bild ${i + 1} = Seite ${m.page + 1}${m.part ? " (" + m.part + ")" : ""}`).join("; ");
  const a = batch[0].page + 1, b = batch[batch.length - 1].page + 1; const pl = a === b ? `Seite ${a}${batch.length === 1 && batch[0].part ? " (" + batch[0].part + ")" : ""}` : `Seite ${a}–${b}`;
  let r, parsed;
  try {
    const prompt = promptFor(desc) + (batch.some(m => m.part) ? "\n" + OVERLAP_NOTE : "") + "\n\nAntworte ausschließlich mit dem JSON-Objekt, ohne Erläuterungen und ohne Markdown.";
    r = await SAMPLE(prompt, { images:blobs, signal:scanCtl.signal, cache:false });
    parsed = tolerantJSON(r.text);
  } catch(e){
    if (e && e.code === "invalid_json" && batch.length > 1 && depth < 2) { logAdd("warn", `${pl}: Antwort nicht auswertbar – Bilder werden einzeln wiederholt`); return retrySplit(batch, promptFor, depth); }
    if (e && e.code === "invalid_json") { logAdd("cut", `${pl}: Antwort nicht auswertbar. Beginn der Antwort: „${String(e.text || "").slice(0, 160)}“`); return []; }
    throw e;
  }
  if ((r.truncated || parsed.salvaged) && batch.length > 1 && depth < 2) { logAdd("warn", `${pl}: Antwort zu lang – Bilder werden einzeln wiederholt`); return retrySplit(batch, promptFor, depth); }
  const d = parsed.value || {}; const n = (Array.isArray(d.zeilen) ? d.zeilen.length : 0) + (Array.isArray(d.positionen) ? d.positionen.length : 0);
  logAdd(r.truncated || parsed.salvaged ? "warn" : "info", `${pl}: ${n} Positionen/Zeilen gelesen${r.truncated || parsed.salvaged ? " – Antwort unvollständig, lesbare Teile übernommen. Ende dieser Seite am Original prüfen." : ""}`);
  return [{ d, metas:batch }];
}
async function retrySplit(batch, promptFor, depth){ const mid = Math.ceil(batch.length / 2); const A = await ocrBatch(batch.slice(0, mid), promptFor, depth + 1); const B = await ocrBatch(batch.slice(mid), promptFor, depth + 1); return [...A, ...B]; }
async function ocrPages(pages, label, promptFor, opts, out){
  const split = opts && opts.split !== false, perCall = (opts && opts.perCall) || 2;
  const max = Math.max(1, Math.min(SAMPLE_LIMITS?.images?.maxCount || 4, 4));
  for (let off = 0; off < pages.length; off += perCall) {
    const metas = []; pages.slice(off, off + perCall).forEach((pg, k) => metas.push(...splitPage(pg, off + k, split)));
    for (let s = 0; s < metas.length; s += max) {
      const b = metas.slice(s, s + max); const a1 = b[0].page + 1, b1 = b[b.length - 1].page + 1;
      S.scanBusy = `${label} – Seite ${a1}${b1 !== a1 ? "–" + b1 : ""} von ${pages.length} …`; render();
      (await ocrBatch(b, promptFor)).forEach(x => out.push(x));
    }
  }
  return out;
}
async function withOCR(files, label, promptFor, onDone, opts = {}){
  if (!SAMPLE) { toast("Automatische Texterkennung ist in dieser Ansicht nicht verfügbar – App über den claude.ai-Link öffnen."); return; }
  logReset(`${label}: ${files.map(f => f.name).join(", ")}`);
  scanCtl = new AbortController(); S.scanBusy = "Datei wird geladen …"; render();
  const res = []; let failed = false;
  try { const pages = await renderFilesPages(files); logAdd("info", `${pages.length} Seite${pages.length === 1 ? "" : "n"} geladen`); await ocrDispatch(pages, label, promptFor, opts, res); }
  catch(e){ failed = true; logAdd("cut", ocrErr(e)); toast(ocrErr(e)); }
  scanCtl = null; S.scanBusy = null;
  if (res.length) { try { onDone(res, failed); } catch(e){ logAdd("cut", "Verarbeitung fehlgeschlagen: " + (e && e.message)); } }
  else if (!failed) logAdd("cut", "Keine auswertbare Antwort erhalten – Scanqualität prüfen (mind. 300 dpi, gerade eingelegt).");
  render();
}
const lvContext = p => p ? p.positions.map(x => `${x.oz} | ${x.text} | ${x.eh}`).join("\n").slice(0, 15000) : "";
const posRowsFrom = arr => (Array.isArray(arr) ? arr : []).filter(z => z && typeof z === "object").map(z => ({ oz:String(z.oz ?? "").trim(), text:String(z.kurztext ?? z.text ?? "").trim().slice(0,160), eh:String(z.eh ?? "").trim(), menge:numOrNull(z.menge), ep:numOrNull(z.ep) }));

/* Auftragsschreiben mit LV */
const AUFTRAG_FIELDS = [
  ["projekt","name","Projektbezeichnung","text"],["baustelle","ort","Baustelle","text"],["vergabe_nr","vergabeNr","Vergabe-/Vertragsnummer","text"],
  ["auftraggeber","ag","Auftraggeber","text"],["auftragnehmer","an","Auftragnehmer","text"],["auftragsdatum","vertragsdatum","Vertragsdatum","date"],
  ["auftragssumme_netto","auftragssummeLaut","Auftragssumme netto lt. Auftrag","eur"],["nachlass_prozent","nachlass","Nachlass","pct"],
  ["umlage_prozent","umlage","Umlage","pct"],["umlage_bezeichnung","umlageText","Bezeichnung Umlage","text"],
  ["skonto_vereinbart","skontoVereinbart","Skonto vereinbart","bool"],["skonto_prozent","skontoSatz","Skontosatz","pct"],["skonto_tage","skontoTage","Skontofrist","days"],
  ["sicherheitseinbehalt_prozent","seSatz","Einbehalt je Abschlagsrechnung","pct"],["sicherheitssumme_prozent","seDeckel","Vereinbarte Sicherheitssumme","pct"],
  ["maengelsicherheit_prozent","gwSatz","Sicherheit für Mängelansprüche","pct"],
  ["zahlungsfrist_abschlag_tage","fristAbschlag","Frist Abschlagszahlung","days"],["zahlungsfrist_schluss_tage","fristSchluss","Frist Schlusszahlung","days"],
  ["reverse_charge_13b","rc13b","Steuerschuldnerschaft § 13b UStG","bool"],["vob_b_vereinbart","vobB","VOB/B vereinbart","bool"],
  ["vertragsstrafe","vertragsstrafe","Vertragsstrafe","text"],["ausfuehrungsfristen","ausfuehrung","Ausführungsfristen","text"],["weitere_hinweise","vertragshinweise","Weitere Vertragsbedingungen","text"]
];
function fmtField(type, v){
  if (v === null || v === undefined || v === "") return "–";
  if (type === "eur") return eur(v); if (type === "pct") return fmtN(v, 3) + " %"; if (type === "days") return fmtN(v, 0) + " Tage";
  if (type === "bool") return v ? "ja" : "nein"; if (type === "date") return fmtD(v);
  return esc(String(v).length > 220 ? String(v).slice(0, 217) + "…" : v);
}
async function recognizeAuftrag(files){
  const p = cp();
  await withOCR(files, "Auftragsunterlagen werden gelesen", desc => `Bilder: ${desc}. Es handelt sich um Auftragsunterlagen zu einem Bauvertrag – typischerweise ein Auftragsschreiben (Zuschlag, Bestellung, Vertrag) mit angehängtem, bepreistem Leistungsverzeichnis.
1. Vertragsangaben: nur übernehmen, was auf diesen Seiten ausdrücklich steht, sonst null. Prozentsätze als Zahl (5 für 5 %), Fristen in Kalendertagen, Datum als JJJJ-MM-TT.
2. Alle LV-Positionen mit Menge (keine Titel-, Gruppen- oder Summenzeilen, keine Vorbemerkungen). kurztext max. 120 Zeichen.
Zahlen im Dokument sind deutsch formatiert (1.234,56); gib sie als JSON-Zahlen mit Punkt zurück. Erfinde nichts.
Antworte nur mit JSON in dieser Form:
{"vertrag":{"projekt":null,"baustelle":null,"vergabe_nr":null,"auftraggeber":null,"auftragnehmer":null,"auftragsdatum":null,"auftragssumme_netto":null,"auftragssumme_brutto":null,"vob_b_vereinbart":null,"nachlass_prozent":null,"umlage_prozent":null,"umlage_bezeichnung":null,"skonto_vereinbart":null,"skonto_prozent":null,"skonto_tage":null,"sicherheitseinbehalt_prozent":null,"sicherheitssumme_prozent":null,"maengelsicherheit_prozent":null,"zahlungsfrist_abschlag_tage":null,"zahlungsfrist_schluss_tage":null,"reverse_charge_13b":null,"vertragsstrafe":null,"ausfuehrungsfristen":null,"weitere_hinweise":null},"positionen":[{"oz":"01.02.0010","kurztext":"Mauerwerk KS 17,5 cm","eh":"m²","menge":420,"ep":58.4}]}
vertragsstrafe, ausfuehrungsfristen und weitere_hinweise (z. B. Abnahme, Gewährleistungsdauer, Bürgschaften, Abrechnungsvorgaben) als knappe Zusammenfassung mit Fundstelle (Seite).`,
  (res, partial) => {
    const v = {}; const rows = [];
    res.forEach(({ d }) => { const vv = d && d.vertrag; if (vv && typeof vv === "object") for (const [k, x] of Object.entries(vv)) if (x !== null && x !== "" && v[k] === undefined) v[k] = x; posRowsFrom(d && d.positionen).forEach(r => rows.push(r)); });
    openAuftragPreview(v, rows, `Auftragsunterlagen „${files.map(f => f.name).join(", ")}“${partial ? " (unvollständig)" : ""}`);
  });
}
function openAuftragPreview(v, rows, source){
  const p = cp();
  const pname = v.projekt ? String(v.projekt).trim().slice(0, 120) : "";
  let target = "cur";
  if (!p || S.forceNewProject) target = "new";
  else if (p.positions.length || p.rechnungen.length) {
    const a = p.name.toLowerCase(), b = pname.toLowerCase();
    if (b && !a.includes(b.slice(0, 14)) && !b.includes(a.slice(0, 14))) target = "new";
  }
  S.forceNewProject = false;
  const fields = AUFTRAG_FIELDS.map(([k, prop, label, type]) => {
    let val = v[k];
    if (type === "bool") val = typeof val === "boolean" ? val : (val === "ja" ? true : val === "nein" ? false : null);
    else if (["pct","eur","days"].includes(type)) val = numOrNull(val);
    else if (type === "date") val = toISODate(val);
    else val = val == null ? null : String(val).trim().slice(0, 800) || null;
    if (val === null) return null;
    const cur = p ? p[prop] : null; const same = String(cur ?? "") === String(val);
    return { k, prop, label, type, val, cur, same };
  }).filter(Boolean);
  const seen = new Set();
  rows = rows.filter(r => r.oz || r.text).filter(r => { const key = r.oz + "|" + r.text; if (seen.has(key)) return false; seen.add(key); return true; }).map(r => ({ ...r, exists: !!(p && p.positions.find(x => ozEq(x.oz, r.oz))) }));
  logAdd(fields.length || rows.length ? "ok" : "cut", `Erkannt: ${fields.length} Vertragsangaben, ${rows.length} Positionen.`);
  if (!fields.length && !rows.length) { toast("In den Unterlagen wurden weder Vertragsangaben noch Positionen erkannt – siehe Protokoll"); render(); return; }
  S.inv = null; S.modal = { kind:"auftrag", fields, rows, source, target, pname, canCur: !!p, brutto: numOrNull(v.auftragssumme_brutto) }; render();
}
function lvRowsTable(rows){
  return `<div class="row" style="margin:6px 0"><button class="btn sm ghost" data-a="lvall" data-v="1">Alle wählen</button><button class="btn sm ghost" data-a="lvall" data-v="0">Keine</button></div>
  <div class="tw"><table><thead><tr><th></th><th>OZ</th><th>Kurztext</th><th>EH</th><th class="r">Menge</th><th class="r">EP</th><th class="r">GP</th><th></th></tr></thead><tbody>
  ${rows.map((r, i) => `<tr><td><input type="checkbox" data-lvrow="${i}" ${r.exists ? "" : "checked"} aria-label="Position ${esc(r.oz)} übernehmen"></td><td class="nw">${esc(r.oz)}</td><td>${esc(r.text)}</td><td>${esc(r.eh)}</td><td class="r nw">${r.menge == null ? "–" : fmtN(r.menge)}</td><td class="r nw">${r.ep == null ? "–" : eur(r.ep)}</td><td class="r nw">${r.menge != null && r.ep != null ? eur(round2(r.menge * r.ep)) : "–"}</td><td>${r.exists ? `<span class="tag">vorhanden</span>` : `<span class="tag ok">neu</span>`}</td></tr>`).join("")}
  </tbody></table></div>
  ${rows.some(r => r.exists) ? `<div style="margin-top:10px"><label class="c"><input type="checkbox" id="lvUpd"><span>Gewählte vorhandene Positionen mit diesen Werten überschreiben</span></label></div>` : ""}`;
}
function applyLVRows(p, rows, ntId = ""){
  const upd = $("#lvUpd") && $("#lvUpd").checked; let nNew = 0, nUpd = 0;
  document.querySelectorAll("[data-lvrow]").forEach(c => { if (!c.checked) return; const r = rows[+c.dataset.lvrow]; if (!r) return; const ex = p.positions.find(x => ozEq(x.oz, r.oz));
    if (ex && !ntId) { if (upd) { ex.text = r.text || ex.text; ex.eh = r.eh || ex.eh; if (r.menge != null) ex.menge = r.menge; if (r.ep != null) ex.ep = r.ep; nUpd++; } }
    else { p.positions.push({ id:uid(), oz:r.oz, text:r.text, eh:r.eh, menge:r.menge ?? 0, ep:r.ep ?? 0, nt:ntId }); nNew++; } });
  return { nNew, nUpd };
}
function auftragModal(m){
  const p = cp();
  const lvSum = round2(m.rows.reduce((s, r) => s + (r.menge != null && r.ep != null ? round2(r.menge * r.ep) : 0), 0));
  const f = k => (m.fields.find(x => x.k === k) || {}).val;
  const summe = f("auftragssumme_netto"), nl = f("nachlass_prozent") ?? (p ? num(p.nachlass) : 0);
  const isNew = m.target === "new";
  const H = [];
  if (summe != null && lvSum > 0) {
    const nach = round2(lvSum * (1 - nl / 100));
    const d = Math.min(Math.abs(summe - lvSum), Math.abs(summe - nach));
    H.push([d < 1 ? "info" : "warn", d < 1 ? `LV-Summe (${eur(lvSum)}${nl ? `, nach ${fmtN(nl,2)} % Nachlass ${eur(nach)}` : ""}) stimmt mit der Auftragssumme überein.` : `LV-Summe ${eur(lvSum)}${nl ? ` (nach Nachlass ${eur(nach)})` : ""} weicht von der Auftragssumme ${eur(summe)} um ${eur(d)} ab – fehlende oder falsch gelesene Positionen prüfen.`]);
  }
  if (f("vob_b_vereinbart") === false) H.push(["cut", "Laut Unterlagen ist die VOB/B nicht vereinbart. Dann gilt BGB-Bauvertragsrecht (§§ 631 ff., 650a ff. BGB) – Einbehalte, Skonto und Fristen nur, soweit vertraglich geregelt."]);
  if (f("sicherheitseinbehalt_prozent") > 10) H.push(["cut", "Einbehalt über 10 % je Zahlung widerspricht § 17 Abs. 6 Nr. 1 VOB/B."]);
  const sk = f("skonto_prozent"); if (sk != null && (sk < 2 || sk > 5)) H.push(["warn", `Skontosatz ${fmtN(sk,2)} % außerhalb der üblichen Spanne von 2–5 % (keine Normvorgabe).`]);
  if (f("zahlungsfrist_schluss_tage") > 60) H.push(["cut", "Schlusszahlungsfrist über 60 Tage – nach § 16 Abs. 3 Nr. 1 VOB/B nicht vorgesehen."]);
  if (f("vertragsstrafe")) H.push(["info", "Vertragsstrafe vereinbart: Vorbehalt bei der Abnahme erforderlich (§ 11 Abs. 4 VOB/B). In AGB ist eine Obergrenze von 5 % der Auftragssumme zu beachten (BGH, Urt. v. 23.01.2003 – VII ZR 210/01)."]);
  if (f("sicherheitseinbehalt_prozent") != null) H.push(["info", "Sicherheitseinbehalt nur, wenn Sicherheitsleistung vereinbart ist (§ 17 Abs. 1 VOB/B) – Fundstelle im Auftragsschreiben prüfen."]);
  return `<div class="modal" role="dialog" aria-modal="true"><div class="box"><h3>Auftragsunterlagen übernehmen</h3>
  <p class="muted" style="font-size:.86rem">${esc(m.source)} · ${m.fields.length} Vertragsangaben, ${m.rows.length} Positionen erkannt. Alle Angaben mit dem Original abgleichen.</p>
  <div class="fields" style="margin:10px 0"><label class="f"><span>Übernehmen in</span><select class="in" id="afTarget"><option value="new" ${isNew ? "selected" : ""}>Neues Projekt „${esc(m.pname || "Neues Projekt")}“</option>${m.canCur && p ? `<option value="cur" ${isNew ? "" : "selected"}>Aktuelles Projekt „${esc(p.name)}“</option>` : ""}</select></label></div>
  ${m.fields.length ? `<h3 style="margin-top:12px">Vertragsangaben</h3><div class="tw"><table><thead><tr><th></th><th>Angabe</th><th>Erkannt</th><th>Bisher</th></tr></thead><tbody>
  ${m.fields.map((x, i) => `<tr><td><input type="checkbox" data-af="${i}" ${isNew || (!x.same && x.prop !== "name") ? "checked" : ""} aria-label="${esc(x.label)} übernehmen"></td><td class="nw">${esc(x.label)}</td><td>${fmtField(x.type, x.val)}</td><td class="muted">${isNew ? "–" : fmtField(x.type, x.cur)}</td></tr>`).join("")}
  </tbody></table></div>` : ""}
  ${H.length ? `<div class="hints" style="margin-top:12px">${H.map(([l, t]) => `<div class="hint ${l}">${t}</div>`).join("")}</div>` : ""}
  ${m.rows.length ? `<h3 style="margin-top:14px">Leistungsverzeichnis</h3>${lvRowsTable(isNew ? m.rows.map(r => ({ ...r, exists:false })) : m.rows)}` : ""}
  <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost" data-a="closemodal">Abbrechen</button><button class="btn pri" data-a="auftragapply">Auswahl übernehmen</button></div></div></div>`;
}

/* Aufmaßblätter */
function aufmassTerm(l){
  const e = numOrNull(l.ergebnis); const a = String(l.ansatz || "").trim(); const v = a ? evalExpr(a) : null;
  if (v !== null && !isNaN(v)) {
    const neg = e != null && e < 0 && v > 0;
    const val = neg ? -v : v; const t = (neg ? "-" : "") + `(${a})`;
    if (e != null && Math.abs(Math.abs(v) - Math.abs(e)) > Math.max(0.01, Math.abs(e) * 0.0005)) return { t, val, err:`Rechenansatz „${a}“ ergibt ${fmtN(Math.abs(v))}, notiert ist ${fmtN(Math.abs(e))} – rechnerisch korrigiert (Lesung am Original prüfen)` };
    return { t, val };
  }
  if (e != null) return { t: e < 0 ? "-" + fmtIn(-e, 3) : fmtIn(e, 3), val:e, err: a ? `Rechenansatz „${a}“ nicht auswertbar – notiertes Ergebnis verwendet` : null };
  return null;
}
async function recognizeAufmass(files, invId){
  const p = cp(); const inv = p.rechnungen.find(r => r.id === invId); if (!inv) return;
  const lv = lvContext(p);
  await withOCR(files, "Aufmaßblätter werden gelesen", desc => `Bilder: ${desc}. Es handelt sich um Aufmaßblätter (Mengenermittlung) einer Bauleistung nach VOB/C.
Extrahiere jede Aufmaßzeile: Blatt-Nr., Pos./OZ, Ort bzw. Bezeichnung (Geschoss, Achse, Raum), den Rechenansatz genau wie notiert (z. B. "12,50 x 2,75 - 1,01 x 2,13"), das notierte Ergebnis als Zahl (Abzüge negativ) und die Einheit. Zeilen ohne eigene OZ gehören zur zuletzt genannten Position. Zwischen- und Übertragssummen weglassen.
Ordne die OZ, wenn eindeutig, einer OZ des Auftrags-LV zu (lv_oz, sonst null):
${lv || "(kein LV erfasst)"}
Zahlen sind deutsch formatiert; ergebnis als JSON-Zahl mit Punkt. Erfinde nichts.
Antworte nur mit JSON: {"gemeinsam":null,"zeilen":[{"blatt":"3","oz":"02.010","lv_oz":"02.010","ort":"EG Achse A–C","ansatz":"12,50*2,75","ergebnis":34.375,"eh":"m²"}]}
gemeinsam = true, wenn das Aufmaß von Auftraggeber- und Auftragnehmerseite unterschrieben bzw. als gemeinsames Aufmaß gekennzeichnet ist, false wenn erkennbar einseitig, sonst null.`,
  (res, partial) => {
    const lines = []; let gem = null, lastOz = "";
    res.forEach(({ d }) => { if (d && d.gemeinsam === true) gem = true; else if (d && d.gemeinsam === false && gem === null) gem = false;
      (Array.isArray(d && d.zeilen) ? d.zeilen : []).forEach(z => { if (!z) return; const oz = String(z.oz ?? "").trim() || lastOz; lastOz = oz; lines.push({ blatt:String(z.blatt ?? "").trim(), oz, lvOz:z.lv_oz, ort:String(z.ort ?? "").trim().slice(0,80), ansatz:String(z.ansatz ?? "").trim().slice(0,200), ergebnis:z.ergebnis, eh:String(z.eh ?? "").trim() }); }); });
    const groups = new Map(); const unmatched = [];
    lines.forEach(l => { const posId = matchPos(p, l.oz, l.lvOz); if (!posId) { unmatched.push(l); return; } if (!groups.has(posId)) groups.set(posId, []); groups.get(posId).push(l); });
    const G = [...groups.entries()].map(([posId, ls]) => {
      const pos = p.positions.find(x => x.id === posId); const terms = ls.map(aufmassTerm).filter(Boolean);
      const formula = terms.reduce((s, t, i) => i === 0 ? t.t : s + (t.t.startsWith("-") ? t.t : "+" + t.t), "");
      const sum = Math.round(terms.reduce((s, t) => s + t.val, 0) * 1000) / 1000;
      const errs = terms.map(t => t.err).filter(Boolean);
      const ehs = [...new Set(ls.map(l => l.eh).filter(Boolean))];
      if (ehs.length && pos.eh && !ehs.some(e => e.replace("2","²").replace("3","³").toLowerCase() === pos.eh.replace("2","²").replace("3","³").toLowerCase())) errs.push(`Einheit im Aufmaß (${ehs.join(", ")}) weicht vom LV (${pos.eh}) ab`);
      const blatt = [...new Set(ls.map(l => l.blatt).filter(Boolean))].join(", ");
      return { posId, oz:pos.oz, text:pos.text, eh:pos.eh, n:ls.length, formula, sum, errs, blatt, lines:ls };
    });
    if (!G.length && !unmatched.length) { logAdd("cut", "Keine Aufmaßzeilen erkannt."); toast("Keine Aufmaßzeilen erkannt – siehe Protokoll"); return; }
    logAdd(G.length ? "ok" : "cut", `${lines.length} Aufmaßzeilen erkannt, ${G.length} Positionen zugeordnet${unmatched.length ? `, ${unmatched.length} Zeilen ohne Zuordnung` : ""}.`);
    S.modal = { kind:"aufmass", invId, groups:G, unmatched, gem, partial, source: files.map(f => f.name).join(", ") }; render();
  }, { split:false, perCall:2 });
}
function aufmassModal(m){
  const p = cp(); const inv = p.rechnungen.find(r => r.id === m.invId); if (!inv) return "";
  const am = inv.aufmass || {};
  return `<div class="modal" role="dialog" aria-modal="true"><div class="box"><h3>Aufmaß übernehmen – ${esc(inv.nr)}</h3>
  <p class="muted" style="font-size:.86rem">${esc(m.source)}${m.partial ? " (unvollständig)" : ""} · ${m.groups.reduce((s, g) => s + g.n, 0)} Aufmaßzeilen zu ${m.groups.length} Positionen. Rechenansätze werden als Aufmaßformel übernommen und nachgerechnet.</p>
  <div class="fields" style="margin:10px 0">
    <label class="f"><span>Übernehmen als</span><select class="in" id="amTarget"><option value="gp" ${m.gem ? "selected" : ""}>geprüfte Menge (Aufmaßformel)</option><option value="an" ${m.gem ? "" : "selected"}>Menge AN</option></select></label>
    <label class="f"><span>Bisherigen Stand</span><select class="in" id="amMode"><option value="add">ergänzen (neue Blätter addieren)</option><option value="replace">ersetzen (Aufmaß enthält Gesamtstand)</option></select></label>
  </div>
  ${m.gem === true ? `<label class="c"><input type="checkbox" id="amGem" checked><span>Als gemeinsames Aufmaß vermerken (§ 14 Abs. 2 VOB/B) – Unterschriften erkannt</span></label>` : m.gem === false ? `<div class="hint warn">Aufmaß erscheint einseitig (nur AN). Übernahme als „Menge AN“ empfohlen; geprüfte Mengen erst nach eigener Prüfung.</div>` : ""}
  <div class="tw" style="margin-top:10px"><table><thead><tr><th></th><th>OZ</th><th>Kurztext</th><th class="r">Zeilen</th><th class="r">Menge Aufmaß</th><th class="r">bisher AN</th><th class="r">bisher geprüft</th><th>Blatt</th><th>Hinweise</th></tr></thead><tbody>
  ${m.groups.map((g, i) => { const a = am[g.posId] || {}; return `<tr class="${g.errs.length ? "flag" : ""}"><td><input type="checkbox" data-amg="${i}" checked aria-label="${esc(g.oz)} übernehmen"></td><td class="nw">${esc(g.oz)}</td><td>${esc(g.text)}<br><small>${esc(g.formula).slice(0, 160)}</small></td><td class="r">${g.n}</td><td class="r nw"><b>${fmtN(g.sum)} ${esc(g.eh)}</b></td><td class="r nw">${a.an === "" || a.an == null ? "–" : fmtN(a.an)}</td><td class="r nw">${a.gp === "" || a.gp == null ? "–" : fmtN(a.gp)}</td><td>${esc(g.blatt)}</td><td style="min-width:200px">${g.errs.map(e => `<small class="neg">${esc(e)}</small>`).join("")}</td></tr>`; }).join("")}
  </tbody></table></div>
  ${m.unmatched.length ? `<div class="hint warn" style="margin-top:10px"><b>${m.unmatched.length} Zeile(n) ohne LV-Zuordnung</b> (OZ ${esc([...new Set(m.unmatched.map(l => l.oz || "?"))].join(", "))}) – mögliche Nachtragsleistung oder Lesefehler; nicht übernommen.</div>` : ""}
  <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost" data-a="closemodal">Abbrechen</button><button class="btn pri" data-a="amapply">Auswahl übernehmen</button></div></div></div>`;
}
function applyAufmass(p){
  const m = S.modal; const inv = p.rechnungen.find(r => r.id === m.invId); if (!inv) return;
  const target = $("#amTarget").value, mode = $("#amMode").value; inv.aufmass = inv.aufmass || {}; let n = 0;
  document.querySelectorAll("[data-amg]").forEach(c => {
    if (!c.checked) return; const g = m.groups[+c.dataset.amg]; if (!g || !g.formula) return;
    const a = inv.aufmass[g.posId] = inv.aufmass[g.posId] || {};
    if (target === "gp") {
      const base = mode === "add" ? (a.formel && String(a.formel).trim() ? String(a.formel) : (num(a.gp) ? fmtIn(num(a.gp), 3) : "")) : "";
      a.formel = base ? base + (g.formula.startsWith("-") ? "" : "+") + g.formula : g.formula;
      const v = evalExpr(a.formel); if (v !== null && !isNaN(v)) a.gp = v;
    } else a.an = Math.round(((mode === "add" ? num(a.an) : 0) + g.sum) * 1000) / 1000;
    if (g.blatt) a.blatt = [...new Set([...(String(a.blatt || "").split(/,\s*/).filter(Boolean)), ...g.blatt.split(/,\s*/)])].join(", ");
    n++;
  });
  if ($("#amGem") && $("#amGem").checked) inv.gemAufmass = true;
  S.modal = null; save(p); render(); toast(`Aufmaß für ${n} Position${n === 1 ? "" : "en"} übernommen`);
}

/* Nachtragsangebote */
async function recognizeNachtrag(files){
  const p = cp(); if (!p) return;
  await withOCR(files, "Nachtragsangebot wird gelesen", desc => `Bilder: ${desc}. Es handelt sich um ein Nachtragsangebot (ggf. mit Mehrkostenanzeige) eines Auftragnehmers zu einem VOB-Bauvertrag.
Extrahiere Kopfdaten und alle angebotenen Positionen. Zahlen sind deutsch formatiert; als JSON-Zahlen mit Punkt. Datum als JJJJ-MM-TT. Erfinde nichts, unbekannt = null.
grundlage aus der Begründung ableiten: "2-5" geänderte Leistung/Anordnung, "2-6" zusätzliche Leistung, "2-3" Mengenänderung, "2-8" Leistung ohne Auftrag, "2-9" Zeichnungen/Berechnungen, "6-6" Behinderung, "sonst" oder null.
Antworte nur mit JSON: {"nachtrag":{"nr":"NT 03","titel":"…","datum":null,"anzeige_datum":null,"grundlage":null,"summe_netto":null,"begruendung":"kurz, max. 300 Zeichen"},"positionen":[{"oz":"N03.010","kurztext":"…","eh":"m²","menge":12,"ep":45.5}]}
anzeige_datum = Datum einer im Angebot genannten vorherigen Ankündigung bzw. Mehrkostenanzeige.`,
  (res, partial) => {
    const n = {}; const rows = [];
    res.forEach(({ d }) => { const x = d && d.nachtrag; if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) if (v !== null && v !== "" && n[k] === undefined) n[k] = v; posRowsFrom(d && d.positionen).forEach(r => rows.push(r)); });
    const seenN = new Set(); for (let i = rows.length - 1; i >= 0; i--) { const k = rows[i].oz + "|" + rows[i].text; if (seenN.has(k)) rows.splice(i, 1); else seenN.add(k); }
    rows.forEach(r => r.exists = !!p.positions.find(x => ozEq(x.oz, r.oz)));
    logAdd("ok", `Nachtrag erkannt: ${rows.length} Positionen.`);
    S.tab = "nt"; S.inv = null;
    S.modal = { kind:"nachtrag", partial, source: files.map(f => f.name).join(", "), rows,
      n: { nr: n.nr ? String(n.nr).slice(0,20) : "NT " + String(p.nachtraege.length + 1).padStart(2, "0"), titel: String(n.titel || "").slice(0,160), datum: toISODate(n.datum) || "", anzeige: toISODate(n.anzeige_datum) || "", grundlage: GRUNDLAGEN.some(g => g[0] === n.grundlage) ? n.grundlage : "2-5", summe: numOrNull(n.summe_netto), begr: String(n.begruendung || "").slice(0, 400) } };
    render();
  });
}
function nachtragModal(m){
  const n = m.n; const posSum = round2(m.rows.reduce((s, r) => s + (r.menge != null && r.ep != null ? round2(r.menge * r.ep) : 0), 0));
  const H = [];
  if (n.summe != null && m.rows.length && Math.abs(n.summe - posSum) >= 1) H.push(["warn", `Summe der Positionen ${eur(posSum)} weicht von der Angebotssumme ${eur(n.summe)} um ${eur(Math.abs(n.summe - posSum))} ab.`]);
  if (n.grundlage === "2-6" && !n.anzeige) H.push(["warn", "§ 2 Abs. 6 Nr. 1 VOB/B: Vergütungsanspruch setzt Ankündigung vor Ausführung voraus – keine Ankündigung erkannt. Datum ggf. nachtragen."]);
  if (m.rows.some(r => r.exists)) H.push(["warn", "Einige OZ existieren bereits im LV. Nachtragspositionen erhalten eigene OZ – bitte umbenennen."]);
  H.push(["info", "Preisprüfung: Nachtragspreise auf Basis der Urkalkulation anfordern und prüfen. Ohne Einigung sind nach BGH (Urt. v. 08.08.2019 – VII ZR 34/18, zu § 2 Abs. 3 VOB/B) die tatsächlich erforderlichen Kosten zzgl. angemessener Zuschläge maßgeblich."]);
  return `<div class="modal" role="dialog" aria-modal="true"><div class="box"><h3>Nachtragsangebot übernehmen</h3>
  <p class="muted" style="font-size:.86rem">${esc(m.source)}${m.partial ? " (unvollständig)" : ""} · ${m.rows.length} Positionen erkannt</p>
  <div class="fields" style="margin-top:10px">
    <label class="f"><span>Nachtrag-Nr.</span><input class="in" id="ntNr" value="${esc(n.nr)}"></label>
    <label class="f" style="grid-column:span 2"><span>Bezeichnung</span><input class="in" id="ntTitel" value="${esc(n.titel)}"></label>
    <label class="f"><span>Anspruchsgrundlage</span><select class="in" id="ntGrund">${GRUNDLAGEN.map(([k, l]) => `<option value="${k}" ${k === n.grundlage ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
    <label class="f"><span>Angebot vom</span><input class="in" type="date" id="ntDatum" value="${esc(n.datum)}"></label>
    <label class="f"><span>Angekündigt am</span><input class="in" type="date" id="ntAnz" value="${esc(n.anzeige)}"></label>
    <label class="f"><span>Angebotssumme netto (€)</span><input class="in num" id="ntSumme" inputmode="decimal" value="${esc(fmtIn(n.summe ?? posSum, 2, 2))}"></label>
  </div>
  ${n.begr ? `<p style="font-size:.86rem;margin-top:10px"><b>Begründung lt. Angebot:</b> ${esc(n.begr)}</p>` : ""}
  <div class="hints" style="margin-top:10px">${H.map(([l, t]) => `<div class="hint ${l}">${t}</div>`).join("")}</div>
  ${m.rows.length ? `<h3 style="margin-top:14px">Positionen (werden dem Nachtrag zugeordnet)</h3>${lvRowsTable(m.rows.map(r => ({ ...r, exists:false })))}` : ""}
  <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost" data-a="closemodal">Abbrechen</button><button class="btn pri" data-a="ntapply">Nachtrag anlegen</button></div></div></div>`;
}
function applyNachtrag(p){
  const m = S.modal;
  const nt = { id:uid(), nr:$("#ntNr").value.trim() || "NT", titel:$("#ntTitel").value.trim(), grundlage:$("#ntGrund").value, anzeige:$("#ntAnz").value, angebotDatum:$("#ntDatum").value, angebot:num($("#ntSumme").value), geprueft:0, status:"Angebot eingegangen", bem:m.n.begr ? ("lt. Angebot: " + m.n.begr).slice(0, 300) : "" };
  p.nachtraege.push(nt);
  const { nNew } = applyLVRows(p, m.rows, nt.id);
  S.modal = null; S.tab = "nt"; save(p); render(); toast(`${nt.nr} angelegt${nNew ? ` mit ${nNew} Position${nNew === 1 ? "" : "en"}` : ""} – Status „Angebot eingegangen“`);
}
function doctypeModal(){
  return `<div class="modal" role="dialog" aria-modal="true"><div class="box" style="max-width:460px"><h3>Was möchtest du einlesen?</h3>
  <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
    <button class="btn pri" data-a="doctype" data-v="inv">Rechnung – Positionen erkennen und markieren</button>
    <button class="btn" data-a="doctype" data-v="am">Aufmaßblätter – Mengen und Rechenansätze übernehmen</button>
    <button class="btn ghost" data-a="closemodal">Abbrechen</button></div></div></div>`;
}
function openLVPreview(rows, source, meta){
  let p = cp();
  if (!p) { p = newProject(meta && meta.name || "Neues Projekt"); if (meta) { if (meta.ag) p.ag = meta.ag; if (meta.an) p.an = meta.an; } S.projects.push(p); S.cur = p.id; save(p); toast("Projekt angelegt"); }
  else if (meta) { if (!p.ag && meta.ag) p.ag = meta.ag; if (!p.an && meta.an) p.an = meta.an; if (p.name === "Neues Projekt" && meta.name) p.name = meta.name; save(p); }
  const seen = new Set();
  rows = rows.filter(r => r.oz || r.text).filter(r => { const k = r.oz + "|" + r.text; if (seen.has(k)) return false; seen.add(k); return true; })
    .map(r => ({ ...r, exists: !!p.positions.find(x => ozEq(x.oz, r.oz)) }));
  if (!rows.length) { toast("Keine Positionen gefunden"); render(); return; }
  S.tab = "lv"; S.inv = null; S.modal = { kind:"lvpreview", rows, source }; render();
}
function createInvoice(p, art){
  const prev = p.rechnungen[p.rechnungen.length - 1];
  const nAR = p.rechnungen.filter(r => r.art === "Abschlagsrechnung").length + 1;
  const aufmass = {};
  if (prev && prev.aufmass) for (const [k, v] of Object.entries(prev.aufmass)) aufmass[k] = { an:v.an ?? "", gp:v.gp ?? "", formel:v.formel || "", blatt:v.blatt || "" };
  const inv = { id:uid(), nr: art === "Schlussrechnung" ? "SR" : nAR + ". AR", art, datum:"", eingang:todayISO(), forderung:"", pruefdatum:"", gemAufmass:false, status:"eingegangen", aufmass,
    maengel: prev ? prev.maengel || 0 : 0, sonst: prev ? prev.sonst || 0 : 0, sonstText: prev ? prev.sonstText || "" : "", zahlDatum:"", zahlBetrag:"", skontoGezogen:false, bem:"" };
  p.rechnungen.push(inv); save(p); return inv;
}
async function newInvoiceFromFile(file){
  const p = cp(); if (!p) { toast("Bitte zuerst ein Projekt anlegen oder das Auftrags-LV einlesen"); return; }
  const inv = createInvoice(p, "Abschlagsrechnung");
  S.tab = "re"; S.inv = inv.id; S.placeMode = null; S.editMarks = false; render(); window.scrollTo(0, 0);
  const ok = await loadScan(file, inv.id);
  if (ok && SAMPLE) await recognize(inv.id, { auto:true });
  else if (ok) toast("Rechnung angelegt – automatische Erkennung ist in dieser Ansicht nicht verfügbar.");
}
let PENDING_FILES = [];
function dropTarget(){
  const p = cp(); if (!p) return "lv";
  if (S.tab === "lv" || S.tab === "vertrag") return "lv";
  if (S.tab === "nt") return "nt";
  if (S.tab === "re" && S.inv && p.rechnungen.find(r => r.id === S.inv)) return "choose";
  return "newinv";
}
function dropHintText(){
  const t = dropTarget();
  if (t === "lv") return cp() ? "Auftragsschreiben mit LV (Scan), GAEB DA XML, Excel oder CSV einlesen" : "Auftragsschreiben mit LV einlesen – Projekt, Vertragsdaten und Positionen werden angelegt";
  if (t === "nt") return "Nachtragsangebot (PDF/Scan) einlesen – Nachtrag mit Positionen wird angelegt";
  if (t === "choose") return "Rechnung oder Aufmaßblätter zu dieser Rechnung einlesen";
  return "PDF/Scan: neue Rechnung anlegen und Positionen erkennen (mehrere Dateien möglich). GAEB/Excel: Leistungsverzeichnis.";
}
async function handleFiles(list, target){
  const files = [...(list || [])]; if (!files.length) return;
  let t = target || dropTarget();
  const other = files.filter(f => !isPdfImg(f)), scans = files.filter(isPdfImg);
  for (const f of other) {
    try {
      if (extOf(f) === "json") { importFile(f); continue; }
      if (isGAEB(f)) { const g = parseGAEB(await f.text()); openLVPreview(g.rows, `GAEB-Datei „${f.name}“${g.kind ? " (DA " + g.kind + ")" : ""}`, g.name ? { name:g.name } : null); continue; }
      if (isTable(f)) { openLVPreview(await parseTable(f), `Tabelle „${f.name}“`, null); continue; }
      toast(`„${f.name}“: Dateityp wird nicht unterstützt`);
    } catch(e){ toast(`„${f.name}“: ${e && e.message ? e.message : "konnte nicht gelesen werden"}`); }
  }
  if (!scans.length) return;
  try {
    if (t === "choose") { PENDING_FILES = scans; S.modal = { kind:"doctype" }; render(); return; }
    if (t === "lv") { await recognizeAuftrag(scans); return; }
    if (t === "nt") { await recognizeNachtrag(scans); return; }
    if (t === "am") { if (S.inv) await recognizeAufmass(scans, S.inv); return; }
    if (t === "inv") { const id = S.inv; const ok = await loadScan(scans[0], id); if (ok && SAMPLE) await recognize(id, { auto:true }); for (const f of scans.slice(1)) await newInvoiceFromFile(f); return; }
    for (const f of scans) await newInvoiceFromFile(f);
  } catch(e){ toast(e && e.message ? e.message : "Datei konnte nicht gelesen werden"); S.scanBusy = null; render(); }
}
let dragDepth = 0;
const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
document.addEventListener("dragenter", e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $("#dropHint").textContent = dropHintText(); $("#dropov").hidden = false; });
document.addEventListener("dragover", e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
document.addEventListener("dragleave", e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $("#dropov").hidden = true; });
document.addEventListener("drop", e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; $("#dropov").hidden = true; if (S.scanBusy) { toast("Bitte warten, bis die laufende Erkennung abgeschlossen ist"); return; } handleFiles(e.dataTransfer.files); });
const dropZone = (title, sub, action) => `<button class="dropzone" data-a="${action}"><b>${title}</b><span>Datei hierher ziehen oder tippen zum Auswählen</span><small>${sub}</small></button>`;

/* ---------- Start ---------- */
S.projects = lsLoad(); uiLoad(); S.menu = false; S.modal = null; S.confirm = null;
if (!S.projects.find(p => p.id === S.cur)) S.cur = S.projects[0]?.id || null;
render();
connect();
initSample();
