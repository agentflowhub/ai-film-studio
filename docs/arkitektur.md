# [PRODUCT NAME] — arkitektur

Status: **udkast til godkendelse.** Ingen kode bygges ud over bid 1, før dette
dokument er godkendt. Dokumentet erstatter faserne i `docs/plan.md`, når det
er godkendt.

Grundprincippet i én sætning: **storyboardet er sandhedskilden, hvert shot
er en produktionsenhed, og hvert shot peger på versionerede, godkendte
produktionsaktiver** — så kontinuitet er en egenskab ved datamodellen, ikke
noget en prompt håber på.

---

## Produkt og testdata

**Produktnavn:** `PRODUCT_NAME = "[PRODUCT NAME]"` — en placeholder, indtil
brandet er besluttet. Navnet står ét sted (`product.config.json`) og hentes
derfra af app, prototype og dokumentation. Et brand-skift ændrer ikke den
funktionelle kerne.

**Produktdefinition:** Et AI-produktionssystem, hvor brugeren instruerer filmen på et menneskeligt niveau, mens systemet håndterer AI-generation, kontinuitet, referencesystem, prompts, modeller, approvals og produktionsstatus.

Produktet er et production control system omkring generativ filmproduktion
— ikke en "AI video generator".

**Produkt og testdata er adskilt.** Ingen model, tabel, namespace, URL, API
eller konfiguration er bygget til en bestemt karakter eller film:

```
Bruger
 → Filmprojekt → Filmversion
   → Brief → Film DNA → Filmregler
   → Karakterer → Locations og aktiver
   → Storyboard → Shots → Startframes → Videogenerationer
   → Godkendelser → Produktion → Færdig film
```

**Golden Test Case** (`fixtures/golden-test-case/`) er det fælles
testdatasæt: demofilmen *Golden Test Film* med testkarakteren **Sander**,
hans varevogn, tre locations og 12 shots. Den bruges til regressionstest af
karakteridentitet, tøj, ansigt, proportioner, referencetroskab, miljø,
kamerakomposition, dokumentarisk fotorealisme, billedgenerering,
image-to-video, startframe-bevarelse, bevægelse, kamerabevægelse, optisk
zoom, tidsmæssig konsistens, provider-routing, failover, omkostninger og
godkendelsesflow. Sander er data — aldrig produktnavn, projektnavn eller
brand — og kan erstattes af en anden karakter, en kundes karakter eller en
anden genre uden kodeændringer. `tests/unit/brand-separation.test.ts`
håndhæver adskillelsen.

**Film DNA og filmregler** (fra UX-iteration 2) afløser "stilbiblen" i
afsnit 2–3 og 9: Film DNA er filmens versionerede visuelle grammatik, og
filmregler er regler, AI'en ikke må bryde uden brugerens tilladelse.
Detaljerne skrives ind i skemaet, når MVP 1 planlægges.

---

## 0. Fund, der ændrer planen

**0.1 Bid 1's shots er ikke produktionsenheder endnu.** I bid 1 er
`shots.characters` og `shots.location` fritekst (`"Sander"`, `"Køkken"`).
Det er præcis den løse kobling, arkitekturen skal fjerne. Konsekvens:
migration 002 erstatter tekstfelterne med referencer til aktiv-versioner
(afsnit 3), og storyboard-generatoren skal vælge blandt eksisterende aktiver
i stedet for at opfinde navne. Bid 1's godkendelses-, idempotens- og
RLS-fundament genbruges uændret.

**0.2 Next.js — anbefaling: behold Vite + Supabase Edge Functions.**
Oplægget foreslår Next.js + Next API. Bid 1 er bygget på React + Vite +
Supabase Edge Functions. Next.js giver server-rendering og SEO, som et
login-beskyttet produktionsværktøj ikke har brug for, og løser ikke det
egentlige backend-problem: **video- og billedgenerering tager minutter**,
og hverken en Next API-route eller en Edge Function må vente så længe.
Begge kræver det samme: en jobkø + asynkrone workers (afsnit 7). Vi skifter
derfor ikke frontend-teknologi, men tilføjer en jobkø. Skulle der senere
komme en offentlig marketingside, kan den bygges separat.

**0.3 Én ny infrastrukturdel er uundgåelig: en render-worker.** Den
endelige klipning (MVP 5) kræver ffmpeg på en rigtig server/container —
det kan hverken Edge Functions eller Next.js. Den beslutning kan vente til
MVP 5, men den er med i planen fra start.

---

## 1. Produktarkitektur

```
┌────────────────────────── Browser (React + Vite) ──────────────────────────┐
│ Projekt · Brief · Manus · Karakterer · Locations · Aktiver · Storyboard ·  │
│ Produktion · Lyd · Tidslinje                                              │
└──────────────┬──────────────────────────────────────────┬─────────────────┘
      læser (RLS)│                              handlinger │ (POST)
               ▼                                          ▼
┌──────────────────────────┐          ┌───────────────────────────────────────┐
│ Postgres (Supabase)      │◄─────────│ Edge Functions (kommandoer)           │
│ projekter, aktiver,      │  skriver │ validering → politik → opret opgave   │
│ shots, opgaver, godkend- │          └───────────────────────────────────────┘
│ elser, generationer      │                              │ enqueue
│                          │          ┌───────────────────▼───────────────────┐
│ Jobkø (tasks)            │◄─────────│ Worker (cron + provider-webhooks)     │
└──────────┬───────────────┘ status   │ Prompt-compiler → Provider-router →   │
           │                          │ Provider-adaptere (billede/video/lyd) │
┌──────────▼───────────────┐          └───────────────────┬───────────────────┘
│ Supabase Storage         │◄──────── resultater ─────────┘
│ referencer, frames, klip │
└──────────────────────────┘          Render-worker (MVP 5): ffmpeg-klipning
```

Tre regler bærer det hele:

1. **Frontenden læser direkte (RLS), men ændrer kun via Edge Functions.**
   Ingen klient kan selv godkende, sætte en status eller starte en betalt
   generering.
2. **Alt arbejde er en opgave** i Postgres med idempotency-nøgle. Tekst-trin
   kører synkront i Edge Functions (sekunder); billede/video/lyd kører
   asynkront via køen (minutter).
3. **Providere er adaptere bag ét interface.** UI siger "generér dette shot";
   routeren vælger provider og model ud fra evner, pris og tilgængelighed.

---

## 2. Domænemodel

```
Organisation
 └─ Projekt (én film)
     ├─ Stilbibel (visuel stil, farvepalet, kamerasprog, format)   — versioneret
     ├─ Brief                                                     — versioneret
     ├─ Manus (scener, handling, replikker)                        — versioneret
     ├─ Aktiver
     │   ├─ Karakter  (Sander)          ┐
     │   ├─ Location  (Villavejen)      │ hver med versioner;
     │   ├─ Køretøj   (Sanders varevogn)│ én godkendt MASTER-version
     │   └─ Prop      (værktøjskasse)   ┘ ad gangen
     └─ Storyboard (sandhedskilden)                               — versioneret
         └─ Scene
             └─ Shot (produktionsenhed)
                 ├─ Shot-spec (kamera, handling, lys, lyd, varighed) — versioneret
                 ├─ Aktiv-referencer → låst til en bestemt aktiv-version
                 ├─ Afvigelser (godkendte undtagelser fra master)
                 ├─ Generationer: startframe, bevægelsesplan, video, lyd
                 └─ Godkendte versioner pr. slot (startframe, video, lyd)
```

Kernebegreber:

- **Aktiv** — en genbrugelig produktionsenhed med stabilt id
  (`CHAR_SANDER_01`). Selve indholdet ligger i **aktiv-versioner**, som er
  uforanderlige efter godkendelse. En ændring = en ny version.
- **Master** — den ene godkendte version af et aktiv, som nye shots bruger.
  Systemet ændrer aldrig en master selv.
- **Shot** — en produktionsenhed med en struktureret spec. Det er ikke "et
  billede"; det er ordren på et billede, en video og en lydside.
- **Generation** — ét kald til én provider med ét input og ét resultat.
  Kan godkendes eller afvises. Et shot har mange generationer, men højst én
  godkendt pr. slot.
- **Opgave** og **godkendelse** — som i bid 1: arbejdsgangen, idempotens og
  menneskets ja.

---

## 3. Databaseskema

Alle tabeller har `org_id uuid not null` + RLS + eksplicitte grants
(FREDET REGEL 1). Kun de vigtigste kolonner er vist.

### Eksisterende fra bid 1 (uændret)
`orgs`, `org_members`, `projects`, `tasks`, `approvals`, `film_briefs`,
`usage`.

### Planlægning

```sql
style_bibles   (id, org_id, project_id, version, content jsonb, status)
scripts        (id, org_id, project_id, brief_id, task_id, version,
                content jsonb, status)                  -- scener + replikker
storyboards    (… som bid 1, + script_id)
scenes         (id, org_id, storyboard_id, number, heading, purpose,
                script_scene_ref)
```

### Aktiver

```sql
assets (
  id uuid, org_id, project_id,
  kind text check (kind in ('character','location','vehicle','prop')),
  code text,                        -- 'CHAR_SANDER_01', unik pr. projekt
  name text,
  master_version_id uuid null       -- peger på den godkendte version
)

asset_versions (
  id uuid, org_id, asset_id, version int,
  attributes jsonb,                 -- struktureret, pr. kind (se afsnit 9)
  description text,                 -- menneskelæsbar
  status text check (status in ('draft','pending_approval','approved','rejected','retired')),
  task_id uuid null,
  unique (asset_id, version)
)
-- Trigger: attributes kan ikke ændres, når status = 'approved'.
-- Trigger: master_version_id kan kun pege på en 'approved' version.

asset_references (                  -- uploadede og genererede referencebilleder
  id, org_id, asset_version_id, media_id,
  role text,                        -- 'face','full_body','profile','clothing',
                                    -- 'expression','exterior','interior',...
  is_primary boolean
)
```

### Shots

```sql
shots (
  id uuid, org_id, storyboard_id, scene_id,
  code text,                        -- 'SHOT_07', unik pr. storyboard
  order_index int,
  spec jsonb,                       -- ShotSpec, zod-valideret (nedenfor)
  spec_version int,
  state text,                       -- shot-tilstand (afsnit 5)
  approved_start_frame_id uuid null → generations
  approved_video_id       uuid null → generations
  approved_audio_id       uuid null → generations
)

shot_assets (
  org_id, shot_id, asset_version_id,  -- LÅST til en version, ikke til aktivet
  role text,                          -- 'subject','background','vehicle','prop'
  primary key (shot_id, asset_version_id)
)

shot_deviations (                     -- godkendte undtagelser fra en master
  id, org_id, shot_id, asset_version_id,
  attribute_path text,                -- fx 'wardrobe.headwear'
  master_value text, shot_value text,
  reason text, approved_by uuid
)
```

`ShotSpec` — oplæggets eksempel, gjort til et skema:

```ts
{
  duration_seconds: number,                 // 1–15
  camera: {
    shot_type: 'extreme_wide'|'wide'|'medium'|'medium_closeup'|'closeup'|…,
    lens_mm: number | null,                 // 85
    movement: 'static'|'pan'|'tilt'|'dolly'|'handheld'|'optical_zoom'|…,
    angle: 'eye_level'|'low'|'high'|…
  },
  action: string,                           // "Sander kigger i kameraet og venter."
  dialogue: { character_code: string, line: string }[],
  lighting: string,                         // 'early_evening'
  audio: { ambience: string|null, sfx: string[] },
  notes: string | null,                     // fri tekst — kontinuitetstjekkes
  start_frame_required: boolean,
  video_required: boolean
}
```

Karakterer, location og køretøjer er IKKE felter i spec'en — de er rækker i
`shot_assets`. Så kan de ikke staves forkert, og systemet kan svare på
"hvilke shots bruger Sander v1?" med én forespørgsel.

### Medier og generationer

```sql
media (
  id, org_id, project_id,
  storage_path text,                  -- '{org_id}/{project_id}/{media_id}.{ext}'
  kind text ('image','video','audio'),
  mime text, bytes bigint, sha256 text,
  width int, height int, duration_ms int,
  source text ('upload','generation','render')
)

generations (
  id, org_id, project_id,
  target_type text ('asset_version','shot','scene'),
  target_id uuid,
  slot text ('reference','storyboard_frame','start_frame',
             'motion_plan','video','voice','sfx','music'),
  task_id uuid → tasks,              -- idempotens + godkendelse arves herfra
  input jsonb,                       -- kompileret prompt, refererede medier
  input_hash text,                   -- afgør forældelse (afsnit 9.4)
  source_spec_version int,
  provider text, model text,
  provider_job_id text,              -- skrives FØR status går videre
  attempt_log jsonb,                 -- hvert provider-forsøg (afsnit 6.3)
  status text,                       -- afsnit 5.3
  cost_estimate_cents int, cost_actual_cents int,
  output_media_id uuid null → media,
  review text ('pending','approved','rejected') null
)
```

### Budget

```sql
project_budgets (org_id, project_id, limit_cents, spent_cents, reserved_cents)
```

Et estimat reserveres, når en generering godkendes; det faktiske beløb
bogføres, når provideren melder færdig. Over grænsen = ingen nye jobs uden
et nyt ja.

---

## 4. Kerneentiteter — ansvar i én linje

| Entitet | Ansvar |
|---|---|
| `projects` | Filmen og dens overordnede fase |
| `style_bibles` | Fælles visuel stil, som indgår i alle billed-/videoprompts |
| `scripts` | Hvad der sker og siges — uden kamera |
| `storyboards` / `scenes` / `shots` | Hvordan det filmes — sandhedskilden |
| `assets` / `asset_versions` | Hvem og hvor — genbrugelige, versionerede, godkendte |
| `shot_assets` | Hvilke aktiv-versioner et shot bruger (låst) |
| `shot_deviations` | Bevidste, godkendte afvigelser fra en master |
| `generations` | Hvert kald til en provider, med input, pris og resultat |
| `media` | Alle filer i Storage, med metadata |
| `tasks` / `approvals` | Arbejdsgang, idempotens, menneskets ja |

---

## 5. Tilstandsmaskiner

### 5.1 Projektets faser (planlægning er lineær og gated)

```
idea → brief → script → storyboard → assets → production → edit → final
```

Et trin kan først startes, når det foregående er godkendt. Håndhæves som
i bid 1: i `_shared/policy.ts` OG af databasetriggere. Går man tilbage
(fx en ny manusversion), markeres alt nedstrøms som **forældet** — intet
slettes.

### 5.2 Shot-tilstand (produktion er parallel pr. shot)

```
spec_draft
   │ spec godkendt
   ▼
spec_approved ──► start_frame_pending ──► start_frame_review ──► start_frame_approved
                        ▲  (afvist) ◄──────────┘                        │
                                                                        ▼
                  video_approved ◄── video_review ◄── video_pending ◄── motion_planned
                        │                 └── (afvist) ──► video_pending
                        ▼
                  audio_pending → audio_review → shot_final
```

Plus én tværgående tilstand: **`stale`**. Et shot bliver forældet, når
noget, det bygger på, ændres: en aktiv-version udskiftes, spec'en ændres,
eller stilbiblen får en ny version. Et forældet shot beholder alle sine
godkendte versioner, men viser advarslen "bygger på Sander v1 — master er
nu v2" og kræver et bevidst valg: opdatér eller behold.

Hvis `start_frame_required=false`, springes startframe-trinene over
(tekst-til-video). Hvis `video_required=false`, er shottet færdigt, når
startframen er godkendt (stillbillede i klippet).

### 5.3 Generation

```
awaiting_approval ─(ja + budget reserveret)─► queued ─► submitted ─► running
        │                                                  │           │
        └─(nej)─► cancelled                                ▼           ▼
                                     failed ◄───────── (fejl)    succeeded
                                        │                          │
                         (failover, afsnit 6.3)            review: pending
                                                           → approved | rejected
```

---

## 6. Provider-abstraktion

### 6.1 Interface

```ts
type Capability =
  | 'text' | 'text_to_image' | 'image_edit' | 'image_to_image'
  | 'text_to_video' | 'image_to_video' | 'voice' | 'sfx' | 'music';

interface ProviderAdapter {
  id: string;                                   // 'provider_a'
  models(): ModelInfo[];                        // evner, grænser, pris
  estimate(job: GenerationJob, model: string): CostEstimate;
  submit(job: GenerationJob, model: string, idempotencyKey: string): Promise<{ providerJobId: string }>;
  status(providerJobId: string): Promise<ProviderStatus>;
  cancel(providerJobId: string): Promise<void>;
  fetchResult(providerJobId: string): Promise<ResultFile[]>;
  verifyWebhook?(req: Request): Promise<ProviderEvent | null>;
}

interface ModelInfo {
  model: string;
  capabilities: Capability[];
  maxReferenceImages: number;
  durationsSeconds: number[];                   // fx [5, 6, 8, 10]
  aspectRatios: string[];
  supportsSeed: boolean;
  supportsNegativePrompt: boolean;
  quality: 1 | 2 | 3;                           // intern vurdering
}
```

Tekst (brief, manus, storyboard) bruger Claude direkte som i bid 1 — det er
ikke en udskiftelig provider, men den samme adapter-disciplin gælder: model
pr. opgavetype via config.

### 6.2 Router

1. Filtrér modeller på evne (fx `image_to_video`), varighed, format og
   antal referencebilleder, jobbet kræver.
2. Sortér efter projektets politik: kvalitet først, pris først, eller en
   fast provider (valgt i projektindstillinger).
3. Returnér en **plan**: primær model + ordnet fallback-liste + samlet
   pris-estimat (det højeste i kæden, så budgetreservationen dækker failover).

### 6.3 Failover — uden at betale to gange

Failover er FREDET REGEL 3 i praksis: vi må aldrig ende med to betalte
videoer for ét klik.

- Skift kun provider ved **infrastrukturfejl** (timeout, 5xx, provider nede,
  kø-overløb). Aldrig ved en indholdsafvisning — den skal et menneske se.
- Før næste provider prøves: kald `cancel()` og bekræft med `status()`, at
  det forrige job er afsluttet uden resultat. Kan det ikke bekræftes,
  stopper kæden og opgaven markeres "kræver opmærksomhed".
- Hvert forsøg logges i `generations.attempt_log`. `provider_job_id`
  skrives, FØR status sættes til `submitted`.
- Et resultat, der alligevel ankommer sent fra en opgivet provider, gemmes
  som en ekstra version (så pengene ikke er spildt), men godkendes ikke
  automatisk.

---

## 7. API-struktur

**Læsning:** direkte fra frontenden med supabase-js + RLS (som i dag).

**Kommandoer (Edge Functions):**

| Område | Endpoint | Synkron? |
|---|---|---|
| Planlægning | `brief-generate`, `script-generate`, `storyboard-generate` | Ja (Claude, sekunder) |
| Aktiver | `asset-create`, `asset-version-create`, `asset-extract` (foreslår aktiver ud fra manus), `asset-set-master` | Ja |
| Upload | `media-upload-url` (signeret upload-URL), `media-register` | Ja |
| Shots | `shot-update-spec`, `shot-assign-assets`, `continuity-check`, `shot-allow-deviation` | Ja |
| Generering | `generation-estimate`, `generation-request` (opretter opgave → afventer ja) | Ja |
| Godkendelse | `approval-decide` (fælles for alt), `approval-decide-batch` | Ja |
| Worker | `generation-worker` (pg_cron hvert minut: afhent kø, poll providere) | Asynkron |
| Webhooks | `provider-webhook/{provider}` (signaturtjek → opdater generation) | Asynkron |
| Klipning | `render-request` → render-worker (MVP 5) | Asynkron |

Edge Functions har en tidsgrænse på få minutter, så et videojob **ventes
aldrig færdigt i et request**: det indsendes, `provider_job_id` gemmes, og
worker/webhook afslutter det. Frontenden følger med via Supabase Realtime
på `generations` og `shots`.

---

## 8. Informationsarkitektur (frontend)

```
┌───────────────────────────────────────────────────────────────────────┐
│ [PRODUCT NAME]                         Golden Test Film  ▾        JN  │
├──────────────┬────────────────────────────────────────────────────────┤
│ Brief      ✓ │  STORYBOARD                   [Gitter] [Tabel]  Filter │
│ Manus      ✓ │  Scene 1 · Villavejen, morgen                          │
│ Karakterer 3 │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                   │
│ Locations  2 │  │ 01 🖼│ │ 02 🖼│ │ 03 ⏳│ │ 04 ⚠│                   │
│ Aktiver    4 │  └──────┘ └──────┘ └──────┘ └──────┘                   │
│ Storyboard ● │  Scene 2 · Køkkenet                                    │
│ Produktion   │  ┌──────┐ ┌──────┐ …                                   │
│ Lyd          │                                                        │
│ Tidslinje    │                                                        │
├──────────────┴────────────────────────────────────────────────────────┤
│ 12 shots · 9 startframes godkendt · 6 videoer · 4 godkendt · 2 til dig │
└───────────────────────────────────────────────────────────────────────┘
```

| Flade | Indhold |
|---|---|
| **Brief / Manus** | Læs, godkend, afvis med kommentar, se versioner |
| **Karakterer** (Character Studio) | Kort pr. karakter; upload referencer pr. rolle (ansigt, helkrop, profil, tøj, udtryk); strukturerede attributter; generér/godkend master; versionshistorik; "bruges i 14 shots" |
| **Locations / Aktiver** | Samme mønster for locations, køretøjer, props |
| **Storyboard** | Gitter (frames) og tabel (shot, frame, karakter, location, kamera, video). Træk for at ændre rækkefølge |
| **Shot Editor** (panel) | Referencer · Spec (kamera, bevægelse, lys, lyd, varighed) · Kompileret prompt (læsbar, ikke redigerbar) · Noter · Kontinuitet · Startframe-versioner · Video-versioner · Godkendt version |
| **Produktion** | Kanban pr. shot-tilstand; batch: "Generér 12 startframes · ca. 84 kr. · Godkend" |
| **Lyd** | Stemmer pr. karakter, replikker, ambience, SFX |
| **Tidslinje** | Godkendte klip i rækkefølge, trim, eksport |
| **Til din beslutning** | Alle ventende godkendelser på tværs af filmen, ét sted |

Menneskesprog i UI: "Venter på dig", "Klar", "Forældet — Sander er
opdateret", aldrig tilstandskoder.

---

## 9. Kontinuitetssystemet

Kontinuitet sikres i tre lag. Det første lag er det vigtigste og koster
ingenting.

### 9.1 Lag 1 — kontinuitet ved konstruktion (deterministisk)

Brugeren skriver ikke billed-/video-prompts. **Prompt-compileren** bygger
dem ud fra:

```
stilbibel + aktiv-versioners attributter + referencebilleder + shot-spec
```

Når Sanders master siger `wardrobe.headwear = "mørkegrå flat cap"`, står
det i hver eneste prompt, der indeholder Sander, og hans referencebilleder
sendes med. Et "blue baseball cap" kan kun opstå, hvis nogen skriver det i
et fritekstfelt (`notes`, `action`). Derfor er de fleste konflikter umulige
fra start.

Attributter er strukturerede pr. aktivtype, fx for en karakter:

```ts
{
  age: '45', build: 'kraftig', height: 'høj',
  face: { hair: 'kort, gråsprængt', facial_hair: 'fuldskæg', eyes: 'blå' },
  wardrobe: { headwear: 'mørkegrå flat cap', top: 'marineblå arbejdsjakke',
              bottom: 'sorte arbejdsbukser', footwear: 'sikkerhedssko' },
  distinguishing: ['blyant bag øret']
}
```

### 9.2 Lag 2 — tekstkontrol før generering (Claude)

`continuity-check` kører, når et shots fritekst ændres, og altid før en
betalt generering. Claude får aktivernes attributter og shottets fritekst
og returnerer struktureret:

```ts
{ conflicts: [{ asset_code: 'CHAR_SANDER_01', attribute: 'wardrobe.headwear',
                master_value: 'mørkegrå flat cap', shot_value: 'blå baseballkasket',
                severity: 'conflict' }],
  matches: ['age', 'wardrobe.top', 'location', 'vehicle'] }
```

UI viser advarslen fra oplægget med to valg:

- **Ret automatisk** — fjerner/omskriver den modstridende formulering i
  fritekst, så master gælder.
- **Tillad afvigelse** — gemmes i `shot_deviations` med begrundelse og
  indgår derefter bevidst i prompten for netop dette shot.

En betalt generering kan ikke startes, mens der er uafklarede konflikter.

### 9.3 Lag 3 — visuel kontrol efter generering (QA, MVP 3+)

Claude (vision) sammenligner den genererede frame med masterens
referencebilleder og attributter og svarer pr. attribut: match / afvigelse
/ usikker. Det er en **anbefaling** til den, der godkender, aldrig en
automatisk afvisning.

### 9.4 Forældelse

Hver generation gemmer `input_hash` (kompileret prompt + aktiv-versioner +
spec-version + stilbibel-version). Ændres noget af det, er generationen
forældet, og shottet går i `stale` (afsnit 5.2).

---

## 10. Aktivstyring

- **Opret**: manuelt, eller `asset-extract` foreslår aktiver ud fra
  manuset ("Sander", "kunden", "Villavejen", "varevognen"), som brugeren
  godkender eller slår sammen.
- **Referencer**: upload pr. rolle via signeret URL direkte til Storage.
  Filer valideres (type, størrelse, dimensioner) og får sha256, så samme
  billede ikke gemmes to gange.
- **Master**: generér master-referencer ud fra uploads + attributter →
  godkend → versionen låses og bliver master.
- **Ændring**: aldrig i en godkendt version. Ny version → godkend → vælg at
  gøre den til master → berørte shots bliver `stale` med et valg: opdatér
  til v2 eller behold v1.
- **Storage**: bucket `media`, sti `{org_id}/{project_id}/{media_id}.{ext}`.
  RLS på `storage.objects` via org-præfikset. Frontenden får kun
  tidsbegrænsede signerede URL'er.
- **Rettigheder**: uploades et foto af en virkelig person, skal der ligge
  et samtykke-flag på aktivet, før det kan bruges i generering — og flere
  video-providere kræver det selv. Relevant allerede for Sander, hvis han
  er en rigtig person.

---

## 11. Shot-generations-pipelinen

```
Shot (spec godkendt, aktiver låst, kontinuitet ren)
  │
  ▼ prompt-compiler            → input + input_hash
  ▼ router                     → model-plan + estimat
  ▼ generation-request         → opgave 'awaiting_approval'
  ▼ menneskets ja              → budget reserveret
  ▼ worker: submit             → provider_job_id gemt
  ▼ webhook/poll               → resultat hentet → media → Storage
  ▼ (lag 3: visuel QA)         → anbefaling
  ▼ review                     → godkend → shots.approved_*_id sættes
```

Startframe og video er samme pipeline med forskellig `slot` og
`capability`. Video bruger den godkendte startframe som input
(`image_to_video`), hvis `start_frame_required`.

---

## 12. Godkendelsesflow

Alt, der kan godkendes, bruger den samme mekanik som bid 1: en opgave, en
række i `approvals`, databasetriggere der håndhæver den.

| Hvad | Hvornår godkendes det | Betalt? |
|---|---|---|
| Brief, manus, storyboard | Efter generering (output) | Nej |
| Shot-spec | Før produktion af shottet | Nej |
| Aktiv-version → master | Efter generering/upload | Nej / ja* |
| Startframe, video, lyd | **Før** (pris) og **efter** (resultat) | Ja |
| Afvigelse fra master | Når den tillades | Nej |
| Endelig film | Efter render | Nej |

\* Generering af master-referencer er betalt og kræver ja før.

Betalte trin kræver **altid** et ja før kørsel (FREDET REGEL 4 i
CLAUDE.md). For at det ikke bliver 60 klik, findes **batch-godkendelse**:
"Generér startframes for scene 1–3 · 12 shots · ca. 84 kr." er én
godkendelse af 12 opgaver med ét samlet estimat. Den er stadig et ja pr.
beløb — aldrig en generel "kør bare".

---

## 13. MVP-plan

| MVP | Indhold | Forhold til det byggede |
|---|---|---|
| **1 — Film Planner** | Brief ✓, **manus**, **aktiver (uden billeder)**, storyboard med shots der peger på aktiv-versioner, ShotSpec, lag 1+2 kontinuitet, storyboard-gitter/tabel, Shot Editor (spec, uden generering) | Bid 1 dækker brief + et første storyboard. Kræver migration 002: manus, aktiver, `shot_assets`, ny ShotSpec; storyboard-generatoren omskrives til at bruge aktiver |
| **2 — Billedpipeline** | Medier + Storage, upload af referencer, provider-lag + router + første billed-provider, jobkø + worker, master-generering, storyboard-frames, startframes, budget, batch-godkendelse, lag 3 QA | Ny |
| **3 — Videopipeline** | Video-adapter(e), image-to-video, failover, retry/regenerér/godkend/afvis, Realtime-status | Ny |
| **4 — Lyd** | Stemme pr. karakter, replikker, ambience, SFX | Ny |
| **5 — Klipning** | Tidslinje, render-worker (ffmpeg), eksport | Ny infrastruktur (0.3) |

**Golden Test Case er testfilmen** gennem alle faser
(`fixtures/golden-test-case/`): testkarakteren Sander, en varevogn, tre
locations og 12 shots. Hver MVP er først færdig, når Golden Test Film kan
føres igennem den.

---

## 14. Beslutninger, der skal træffes

| # | Beslutning | Anbefaling | Hvornår |
|---|---|---|---|
| 1 | Frontend: Next.js eller behold Vite + Edge Functions | **Behold** (0.2) | Nu |
| 2 | Godkend dette dokument som grundlag for MVP 1 | — | Nu |
| 3 | Første billed-provider og første video-provider | Vælg efter test med Golden Test Case' referencer | Før MVP 2 |
| 4 | Hvem betaler provider-kreditter (platformen eller kunden) og prissætning | — | Før MVP 2 |
| 5 | Hvor render-workeren kører | Container-tjeneste med ffmpeg | Før MVP 5 |
| 6 | Hvem er brugeren: bureauer, SMV'er med egen marketing eller indholdsskabere | Påvirker UI-tæthed og pris | Før MVP 2 |
