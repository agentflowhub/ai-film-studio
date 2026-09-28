-- 001: Kernen for bid 1 — projekter, opgaver, godkendelser, film-briefs,
-- storyboards og shots.
--
-- Principper (se CLAUDE.md):
--   * org_id + RLS på ALLE tabeller fra første migration.
--   * Brugeren (authenticated) må kun LÆSE produktionsdata. Alt, der ændrer
--     status eller skaber AI-output, går gennem Edge Functions med
--     service_role — så en klient aldrig selv kan skrive en godkendelse
--     eller flytte et brief til "approved".
--   * Godkendelse håndhæves i databasen (triggere nedenfor), ikke kun i kode:
--     et brief/storyboard kan fysisk ikke blive "approved" uden en
--     approvals-række med decision='approved', og et storyboard kan ikke
--     oprettes på et brief, der ikke er godkendt.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Organisationer og medlemskab
-- ---------------------------------------------------------------------------

create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  -- orgs.id ER org_id; kolonnen findes, så reglen "org_id på alle tabeller"
  -- holder uden undtagelser, og RLS kan skrives ens overalt.
  org_id uuid not null generated always as (id) stored,
  name text not null check (length(trim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.org_members (
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index org_members_user_idx on public.org_members(user_id);

-- security definer, så policies på org_members selv ikke rekurserer.
create function public.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = target_org and m.user_id = auth.uid()
  );
$$;

-- Første login: brugeren opretter sin egen organisation og bliver ejer.
create function public.create_org(org_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'ikke logget ind' using errcode = '42501';
  end if;
  insert into public.orgs(name) values (org_name) returning id into new_id;
  insert into public.org_members(org_id, user_id, role) values (new_id, auth.uid(), 'owner');
  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Projekter (én film)
-- ---------------------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  idea text not null check (length(trim(idea)) between 1 and 4000),
  -- briefing → storyboarding → storyboard_ready. Senere bidder tilføjer flere.
  stage text not null default 'briefing'
    check (stage in ('briefing', 'storyboarding', 'storyboard_ready')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_org_idx on public.projects(org_id);

-- ---------------------------------------------------------------------------
-- Opgaver og godkendelser (samme model som agentFLOW)
-- ---------------------------------------------------------------------------

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  type text not null check (type in ('brief.generate', 'storyboard.generate')),
  status text not null default 'proposed'
    check (status in ('proposed', 'pending_approval', 'approved', 'executing',
                      'done', 'rejected', 'failed')),
  -- Idempotens: samme nøgle kan aldrig starte samme generering to gange.
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error jsonb,
  attempts integer not null default 0,
  model text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, idempotency_key)
);

create index tasks_project_idx on public.tasks(project_id);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  task_id uuid not null unique references public.tasks(id) on delete cascade,
  decision text not null check (decision in ('approved', 'rejected')),
  comment text check (comment is null or length(comment) <= 2000),
  decided_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- En godkendelse skal tilhøre samme org som opgaven.
create function public.approvals_same_org()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.tasks t where t.id = new.task_id and t.org_id = new.org_id) then
    raise exception 'godkendelse og opgave tilhører ikke samme organisation' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger approvals_same_org
  before insert or update on public.approvals
  for each row execute function public.approvals_same_org();

-- ---------------------------------------------------------------------------
-- Film Brief og storyboard
-- ---------------------------------------------------------------------------

create table public.film_briefs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid not null unique references public.tasks(id) on delete cascade,
  version integer not null check (version >= 1),
  answers jsonb not null,
  content jsonb not null,
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  unique (project_id, version)
);

create table public.storyboards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  brief_id uuid not null references public.film_briefs(id) on delete cascade,
  task_id uuid not null unique references public.tasks(id) on delete cascade,
  version integer not null check (version >= 1),
  content jsonb not null,
  total_seconds numeric(7, 1) not null check (total_seconds > 0),
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  unique (project_id, version)
);

create table public.shots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  storyboard_id uuid not null references public.storyboards(id) on delete cascade,
  scene_number integer not null check (scene_number >= 1),
  shot_number integer not null check (shot_number >= 1),
  duration_seconds numeric(5, 1) not null check (duration_seconds > 0),
  shot_type text not null,
  camera text not null,
  action text not null,
  dialogue text,
  characters text[] not null default '{}',
  location text not null,
  props text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (storyboard_id, scene_number, shot_number)
);

create index shots_storyboard_idx on public.shots(storyboard_id);

-- ---------------------------------------------------------------------------
-- Forbrug (tokens pr. opgave)
-- ---------------------------------------------------------------------------

create table public.usage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Godkendelses-vagter i databasen
-- ---------------------------------------------------------------------------

-- Et output kan kun blive 'approved', hvis dets opgave har en godkendelse
-- med decision='approved'. Gælder både briefs og storyboards.
create function public.require_approval_for_approved_status()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    if not exists (
      select 1 from public.approvals a
      where a.task_id = new.task_id and a.decision = 'approved' and a.org_id = new.org_id
    ) then
      raise exception 'kan ikke godkendes uden en godkendelse' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger film_briefs_require_approval
  before insert or update of status on public.film_briefs
  for each row execute function public.require_approval_for_approved_status();

create trigger storyboards_require_approval
  before insert or update of status on public.storyboards
  for each row execute function public.require_approval_for_approved_status();

-- Et storyboard bygger videre på et brief — kun et godkendt brief i samme
-- projekt og org må bruges.
create function public.storyboard_requires_approved_brief()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.film_briefs b
    where b.id = new.brief_id
      and b.status = 'approved'
      and b.project_id = new.project_id
      and b.org_id = new.org_id
  ) then
    raise exception 'storyboard kræver et godkendt brief' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger storyboards_require_approved_brief
  before insert on public.storyboards
  for each row execute function public.storyboard_requires_approved_brief();

-- Et shot tilhører samme org som sit storyboard.
create function public.shots_same_org()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.storyboards s where s.id = new.storyboard_id and s.org_id = new.org_id) then
    raise exception 'shot og storyboard tilhører ikke samme organisation' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger shots_same_org
  before insert or update on public.shots
  for each row execute function public.shots_same_org();

-- updated_at vedligeholdes automatisk.
create function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.orgs enable row level security;
alter table public.org_members enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.approvals enable row level security;
alter table public.film_briefs enable row level security;
alter table public.storyboards enable row level security;
alter table public.shots enable row level security;
alter table public.usage enable row level security;

create policy orgs_select on public.orgs
  for select to authenticated using (public.is_org_member(org_id));

create policy org_members_select on public.org_members
  for select to authenticated using (public.is_org_member(org_id));

create policy projects_select on public.projects
  for select to authenticated using (public.is_org_member(org_id));
-- Et projekt er kun en titel og en idé — intet AI-output, ingen status, der
-- kræver godkendelse — så brugeren må selv oprette det direkte.
create policy projects_insert on public.projects
  for insert to authenticated
  with check (public.is_org_member(org_id) and created_by = auth.uid() and stage = 'briefing');

create policy tasks_select on public.tasks
  for select to authenticated using (public.is_org_member(org_id));
create policy approvals_select on public.approvals
  for select to authenticated using (public.is_org_member(org_id));
create policy film_briefs_select on public.film_briefs
  for select to authenticated using (public.is_org_member(org_id));
create policy storyboards_select on public.storyboards
  for select to authenticated using (public.is_org_member(org_id));
create policy shots_select on public.shots
  for select to authenticated using (public.is_org_member(org_id));
create policy usage_select on public.usage
  for select to authenticated using (public.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Grants — eksplicitte, fordi nye tabeller ikke auto-eksponeres
-- ---------------------------------------------------------------------------

revoke all on public.orgs, public.org_members, public.projects, public.tasks,
  public.approvals, public.film_briefs, public.storyboards, public.shots,
  public.usage from anon, authenticated;

grant select on public.orgs, public.org_members, public.projects, public.tasks,
  public.approvals, public.film_briefs, public.storyboards, public.shots,
  public.usage to authenticated;
grant insert (org_id, title, idea, created_by) on public.projects to authenticated;

grant all on public.orgs, public.org_members, public.projects, public.tasks,
  public.approvals, public.film_briefs, public.storyboards, public.shots,
  public.usage to service_role;

revoke all on function public.create_org(text) from public, anon;
grant execute on function public.create_org(text) to authenticated;
revoke all on function public.is_org_member(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;
