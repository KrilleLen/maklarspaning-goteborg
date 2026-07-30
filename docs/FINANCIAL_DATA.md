# Finansiell data i Mäklarspaning

Appen visar en snabb marknadsöversikt och en separat fördjupad ekonomivy per juridiskt bolag.

## Dataprincip

- Organisationsnummer är primär nyckel.
- Varje bokslutsperiod har egen källa och källänk.
- Saknade rader lämnas tomma. Hyra, lokalkostnad och andra noter uppskattas aldrig.
- Bokslutsår kan skilja mellan bolag och visas därför alltid tillsammans med talet.
- Systematisk insamling från Allabolag används inte. Automatisk uppdatering bygger på Bolagsverkets API för värdefulla datamängder.
- API-hemligheter används endast i GitHub Actions och skickas aldrig till den publika appen.
- Varje officiell period sparar dokument-ID, registreringsdatum och hämtningsdatum.

## Importflöde

1. GitHub Actions hämtar dokumentlistan för appens 45 organisationsnummer.
2. Årsredovisningspaketen öppnas tillfälligt i körmiljön och XBRL/iXBRL normaliseras.
3. Dubbletter väljs efter primär rapportperiod, fälttäckning och registreringsdatum.
4. Normaliserad data mappas till `site/data/financial-import.schema.json`.
5. Kör:

   `node scripts/import-financials.mjs export.json`

6. Verifiera:

   `node scripts/validate-financial-data.mjs site/data/app-data.json`

Vid felsökning eller en kontrollerad återhämtning kan importen begränsas till en
kommaseparerad lista organisationsnummer med `BOLAGSVERKET_ORG_NOS`. HTTP 429
respekteras med längre exponentiell väntan innan anropet försöks igen.

Importen matchar på organisationsnummer, slår ihop befintlig historik per bokslutsperiod och uppdaterar bolagets senaste jämförelsetal.

Officiella perioder ersätter äldre tredjepartsfält för samma bokslutsperiod. Ett saknat officiellt fält lämnas tomt i stället för att ärva ett tal som då skulle få fel källa.

## Härledda nyckeltal

- Vinstmarginal = resultat efter finansnetto / nettoomsättning.
- EBITDA = rörelseresultat + avskrivningar, när båda raderna finns.
- Kassalikviditet = (omsättningstillgångar − varulager) / kortfristiga skulder.
- Justerat eget kapital = eget kapital + 79,4 % av obeskattade reserver.
- Soliditet = justerat eget kapital / totala tillgångar.
- Avkastning räknas först när både aktuell och föregående balansperiod finns.

Lokalkostnad och marknadsföringskostnad lämnas tomma när årsredovisningen inte särredovisar dem.

## Fullständighet

`Grunddata` betyder att senaste omsättning, resultat, anställda och jämförelsemått finns.

`Historik` betyder att minst två bokslutsperioder finns.

`Fördjupad` betyder att flera verifierade resultat-, kostnads-, balans- eller nyckeltalsrader finns per period.
