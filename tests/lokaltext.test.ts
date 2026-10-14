import { aufmassAusText, auftragAusText, nachtragAusText, parsePositionen, rechnungAusText, type TextSeite } from "../src/core";

const seite = (...zeilen: string[]): TextSeite => ({ zeilen: zeilen.map((text, k) => ({ id: `S1Z${k + 1}`, text })) });

describe("Positionszeilen ohne KI", () => {
  it("liest OZ, Text, Menge, EH, EP und Betrag und prüft Menge × EP", () => {
    const [p] = parsePositionen([seite("02.010   Mauerwerk KS 17,5 cm   250,00   m²   58,40   14.600,00")]);
    expect(p).toMatchObject({ zeile: "S1Z1", oz: "02.010", text: "Mauerwerk KS 17,5 cm", eh: "m²", menge: 250, ep: 58.4, betrag: 14600, stimmig: true });
  });
  it("löst die von der Texterkennung verlesene Einheit über das LV auf", () => {
    const [p] = parsePositionen([seite("02.020   Stahlbetondecke C25/30   84,50   m}   312,00   26.364,00")], [{ oz: "2.20", eh: "m³" }]);
    expect(p).toMatchObject({ eh: "m³", menge: 84.5, ep: 312, betrag: 26364, stimmig: true });
    expect(p.ehGeschaetzt).toBeUndefined();
  });
  it("liest hochgestellte Einheiten, die die Texterkennung als „m?2“ ausgibt", () => {
    expect(parsePositionen([seite("02.010 Mauerwerk KS 17,5 cm 300,00 m?2 58,40 17.520,00")])[0]).toMatchObject({ eh: "m²", menge: 300, stimmig: true });
  });
  it("schätzt m³ ohne LV nur bei Volumenleistungen und kennzeichnet das", () => {
    const [p] = parsePositionen([seite("02.020 Ortbeton Decke 84,50 m? 312,00 26.364,00")]);
    expect(p).toMatchObject({ eh: "m³", ehGeschaetzt: true });
  });
  it("findet bei Zusatzspalten (LV-Menge, kumulierte Menge) die stimmige Kombination", () => {
    const [p] = parsePositionen([seite("01.0030 Bodenaushub BK 3-5 300,000 m³ 210,000 18,50 3.885,00")]);
    expect(p).toMatchObject({ menge: 210, ep: 18.5, betrag: 3885, stimmig: true });
  });
  it("nimmt Beträge aus der Folgezeile, wenn der Text umbricht", () => {
    const ps = parsePositionen([seite("1.2.10 Innenputz Kalkzement einlagig,", "Wände, geglättet 812,40 m2 14,20 11.536,08")]);
    expect(ps[0]).toMatchObject({ oz: "1.2.10", eh: "m²", menge: 812.4, ep: 14.2, betrag: 11536.08, zeile: "S1Z2" });
    expect(ps[0].text).toContain("Wände, geglättet");
  });
  it("ignoriert Datum, Summen- und Steuerzeilen", () => {
    expect(parsePositionen([seite("14.10.2026 Rechnung über Leistungen 3", "01 Summe Titel Rohbau 40.964,00", "19 % MwSt 7.783,16")])).toEqual([]);
  });
});

describe("Rechnung ohne KI", () => {
  it("liest Kopf und Summen", () => {
    const r = rechnungAusText([seite("Musterbau GmbH", "3. Abschlagsrechnung", "Rechnungsdatum: 01.07.2026", "02.010 Mauerwerk 250,00 m² 58,40 14.600,00", "Nettosumme 14.600,00", "zzgl. 19 % MwSt 2.774,00", "Bruttobetrag 17.374,00", "abzgl. Abschlagszahlungen 10.000,00", "Zahlbetrag 7.374,00")]);
    expect(r.rechnung).toEqual({ nr: "3. AR", art: "Abschlagsrechnung", datum: "2026-07-01", zahlbetrag: 7374 });
    expect(r.summen.map(s => [s.art, s.wert])).toEqual([["netto", 14600], ["brutto", 17374], ["zahlbetrag", 7374]]);
    expect(r.zeilen).toHaveLength(1);
  });
});

describe("Auftrag ohne KI", () => {
  it("übernimmt nur eindeutige Vertragsangaben", () => {
    const a = auftragAusText([seite("Bauvorhaben: Kita Sonnenschein, Neubau", "Vergabe-Nr.: 2026-117", "Auftragsschreiben vom 12.03.2026", "Die VOB/B ist Vertragsbestandteil.", "Auftragssumme netto 248.300,00 €", "Skonto: 2 % bei Zahlung innerhalb von 14 Kalendertagen", "Sicherheitseinbehalt 5 % je Abschlagsrechnung", "01.010 Baustelleneinrichtung 1 psch 12.500,00 12.500,00")]);
    expect(a.vertrag).toMatchObject({ projekt: "Kita Sonnenschein, Neubau", vergabe_nr: "2026-117", auftragsdatum: "2026-03-12", vob_b_vereinbart: true, auftragssumme_netto: 248300, skonto_vereinbart: true, skonto_prozent: 2, skonto_tage: 14, sicherheitseinbehalt_prozent: 5, nachlass_prozent: null, auftraggeber: null });
    expect(a.positionen[0]).toMatchObject({ oz: "01.010", eh: "psch", menge: 1, ep: 12500 });
  });
  it("setzt VOB/B nicht, wenn sie nur erwähnt wird", () => {
    expect(auftragAusText([seite("Hinweis zu § 16 VOB/B Abs. 3")]).vertrag.vob_b_vereinbart).toBeNull();
  });
});

describe("Aufmaß ohne KI", () => {
  it("liest Rechenansätze, Ergebnisse und Abzüge je Position", () => {
    const a = aufmassAusText([seite("Aufmaßblatt Nr. 3", "Pos. 02.010 Mauerwerk KS", "EG Achse A–C 12,50 x 2,75 = 34,375 m²", "Abzug Tür 1,01 x 2,13 = 2,151 m²", "Übertrag 32,224")]);
    expect(a.zeilen).toEqual([
      { blatt: "3", oz: "02.010", lv_oz: null, ort: "Mauerwerk KS EG Achse A–C".replace("Mauerwerk KS ", ""), ansatz: "12,50 x 2,75", ergebnis: 34.375, eh: "m²" },
      { blatt: "3", oz: "02.010", lv_oz: null, ort: "Abzug Tür", ansatz: "1,01 x 2,13", ergebnis: -2.151, eh: "m²" },
    ]);
  });
});

describe("Nachtrag ohne KI", () => {
  it("liest Nummer, Betreff, Grundlage und Summe", () => {
    const n = nachtragAusText([seite("Nachtragsangebot Nr. 3", "Datum: 02.09.2026", "Betreff: Zusätzliche Kernbohrungen Decke über EG", "Mehrkostenanzeige vom 20.08.2026", "N03.010 Kernbohrung DN 150 12 St 145,00 1.740,00", "Summe netto 1.740,00")]);
    expect(n.nachtrag).toMatchObject({ nr: "NT 03", titel: "Zusätzliche Kernbohrungen Decke über EG", datum: "2026-09-02", anzeige_datum: "2026-08-20", grundlage: "2-6", summe_netto: 1740 });
    expect(n.positionen[0]).toMatchObject({ oz: "N03.010", eh: "St", menge: 12, ep: 145 });
  });
});
