# FRAME — plan

> **Bemærk:** `docs/arkitektur.md` (udkast) beskriver den fulde arkitektur og
> MVP 1–5. Når den er godkendt, afløser den faserne herunder.

Et orkestreringslag, der fører en film fra idé til færdigt klip:

```
Idé → Film Brief → Storyboard → Karakterer → Locations → Props
    → Shots → Startframes → Video → Klip → QA → Færdig film
```

Softwaren er **instruktøren og produktionslederen, ikke kameraet**. Selve
billed- og videogenereringen kommer fra specialiserede modeller bag
udskiftelige adaptere. Mennesket godkender hvert trin, før det næste
bygger videre på det.

## Principper (arvet fra agentFLOW OS)

1. **Alt arbejde er en opgave.** Hvert produktionstrin er en række i
   `tasks` med status `proposed → pending_approval → approved → executing
   → done` (alternativt `rejected | failed`).
2. **Omkostning afgør godkendelse.** Tekst-trin (brief, storyboard,
   shot-liste) er billige og kan køre frit. Trin, der bruger betalte
   kreditter (billeder, video), kræver altid et ja med et vist
   kreditestimat, håndhævet i én central policy-funktion i backend, aldrig
   kun i UI.
3. **Idempotens.** Hver generering har en idempotency-nøgle. En retry må
   aldrig kunne starte den samme videogenerering to gange. Leverandørens
   job-id skrives til `tasks.result` FØR status sættes til `done`.
4. **Motorer er adaptere.** Claude (tekst), en billedmodel og en
   videomodel sidder bag ét fælles interface. Model vælges pr. opgavetype
   via config, aldrig hårdkodet.
5. **Kontinuitet er data, ikke prompt-held.** Karakterer, locations og
   props er egne entiteter med referencebilleder, som hvert shot peger
   på. Det er dét, der holder Sander ens fra shot til shot.
6. **org_id + RLS på alle tabeller** fra første migration.

## Stack

React 18 + Vite + TypeScript (strict), Supabase (Postgres, Edge
Functions, Storage, Realtime), Claude API fra Edge Functions, Zod på alle
inputs, Vitest. Samme stack som agentFLOW, så mønstre og viden kan
genbruges.

## Datamodel (første udkast)

| Tabel | Indhold |
|---|---|
| `projects` | én film: titel, status, org_id |
| `film_briefs` | budskab, målgruppe, ønsket følelse, længde (sek.), stil, versioneret |
| `storyboards` | ordnet liste af scener, bundet til en brief-version |
| `shots` | scene, rækkefølge, varighed, kamera, handling, dialog, refs til karakterer/location/props |
| `characters` / `locations` / `props` | beskrivelse + referencebilleder (Storage) |
| `assets` | genererede billeder/videoer, kilde-shot, leverandør, job-id |
| `tasks` / `approvals` | fælles opgave- og godkendelsesmodel som i agentFLOW |
| `usage` | forbrugte kreditter/tokens pr. opgave |

## Faser

**Bid 1 — Instruktøren (kun Claude, ingen betalt generering)** ✅ bygget
- Migrations + RLS: `orgs`, `org_members`, `projects`, `tasks`, `approvals`,
  `film_briefs`, `storyboards`, `shots`, `usage`.
- Edge Function `brief-generate`: interview-svar (budskab, målgruppe,
  følelse, længde, stil) → struktureret Film Brief.
- Edge Function `storyboard-generate`: godkendt brief → scener → shot-liste
  med samlet varighed = ønsket længde (skaleres proportionalt, hvis Claude
  rammer lidt ved siden af).
- Edge Function `approval-decide`: godkend/afvis brief eller storyboard.
- UI: nyt projekt → interview → brief til godkendelse → storyboard og
  shot-liste til godkendelse. (Redigering af enkelte shots i UI er IKKE
  bygget endnu — man afviser og laver et nyt.)
- Tests: RLS-isolation, godkendelseskrav, Zod-skemaer for brief/shots.

**Bid 2 — Kontinuitet:** karakterer, locations, props udledt af
storyboardet; referencebilleder genereres (kræver godkendelse med
kreditestimat).

**Bid 3 — Startframes:** ét billede pr. shot, bygget af shot +
referencebilleder.

**Bid 4 — Video:** startframe + shot-beskrivelse → videoklip via
video-adapter. Asynkrone jobs med polling/webhook og idempotens.

**Bid 5 — Klip og QA:** samling af klip i rækkefølge (ffmpeg eller
leverandørens værktøj), QA-agent der tjekker kontinuitet og varighed
mod brief, eksport.

## Åbne beslutninger (tages før bid 2)

- Hvilken billed- og videoleverandør (fx Higgsfield, Runway, Veo, Kling)?
  Adapteren gør valget udskifteligt, men den første skal vælges.
- Hvor sker klipningen: server-side ffmpeg eller leverandørværktøj?
- Hvem er brugeren: bureauer, SMV'er, der laver egen marketing, eller
  indholdsskabere? Det styrer UI og prissætning.
