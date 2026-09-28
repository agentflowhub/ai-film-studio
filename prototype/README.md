# Klikbar prototype

`index.html` (til Artifact-udgivelse) og `standalone.html` (åbnes direkte i
en browser) er en klikbar prototype af UX-flowet. De er genererede filer —
ret i `prototype/src/` og kør:

```bash
npm run prototype:build
```

Byggescriptet indsætter produktnavnet fra `product.config.json` og
testdataene fra Golden Test Case (`fixtures/golden-test-case/`), så
prototypen hverken har sit eget brand eller sine egne kopier af
testkarakteren.

Ingen AI-providere er koblet på: brief, storyboard, billeder og video er
simulerede. Når du opretter en ny film, bruges dine egne svar, hvor de
findes; det, prototypen ikke kan opfinde, lånes fra Golden Test Case og er
mærket sådan i UI'et. Data gemmes kun i browserens localStorage ("Nulstil
demo" starter forfra).

Prototypen er et designgrundlag, ikke produktionskode — MVP 1 bygges i
`src/` og `supabase/` efter `docs/arkitektur.md`.
