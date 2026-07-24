# Mäklarspaning Göteborg

Installerbar PWA för bolagsjämförelse, kontorsmappning och rekryteringsspaning bland mäklarfirmor i Göteborg. **EO Franchise Göteborg 21 AB** är fast benchmark.

## Funktioner

- jämför omsättning, resultat, marginal, omsättning/anställd och vinst/anställd
- sortering, filtrering, bolagsdetaljer och export till CSV
- kontorsmappning mot juridiska bolag med markerad säkerhetsnivå
- publika länkar och personstickprov från Booli/Hittamäklare
- bolagsbaserad rekryteringssignal med tydlig metodförklaring
- lokal kandidatpipeline med status, anteckningar, export och import
- installerbar på hemskärm och tillgänglig offline efter första besöket
- automatisk publicering med GitHub Pages

## Appadress

Appen publiceras automatiskt på:

```text
https://krillelen.github.io/maklarspaning-goteborg/
```

Senast triggat för publicering: 2026-07-24.

## Installera på iPhone

1. Öppna appadressen i Safari.
2. Tryck på dela-symbolen.
3. Välj **Lägg till på hemskärmen**.

På Android och dator visas knappen **Installera app** när webbläsaren stöder installation.

## Data och integritet

- Ekonomisnapshot: 2026-07-24.
- Bokslutsår kan skilja mellan bolag.
- Personnamn är publika yrkesuppgifter och inte kompletta personalregister.
- Kandidatanteckningar sparas endast i webbläsarens `localStorage` på den aktuella enheten.
- Rekryteringssignalen gäller bolagets offentliga nyckeltal och poängsätter inte individer.

## Lokal test

```bash
python3 -m http.server 8080
```

Öppna sedan `http://localhost:8080`.

## Uppdatera data

Appens snapshot ligger i `data/app-data.json`. Behåll samma fältnamn när data uppdateras. Byt även cacheversion i `sw.js` för att tvinga installerade appar att hämta den nya snapshoten.
