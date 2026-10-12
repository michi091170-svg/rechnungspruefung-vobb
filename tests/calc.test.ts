import { calcAll, migrateProject, newProject, sampleProject, uid, type Project } from "../src/core";

const hints = (p: Project, i: number) => calcAll(p).out[i].hints.map(h => `${h.lvl}: ${h.t}`);

describe("Beispielprojekt – Referenzwerte (Golden Master)", () => {
  // Werte aus der veröffentlichten App, Stand 12.10.2026; jede Abweichung ist eine fachliche Änderung.
  const C = calcAll(sampleProject());

  it("Auftragssummen", () => {
    expect(C.auftragNetto).toBe(81290);
    expect(C.ntBeauftragt).toBe(2280);
    expect(C.auftragBrutto).toBe(96972.04);
  });

  it("1. Abschlagsrechnung", () => {
    const r = C.out[0];
    expect(r.sumGP).toBe(30099.36);
    expect(r.cGP.brutto).toBe(34926.36);
    expect(r.se).toBe(3492.64);
    expect(r.zahlbetrag).toBe(31433.72);
    expect(r.skonto).toBe(943.01);
    expect(r.auszMit).toBe(30490.71);
    expect(r.anrechnung).toBe(31433.72);
  });

  it("2. Abschlagsrechnung kumuliert", () => {
    const r = C.out[1];
    expect(r.sumGP).toBe(65239.8);
    expect(r.cGP.nl).toBe(1304.8);
    expect(r.cGP.brutto).toBe(75702.23);
    expect(r.se).toBe(7570.22);
    expect(r.vor).toBe(31433.72);
    expect(r.zahlbetrag).toBe(36698.29);
    expect(r.auszMit).toBe(35597.34);
  });

  it("erkennt nicht beauftragte Nachtragspositionen", () => {
    const r = C.out[1];
    const row = r.rows.find(x => x.pos.oz === "N02.001")!;
    expect(row.ntOk).toBe(false);
    expect(row.bGP).toBe(0);
    expect(r.hints.some(h => h.lvl === "cut" && h.t.includes("NT 02"))).toBe(true);
  });
});

/** Beispielprojekt mit den Voreinstellungen eines neuen Projekts (nur Nachlass 2 % wie im Beispiel). */
function mitNeuenVoreinstellungen(): Project {
  const s = sampleProject();
  return { ...newProject(), positions: s.positions, nachtraege: s.nachtraege, rechnungen: s.rechnungen, nachlass: 2 };
}

describe("Voreinstellungen neuer Projekte", () => {
  it("sind Skonto, Sicherheitsleistung und Nachlass auf Nachträge aus", () => {
    const p = newProject();
    expect(p.skontoVereinbart).toBe(false);
    expect(p.seVereinbart).toBe(false);
    expect(p.nachlassNT).toBe(false);
  });

  it("setzen ohne Vereinbarung keinen Sicherheitseinbehalt an (§ 17 Abs. 1 Nr. 1 VOB/B)", () => {
    const r = calcAll(mitNeuenVoreinstellungen()).out[0];
    expect(r.se).toBe(0);
    expect(r.seLabel).toContain("nicht vereinbart");
  });

  it("ziehen ohne Vereinbarung kein Skonto (§ 16 Abs. 5 Nr. 2 VOB/B)", () => {
    const p = mitNeuenVoreinstellungen();
    const r = calcAll(p).out[0];
    expect(r.skontoMoeglich).toBe(false);
    expect(r.skonto).toBe(0);
    // Das Beispiel hat bei der 1. AR Skonto gezogen: ohne Vereinbarung fällt das als Minderzahlung auf.
    expect(hints(p, 0).some(h => h.startsWith("warn: Minderzahlung"))).toBe(true);
  });

  it("wenden den Nachlass nur auf den Hauptauftrag an", () => {
    const r = calcAll(mitNeuenVoreinstellungen()).out[1];
    // (65.239,80 − 2.280,00 Nachtrag) × 2 %
    expect(r.cGP.nl).toBe(1259.2);
  });
});

describe("Kürzungskette und Steuern", () => {
  it("Bauabzugsteuer 15 % ohne Freistellungsbescheinigung (§ 48 EStG)", () => {
    const p = sampleProject();
    p.freistellung = false;
    const r = calcAll(p).out[1];
    expect(r.baOhne).toBe(Math.round(r.zahlbetrag * 15) / 100);
    expect(hints(p, 1).some(h => h.includes("§ 48b EStG"))).toBe(true);
  });

  it("keine Umsatzsteuer bei § 13b UStG", () => {
    const p = sampleProject();
    p.rc13b = true;
    const r = calcAll(p).out[0];
    expect(r.cGP.ust).toBe(0);
    expect(r.cGP.brutto).toBe(r.cGP.n2);
  });

  it("Skonto nach Fristablauf ist unberechtigt", () => {
    const p = sampleProject();
    p.rechnungen[0].zahlDatum = "2026-07-30";
    expect(hints(p, 0).some(h => h.startsWith("cut: Skonto unberechtigt"))).toBe(true);
  });

  it("meldet Überzahlungen", () => {
    const p = sampleProject();
    p.rechnungen[1].aufmass = {};
    const r = calcAll(p).out[1];
    expect(r.zahlbetrag).toBeLessThan(0);
    expect(r.hints.some(h => h.lvl === "cut" && h.t.startsWith("Überzahlung"))).toBe(true);
  });

  it("weist auf Mengenüberschreitung > 10 % hin (§ 2 Abs. 3 VOB/B)", () => {
    const p = sampleProject();
    const m24 = p.positions.find(x => x.oz === "02.020")!;
    p.rechnungen[1].aufmass[m24.id] = { an: 300, gp: 300 };
    expect(hints(p, 1).some(h => h.includes("§ 2 Abs. 3 Nr. 2"))).toBe(true);
  });

  it("Abzug unter der Übermessungsgrenze wird als angreifbar markiert", () => {
    const p = sampleProject(); // ATV DIN 18330, Wandöffnungen ≤ 2,5 m² übermessen
    const m17 = p.positions.find(x => x.oz === "02.010")!;
    p.rechnungen[1].aufmass[m17.id] = { an: 100, formel: "10*10-1,01*2,13" };
    expect(hints(p, 1).some(h => h.startsWith("warn:") && h.includes("Übermessungsgrenze"))).toBe(true);
  });
});

describe("Sicherungen aus älteren Versionen", () => {
  it("behalten das bisherige Rechenverhalten", () => {
    const alt = JSON.parse(JSON.stringify(sampleProject()));
    delete alt.nachlassNT; delete alt.seVereinbart; delete alt.skontoAbschlag;
    const p = migrateProject(alt);
    expect(p.nachlassNT).toBe(true);
    expect(p.seVereinbart).toBe(true);
    expect(calcAll(p).out[1].zahlbetrag).toBe(36698.29);
  });

  it("ergänzen fehlende Felder", () => {
    const p = migrateProject({ id: uid(), positions: [], nachtraege: [], rechnungen: [] });
    expect(p.fristAbschlag).toBe(21);
    expect(p.fristSchluss).toBe(30);
  });
});
