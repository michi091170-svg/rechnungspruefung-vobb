/** Eingabewerte aus Formularfeldern: Zahl, leerer String oder deutsch formatierter Text. */
export type NumIn = number | string | null | undefined;

export interface Position {
  id: string;
  oz: string;
  text: string;
  eh: string;
  menge: NumIn;
  ep: NumIn;
  /** id des Nachtrags, leer = Hauptauftrag */
  nt: string;
}

export type NachtragStatus = "angekündigt" | "Angebot eingegangen" | "in Prüfung" | "beauftragt" | "abgelehnt" | "zurückgestellt";

export interface Nachtrag {
  id: string;
  nr: string;
  titel: string;
  grundlage: string;
  anzeige: string;
  angebotDatum: string;
  angebot: NumIn;
  geprueft: NumIn;
  status: NachtragStatus | string;
  bem: string;
}

export interface AufmassEintrag {
  an?: NumIn;
  gp?: NumIn;
  formel?: string;
  blatt?: string;
  bem?: string;
  /** Herkunft der Menge AN bzw. geprüft: "ki" = automatische Erkennung, "hand" = Eingabe/Änderung durch Prüfer */
  anSrc?: "ki" | "hand";
  gpSrc?: "ki" | "hand";
}

export type RechnungsArt = "Abschlagsrechnung" | "Teilschlussrechnung" | "Schlussrechnung";

export interface Rechnung {
  id: string;
  nr: string;
  art: RechnungsArt | string;
  datum: string;
  eingang: string;
  forderung: NumIn;
  pruefdatum: string;
  gemAufmass: boolean;
  status: string;
  aufmass: Record<string, AufmassEintrag>;
  pauschalAN?: NumIn;
  pauschalGP?: NumIn;
  maengel: NumIn;
  sonst: NumIn;
  sonstText: string;
  zahlDatum: string;
  zahlBetrag: NumIn;
  skontoGezogen: boolean;
  skontoIst?: NumIn;
  bem: string;
  /** Scan-Markierungen; Aufbau siehe UI */
  scan?: unknown;
}

export interface Buergschaft {
  id: string;
  buerge: string;
  nr: string;
  datum: string;
  eingang: string;
  betrag: NumIn;
  befristetBis: string;
  status: string;
  rueckgabe: string;
  selbstschuldnerisch: boolean;
  erstesAnfordern: boolean;
  verz770: boolean;
  tauglich: boolean;
  original: boolean;
  bem: string;
}

export interface GesicherteForderung {
  id: string;
  text: string;
  betrag: NumIn;
  faellig: string;
}

export interface Sicherheit {
  verbraucher: boolean | null;
  vbv: boolean | null;
  vereinbart: boolean | null;
  klausel: "agb" | "individuell" | string;
  satz: NumIn;
  basis: "brutto" | "netto" | string;
  zweckMaengel: boolean;
  fristAnf: string;
  buergschaften: Buergschaft[];
  forderungen: GesicherteForderung[];
  hauptschuldnerGemahnt: string;
  konto: string;
}

export interface Project {
  id: string;
  name: string;
  ag: string;
  an: string;
  ort: string;
  vergabeNr: string;
  bauleiter: string;
  atv: string;
  vertragsdatum: string;
  abnahme: string;
  /** Bundesland der Baustelle für Feiertage bei Fristen (§ 193 BGB); leer = nur bundeseinheitliche */
  bundesland?: string;
  /** Vereinbarte VOB-Fassung, z. B. „VOB/B 2016, VOB/C 2019 inkl. Ergänzungsband 2023“ */
  vobFassung?: string;
  auftragssummeLaut?: NumIn;
  vobB?: boolean;
  vertragsstrafe?: string;
  ausfuehrung?: string;
  vertragshinweise?: string;
  ust: NumIn;
  rc13b: boolean;
  nachlass: NumIn;
  /** Nachlass auch auf Nachträge; fehlt bei Altprojekten (= ja) */
  nachlassNT?: boolean;
  umlage: NumIn;
  umlageText: string;
  /** Sicherheitsleistung vereinbart; fehlt bei Altprojekten (= ja) */
  seVereinbart?: boolean;
  seSatz: NumIn;
  seDeckel: NumIn;
  seBuergschaft: boolean;
  gwSatz: NumIn;
  gwBuergschaft: boolean;
  skontoVereinbart: boolean;
  skontoSatz: NumIn;
  skontoTage: NumIn;
  skontoAbschlag: boolean;
  fristAbschlag: NumIn;
  fristSchluss: NumIn;
  freistellung: boolean;
  freistellungBis: string;
  positions: Position[];
  nachtraege: Nachtrag[];
  rechnungen: Rechnung[];
  /** projektbezogene Übermessungsgrenzen, Schlüssel ATV|Art|Regel */
  ueb?: Record<string, NumIn>;
  sicherheit?: Sicherheit;
  updated: number;
  /** Datenstand-Version, siehe SCHEMA_VERSION */
  schema?: number;
  /** Zeitstempel des letzten erfolgreichen Abgleichs mit dem Konto (nur lokal relevant) */
  synced?: number;
}

export type HintLevel = "cut" | "warn" | "info";
export interface Hint { lvl: HintLevel; t: string }
