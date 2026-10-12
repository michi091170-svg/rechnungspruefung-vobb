import { ensureSic, newProject, sampleProject, sicCalc, sicHints, uid, type Buergschaft } from "../src/core";

const buergschaft = (o: Partial<Buergschaft> = {}): Buergschaft => ({
  id: uid(), buerge: "Bank", nr: "1", datum: "", eingang: "", betrag: 5000, befristetBis: "", status: "liegt vor",
  rueckgabe: "", selbstschuldnerisch: true, erstesAnfordern: false, verz770: false, tauglich: true, original: true, bem: "", ...o,
});

describe("Vertragserfüllungssicherheit", () => {
  it("§ 650m Abs. 2 BGB: 5 % beim Verbraucherbauvertrag", () => {
    const p = sampleProject();
    Object.assign(ensureSic(p), { verbraucher: true, vbv: true, vereinbart: false });
    const K = sicCalc(p);
    expect(K.p650m).toBe(true);
    expect(K.soll).toBe(Math.round(K.urspr * 5) / 100);
  });

  it("über 10 % in AGB des Auftraggebers ist unangemessen (§ 307 BGB)", () => {
    const p = newProject();
    Object.assign(ensureSic(p), { verbraucher: false, vbv: false, vereinbart: true, klausel: "agb", satz: 12 });
    expect(sicHints(p, sicCalc(p)).some(([l, t]) => l === "cut" && t.includes("§ 307 BGB"))).toBe(true);
  });

  it("VOB/B: keine Bürgschaft auf erstes Anfordern, keine Befristung (§ 17 Abs. 4)", () => {
    const p = newProject();
    const s = Object.assign(ensureSic(p), { verbraucher: false, vbv: false, vereinbart: true });
    s.buergschaften.push(buergschaft({ erstesAnfordern: true, befristetBis: "2030-01-01" }));
    const H = sicHints(p, sicCalc(p)).filter(([l]) => l === "cut").map(([, t]) => t);
    expect(H.some(t => t.includes("erstes Anfordern"))).toBe(true);
    expect(H.some(t => t.includes("nicht auf bestimmte Zeit"))).toBe(true);
  });
});
