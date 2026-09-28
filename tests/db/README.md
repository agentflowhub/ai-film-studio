# Database-tests

Testene kører migrationerne mod en helt almindelig Postgres (16+) i en
midlertidig database pr. testfil. `supabase-shim.sql` efterligner det lille
udsnit af Supabase, migrationerne bruger (`auth.uid()`, `auth.users` og
rollerne `anon`, `authenticated` og `service_role`).

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db
```

Standardværdien for `DATABASE_URL` er netop den adresse. Brugeren skal have
lov til at oprette databaser og roller.
