import { addWerktage, daysBetween, fmtD, num, shiftWeekend, toISODate, yearEnd3 } from "../src/core";

describe("num – deutsche Zahleneingabe", () => {
  it.each([
    ["1.234,56", 1234.56],
    ["1234,5", 1234.5],
    ["1.234", 1234],
    ["1234.56", 1234.56],
    ["12 €", 12],
    ["-3,5", -3.5],
    ["", 0],
    ["abc", 0],
    [null, 0],
    [7, 7],
  ])("%s → %s", (v, out) => expect(num(v as never)).toBe(out));
});

describe("Fristen", () => {
  it("verschiebt ein Fristende am Samstag auf Montag (§ 193 BGB)", () => {
    expect(shiftWeekend("2026-07-25")).toEqual({ d: "2026-07-27", shifted: true });
  });
  it("verschiebt ein Fristende am Sonntag auf Montag", () => {
    expect(shiftWeekend("2026-07-26")).toEqual({ d: "2026-07-27", shifted: true });
  });
  it("lässt Werktage unverändert", () => {
    expect(shiftWeekend("2026-07-24")).toEqual({ d: "2026-07-24", shifted: false });
  });
  it("zählt Samstage als Werktage (§ 17 VOB/B, 18 Werktage)", () => {
    // Mo 02.03.2026 + 18 Werktage (Mo–Sa) = Mo 23.03.2026
    expect(addWerktage("2026-03-02", 18)).toBe("2026-03-23");
  });
  it("berechnet Tagesdifferenzen", () => expect(daysBetween("2026-06-05", "2026-06-26")).toBe(21));
  it("Regelverjährung endet am 31.12. des dritten Folgejahres", () => expect(yearEnd3("2026-05-14")).toBe("2029-12-31"));
});

describe("Datumsformate", () => {
  it("liest TT.MM.JJJJ und TT.MM.JJ", () => {
    expect(toISODate("05.06.2026")).toBe("2026-06-05");
    expect(toISODate("5.6.26")).toBe("2026-06-05");
    expect(toISODate("2026-06-05")).toBe("2026-06-05");
    expect(toISODate("32.01.2026")).toBeNull();
  });
  it("formatiert ISO als TT.MM.JJJJ", () => expect(fmtD("2026-06-05")).toBe("05.06.2026"));
});
