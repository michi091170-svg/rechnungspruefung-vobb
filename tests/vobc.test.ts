import { uebResult, uebRules, unitKind } from "../src/core";

describe("Übermessung nach Abschnitt 5 ATV", () => {
  const p = { atv: "DIN 18350", ueb: {} };

  it("zieht Öffnungen über 2,5 m² ab und übermisst kleinere", () => {
    const r = uebResult(p, {
      kind: "m2",
      brutto: "10*3",
      items: [
        { bez: "Fenster", a: "1,01", b: "2,13", c: "", n: 1, r: "ass" }, // 2,151 m² → übermessen
        { bez: "Tor", a: "2", b: "2,5", c: "", n: 1, r: "ass" }, //        5,0 m²   → abziehen
      ],
    });
    expect(r.formel).toBe("10*3-2*2,5");
    expect(r.netto).toBe(25);
    expect(r.bem).toContain("abgezogen: Tor");
    expect(r.bem).toContain("übermessen: Fenster");
  });

  it("wertet den Grenzwert einschließlich (≤) als übermessen", () => {
    const r = uebResult(p, { kind: "m2", brutto: "20", items: [{ bez: "", a: "1", b: "2,5", c: "", n: 1, r: "ass" }] });
    expect(r.netto).toBe(20);
  });

  it("verwendet projektbezogene Grenzwerte", () => {
    const rules = uebRules({ ueb: { "DIN 18350|m2|ass": 1 } }, "DIN 18350", "m2");
    expect(rules.find(r => r.id === "ass")).toMatchObject({ g: 1, def: 2.5, ovr: true });
  });

  it("erkennt Abrechnungseinheiten", () => {
    expect(unitKind("m²")).toBe("m2");
    expect(unitKind("qm")).toBe("m2");
    expect(unitKind("m3")).toBe("m3");
    expect(unitKind("lfm")).toBe("m");
    expect(unitKind("St")).toBeNull();
  });
});
