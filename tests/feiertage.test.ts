import { addWerktage, feiertagName, ostersonntag, shiftFrist } from "../src/core";

describe("Feiertage (§ 193 BGB)", () => {
  it("berechnet Ostersonntag", () => {
    expect(ostersonntag(2026)).toBe("2026-04-05");
    expect(ostersonntag(2027)).toBe("2027-03-28");
    expect(ostersonntag(2000)).toBe("2000-04-23");
  });

  it("kennt bundeseinheitliche und Landesfeiertage", () => {
    expect(feiertagName("2026-04-03")).toBe("Karfreitag");
    expect(feiertagName("2026-05-14")).toBe("Christi Himmelfahrt");
    expect(feiertagName("2026-06-04", "BY")).toBe("Fronleichnam");
    expect(feiertagName("2026-06-04", "NI")).toBeUndefined();
    expect(feiertagName("2026-10-31", "NI")).toBe("Reformationstag");
    expect(feiertagName("2017-10-31", "NI")).toBeUndefined();
    expect(feiertagName("2026-11-18", "SN")).toBe("Buß- und Bettag");
    expect(feiertagName("2026-03-08", "BE")).toBe("Internationaler Frauentag");
  });

  it("verschiebt Fristende über Wochenende und Feiertag", () => {
    // Do 2.4.2026 → Karfreitag, Sa, So, Ostermontag → Di 7.4.
    expect(shiftFrist("2026-04-03")).toEqual({ d: "2026-04-07", shifted: true, grund: "Karfreitag, Samstag, Sonntag, Ostermontag" });
    // Sa 3.10.2026: Samstag und Feiertag → Mo 5.10.
    expect(shiftFrist("2026-10-03").d).toBe("2026-10-05");
    // Fronleichnam nur im Land
    expect(shiftFrist("2026-06-04", "NW").d).toBe("2026-06-05");
    expect(shiftFrist("2026-06-04", "HH").shifted).toBe(false);
  });

  it("zählt Werktage ohne Sonn- und Feiertage", () => {
    expect(addWerktage("2026-03-02", 18)).toBe("2026-03-23");
    // Über Ostern 2026: Do 2.4. (1), Karfreitag –, Sa 4.4. (2), So –, Ostermontag –, Di 7.4. (3)
    expect(addWerktage("2026-04-01", 3)).toBe("2026-04-07");
  });
});
