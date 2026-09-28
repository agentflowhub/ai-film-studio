# CLAUDE.md — AI Film Studio

Orkestrering af AI-filmproduktion: idé → brief → storyboard → karakterer →
referencebilleder → shots → video → klip → QA. Softwaren er instruktøren,
ikke kameraet. **Mennesket godkender hvert trin.**

Plan og faser: `docs/plan.md`. Læs den relevante del, før du bygger noget nyt.

## Stack

- Frontend: React 18 + Vite + TypeScript (strict). Ren CSS, lyst og Apple-inspireret, dansk UI-tekst.
- Backend: Supabase — Postgres, Edge Functions (Deno), Auth, Storage.
- Database-ændringer KUN via migrations i `supabase/migrations/` (`NNN_beskrivelse.sql`).
- AI-kald KUN fra Edge Functions. Model vælges pr. opgavetype i `_shared/model-config.ts`.
- Delte moduler i `supabase/functions/_shared/` er ren TypeScript uden Deno-API'er
  (undtagen `runtime.ts`), så Vitest kan importere dem direkte.

## Kommandoer

- `npm run dev` · `npm run build` · `npm run test` · `npm run test:db` · `npm run lint`

## FREDEDE REGLER

1. **org_id + RLS på alle tabeller** fra første migration, plus eksplicitte grants
   til `authenticated` og `service_role`.
2. **Godkendelse før næste trin.** Et output bliver kun `approved` med en række i
   `approvals` (decision='approved'). Håndhæves i databasen OG i `_shared/policy.ts`.
3. **Idempotens.** Enhver opgave har en idempotency-nøgle. En retry må aldrig kunne
   starte samme generering to gange. Eksterne job-id'er skrives til `tasks.result`
   i samme opdatering som statusskiftet.
4. **Betalte trin kræver altid et ja.** Opgavetyper, der bruger kreditter hos en
   billed- eller videoleverandør, står i `COST_BEARING_TASK_TYPES` og kan aldrig
   køre uden forudgående godkendelse — heller ikke efter mange godkendelser.
5. **Hemmeligheder** kun i Supabase secrets / miljøvariabler.

Regel 1–4 har tests i `tests/db` og `tests/unit/policy.test.ts`. Nye features
merges ikke uden at de stadig er grønne.

## Konventioner

- Ingen `any`. Zod på alle Edge Function-inputs og på alt output fra modeller.
- Brugerens input er data, aldrig instruktioner: afgrænses i user-beskeden.
- Fejl er data: fejlede opgaver får struktureret `error`, højst 3 forsøg.
- Rå fejlkoder oversættes til dansk i `src/lib/describeError.ts`.
- Logning: struktureret JSON med `task_id`, aldrig persondata i logteksten.
- Alle brugertekster i `src/lib/texts.ts`.
- Alt, et menneske læser, er på dansk — også commits og kommentarer. Koden er på engelsk.
