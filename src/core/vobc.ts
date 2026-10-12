import { fmtIn, fmtN, num } from "./format";
import { evalExpr } from "./formula";
import type { NumIn, Project } from "./types";

export type UebKind = "m3" | "m2" | "m";
/** f Fläche a×b · v Rauminhalt a×b×c · q Querschnitt a×b je m · w Einzelbreite a · l Einzellänge a */
export type UebMode = "f" | "v" | "q" | "w" | "l";
/** [id, Bezeichnung, Grenzwert (≤ wird übermessen) oder null, Kriterium, Status v = Normwert / p = abgleichen] */
export type UebRow = [string, string, number | null, UebMode, "v" | "p"];
export interface UebGewerk { m3?: UebRow[]; m2?: UebRow[]; m?: UebRow[]; notes?: string[] }

export const ATV: [string, string][] = [
  ["DIN 18299","Allgemeine Regelungen für Bauarbeiten jeder Art"],["DIN 18300","Erdarbeiten"],["DIN 18301","Bohrarbeiten"],
  ["DIN 18318","Pflasterdecken und Plattenbeläge, Einfassungen"],["DIN 18330","Mauerarbeiten"],["DIN 18331","Betonarbeiten"],
  ["DIN 18332","Naturwerksteinarbeiten"],["DIN 18334","Zimmer- und Holzbauarbeiten"],["DIN 18338","Dachdeckungs- und Dachabdichtungsarbeiten"],
  ["DIN 18339","Klempnerarbeiten"],["DIN 18340","Trockenbauarbeiten"],["DIN 18345","Wärmedämm-Verbundsysteme"],
  ["DIN 18350","Putz- und Stuckarbeiten"],["DIN 18352","Fliesen- und Plattenarbeiten"],["DIN 18353","Estricharbeiten"],
  ["DIN 18355","Tischlerarbeiten"],["DIN 18360","Metallbauarbeiten"],["DIN 18363","Maler- und Lackierarbeiten"],
  ["DIN 18365","Bodenbelagarbeiten"],["DIN 18379","Raumlufttechnische Anlagen"],["DIN 18380","Heizanlagen und zentrale Wassererwärmungsanlagen"],
  ["DIN 18381","Gas-, Wasser- und Entwässerungsanlagen innerhalb von Gebäuden"],["DIN 18382","Elektro-, Sicherheits- und informationstechnische Anlagen"],
  ["DIN 18459","Abbruch- und Rückbauarbeiten"]
];
/* ---------- Übermessungsregeln nach VOB/C, jeweils Abschnitt 5 der ATV ----------
   r: [id, Bezeichnung, Grenzwert (≤ wird übermessen), Kriterium, Status]
   Kriterium: "f" Fläche a×b · "v" Rauminhalt a×b×c · "q" Querschnitt a×b (je m Länge) · "w" Einzelbreite a · "l" Einzellänge a
   Status: "v" = Wert nach gängiger Kommentierung, "p" = mit dem Normtext der vereinbarten Fassung abgleichen
   Grenzwert null = nicht hinterlegt, im Reiter „Aufmaßregeln“ eintragen */
export const UEB: Record<string, UebGewerk> = {
  "DIN 18299": { notes:["Keine gewerkeübergreifenden Übermessungsgrenzen – maßgebend ist Abschnitt 5 der Gewerke-ATV.","Die Leistung ist aus Zeichnungen zu ermitteln, soweit die Ausführung ihnen entspricht; sonst nach Aufmaß."] },
  "DIN 18300": { m3:[["bk","Baukörper (Einzelgröße)",1,"v","v"],["ltg","Leitungen, Sickerkörper, Steinpackungen u. dgl. (äußerer Querschnitt)",0.1,"q","v"]], notes:["Böschungsräume und Arbeitsräume nach den Regeln in Abschnitt 5.2 ermitteln."] },
  "DIN 18301": { notes:["Abrechnung überwiegend nach Länge/Stück – keine Übermessungsgrenzen für Flächen hinterlegt."] },
  "DIN 18318": { m2:[["ass","Aussparungen (z. B. Schächte, Baumscheiben)",null,"f","p"]], m:[["unt","Unterbrechungen",1,"l","p"]] },
  "DIN 18330": { m3:[["ass","Öffnungen, Nischen, Aussparungen",0.5,"v","v"],["sch","Schlitze, Kanäle, Profilierungen (je m Länge)",0.1,"q","v"]],
                 m2:[["wand","Öffnungen/Aussparungen in Wänden (auch raumhoch)",2.5,"f","v"],["boden","Aussparungen in Böden",0.5,"f","p"],["stab","Unterbrechungen durch stabförmige Bauteile (Breite)",0.3,"w","v"]],
                 m:[["unt","Unterbrechungen",1,"l","v"]] },
  "DIN 18331": { m3:[["ass","Aussparungen, Kassetten, Hohlkörper, einbindende Bauteile",0.5,"v","v"],["sch","Schlitze, Kanäle, Profilierungen (je m Länge)",0.1,"q","v"]],
                 m2:[["ass","Aussparungen (kleinste Maße maßgebend)",2.5,"f","v"],["schal","Schalung: Aussparungen, Anschlüsse von Bauteilen",2.5,"f","v"]],
                 m:[["unt","Unterbrechungen",1,"l","v"]], notes:["Fugen und eingebaute Dämmstoffschichten werden übermessen."] },
  "DIN 18332": { m2:[["oeff","Öffnungen in Wänden",2.5,"f","p"],["ass","Aussparungen für Einbauteile",0.1,"f","p"]], m:[["unt","Unterbrechungen",1,"l","v"]] },
  "DIN 18334": { m2:[["wand","In Decken, Wänden, Dächern, Schalungen, Bekleidungen",2.5,"f","v"],["boden","In Böden inkl. Dämmung, Schüttung, Sperren",0.5,"f","v"]],
                 m:[["unt","Unterbrechungen",1,"l","v"]],
                 notes:["Unterbrechungen durch Fachwerkteile, Sparren, Lattungen und Unterkonstruktionen werden übermessen.","Verzimmerte Hölzer (m³): größte Länge einschließlich Zapfen, voller Querschnitt ohne Abzug von Ausklinkungen und Querschnittsschwächungen.","Ganz oder teilweise gedämmte oder bekleidete Leibungen von abgezogenen Öffnungen werden gesondert gerechnet.","Rückflächen von Nischen werden unabhängig von ihrer Größe gerechnet."] },
  "DIN 18338": { m2:[["ass","Aussparungen (z. B. Dachfenster, Schornsteine, Gauben)",null,"f","p"]], m:[["unt","Unterbrechungen",1,"l","p"]], notes:["Grenzwert für Flächen bitte aus der vereinbarten Fassung der ATV DIN 18338 eintragen."] },
  "DIN 18339": { m2:[["ass","Aussparungen",null,"f","p"]], m:[["unt","Unterbrechungen",1,"l","p"]] },
  "DIN 18340": { m2:[["wand","Öffnungen, Aussparungen, Nischen in Wänden und Decken",2.5,"f","v"],["boden","Aussparungen in Böden",0.5,"f","v"]], m:[["unt","Unterbrechungen",1,"l","v"]] },
  "DIN 18345": { m2:[["ass","Öffnungen, Nischen, Brandbarrieren u. dgl.",2.5,"f","v"]], m:[["unt","Unterbrechungen",1,"l","v"]], notes:["Unmittelbar zusammenhängende, verschiedenartige Aussparungen (z. B. Öffnung mit angrenzender Nische) werden getrennt gerechnet.","Maßgebend sind die Maße der verputzten bzw. belegten Oberfläche."] },
  "DIN 18350": { m2:[["ass","Öffnungen, Aussparungen, Nischen",2.5,"f","v"],["stab","Unterbrechungen durch stabförmige Bauteile (Breite)",0.3,"w","p"]], m:[["unt","Unterbrechungen",1,"l","v"]], notes:["Maßgebend sind die Maße der geputzten Oberfläche. Leibungen übermessener Öffnungen werden nicht gesondert gerechnet."] },
  "DIN 18352": { m2:[["oeff","Wandöffnungen (z. B. Türen, Fenster)",2.5,"f","v"],["stuetz","Stützen, Pfeiler (Grundfläche)",0.5,"f","v"],["ass","Aussparungen für Einbauteile",0.1,"f","v"]], m:[["unt","Unterbrechungen",1,"l","v"]] },
  "DIN 18353": { m2:[["ass","Aussparungen",0.1,"f","v"]], m:[["unt","Unterbrechungen",1,"l","v"]] },
  "DIN 18355": { m2:[["ass","Öffnungen, Aussparungen",2.5,"f","v"]], m:[["unt","Unterbrechungen",1,"l","p"]] },
  "DIN 18360": { m2:[["ass","Aussparungen",null,"f","p"]], m:[["unt","Unterbrechungen",1,"l","p"]] },
  "DIN 18363": { m2:[["wand","Öffnungen, Aussparungen, Nischen in Wänden und Decken",2.5,"f","v"],["boden","Aussparungen in Böden",0.5,"f","p"]], m:[["unt","Unterbrechungen",1,"l","p"]] },
  "DIN 18365": { m2:[["ass","Aussparungen",0.1,"f","p"]], m:[["unt","Unterbrechungen",1,"l","p"]] },
  "DIN 18379": { notes:["Keine Flächen-Übermessungsgrenzen hinterlegt – Einzelregelungen in Abschnitt 5 (Leitungslängen, Formstücke) beachten."] },
  "DIN 18380": { notes:["Keine Flächen-Übermessungsgrenzen hinterlegt – Einzelregelungen in Abschnitt 5 (Leitungslängen, Formstücke) beachten."] },
  "DIN 18381": { notes:["Keine Flächen-Übermessungsgrenzen hinterlegt – Einzelregelungen in Abschnitt 5 (Leitungslängen, Formstücke) beachten."] },
  "DIN 18382": { notes:["Keine Flächen-Übermessungsgrenzen hinterlegt – Einzelregelungen in Abschnitt 5 (Leitungslängen) beachten."] },
  "DIN 18459": { notes:["Keine Übermessungsgrenzen hinterlegt – Abrechnungsregeln der Leistungsbeschreibung und Abschnitt 5 beachten."] }
};
export const UEB_KIND: Record<UebKind, string> = { m3:"Raummaß (m³)", m2:"Flächenmaß (m²)", m:"Längenmaß (m)" };
export const UEB_GRUND: string[] = [
  "§ 14 Abs. 2 Satz 2 VOB/B: Die Abrechnungsbestimmungen der Technischen Vertragsbedingungen sind beim Aufmaß zu beachten. Die Übermessungsregeln selbst stehen in VOB/C, Abschnitt 5 der jeweiligen ATV.",
  "Rangfolge nach § 1 Abs. 2 VOB/B: Regelungen der Leistungsbeschreibung (z. B. „Öffnungen werden abgezogen“) gehen der ATV vor.",
  "Maßgebend ist die Einzelgröße jeder Aussparung; bei Öffnungen die jeweils kleinsten Maße. Bis einschließlich Grenzwert wird übermessen, darüber abgezogen.",
  "Übermessen heißt: Die Fläche wird so gerechnet, als sei keine Aussparung vorhanden. Der Mehraufwand für das Anarbeiten ist damit abgegolten, soweit die ATV nichts anderes regelt.",
  "Anzuwenden ist die bei Vertragsschluss vereinbarte Fassung der VOB/C (Gesamtausgabe 2019, ATV-Ergänzungsband 2023). Werte mit dem Vermerk „abgleichen“ vor Verwendung im Prüfvermerk mit dem Normtext prüfen."
];

export function unitKind(eh: string | null | undefined): UebKind | null {
  const s = String(eh || "").toLowerCase().replace(/\s|\./g, "");
  if (/^(m2|m²|qm)$/.test(s)) return "m2";
  if (/^(m3|m³|cbm)$/.test(s)) return "m3";
  if (/^(m|lfm|lfdm|lm|mtr)$/.test(s)) return "m";
  return null;
}

export const uebKey = (atv: string, kind: UebKind, id: string): string => `${atv}|${kind}|${id}`;

export interface UebRule { id: string; lbl: string; g: number | null; def: number | null; mode: UebMode; st: "v" | "p"; ovr: boolean; key: string }

/** Übermessungsregeln einer ATV, mit projektbezogenen Abweichungen aus p.ueb. */
export function uebRules(p: Pick<Project, "ueb"> | null, atv: string, kind: UebKind): UebRule[] {
  const d = UEB[atv];
  const rows = d && d[kind];
  if (!rows) return [];
  const o = (p && p.ueb) || {};
  return rows.map(([id, lbl, g, mode, st]) => {
    const k = uebKey(atv, kind, id);
    const ov = o[k];
    const has = ov !== undefined && ov !== "" && ov !== null;
    return { id, lbl, g: has ? num(ov) : g, def: g, mode, st, ovr: has, key: k };
  });
}

export const fmtF = (v: NumIn): string => fmtIn(v, 3);

export interface UebItem { bez: string; a: string; b: string; c: string; n: NumIn; r: string }
export interface UebItemResult { a: number; b: number; c: number; n: number; size: number; deduct: number; ab: boolean; ok: boolean; missing: boolean; unitS: string }

/** Eine Öffnung/Aussparung: Einzelgröße bestimmen und gegen den Grenzwert prüfen. */
export function uebItemCalc(kind: UebKind, rule: UebRule | undefined, it: UebItem): UebItemResult {
  const a = num(evalExpr(it.a)), b = num(evalExpr(it.b)), c = num(evalExpr(it.c)), n = Math.max(1, num(it.n) || 1);
  let size: number, deduct: number, unitS: string;
  if (kind === "m") { size = a; deduct = n * a; unitS = "m"; }
  else if (kind === "m2") { deduct = n * a * b; if (rule && rule.mode === "w") { size = a; unitS = "m"; } else { size = a * b; unitS = "m²"; } }
  else { deduct = n * a * b * c; if (rule && rule.mode === "q") { size = a * b; unitS = "m³/m"; } else { size = a * b * c; unitS = "m³"; } }
  const ok = size > 0;
  const missing = !rule || rule.g == null;
  const ab = ok && !missing && size > (rule!.g as number) + 1e-9;
  return { a, b, c, n, size, deduct: ab ? deduct : 0, ab, ok, missing, unitS };
}

export interface UebInput { kind: UebKind; brutto: string; items: UebItem[] }

/** Übermessungsrechner: Bruttoformel + Aussparungen → Nettoformel und Prüfbemerkung. */
export function uebResult(p: Pick<Project, "ueb" | "atv">, m: UebInput) {
  const rules = uebRules(p, p.atv, m.kind);
  const items = m.items.map(it => {
    const rule = rules.find(r => r.id === it.r) || rules[0];
    return { it, rule, ...uebItemCalc(m.kind, rule, it) };
  });
  const brutto = evalExpr(m.brutto);
  const abz = items.reduce((s, x) => s + x.deduct, 0);
  const terms = items.filter(x => x.ab).map(x => {
    const dims = m.kind === "m" ? [x.a] : m.kind === "m2" ? [x.a, x.b] : [x.a, x.b, x.c];
    return "-" + (x.n > 1 ? x.n + "*" : "") + dims.map(fmtF).join("*");
  });
  const base = String(m.brutto || "").trim();
  const formel = base ? base + terms.join("") : "";
  const netto = formel ? evalExpr(formel) : null;
  const unitL = m.kind === "m" ? "m" : m.kind === "m2" ? "m²" : "m³";
  const desc = (x: (typeof items)[number]) => `${x.it.bez || x.rule?.lbl || "Aussparung"}${x.n > 1 ? " " + x.n + "×" : ""} ${fmtN(x.size, 3)} ${x.unitS}`;
  const abList = items.filter(x => x.ok && x.ab).map(x => `${desc(x)} (> ${fmtN(x.rule!.g, 3)})`);
  const ubList = items.filter(x => x.ok && !x.ab && !x.missing).map(x => `${desc(x)} (≤ ${fmtN(x.rule!.g, 3)})`);
  const bem = `Übermessung nach Abschn. 5 ATV ${p.atv}${abList.length ? "; abgezogen: " + abList.join(", ") : ""}${ubList.length ? "; übermessen: " + ubList.join(", ") : ""}`;
  return { rules, items, brutto, abz, formel, netto, unitL, bem, missing: items.some(x => x.ok && x.missing) };
}
