import { mergeSync, migrateProject, newProject, SCHEMA_VERSION } from "../src/core";
import type { Project } from "../src/core";

const proj = (id: string, name: string, updated: number, synced?: number): Project =>
  Object.assign(newProject(name), { id, updated, synced });

describe("Abgleich mit dem Kontospeicher", () => {
  it("übernimmt den jüngeren Stand ohne Konflikt", () => {
    const r = mergeSync([proj("a", "A", 200, 100)], [proj("a", "A", 100)]);
    expect(r.projects.find(p => p.id === "a")!.updated).toBe(200);
    expect(r.push).toEqual(["a"]);
    expect(r.conflicts).toEqual([]);
  });

  it("übernimmt den Kontostand, wenn lokal nichts geändert wurde", () => {
    const r = mergeSync([proj("a", "A", 100, 100)], [proj("a", "A neu", 300)]);
    expect(r.projects).toHaveLength(1);
    expect(r.projects[0].name).toBe("A neu");
    expect(r.projects[0].synced).toBe(300);
    expect(r.push).toEqual([]);
  });

  it("legt bei Änderungen auf beiden Seiten eine Kopie an statt zu überschreiben", () => {
    const r = mergeSync([proj("a", "A", 250, 100)], [proj("a", "A", 300)], 999, () => "kopie");
    expect(r.projects.map(p => p.id).sort()).toEqual(["a", "kopie"]);
    expect(r.projects.find(p => p.id === "a")!.updated).toBe(300);
    expect(r.projects.find(p => p.id === "kopie")!.name).toContain("Konflikt-Kopie");
    expect(r.push).toEqual(["kopie"]);
    expect(r.conflicts).toHaveLength(1);
  });

  it("lädt neue lokale Projekte hoch", () => {
    const r = mergeSync([proj("b", "B", 50)], []);
    expect(r.push).toEqual(["b"]);
  });
});

describe("Schemaversion", () => {
  it("neue Projekte tragen die aktuelle Version", () => {
    expect(newProject().schema).toBe(SCHEMA_VERSION);
  });
  it("aktuelle Projekte bleiben bei der Migration unverändert", () => {
    const p = newProject("X");
    expect(migrateProject(p)).toBe(p);
  });
});
