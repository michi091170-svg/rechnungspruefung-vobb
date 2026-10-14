/**
 * Regelbasierte Auswertung von Seitentext (PDF-Textebene oder Texterkennung) ohne KI.
 * Liefert dieselben Strukturen wie die KI-Auswertung, damit die Oberfläche beide Wege gleich behandelt.
 * Grundsatz: lieber ein Feld offen lassen (null) als einen unsicheren Wert raten.
 */
import { num, toISODate } from "./format";

export interface TextZeile { id: string; text: string }
export interface TextSeite { zeilen: TextZeile[] }
export interface LvRef { oz: string; eh: string }

export interface PosZeile {
  zeile: string; oz: string; text: string; eh: string;
  menge: number | null; ep: number | null; betrag: number | null;
  /** Menge × EP stimmt mit dem Betrag überein */
  stimmig: boolean;
  /** Einheit aus mehrdeutiger Texterkennung geschätzt (m?/m}) */
  ehGeschaetzt?: boolean;
}
export interface SummenZeile { zeile: string; art: "netto" | "brutto" | "zahlbetrag"; wert: number }

const NUM_RE = /^-?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?-?$/;
const OZ_RE = /^(?:\d{1,4}(?:[.\-/]\d{1,5}){1,4}\.?|[A-Z]{1,3}\d{0,3}[.\-]\d{1,4}(?:[.\-]\d{1,5}){0,3}|\d{1,4}\.?)$/;
const SUM_WORDS = /\bsumme|zwischensumme|übertrag|uebertrag|gesamtbetrag|^gesamt\b|^titel\b|\bnetto\b|\bbrutto\b|mwst|\bust\b|umsatzsteuer|^%/i;
const DATE_RE = /\b(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2}|\d{4})\b/;

/** Einheiten, wie sie in LV und Rechnungen stehen (auch typische Lesefehler der Texterkennung) */
const UNITS: Record<string, string> = {
  "m": "m", "lfm": "m", "lfdm": "m", "lm": "m", "m1": "m",
  "m2": "m²", "m²": "m²", "qm": "m²", "m3": "m³", "m³": "m³", "cbm": "m³",
  "st": "St", "st.": "St", "stk": "St", "stk.": "St", "stck": "St", "stck.": "St", "stück": "St",
  "psch": "psch", "psch.": "psch", "pauschal": "psch", "pau": "psch", "pa": "psch",
  "h": "h", "std": "h", "std.": "h", "kg": "kg", "t": "t", "to": "t", "l": "l", "ltr": "l",
  "wo": "Wo", "tag": "Tag", "tage": "Tag", "mt": "Mt", "mon": "Mt", "monat": "Mt",
};
const AMBIG_M = /^m[?}*'"°^]$/i;
const VOLUME_WORDS = /beton|aushub|boden|erdarbeit|verfüll|schotter|kies|sand|abbruch|estrich|mörtel/i;

export const isNumTok = (t: string): boolean => NUM_RE.test(cleanTok(t));
const cleanTok = (t: string): string => t.replace(/^[(]|[€)]$/g, "").replace(/EUR$/i, "").replace(/€$/, "");
const tokNum = (t: string): number => { const c = cleanTok(t); return c.endsWith("-") ? -num(c.slice(0, -1)) : num(c); };
const unitOf = (t: string): string | null => {
  const k = t.toLowerCase(); if (UNITS[k]) return UNITS[k];
  const hoch = /^m[?}*'"°^]{1,2}([23²³])$/i.exec(t); if (hoch) return /[2²]/.test(hoch[1]) ? "m²" : "m³";
  return AMBIG_M.test(t) ? "m?" : null;
};
const near = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * 0.002);
const isDate = (t: string): boolean => /^\d{1,2}\.\d{1,2}\.(19|20)\d{2}$/.test(t) && +t.split(".")[0] <= 31 && +t.split(".")[1] <= 12;
const isOz = (t: string): boolean => !isDate(t) && (OZ_RE.test(t) && !/^\d{1,3}(\.\d{3})+$/.test(t.replace(/\.$/, "")) || /^0\d*\.\d{3}$/.test(t));

function ozNorm(o: string): string {
  return String(o || "").trim().replace(/\s+/g, "").replace(/[.\-/]+$/, "").split(/[.\-/]/).map(x => /^\d+$/.test(x) ? String(parseInt(x, 10)) : x.toUpperCase()).join(".");
}
function lvEh(oz: string, lv: LvRef[]): string | null { const n = ozNorm(oz); const f = lv.find(x => ozNorm(x.oz) === n); return f ? f.eh : null; }

/** Zahlen am Zeilenende (Menge, EP, Betrag) samt Einheit; Text davor */
function splitTail(tokens: string[]): { head: string[]; nums: number[]; unitIdx: number; unit: string | null; frontMenge: number | null; frontUnit: string | null } {
  let frontMenge: number | null = null, frontUnit: string | null = null; let start = 0;
  // Aufbau „Menge EH Text … EP GP“
  if (tokens.length > 3 && isNumTok(tokens[0]) && unitOf(tokens[1]) && !isNumTok(tokens[2])) { frontMenge = tokNum(tokens[0]); frontUnit = unitOf(tokens[1]); start = 2; }
  let j = tokens.length;
  while (j > start) { const t = tokens[j - 1]; if (isNumTok(t) || unitOf(t) || /^(€|eur|%)$/i.test(t)) j--; else break; }
  // Text, der mit Maß und Einheit endet („KS 17,5 cm“) bleibt Text: Tail beginnt erst nach einem Wort
  const tail = tokens.slice(j); const nums: number[] = []; let unit: string | null = null, unitIdx = -1;
  for (const t of tail) { if (isNumTok(t)) nums.push(tokNum(t)); else { const u = unitOf(t); if (u && !unit) { unit = u; unitIdx = nums.length; } } }
  return { head: tokens.slice(start, j), nums, unitIdx, unit, frontMenge, frontUnit };
}

/** Menge, EP und Betrag aus den Zahlen bestimmen; bevorzugt eine Kombination mit Menge × EP = Betrag */
function assign(nums: number[], unitIdx: number, frontMenge: number | null): { menge: number | null; ep: number | null; betrag: number | null; stimmig: boolean } {
  if (frontMenge != null) {
    if (nums.length >= 2) { const ep = nums[nums.length - 2], gp = nums[nums.length - 1]; return { menge: frontMenge, ep, betrag: gp, stimmig: near(frontMenge * ep, gp) }; }
    if (nums.length === 1) return { menge: frontMenge, ep: nums[0], betrag: null, stimmig: false };
  }
  if (nums.length >= 3) {
    const gp = nums[nums.length - 1];
    for (let j = nums.length - 2; j >= 1; j--) for (let i = j - 1; i >= 0; i--) if (near(nums[i] * nums[j], gp)) return { menge: nums[i], ep: nums[j], betrag: gp, stimmig: true };
    const mi = unitIdx > 0 && unitIdx <= nums.length - 2 ? unitIdx - 1 : nums.length - 3;
    return { menge: nums[mi], ep: nums[nums.length - 2], betrag: gp, stimmig: false };
  }
  if (nums.length === 2) {
    if (unitIdx === 1) return { menge: nums[0], ep: nums[1], betrag: null, stimmig: false };
    return { menge: null, ep: nums[0], betrag: nums[1], stimmig: false };
  }
  if (nums.length === 1) return unitIdx === 1 ? { menge: nums[0], ep: null, betrag: null, stimmig: false } : { menge: null, ep: null, betrag: nums[0], stimmig: false };
  return { menge: null, ep: null, betrag: null, stimmig: false };
}

/** Positionszeilen (OZ am Zeilenanfang); Langtext auf Folgezeilen wird an den Kurztext angehängt, Beträge ggf. aus der Folgezeile */
export function parsePositionen(seiten: TextSeite[], lv: LvRef[] = []): PosZeile[] {
  const out: PosZeile[] = [];
  const all = seiten.flatMap(s => s.zeilen);
  for (let k = 0; k < all.length; k++) {
    const z = all[k]; let tokens = z.text.trim().split(/\s+/);
    if (/^pos\.?(-?nr\.?)?$/i.test(tokens[0] || "")) tokens = tokens.slice(1);
    const oz = (tokens[0] || "").replace(/:$/, "");
    if (!isOz(oz) || tokens.length < 2) continue;
    let rest = tokens.slice(1); if (!rest.some(t => /[A-Za-zÄÖÜäöü]{2,}/.test(t))) continue;
    let sp = splitTail(rest); let zid = z.id; let extra = "";
    if (!sp.nums.length && sp.frontMenge == null) {
      // Beträge stehen in einer Folgezeile ohne eigene OZ
      for (let n = k + 1; n < Math.min(all.length, k + 5); n++) {
        const t2 = all[n].text.trim().split(/\s+/); if (isOz(t2[0] || "") && /[A-Za-z]{2,}/.test(t2.slice(1).join(" "))) break;
        const s2 = splitTail(t2);
        if (s2.nums.length >= 2) { sp = { ...s2, head: sp.head }; zid = all[n].id; extra = s2.head.join(" "); break; }
        extra += " " + t2.join(" ");
      }
    }
    if (!sp.nums.length && sp.frontMenge == null) continue;
    const text = (sp.head.join(" ") + " " + extra).replace(/\s+/g, " ").trim().slice(0, 140);
    if (SUM_WORDS.test(text)) continue;
    const a = assign(sp.nums, sp.unitIdx, sp.frontMenge);
    let eh = sp.frontUnit || sp.unit || ""; let geschaetzt = false;
    const fromLv = lvEh(oz, lv);
    if (eh === "m?" || (!eh && fromLv)) { if (fromLv) eh = fromLv; else { eh = VOLUME_WORDS.test(text) ? "m³" : "m²"; geschaetzt = true; } }
    if (eh === "psch" && a.menge == null && a.ep != null) a.menge = 1;
    out.push({ zeile: zid, oz, text, eh, ...a, ...(geschaetzt ? { ehGeschaetzt: true } : {}) });
  }
  return out;
}

const lastNum = (text: string): number | null => { const t = text.trim().split(/\s+/).filter(isNumTok); return t.length ? tokNum(t[t.length - 1]) : null; };
const pct = (s: string, re: RegExp): number | null => { const m = re.exec(s); return m ? num(m[m.length - 1]) : null; };
const dateIn = (s: string): string | null => { const m = DATE_RE.exec(s); if (!m) return null; const y = m[3].length === 2 ? "20" + m[3] : m[3]; return toISODate(`${m[1]}.${m[2]}.${y}`); };

/** Summenzeilen einer Rechnung */
export function parseSummen(seiten: TextSeite[]): SummenZeile[] {
  const out: SummenZeile[] = [];
  for (const z of seiten.flatMap(s => s.zeilen)) {
    const t = z.text; if (isOz(t.trim().split(/\s+/)[0] || "") && !/summe|betrag/i.test(t)) continue;
    const w = lastNum(t); if (w == null || /%\s*$/.test(t.trim())) continue;
    let art: SummenZeile["art"] | null = null;
    if (/zahlbetrag|zu zahlen|auszahlungsbetrag|abschlagsforderung|forderungsbetrag|noch offen|zahlungsbetrag/i.test(t)) art = "zahlbetrag";
    else if (/brutto|gesamtbetrag|endbetrag|rechnungsbetrag|inkl\.?\s*(mwst|ust|umsatzsteuer)/i.test(t)) art = "brutto";
    else if (/netto|summe der leistungen|leistungssumme|summe leistungen/i.test(t) && !/mwst|ust\b|umsatzsteuer/i.test(t.replace(/netto.*$/i, ""))) art = "netto";
    if (art) out.push({ zeile: z.id, art, wert: w });
  }
  return out;
}

const fullText = (seiten: TextSeite[]): string => seiten.flatMap(s => s.zeilen.map(z => z.text)).join("\n");

/** Rechnung: Kopf, Positionen, Summen (Form wie die KI-Antwort) */
export function rechnungAusText(seiten: TextSeite[], lv: LvRef[] = []) {
  const t = fullText(seiten); const kopf = seiten[0] ? seiten[0].zeilen.slice(0, 40).map(z => z.text).join("\n") : "";
  const art = /schlussrechnung/i.test(kopf) ? (/teilschluss/i.test(kopf) ? "Teilschlussrechnung" : "Schlussrechnung") : /abschlag|\bAR\b/i.test(kopf) ? "Abschlagsrechnung" : null;
  let nr: string | null = null;
  const m1 = /(\d{1,2})\.\s*(Abschlagsrechnung|Abschlag|AR|Teilschlussrechnung)/i.exec(kopf);
  const m2 = /(?:rechnungs?\s*-?\s*(?:nr|nummer)\.?|rg\.?\s*-?\s*nr\.?)\s*:?\s*([A-Za-z0-9][\w\-/.]{0,24})/i.exec(kopf);
  if (m1) nr = `${parseInt(m1[1], 10)}. ${/teil/i.test(m1[2]) ? "TSR" : "AR"}`; else if (m2) nr = m2[1].replace(/[.,]$/, "");
  const dm = /(?:rechnungsdatum|datum)\s*:?\s*(\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4})/i.exec(kopf);
  const datum = dm ? dateIn(dm[1]) : dateIn(kopf);
  const summen = parseSummen(seiten);
  const zb = summen.filter(s => s.art === "zahlbetrag").pop();
  const kumuliert = !/(nur|ausschließlich)\s+(der|die)?\s*leistungen?\s+(im|des)\s+abrechnungszeitraum/i.test(t);
  const zeilen = parsePositionen(seiten, lv).map(p => ({ zeile: p.zeile, oz: p.oz, lv_oz: null, text: p.text, eh: p.eh, menge: p.menge, ep: p.ep, betrag: p.betrag, stimmig: p.stimmig }));
  return { rechnung: art || nr || datum || zb ? { nr, art, datum, zahlbetrag: zb ? zb.wert : null } : null, kumuliert, zeilen, summen };
}

/** Auftragsschreiben mit LV: Vertragsangaben (nur eindeutige Treffer) und Positionen */
export function auftragAusText(seiten: TextSeite[]) {
  const t = fullText(seiten); const lines = t.split("\n");
  const line = (re: RegExp): string | null => { const l = lines.find(x => re.test(x)); return l ?? null; };
  const after = (re: RegExp): string | null => { for (const l of lines) { const m = re.exec(l); if (m) { const v = l.slice(m.index + m[0].length).replace(/^[\s:.\-–]+/, "").trim(); if (v) return v.slice(0, 120); } } return null; };
  const sumL = line(/(auftragssumme|vertragssumme|angebotssumme|auftragswert).*netto|netto.*(auftragssumme|vertragssumme)|^\s*(auftragssumme|vertragssumme)/i);
  const sk = /skonto\D{0,40}?(\d+(?:,\d+)?)\s*%[^\n]{0,60}?(\d{1,3})\s*(?:kalender|werk)?tage/i.exec(t);
  const vobB = /VOB\s*\/?\s*B/.test(t) && /(VOB\s*\/?\s*B[^\n]{0,80}(vereinbart|vertragsbestandteil|gilt|gelten|zugrunde))|((vereinbart|vertragsbestandteil|gilt|gelten|zugrunde)[^\n]{0,80}VOB\s*\/?\s*B)/i.test(t);
  const fristA = /abschlag\w*[^\n]{0,60}?(\d{1,3})\s*(?:kalender|werk)?tage/i.exec(t), fristS = /schluss(zahlung|rechnung)[^\n]{0,60}?(\d{1,3})\s*(?:kalender|werk)?tage/i.exec(t);
  const dm = /(?:auftrags|vertrags|zuschlags|bestell)(?:datum|erteilung)?[^\n]{0,20}?(?:vom|am|datum)?\s*:?\s*(\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4})/i.exec(t);
  const vertrag = {
    projekt: after(/^\s*(bauvorhaben|projekt|baumaßnahme|maßnahme|BV)\b\.?/i),
    baustelle: after(/^\s*(baustelle|ort der ausführung|ausführungsort)\b/i),
    vergabe_nr: (() => { const m = /(vergabe|vertrags|auftrags|bestell)\s*-?\s*(nr|nummer)\.?\s*:?\s*([A-Za-z0-9][\w\-/.]{1,30})/i.exec(t); return m ? m[3].replace(/[.,]$/, "") : null; })(),
    auftraggeber: null, auftragnehmer: null,
    auftragsdatum: dm ? dateIn(dm[1]) : null,
    auftragssumme_netto: sumL ? lastNum(sumL) : null,
    auftragssumme_brutto: (() => { const l = line(/(auftragssumme|vertragssumme).*brutto/i); return l ? lastNum(l) : null; })(),
    vob_b_vereinbart: vobB ? true : null,
    nachlass_prozent: pct(t, /nachlass\D{0,30}?(\d+(?:,\d+)?)\s*%/i),
    umlage_prozent: pct(t, /umlage\D{0,40}?(\d+(?:,\d+)?)\s*%/i), umlage_bezeichnung: null,
    skonto_vereinbart: sk ? true : null, skonto_prozent: sk ? num(sk[1]) : null, skonto_tage: sk ? num(sk[2]) : null,
    sicherheitseinbehalt_prozent: pct(t, /(sicherheitseinbehalt|einbehalt|vertragserfüllung\w*)\D{0,50}?(\d+(?:,\d+)?)\s*%/i),
    sicherheitssumme_prozent: null,
    maengelsicherheit_prozent: pct(t, /(mängelansprüche|mängelsicherheit|gewährleistungs\w*)\D{0,50}?(\d+(?:,\d+)?)\s*%/i),
    zahlungsfrist_abschlag_tage: fristA ? num(fristA[1]) : null, zahlungsfrist_schluss_tage: fristS ? num(fristS[2]) : null,
    reverse_charge_13b: /13\s*b\s*UStG/i.test(t) ? true : null,
    vertragsstrafe: null, ausfuehrungsfristen: null, weitere_hinweise: null,
  };
  const positionen = parsePositionen(seiten).map(p => ({ oz: p.oz, kurztext: p.text.slice(0, 120), eh: p.eh, menge: p.menge, ep: p.ep }));
  return { vertrag, positionen };
}

/** Aufmaßblätter: Zeilen mit Rechenansatz und Ergebnis; Zeilen ohne OZ gehören zur zuletzt genannten Position */
export function aufmassAusText(seiten: TextSeite[]) {
  const zeilen: { blatt: string; oz: string; lv_oz: null; ort: string; ansatz: string; ergebnis: number | null; eh: string }[] = [];
  const t = fullText(seiten);
  for (const s of seiten) {
    const bm = /blatt\s*(?:nr\.?)?\s*:?\s*(\d{1,4})/i.exec(s.zeilen.map(z => z.text).join("\n")); const blatt = bm ? bm[1] : "";
    let oz = "";
    for (const z of s.zeilen) {
      let txt = z.text.trim(); if (/übertrag|zwischensumme|summe/i.test(txt)) continue;
      const tk = txt.split(/\s+/); const t0 = tk[0] === "Pos." || /^pos\.?$/i.test(tk[0]) ? tk[1] || "" : tk[0];
      if (isOz(t0) && t0.includes(".") || /^pos\.?$/i.test(tk[0])) { oz = t0.replace(/:$/, ""); txt = txt.slice(txt.indexOf(t0) + t0.length).trim(); }
      const em = /(-?\(?\s*\d[\d.,]*\s*\)?(?:\s*[x×*·/+\-]\s*\(?\s*\d[\d.,]*\s*\)?)+)(?:\s*=\s*(-?\d[\d.,]*))?/.exec(txt);
      if (!em || !oz) continue;
      const ansatz = em[1].replace(/\s+/g, " ").trim();
      const res = em[2] ?? (txt.slice(em.index + em[0].length).trim().split(/\s+/).find(isNumTok) || null);
      const after = txt.slice(em.index + em[0].length).trim().split(/\s+/); const eh = (after.map(unitOf).find(Boolean) || "").replace("m?", "");
      const ort = txt.slice(0, em.index).replace(/[:\-–]+$/, "").trim().slice(0, 80);
      const neg = /^(abzug|abz\.?|\-)/i.test(ort) || /^-/.test(ansatz);
      let ergebnis = res != null ? tokNum(res) : null; if (ergebnis != null && neg && ergebnis > 0) ergebnis = -ergebnis;
      zeilen.push({ blatt, oz, lv_oz: null, ort, ansatz: ansatz.replace(/^-\s*/, ""), ergebnis, eh });
    }
  }
  return { gemeinsam: /gemeinsam(es|en)?\s+(aufmaß|aufgemessen|aufmass)/i.test(t) ? true : null, zeilen };
}

/** Nachtragsangebot: Kopf, Grundlage nach Schlagworten, Positionen */
export function nachtragAusText(seiten: TextSeite[]) {
  const t = fullText(seiten); const kopf = seiten[0] ? seiten[0].zeilen.slice(0, 40).map(z => z.text).join("\n") : t;
  const nm = /(nachtrag(?:sangebot)?|mehrkostenanzeige|\bNT)\s*(?:nr\.?|-)?\s*:?\s*([A-Z]{0,3}\s?\d{1,3}[a-z]?)\b/i.exec(kopf);
  const nr = nm ? "NT " + nm[2].replace(/^\D+/, "").padStart(2, "0") : null;
  const titelL = kopf.split("\n").find(l => /^\s*(betreff|betr\.|gegenstand|leistung)\s*:/i.test(l));
  const titel = titelL ? titelL.replace(/^\s*(betreff|betr\.|gegenstand|leistung)\s*:\s*/i, "").trim().slice(0, 160) : nm ? kopf.split("\n").find(l => l.includes(nm[0]))?.replace(nm[0], "").replace(/^[\s:–\-]+/, "").trim().slice(0, 160) || null : null;
  const sumL = t.split("\n").filter(l => /netto|angebotssumme|nachtragssumme|summe/i.test(l) && !/brutto|mwst|ust\b/i.test(l)).pop();
  const grundlage = /behinderung|stillstand|bauzeitverlängerung/i.test(t) ? "6-6" : /zusätzlich|zusatzleistung|nicht vorgesehen/i.test(t) ? "2-6" : /geändert|änderung|anordnung|umplanung/i.test(t) ? "2-5" : /mengenmehrung|mengenänderung|mehrmenge/i.test(t) ? "2-3" : null;
  const am = /(angekündigt|mehrkostenanzeige|anzeige)[^\n]{0,30}?(?:vom|am)\s*(\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4})/i.exec(t);
  const dm = /(?:datum|vom)\s*:?\s*(\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4})/i.exec(kopf);
  return {
    nachtrag: { nr, titel, datum: dm ? dateIn(dm[1]) : dateIn(kopf), anzeige_datum: am ? dateIn(am[2]) : null, grundlage, summe_netto: sumL ? lastNum(sumL) : null, begruendung: null },
    positionen: parsePositionen(seiten).map(p => ({ oz: p.oz, kurztext: p.text.slice(0, 120), eh: p.eh, menge: p.menge, ep: p.ep })),
  };
}
