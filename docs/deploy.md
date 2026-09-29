# Deploy af FRAME

FRAME kører i sit eget Supabase-projekt, adskilt fra agentflow-os.

| | |
|---|---|
| Projekt | `ai-film-studio` |
| Reference | `hiyhutpnxgsqcvsruqav` |
| Adresse | https://hiyhutpnxgsqcvsruqav.supabase.co |
| Region | West EU (Irland), `eu-west-1` |

Alle kommandoer køres fra roden af repoet på en maskine med Node 20+.

## 1. Forbind til projektet

```powershell
npm install
npx supabase login
npx supabase link --project-ref hiyhutpnxgsqcvsruqav
```

## 2. Database

```powershell
npx supabase db push
```

Kører migrationerne i `supabase/migrations/` (tabeller, RLS, godkendelses-
porte, budgetfunktioner og Storage-bucket'en `media`).

## 3. Hemmeligheder

Kun som Supabase secrets — aldrig i koden eller i `.env`-filer, der committes.

```powershell
npx supabase secrets set ANTHROPIC_API_KEY=... OPENAI_API_KEY=... HIGGSFIELD_CREDENTIALS=KEY_ID:KEY_SECRET WORKER_SECRET=<lang tilfældig streng> APP_ENV=production
```

Valgfrit: priser pr. model i øre, fx `FILM_PRICE_HIGGSFIELD_DOP_STANDARD=800`
(se `supabase/functions/_shared/providers/catalog.ts`).

## 4. Edge Functions

```powershell
npx supabase functions deploy
```

## 5. Worker hvert minut

Køres én gang i SQL Editor. `WORKER_SECRET` lægges i Vault, så den ikke står
i klartekst i cron-jobbet.

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('<samme WORKER_SECRET som i trin 3>', 'frame_worker_secret');

select cron.schedule('frame-generation-worker', '* * * * *', $$
  select net.http_post(
    url := 'https://hiyhutpnxgsqcvsruqav.supabase.co/functions/v1/generation-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'frame_worker_secret')
    ),
    body := '{}'::jsonb
  );
$$);
```

## 6. Login

Authentication → URL Configuration: sæt **Site URL** til frontendens adresse
og tilføj den under **Redirect URLs** (lokalt: `http://localhost:5173`).

## 7. Frontend

`.env.local` (offentlige værdier — anon-nøglen findes under Connect):

```
VITE_SUPABASE_URL=https://hiyhutpnxgsqcvsruqav.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

```powershell
npm run dev      # lokalt
npm run build    # produktion → dist/
```
