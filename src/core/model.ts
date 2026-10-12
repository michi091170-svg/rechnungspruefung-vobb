import { uid } from "./format";
import type { Nachtrag, Position, Project, Rechnung, Sicherheit } from "./types";

export const GRUNDLAGEN: [string, string][] = [
  ["2-3","§ 2 Abs. 3 VOB/B – Mengenänderung > 10 %"],
  ["2-5","§ 2 Abs. 5 VOB/B – geänderte Leistung (§ 1 Abs. 3)"],
  ["2-6","§ 2 Abs. 6 VOB/B – zusätzliche Leistung (§ 1 Abs. 4)"],
  ["2-8","§ 2 Abs. 8 VOB/B – Leistung ohne Auftrag"],
  ["2-9","§ 2 Abs. 9 VOB/B – verlangte Zeichnungen/Berechnungen"],
  ["6-6","§ 6 Abs. 6 VOB/B – Behinderung (Schadensersatz)"],
  ["sonst","sonstige Grundlage"]
];
export const NT_STATUS: string[] = ["angekündigt","Angebot eingegangen","in Prüfung","beauftragt","abgelehnt","zurückgestellt"];
export const INV_STATUS: string[] = ["eingegangen","in Prüfung","geprüft","freigegeben","bezahlt"];
export const INV_ART: string[] = ["Abschlagsrechnung","Teilschlussrechnung","Schlussrechnung"];

/** Voreinstellungen neuer Projekte: Skonto und Sicherheitsleistung nur nach ausdrücklicher Vereinbarung. */
export function newProject(name?: string): Project {
  return { id: uid(), name: name || "Neues Projekt", ag:"", an:"", ort:"", vergabeNr:"", bauleiter:"", atv:"DIN 18299", vertragsdatum:"", abnahme:"",
    ust:19, rc13b:false, nachlass:0, nachlassNT:false, umlage:0, umlageText:"Bauwasser / Baustrom / Bauleistungsversicherung",
    seVereinbart:false, seSatz:5, seDeckel:0, seBuergschaft:false, gwSatz:3, gwBuergschaft:false,
    skontoVereinbart:false, skontoSatz:3, skontoTage:14, skontoAbschlag:false,
    fristAbschlag:21, fristSchluss:30, freistellung:true, freistellungBis:"",
    positions:[], nachtraege:[], rechnungen:[], updated: Date.now() };
}

/* Altprojekte ohne diese Felder behalten das bisherige Rechenverhalten */
export const nlNT = (p: Pick<Project, "nachlassNT">): boolean => p.nachlassNT !== false;
export const seOn = (p: Pick<Project, "seVereinbart">): boolean => p.seVereinbart !== false;

export function ensureSic(p: Project): Sicherheit {
  p.sicherheit = p.sicherheit || { verbraucher: null, vbv: null, vereinbart: null, klausel: "agb", satz: 5, basis: "brutto", zweckMaengel: false, fristAnf: "", buergschaften: [], forderungen: [], hauptschuldnerGemahnt: "", konto: "" };
  const s = p.sicherheit;
  s.buergschaften = s.buergschaften || [];
  s.forderungen = s.forderungen || [];
  return s;
}

/**
 * Projekt aus einer Sicherung übernehmen. Fehlende Felder werden mit den Voreinstellungen ergänzt;
 * Felder, die es in älteren Versionen noch nicht gab, erhalten das damalige Verhalten.
 */
export function migrateProject(pr: Partial<Project> & { id: string }): Project {
  return Object.assign(newProject(), { nachlassNT: true, seVereinbart: true, skontoAbschlag: true }, pr) as Project;
}

export function sampleProject(): Project {
  const p = newProject("Beispiel: Neubau Kita Lindenweg – Rohbau");
  Object.assign(p, {ag:"Stadt Musterstadt, Hochbauamt", an:"Muster Bau GmbH", ort:"Lindenweg 12, 12345 Musterstadt", vergabeNr:"HBA-2026-014", bauleiter:"", atv:"DIN 18330", vertragsdatum:"2026-03-02", nachlass:2, nachlassNT:true, umlage:0.5,
    seVereinbart:true, seSatz:10, gwSatz:5, skontoVereinbart:true, skontoAbschlag:true});
  const P = (oz: string, text: string, eh: string, menge: number, ep: number, nt = ""): Position => ({id:uid(),oz,text,eh,menge,ep,nt});
  const n1: Nachtrag = {id:uid(), nr:"NT 01", titel:"Zusätzliche Wandöffnungen EG", grundlage:"2-6", anzeige:"2026-05-04", angebotDatum:"2026-05-08", angebot:2580, geprueft:2280, status:"beauftragt", bem:"Beauftragt per Schreiben AG vom 14.05.2026"};
  const n2: Nachtrag = {id:uid(), nr:"NT 02", titel:"Deckenstärke 22 cm statt 20 cm", grundlage:"2-5", anzeige:"2026-05-20", angebotDatum:"2026-05-27", angebot:1400, geprueft:0, status:"in Prüfung", bem:"Preisermittlung (Urkalkulation) angefordert"};
  p.nachtraege = [n1, n2];
  p.positions = [
    P("01.001","Baustelleneinrichtung","psch",1,4500), P("02.010","Mauerwerk KS 17,5 cm","m²",420,58.4), P("02.020","Mauerwerk KS 24 cm","m²",260,71.2),
    P("03.010","Stahlbeton Decke C25/30, d = 20 cm","m³",85,235), P("03.020","Betonstahl B500B liefern und verlegen","t",9.5,1450),
    P("N01.001","Wandöffnung herstellen inkl. Sturz","St",6,380,n1.id), P("N02.001","Mehrdicke Decke 2 cm","m³",4,250,n2.id)
  ];
  const [bs,m17,m24,dec,bst,no1,no2] = p.positions.map(x=>x.id);
  const r1: Rechnung = {id:uid(), nr:"1. AR", art:"Abschlagsrechnung", datum:"2026-06-02", eingang:"2026-06-05", forderung:32150, pruefdatum:"2026-06-10", gemAufmass:true, status:"bezahlt",
    aufmass:{[bs]:{an:0.5,gp:0.5},[m17]:{an:250,gp:236.4,blatt:"AB 1–3"},[dec]:{an:62,formel:"12,5*8,4*0,20*2+14,8*6*0,2",gp:59.76,blatt:"AB 4",bem:"Aussparungen abgezogen (ATV DIN 18331 Abs. 5)"}},
    maengel:0, sonst:0, sonstText:"", zahlDatum:"2026-06-15", zahlBetrag:30490.71, skontoGezogen:true, bem:""};
  const r2: Rechnung = {id:uid(), nr:"2. AR", art:"Abschlagsrechnung", datum:"2026-07-03", eingang:"2026-07-06", forderung:"", pruefdatum:"", gemAufmass:false, status:"in Prüfung",
    aufmass:{[bs]:{an:0.8,gp:0.75},[m17]:{an:410,gp:402.5,blatt:"AB 1–6"},[m24]:{an:180,gp:171,blatt:"AB 7"},[dec]:{an:62,formel:"12,5*8,4*0,20*2+14,8*6*0,2",gp:59.76,blatt:"AB 4"},[bst]:{an:7.2,gp:6.8,blatt:"Stahlliste 1–3"},[no1]:{an:6,gp:6},[no2]:{an:4,gp:4}},
    maengel:0, sonst:0, sonstText:"", zahlDatum:"", zahlBetrag:"", skontoGezogen:false, bem:""};
  p.rechnungen = [r1, r2];
  return p;
}
