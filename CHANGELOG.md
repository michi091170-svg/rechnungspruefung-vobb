# Änderungen

## 1.0.0 – 2026-10-12

- Code-Repository aus dem bisherigen Einzeldatei-Artifact aufgebaut: Rechenkern in TypeScript-Module ausgelagert, Unit-Tests, Build zur Einzeldatei, CI.
- Neue Projekte: Skonto standardmäßig nicht vereinbart (§ 16 Abs. 5 Nr. 2 VOB/B).
- Sicherheitseinbehalt nur bei vereinbarter Sicherheitsleistung (§ 17 Abs. 1 Nr. 1 VOB/B); Schalter wird mit dem Reiter Vertragserfüllungsbürgschaft abgeglichen. Voreinstellung 5 % / 3 % entsprechend § 9c Abs. 2 VOB/A.
- Schalter „Nachlass gilt auch für Nachtragsleistungen“; Voreinstellung nein. Ausweis im Prüfergebnis und Prüfvermerk.
- Prüfvermerk nennt die angewandten Konditionen (Skonto, Sicherheit, Nachlass).
- Skonto-Spanne 2–5 % als Erfahrungswert gekennzeichnet, nicht als Normvorgabe.
- Aufmaßformel: fehlerhafte Zahlen wie „1..2“ werden abgewiesen statt still als 1 gelesen.
- Sicherungen älterer Versionen behalten ihr Rechenverhalten.
