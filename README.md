<div align="center">

# Steuerschätzer für Portfolio Performance

### Vorabpauschale, Freibetrag und Verkaufsplanung – eine HTML-Datei, läuft offline

[![Online öffnen](https://img.shields.io/badge/Online_öffnen-1f5f8b?style=for-the-badge)](https://inazr.github.io/pp-steuerschaetzer/)
[![Offline-Version laden](https://img.shields.io/badge/Offline--Version_laden-1a7f4b?style=for-the-badge)](https://github.com/inazr/pp-steuerschaetzer/releases/latest)

![Release](https://img.shields.io/github/v/release/inazr/pp-steuerschaetzer)
![Pages](https://img.shields.io/github/actions/workflow/status/inazr/pp-steuerschaetzer/pages.yml?label=Pages)
![Stand](https://img.shields.io/github/release-date/inazr/pp-steuerschaetzer?label=Stand)
![Offline](https://img.shields.io/badge/läuft-offline-success)
![Abhängigkeiten](https://img.shields.io/badge/Abhängigkeiten-0-success)
![Lizenz](https://img.shields.io/badge/Lizenz-MIT-blue)

[Funktionen](#was-der-rechner-abbildet) · [Gesetzliche Werte](#gesetzliche-werte) · [Grenzen](#grenzen) · [Entwicklung](#entwicklung) · [Releases](#releases) · [Lizenz](#lizenz)

<sub>Keine Steuerberatung. Modellrechnung, alle Angaben ohne Gewähr. Maßgeblich ist die Abrechnung deiner Bank.</sub>

</div>

Der Steuerschätzer liest eine Datei aus [Portfolio Performance](https://www.portfolio-performance.info/) (XML, binär oder verschlüsselt) und rechnet die deutschen Kapitalertragsteuer-Themen eines ETF- und Fondsdepots durch: Vorabpauschale je Jahr, Verlusttöpfe und Freistellungsaufträge je Bank, wie du den Sparerpauschbetrag mit Verkauf und Rückkauf ausnutzt, und wie viel du verkaufen musst, um einen Netto-Betrag zu erhalten.

> [!TIP]
> Die ganze Anwendung ist **eine einzige HTML-Datei** mit eingebetteten Charts (Apache ECharts) und Schriften. Sie funktioniert ohne Internet, auch per Doppelklick. Deine Datei wird nur im Browser gelesen. Eine Content-Security-Policy verhindert jede Netzwerkanfrage. Gespeichert werden im Browser nur deine Einstellungen, Fondstypen, abgewählte Depots (als interne IDs) und deine Eingaben je Bank: Bank-Zuordnung, Freistellungsaufträge, Vorträge, Zinsschalter, ein überschriebener genutzter Freibetrag und der verbleibende Altbestand-Freibetrag laut Steuerbescheid, nie Buchungen, Kurse, Beträge aus der Datei, Depot- und Kontonamen oder das Passwort einer verschlüsselten Datei.

Neu umgesetzt nach der Idee von [inazr/PortfolioPerformanceTaxes](https://github.com/inazr/PortfolioPerformanceTaxes) (Python/PyQt), mit korrigierter Steuerlogik.

## Was der Rechner abbildet

| Reiter | Inhalt |
|---|---|
| **Übersicht** | Steuer-Einstellungen (Veranlagung, Kirchensteuer, Bundesland), Depotauswahl, **Banken & Freistellungsaufträge** (Zuordnung von Depots und Konten, Freistellungsauftrag, genutzter Freibetrag, Verlustvortrag zum 1.1. und Verlusttöpfe je Bank, Zinsschalter je Konto), **Altbestand-Freibetrag (vor 2009)** mit Verbrauch, Rest laut Steuerbescheid und erwarteter Erstattung (nur bei Fondsanteilen von vor 2009), Wertpapiere mit Fondstyp und Altbestand-Markierung, unrealisierte Gewinne je Wertpapier über die Kaufdaten, geteilt in steuerpflichtig und steuerfrei |
| **Vorabpauschale** | § 18 InvStG je Jahr, Depot und Wertpapier: Basisertrag, Deckelung durch Wertsteigerung plus Ausschüttungen, Zwölftelung im Kaufjahr, Teilfreistellung, Steuer. Prognose für das laufende Jahr zum letzten Kurs (fällig im Januar) mit Restfreibetrag des Folgejahres je Bank. Gestapelter Chart je Jahr, CSV-Export |
| **Freibetrag nutzen** | Welche Lots du verkaufen und sofort zurückkaufen kannst, damit der steuerpflichtige Gewinn den freien Freistellungsauftrag jeder Bank genau füllt, nach Verrechnung ihrer Verlusttöpfe. Streng FIFO je Depot, je Bank ein Abschnitt, CSV-Export mit Spalte „Bank“. Danach **Altbestand-Freibetrag nutzen**: Fondsanteile von vor 2009 verkaufen und zurückkaufen, bis der 100.000-€-Freibetrag gefüllt ist, mit Bankabzug und erwarteter Erstattung Dazu der **Dezember-Effekt**: wie stark Verkauf und Rückkauf je Monat die Vorabpauschale des laufenden Jahres senken (Zwölftelung im Kaufjahr) und wie viel Freistellungsauftrag dadurch im Folgejahr frei bleibt |
| **Verkaufsplanung** | „Ich brauche X € netto“: verkauft je Depot nach FIFO und wählt zwischen Wertpapieren immer den Lot mit der geringsten Steuer je Euro netto. Steuer im Jahressaldo je Bank: Verluste geben Freibetrag frei oder werden erstattet. Ordergebühren fest je Order und in % vom Erlös. Kennzahlen je Bank, Wasserfall Brutto → Gebühren → Steuer → Netto, CSV-Export mit Spalte „Bank“. Netto ist die Auszahlung der Bank; eine erwartete Erstattung über die Steuererklärung (Altbestand) steht getrennt daneben |
| **Gesetze & Annahmen** | Alle Rechenwerte mit Status (geltendes Recht, beschlossen, Entwurf, Annahme des Tools) und Link auf Gesetz, BMF-Schreiben oder BFH-Urteil, Basiszins je Jahr, Stand der Prüfung |

Steuerlogik im Überblick:

- **FIFO je Depot** (§ 20 Abs. 4 S. 7 EStG). Depotüberträge in Portfolio Performance nehmen die Lots mit Kaufdatum, Einstand und bereits versteuerter Vorabpauschale mit.
- **Vorabpauschale je Lot**, zum Jahresende verbucht und beim Verkauf auf den Gewinn angerechnet. Ausschüttungen zählen brutto (netto plus einbehaltene Steuern) und werden nach dem Bestand im jeweiligen Depot am Zahltag verteilt.
- **Teilfreistellung** je Fondstyp: Aktienfonds 30 %, Mischfonds 15 %, Immobilienfonds 60 % (Inland) bzw. 80 % (Ausland). Für **Einzelaktien** gibt es keine Vorabpauschale und keine Teilfreistellung, Käufe vor 2009 sind steuerfrei (Bestandsschutz). **Sonstige Wertpapiere** (ETC, Anleihe, Zertifikat): keine Vorabpauschale, keine Teilfreistellung, kein Bestandsschutz.
- **Fondstyp** steht nicht in der PP-Datei und wird geraten: ISIN aus Irland oder Luxemburg (außer mit Gesellschaftsform wie „plc“ im Namen oder bekannten Aktien wie Linde, Accenture, ArcelorMittal) oder Fondswörter wie ETF/UCITS → Aktienfonds, Renten- und Geldmarkt-Wörter → Sonstiger Fonds, ETC/Zertifikat/Anleihe → Sonstiges Wertpapier, sonst Einzelaktie. Geratene Typen sind markiert, bis du sie bestätigst oder änderst.
- **Steuersatz** Abgeltungsteuer + Soli, wahlweise mit Kirchensteuer (8 % oder 9 %) und Ermäßigung nach § 32d Abs. 1 EStG.
- **Banken.** Jedes ausgewählte Depot ist zunächst eine eigene Bank, sein Verrechnungskonto gehört dazu. Depots und Konten lassen sich einer anderen Bank zuordnen (z. B. zwei Depots bei derselben Bank). Ein Konto ohne Depot, aber mit Zinsen (Tagesgeld) ist eine eigene Bank. Eine Bank heißt wie ihr erstes Depot bzw. Konto.
- **Zwei Verlusttöpfe je Bank** wie bei der Bank: Aktienverluste nur gegen Aktiengewinne, alle anderen Verluste (Fonds, ETF, sonstige Wertpapiere) im allgemeinen Topf gegen alle positiven Erträge. Die Töpfe werden **ab 2018** aus der Datei Jahr für Jahr fortgeschrieben (vorher galt altes Investmentsteuerrecht). Der **Vortrag zum 1.1.** ist je Bank und Jahr überschreibbar, z. B. mit Verlusten aus 2009–2017 laut Jahressteuerbescheinigung. Hat eine Bank keinen Bestand mehr, bleibt ihr Topf markiert: nutzbar nur per Verlustbescheinigung oder bei vollständigem Depotübertrag (§ 43a Abs. 3 EStG).
- **Freistellungsauftrag je Bank.** Er wirkt erst auf das, was nach der Verlustverrechnung positiv bleibt. Gibt es genau eine aktive Bank und keinen Eintrag, gilt der volle Sparerpauschbetrag. Bei mehreren Banken ohne Eintrag rechnet das Tool mit einem **gemeinsamen** Freibetrag und warnt deutlich, denn dann stimmt der Abzug der einzelnen Bank nicht. Sind Aufträge eingetragen, haben Banken ohne Eintrag 0 €; übersteigt die Summe den Sparerpauschbetrag, gibt es eine Warnung.
- **Bereits genutzter Freibetrag** je Bank und Jahr: steuerpflichtige Vorabpauschale des Vorjahres (fließt im Januar zu), Ausschüttungen nach Teilfreistellung, Verkäufe und Zinsen des laufenden Jahres, nach den Verlusttöpfen. Überschreibbar. Eine Ausschüttung nach dem Komplettverkauf zählt beim Depot mit dem letzten Bestand, wenn der Verkauf höchstens 60 Tage zurückliegt. Enthält eine Datei Depots mehrerer Personen (z. B. ein Kinderdepot), wählst du nur die Depots einer Person aus; abgewählte Depots gehören zu keiner Bank.
- **Zinsen** (Buchungsart „Zinsen“ auf EUR-Konten) zählen brutto als Kapitalertrag und verbrauchen den Freistellungsauftrag der Bank. Je Konto abschaltbar; an für Verrechnungskonten ausgewählter Depots, aus für Konten ohne Depot. Soll- und Negativzinsen sind nicht abziehbar (§ 20 Abs. 9 EStG) und werden ignoriert.
- **Altbestand (vor 2018 gekaufte Fondsanteile, § 56 InvStG).** Zum 31.12.2017 gelten sie als verkauft und zum letzten Kurs 2017 neu gekauft; der Einstand ab 2018 ist dieser Kurs. Fehlt ein Kurs zum 31.12.2017 (höchstens 10 Tage davor), bleibt der Lot beim ursprünglichen Einstand und es gibt einen Hinweis. Beim Verkauf versteuert die Bank den Neugewinn ab 2018 (nach Teilfreistellung) und, bei Kauf 2009–2017, zusätzlich den Altgewinn (Kurs 31.12.2017 − Einstand, ohne Teilfreistellung). Bei Kauf **vor 2009** ist der Altgewinn steuerfrei, und Gewinne ab 2018 sind bis **100.000 € je Person** steuerfrei; die Bank zieht trotzdem Steuer ab, zurück kommt sie über die Steuererklärung. Das Tool zieht den Freibetrag aus den Verkäufen ab 2018 in der Datei ab (angerechnet auf den Gewinn vor Teilfreistellung); den Rest laut letztem Steuerbescheid kannst du eintragen. Verluste ab 2018 aus Anteilen von 2009–2017, die auf dem höheren Kurs 31.12.2017 beruhen, zählen nach BFH (25.11.2025) ohne Kürzung um die Teilfreistellung; die Differenz erscheint als erwartete Erstattung. Erwartete Erstattungen zeigt das Tool nur für das laufende Jahr und den Verkaufsplan, nie im Netto.
- **Verkaufsplan im Jahressaldo wie die Bank:** Die geplanten Verkäufe kommen zu den Erträgen des Jahres ihrer Bank hinzu. Ein Verlust gibt bereits genutzten Freibetrag wieder frei oder erstattet schon gezahlte Steuer (negative Steuer, angezeigt als „Erstattung“). Die unterjährige Reihenfolge der Bank (erst einbehalten, später erstattet) ist nicht nachgebildet; am Jahresende ist das Ergebnis dasselbe.

## Gesetzliche Werte

Stand 26.11.2026. Status: **G** geltendes Recht, **B** beschlossen, **E** Entwurf, **A** Annahme/Vereinfachung des Tools. Dieselben Zeilen zeigt der Reiter „Gesetze & Annahmen“; Zahlen für 2026, Einzelveranlagung ohne Kirchensteuer.

| Bereich | Wert | Status | Norm |
|---|---|---|---|
| Basiszins | 2026: 3,20 % | G | [§ 18 Abs. 4 InvStG; BMF-Schreiben vom 13.01.2026, BStBl I 2026, S. 155](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Investmentsteuer/2026-01-13-basiszins-berechnung-vorabpauschale.html) |
| Basiszins | 2025: 2,53 % | G | [§ 18 Abs. 4 InvStG; BMF-Schreiben vom 10.01.2025, BStBl I 2025, 273](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Investmentsteuer/2025-01-10-basiszins-vorabpauschale-zum-2-1-2025.html) |
| Basiszins | 2024: 2,29 % | G | [§ 18 Abs. 4 InvStG; BMF-Schreiben vom 05.01.2024, BStBl I 2024, S. 154](https://www.otto-schmidt.de/news/steuerrecht/basiszins-zur-berechnung-der-vorabpauschale-gemass-18-absatz-4-invstg-2024-01-11.html) |
| Basiszins | 2023: 2,55 % | G | [§ 18 Abs. 4 InvStG; BMF-Schreiben vom 04.01.2023](https://www.haufe.de/id/rechtsquelle/basiszins-zur-berechnung-der-vorabpauschale-gemaess-18-absatz-4-invstg-basiszins-zum-2-januar-2023-HI15518934.html) |
| Basiszins | 2022: -0,05 % | G | [§ 18 Abs. 4 InvStG; BMF-Schreiben vom 07.01.2022](https://www.otto-schmidt.de/news/steuerrecht/basiszins-zur-berechnung-der-vorabpauschale-gemass-18-absatz-4-invstg-2022-01-13.html) |
| Basiszins | 2021: -0,45 % | G | [§ 18 Abs. 4 InvStG; BMF-Schreiben vom 06.01.2021, BStBl I 2021, S. 56](https://www.otto-schmidt.de/news/steuerrecht/alle-weiteren-zuletzt-veroffentlichten-bmf-schreiben-2021-01-08.html) |
| Basiszins | 2020: 0,07 % | G | [§ 18 Abs. 4 InvStG; BMF-Schreiben vom 29.01.2020, BStBl I 2020, 218](https://www.haufe.de/id/rechtsquelle/basiszins-zur-berechnung-der-vorabpauschale-gemaess-18-abs-4-invstg-HI13687798.html) |
| Basiszins | 2019: 0,52 % | G | [§ 18 Abs. 4 InvStG; BMF-Schreiben vom 09.01.2019, BStBl I 2019, S. 58](https://www.haufe.de/id/rechtsquelle/basiszins-zur-berechnung-der-vorabpauschale-gem-18-abs-4-invstg-HI12617630.html) |
| Basiszins | 2018: 0,87 % | G | [§ 18 Abs. 4 InvStG; BMF-Schreiben vom 04.01.2018, BStBl I 2018, S. 249](https://www.haufe.de/id/beitrag/investmentfonds-223-vorabpauschale-HI11762300.html) |
| Vorabpauschale | Basisertrag = Wert 01.01. × Basiszins × 70 %, höchstens Wertsteigerung + Ausschüttungen, abzüglich Ausschüttungen; im Kaufjahr je vollem Monat vor dem Kauf ein Zwölftel weniger; fließt am ersten Werktag des Folgejahres zu | G | [§ 18 InvStG](https://www.gesetze-im-internet.de/invstg_2018/__18.html) |
| Teilfreistellung | Aktienfonds 30 %, Mischfonds 15 %, Immobilienfonds (Inland) 60 %, Immobilienfonds (Ausland) 80 %; gilt auch für Vorabpauschale und Verluste | G | [§ 20 InvStG](https://www.gesetze-im-internet.de/invstg_2018/__20.html) |
| Anrechnung der Vorabpauschale | Bereits versteuerte Vorabpauschalen mindern den Veräußerungsgewinn | G | [§ 19 Abs. 1 InvStG](https://www.gesetze-im-internet.de/invstg_2018/__19.html) |
| FIFO | Bei Sammelverwahrung gelten die zuerst gekauften Anteile als zuerst verkauft (je Depot) | G | [§ 20 Abs. 4 S. 7 EStG](https://www.gesetze-im-internet.de/estg/__20.html) |
| Bestandsschutz Einzelaktien | Kauf vor dem 01.01.2009: Kursgewinn steuerfrei | G | [§ 52 Abs. 28 S. 11 EStG](https://www.gesetze-im-internet.de/estg/__52.html) |
| Sparerpauschbetrag | 2026: 1.000 € (Einzelveranlagung); 2009–2022: 801 € / 1.602 € (zusammen); ab 2023: 1.000 € / 2.000 € (zusammen) | G | [§ 20 Abs. 9 EStG](https://www.gesetze-im-internet.de/estg/__20.html) |
| Werbungskosten | Kein Abzug tatsächlicher Werbungskosten; Soll- und Negativzinsen mindern die Kapitalerträge nicht | G | [§ 20 Abs. 9 S. 1 EStG](https://www.gesetze-im-internet.de/estg/__20.html) |
| Abgeltungsteuer | 25 % | G | [§ 32d Abs. 1 EStG](https://www.gesetze-im-internet.de/estg/__32d.html) |
| Solidaritätszuschlag | 5,5 % der Abgeltungsteuer | G | [§ 4 SolZG](https://www.gesetze-im-internet.de/solzg_1995/__4.html) |
| Kirchensteuer | 8 % (Bayern, Baden-Württemberg), sonst 9 %; mindert die Abgeltungsteuer (§ 32d Abs. 1 S. 3 EStG) | G | [§ 51a EStG; Kirchensteuergesetze der Länder](https://www.gesetze-im-internet.de/estg/__51a.html) |
| Steuersatz (deine Einstellung) | 2026: 26,375 % ohne Kirchensteuer | G | [§ 32d Abs. 1 EStG, § 4 SolZG, § 51a EStG](https://www.gesetze-im-internet.de/estg/__32d.html) |
| Verlusttöpfe | Je Bank: Aktienverluste nur gegen Aktiengewinne, übrige Verluste gegen alle positiven Erträge; Rest wird vorgetragen oder auf Antrag bescheinigt | G | [§ 43a Abs. 3 EStG](https://www.gesetze-im-internet.de/estg/__43a.html) |
| Freistellungsauftrag | Je Bank; zusammen höchstens der Sparerpauschbetrag | G | [§ 44a EStG](https://www.gesetze-im-internet.de/estg/__44a.html) |
| Altanteile (vor 2018 gekauft) | Fiktiver Verkauf zum 31.12.2017 und Neukauf zum 01.01.2018 zum letzten Kurs 2017; der Altgewinn wird erst beim tatsächlichen Verkauf versteuert | G | [§ 56 Abs. 2, 3 InvStG](https://www.gesetze-im-internet.de/invstg_2018/__56.html) |
| Freibetrag Altanteile vor 2009 | Altgewinn bis 31.12.2017 steuerfrei; Gewinne ab 2018 steuerfrei bis 100.000 € je Person, Rest wird jährlich festgestellt; die Bank zieht zunächst Steuer ab, Erstattung über die Steuererklärung | G | [§ 56 Abs. 6 S. 1 Nr. 2 InvStG](https://www.gesetze-im-internet.de/invstg_2018/__56.html) |
| BFH: Teilfreistellung bei Verlusten aus Altanteilen | Beruht ein Verlust ab 2018 darauf, dass der Kurs 31.12.2017 über dem Einstand lag, wird er nicht um die Teilfreistellung gekürzt | G | [BFH, Urteile vom 25.11.2025, VIII R 22/23 und VIII R 15/22](https://www.bundesfinanzhof.de/de/entscheidung/entscheidungen-online/detail/STRE202610013/) |
| Verlusttöpfe ab 2018 | Töpfe werden erst ab 2018 aus der Datei fortgeschrieben; ältere Verluste als Vortrag zum 1.1. eintragen | A | Annahme des Tools |
| Jahressaldo | Steuer je Bank als Jahressaldo statt in der Buchungsreihenfolge der Bank | A | Annahme des Tools |
| Gemeinsamer Freibetrag | Ohne eingetragene Freistellungsaufträge wird der Sparerpauschbetrag gemeinsam über alle Banken gerechnet | A | Annahme des Tools |
| Fondstyp | Steht nicht in der PP-Datei und wird aus Name und ISIN geraten, bis du ihn bestätigst | A | Annahme des Tools |
| Altgewinn | Kurs 31.12.2017 − Einstand, ohne ausschüttungsgleiche Erträge aus der Zeit vor 2018 | A | [Annahme des Tools; § 56 Abs. 3 InvStG](https://www.gesetze-im-internet.de/invstg_2018/__56.html) |
| Freibetrag Altanteile: Bemessung | 100.000 € werden auf den Gewinn vor Teilfreistellung angerechnet | A | [Annahme des Tools; § 56 Abs. 6 InvStG](https://www.gesetze-im-internet.de/invstg_2018/__56.html) |
| Freibetrag Altanteile: Paare | Bei Zusammenveranlagung gemeinsam 200.000 € statt 100.000 € je Person für die eigenen Anteile | A | [Annahme des Tools; § 56 Abs. 6 InvStG](https://www.gesetze-im-internet.de/invstg_2018/__56.html) |
| Erwartete Erstattungen | Vereinfacht: nur für das laufende Jahr bzw. die Planung, höchstens bis zur im Jahr besteuerten Bemessungsgrundlage; die Veranlagung wird nicht im Detail nachgebildet | A | Annahme des Tools |
| BFH-Urteile: Anwendung | Anwendung durch BMF und Banken offen; das Tool rechnet die Bank-Sicht und zeigt die Differenz als erwartete Erstattung über die Veranlagung | A | [Annahme des Tools; BFH VIII R 22/23](https://www.bundesfinanzhof.de/de/entscheidung/entscheidungen-online/detail/STRE202610013/) |
| Spiegelfall | Altverlust bis 2017 mit Neugewinn ab 2018: keine Nachforderung modelliert | A | Annahme des Tools |
| Gold-ETCs | Gold-ETCs mit Lieferanspruch (steuerfrei nach einem Jahr) nicht abgebildet; Gewinn voll steuerpflichtig | A | Annahme des Tools |
| Quellensteuer | Keine Anrechnung ausländischer Quellensteuer | A | Annahme des Tools |
| Ehegatten | Keine ehegattenübergreifende Verlustverrechnung zum Jahresende | A | Annahme des Tools |

Ein neuer Basiszins wird jedes Jahr im Januar veröffentlicht und muss in `src/law.js` nachgetragen werden: Wert in `LAW.basiszins.values[year]`, Fundstelle in `LAW.basiszins.source[year]` und Link in `LAW.basiszins.url[year]` (ein Test verlangt für jede Zeile mit Status G einen `https://`-Link). Fehlt er, rechnet das Tool für dieses Jahr keine Vorabpauschale und zeigt einen Hinweis. Die Tabelle oben ist ein Abzug von `lawRows()` für 2026, Einzelveranlagung ohne Kirchensteuer; ein Test prüft, dass sie übereinstimmt. `LAW_STAND` in `src/law.js` (Anzeige „Stand TT.MM.JJJJ“ im Seitenkopf und im Reiter) wird bei jeder Prüfung der Rechtslage auf das Prüfdatum gesetzt; Tabelle und Reiter kommen aus `lawRows()` in derselben Datei.

## Grenzen

- Gelesen werden Dateien aus Portfolio Performance als **XML** (beide XStream-Varianten, auch als `.portfolio`-ZIP), **binär** und **verschlüsselt** (AES-128 und AES-256). Für verschlüsselte Dateien fragt das Tool nach dem Passwort; es wird nur zum Entschlüsseln verwendet und nirgends gespeichert. Andere Formate und beschädigte Dateien werden mit „Die Datei ist beschädigt oder ihr Format wird nicht unterstützt.“ abgelehnt.
- Nur **Wertpapiere in EUR**. Andere werden ausgelassen und angezeigt.
- **Gold-ETCs mit Lieferanspruch** (z. B. Xetra-Gold, steuerfrei nach einem Jahr Haltedauer) sind nicht abgebildet; als „Sonstiges Wertpapier“ wird der Gewinn voll besteuert.
- Verluste werden je Bank in Aktien- und allgemeinem Topf verrechnet, aber erst **ab 2018** aus der Datei; ältere Verluste bitte als Vortrag zum 1.1. eintragen.
- **Kein Quellensteuertopf** (keine Anrechnung ausländischer Quellensteuer), keine **ehegattenübergreifende Verlustverrechnung** zum Jahresende, keine Günstigerprüfung und keine NV-Bescheinigung.
- **Altbestand:** Der Altgewinn ist Kurs 31.12.2017 − Einstand; **ausschüttungsgleiche Erträge vor 2018** (thesaurierende Fonds) sind nicht abgebildet, der Altgewinn kann deshalb zu hoch sein. Bei Zusammenveranlagung rechnet das Tool **gemeinsam 200.000 €** statt 100.000 € je Person für die eigenen Anteile. Ob und wie Banken die **BFH-Urteile** vom 25.11.2025 anwenden, ist offen; das Tool rechnet die Bank-Sicht und zeigt die Differenz als erwartete Erstattung. Der **Spiegelfall** (Altverlust bis 2017, Neugewinn ab 2018) ist nicht modelliert. Erwartete Erstattungen sind vereinfacht und gelten nur für das laufende Jahr.
- Gerechnet wird mit dem **letzten Kurs in der Datei**. Ordergebühren gibt es nur im Verkaufsplan, nicht beim Freibetrag-Nutzen (Verkauf und Rückkauf).

## Entwicklung

```bash
npm test        # Tests (node:vm, keine Abhängigkeiten); baut dabei auch dist/index.html
npm run build   # nur bauen
```

Die Kenntnis des binären und des verschlüsselten Formats stammt aus dem öffentlichen Quellcode von [Portfolio Performance](https://github.com/portfolio-performance/portfolio); übernommen wurden nur Dateiaufbau und Feldnummern, kein Code.

Node 22 oder neuer. Es gibt **keine npm-Abhängigkeiten**: `scripts/build.mjs` bettet ECharts, Schriften und die Skripte in `dist/index.html` ein. Die Engine-Dateien sind klassische Skripte mit gemeinsamem globalen Gültigkeitsbereich. Ihre Reihenfolge steht in `scripts/files.mjs` und gilt für Build und Tests.

| Datei | Inhalt |
|---|---|
| `src/xml.js`, `src/zip.js`, `src/pb.js` | XML-Leser mit XStream-Referenzen (XPath- und id-Modus), Erkennung des Dateiformats, `.portfolio`-ZIP, Entschlüsselung (Web Crypto), Protobuf-Leser für das binäre Format |
| `src/pp.js` | Wertpapiere, Depots, Konten, Buchungen, Ausschüttungen, Zinsen und Kurse aus der PP-Datei |
| `src/law.js` | Gesetzliche Werte mit Quellen und Status (`lawRows`, `LAW_STAND`), Steuersatz, Fondstypen |
| `src/engine.js` | Chronologischer Durchlauf: FIFO je Depot, Überträge, Vorabpauschale je Lot, fiktive Veräußerung zum 31.12.2017, Ertragsereignisse und Veranlagungs-Posten |
| `src/ledger.js` | Banken, Verlusttöpfe ab 2018, Freistellungsaufträge, Jahressaldo je Bank, Altbestand-Freibetrag (100.000 €) und erwartete Erstattungen |
| `src/freibetrag.js`, `src/planner.js` | Freibetrag-Optimierer (Sparerpauschbetrag und Altbestand), Netto-Verkaufsplan |
| `src/format.js`, `src/csv.js` | Deutsche Formate, CSV-Export |
| `src/charts.js` | ECharts-Optionen als reine Funktionen |
| `src/state.js`, `src/ui.js`, `src/page.html` | Einstellungen, Oberfläche, Seitenvorlage |
| `test/` | Tests und synthetische PP-Dateien |

## Releases

Version in `package.json` erhöhen und auf `main` pushen. Der Workflow `release.yml` legt den Tag `v<Version>` an und hängt `pp-steuerschaetzer-<Version>.html` an das Release. `pages.yml` veröffentlicht jeden Stand von `main` auf GitHub Pages. Pages einmalig unter *Settings → Pages → Source: GitHub Actions* aktivieren.

## Hinweis

Keine Anlage-, Steuer- oder Rechtsberatung. Die Berechnung bildet die Regeln vereinfacht nach und ersetzt weder die Abrechnung deiner Bank noch eine Steuerberatung.

## Lizenz

MIT, siehe [LICENSE](LICENSE). Eingebettet: [Apache ECharts](https://echarts.apache.org/) 6.1.0 (Apache-2.0, siehe `vendor/`), [Public Sans](https://public-sans.digital.gov/) und [JetBrains Mono](https://www.jetbrains.com/lp/mono/) (SIL OFL 1.1, siehe `fonts/`).
