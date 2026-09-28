# [PRODUCT NAME]

> Produktnavnet er ikke besluttet. `[PRODUCT NAME]` er en placeholder, som
> står ét sted: `product.config.json`.

Et AI-produktionssystem, hvor brugeren instruerer filmen på et menneskeligt niveau, mens systemet håndterer AI-generation, kontinuitet, referencesystem, prompts, modeller, approvals og produktionsstatus.

Det er et production control system omkring generativ filmproduktion — ikke
en "AI video generator". Et orkestreringslag fører en film fra idé til færdigt klip. Softwaren er
**instruktøren og produktionslederen, ikke kameraet**: billed- og
videogenerering kommer fra specialiserede modeller bag udskiftelige adaptere,
og et menneske godkender hvert trin, før det næste bygger videre på det.

```
Idé → Film Brief → Storyboard → Karakterer → Locations → Props
    → Shots → Startframes → Video → Klip → QA → Færdig film
```

Arkitekturen ligger i [`docs/arkitektur.md`](docs/arkitektur.md), og den
klikbare prototype i [`prototype/`](prototype/).

## Golden Test Case

Testdata ligger i [`fixtures/golden-test-case/`](fixtures/golden-test-case/):
demofilmen *Golden Test Film* med testkarakteren Sander. Den bruges til
regressionstest af hele kæden fra karakteridentitet til failover. Sander er
data — aldrig produktets navn eller brand.

## Status: bid 1 — Instruktøren

Kun Claude, ingen betalt billed- eller videogenerering endnu.

1. Brugeren opretter en film med titel og idé.
2. **Interview**: budskab, målgruppe, følelse, længde og stil.
3. **`brief-generate`** laver et struktureret Film Brief → *venter på godkendelse*.
4. Brugeren godkender eller afviser. Afviser man, retter man svarene og laver et nyt.
5. **`storyboard-generate`** laver scener og shots ud fra det godkendte brief,
   med varigheder, der summerer præcis til filmens længde → *venter på godkendelse*.
6. Når storyboardet er godkendt, er projektet klar til bid 2.

## Stack

React 18 + Vite + TypeScript (strict) · Supabase (Postgres, Edge Functions,
Auth) · Claude API fra Edge Functions (`@anthropic-ai/sdk`, structured
outputs) · Zod · Vitest.

## Kom i gang

```bash
npm install
cp .env.example .env.local        # udfyld VITE_SUPABASE_URL og VITE_SUPABASE_ANON_KEY
supabase start
supabase db reset                 # kører supabase/migrations
supabase secrets set ANTHROPIC_API_KEY=...   # eller i supabase/functions/.env lokalt
supabase functions serve
npm run dev
```

## Kommandoer

| Kommando | Hvad den gør |
|---|---|
| `npm run dev` | Frontend dev-server |
| `npm run build` | Typecheck + produktionsbuild |
| `npm run test` | Enhedstests (politik, timing, skemaer, Claude-adapter, fejltekster) |
| `npm run test:db` | RLS- og godkendelsestests mod en rigtig Postgres (se `tests/db/README.md`) |
| `npm run lint` | ESLint + TypeScript + `deno check` af Edge Functions |
| `npm run prototype:build` | Bygger prototypen fra `prototype/src` med produktnavn og Golden Test Case |

## MVP 1 — status

Backend for hele produktionskæden er bygget (migration 002–003 og Edge
Functions); brugerfladen er næste skridt.

| Edge Function | Hvad den gør |
|---|---|
| `brief-generate` | Idé → Film Brief, Film DNA og filmregler (Claude) |
| `approval-decide` | Godkend/afvis brief, Film DNA og storyboard |
| `storyboard-generate` | Godkendt brief → storyboard, aktiver og shots koblet til aktiv-versioner (Claude) |
| `asset-save` | Opret aktiv, ny version, ret kladde, samtykke, vælg master |
| `media-upload` | Upload egne referencebilleder til en kladde |
| `shot-update` | Ret et shots instruktion og spec |
| `shot-continuity` | Ret automatisk, tillad afvigelse, fortryd, opdatér/behold aktiv-version |
| `film-rules-update` | Tilføj filmregler, slå dem til og fra |
| `production-plan` | Production Control: status, porte, anbefalet model og pakker med pris |
| `production-start` | "Godkend produktion": reservér budget og sæt generationer i kø |
| `generation-worker` | Kører køen: submit, følg, failover, gem resultat, bogfør pris |
| `generation-review` | Godkend/afvis et resultat (startframe, video, master-referencer) |

**Providere:** indtil de rigtige billed- og videoprovidere er valgt, kører
produktionen mod en simulator bag samme interface
(`ALLOW_SIMULATOR_PROVIDER=true`). Den kan aldrig bruges, når
`APP_ENV=production`, og dens resultater gemmes som tydeligt mærkede
pladsholdere.

**Worker:** `generation-worker` skal kaldes hvert minut af pg_cron (via
pg_net) med headeren `x-worker-secret: $WORKER_SECRET`. Opsætningen er
miljøspecifik (projekt-URL og hemmelighed) og ligger derfor ikke i en
migration.

## Arkitektur i korte træk

- **Alt arbejde er en opgave** (`tasks`) med idempotency-nøgle. En retry med
  samme nøgle genoptager den samme opgave — den starter aldrig en ny generering.
- **Godkendelse håndhæves i databasen.** Et brief eller storyboard kan
  fysisk ikke få status `approved` uden en række i `approvals`, og et
  storyboard kan ikke oprettes på et brief, der ikke er godkendt.
- **Brugeren kan kun læse** produktionsdata. Alle skrivninger, der ændrer
  status eller skaber AI-output, går gennem Edge Functions.
- **Model pr. opgavetype** i `supabase/functions/_shared/model-config.ts`,
  kan overskrives med `FILM_MODEL_<TYPE>` uden kodeændring.
