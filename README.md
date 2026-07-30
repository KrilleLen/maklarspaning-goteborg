# Mäklarspaning Göteborg

Konkurrent-, ekonomi- och rekryteringsradar för mäklarfirmor i Göteborg.

Den publika appen finns på:

`https://krillelen.github.io/maklarspaning-goteborg/`

## Version 8.0

- 45 juridiska bolag och 91 kontorskopplingar
- snabb ekonomisk jämförelse i marknadsvyn
- sex flikar med ekonomisk fördjupning per bolag
- historisk resultatutveckling och effektivitetsmått
- stöd för resultat-, kostnads- och balansrader
- tydlig datatäckning och periodvisa källor
- validerad import via organisationsnummer
- säker OAuth 2.0-koppling till Bolagsverkets officiella API
- schemalagd import av digitala årsredovisningar utan hemligheter i frontend
- XBRL/iXBRL-normalisering med spårbart Bolagsverket-ID per period
- ingen uppskattning av saknade rader eller lokalkostnader
- 202 officiella bokslutsperioder för 35 av 45 bolag vid produktionsimporten 2026-07-30
- verifierad senaste bolagssnapshot behålls för bolag/perioder som ännu saknas i Bolagsverkets digitala arkiv

## Struktur

- `site/` – statisk PWA som publiceras till GitHub Pages
- `site/data/app-data.json` – bolag, kontor, personal och finansiell historik
- `site/data/financial-import.schema.json` – format för fördjupad bokslutsimport
- `scripts/import-financials.mjs` – slår ihop normaliserad bokslutsdata
- `scripts/fetch-bolagsverket-financials.mjs` – hämtar och normaliserar digitala årsredovisningar
- `scripts/bolagsverket/` – OAuth-klient och XBRL/iXBRL-parser
- `scripts/validate-financial-data.mjs` – datakontroll i CI
- `docs/FINANCIAL_DATA.md` – dataprinciper och importflöde

GitHub Actions verifierar JavaScript, datamängder och organisationsnummer innan `site/` publiceras. En separat schemalagd workflow hämtar nya bokslut varje måndag. Den kräver repository-hemligheterna `BOLAGSVERKET_CLIENT_ID` och `BOLAGSVERKET_CLIENT_SECRET`.
