-- 003: Et ja til prisen er ikke et ja til resultatet.
--
-- En aktiv-version kan kun blive godkendt (og dermed master), når en af dens
-- reference-generationer er gennemset og godkendt af et menneske. Godkendelsen
-- af selve genereringen (budget/pris) er ikke nok.
--
-- Desuden: Storage-bucket til medier med adgang pr. organisation.

drop trigger asset_versions_require_approval on public.asset_versions;

create function public.asset_version_requires_reviewed_reference()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    if not exists (
      select 1 from public.generations g
      where g.asset_version_id = new.id and g.slot = 'reference' and g.review = 'approved' and g.org_id = new.org_id
    ) then
      raise exception 'versionen kan kun godkendes ud fra gennemsete referencer' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger asset_versions_require_reviewed_reference
  before insert or update of status on public.asset_versions
  for each row execute function public.asset_version_requires_reviewed_reference();

-- Storage findes kun i et rigtigt Supabase-miljø; testdatabasen springer det over.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('media', 'media', false)
    on conflict (id) do nothing;

    -- Stien er "{org_id}/{project_id}/{fil}": kun medlemmer af organisationen
    -- kan læse. Al skrivning sker med service_role fra Edge Functions.
    execute $p$
      create policy media_read_own_org on storage.objects for select to authenticated
      using (bucket_id = 'media' and public.is_org_member(((storage.foldername(name))[1])::uuid))
    $p$;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Budget: atomiske reservationer. Kun Edge Functions (service_role) kalder dem.
-- Tabellens budget_within_limit-constraint er den endelige vagt.
-- ---------------------------------------------------------------------------

create function public.reserve_budget(target_project uuid, cents integer)
returns boolean
language plpgsql
as $$
begin
  if cents < 0 then raise exception 'negativt beløb' using errcode = '22023'; end if;
  update public.project_budgets
    set reserved_cents = reserved_cents + cents
    where project_id = target_project and reserved_cents + spent_cents + cents <= limit_cents;
  return found;
end;
$$;

-- Frigiver en reservation (fejlet eller annulleret generering).
create function public.release_budget(target_project uuid, cents integer)
returns void
language sql
as $$
  update public.project_budgets set reserved_cents = greatest(0, reserved_cents - cents) where project_id = target_project;
$$;

-- Et færdigt job: reservationen frigives, og det faktiske beløb bogføres.
create function public.settle_budget(target_project uuid, reserved integer, actual integer)
returns void
language sql
as $$
  update public.project_budgets
    set reserved_cents = greatest(0, reserved_cents - reserved), spent_cents = spent_cents + actual
    where project_id = target_project;
$$;

revoke all on function public.reserve_budget(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_budget(uuid, integer) from public, anon, authenticated;
revoke all on function public.settle_budget(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_budget(uuid, integer) to service_role;
grant execute on function public.release_budget(uuid, integer) to service_role;
grant execute on function public.settle_budget(uuid, integer, integer) to service_role;
