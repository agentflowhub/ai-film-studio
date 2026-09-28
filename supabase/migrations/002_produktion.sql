-- 002: MVP 1 — filmen som produktion.
--
-- Filmversioner, Film DNA, filmregler, aktiver med versioner og master,
-- samtykke, medier, shots koblet til aktiv-versioner, afvigelser og
-- rettelseslog, generationer med provider-forsøg, budget og batch-godkendelse.
--
-- Samme principper som 001:
--   * org_id + RLS på alle tabeller; brugeren LÆSER, Edge Functions SKRIVER.
--   * Godkendelse håndhæves i databasen, ikke kun i kode.
--   * Idempotens: en betalt generering kan ikke startes to gange, og et nyt
--     provider-forsøg kan ikke startes, før det forrige er bekræftet stoppet.
-- Ingen tabel, kolonne eller værdi her kender nogen bestemt karakter eller film.

-- ---------------------------------------------------------------------------
-- Opgavetyper, projektfaser og batch
-- ---------------------------------------------------------------------------

alter table public.tasks drop constraint tasks_type_check;
alter table public.tasks add constraint tasks_type_check check (type in (
  'brief.generate', 'dna.generate', 'storyboard.generate',
  'asset.master_generate', 'frame.generate', 'video.generate',
  'production.batch'
));

-- En batch-godkendelse ("Godkend produktion") er én forælder-opgave med én
-- godkendelse; hver generering er en under-opgave, der arver dens ja.
alter table public.tasks add column parent_task_id uuid references public.tasks(id) on delete cascade;
create index tasks_parent_idx on public.tasks(parent_task_id);

alter table public.projects drop constraint projects_stage_check;
update public.projects set stage = 'production' where stage = 'storyboard_ready';
alter table public.projects add constraint projects_stage_check
  check (stage in ('briefing', 'storyboarding', 'production'));

-- Har opgaven (eller dens batch) en godkendelse med decision='approved'?
create function public.task_is_approved(target_task uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.tasks t
    join public.approvals a on a.task_id in (t.id, t.parent_task_id) and a.org_id = t.org_id
    where t.id = target_task and a.decision = 'approved'
  );
$$;

-- ---------------------------------------------------------------------------
-- Filmversioner
-- ---------------------------------------------------------------------------

create table public.film_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  number integer not null check (number >= 1),
  label text,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  unique (project_id, number)
);
create unique index film_versions_one_current on public.film_versions(project_id) where is_current;

create function public.create_first_film_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.film_versions(org_id, project_id, number) values (new.org_id, new.id, 1);
  insert into public.project_budgets(org_id, project_id) values (new.org_id, new.id);
  return new;
end;
$$;

-- Nuværende filmversion udfyldes automatisk, når intet er angivet.
create function public.fill_current_film_version()
returns trigger
language plpgsql
as $$
begin
  if new.film_version_id is null then
    select id into new.film_version_id from public.film_versions
    where project_id = new.project_id and is_current;
  end if;
  if not exists (select 1 from public.film_versions v
                 where v.id = new.film_version_id and v.project_id = new.project_id and v.org_id = new.org_id) then
    raise exception 'filmversionen hører ikke til projektet' using errcode = '23514';
  end if;
  return new;
end;
$$;

alter table public.storyboards add column film_version_id uuid references public.film_versions(id) on delete cascade;
create trigger storyboards_film_version before insert on public.storyboards
  for each row execute function public.fill_current_film_version();

-- ---------------------------------------------------------------------------
-- Budget
-- ---------------------------------------------------------------------------

create table public.project_budgets (
  project_id uuid primary key references public.projects(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  limit_cents integer not null default 50000 check (limit_cents >= 0),
  reserved_cents integer not null default 0 check (reserved_cents >= 0),
  spent_cents integer not null default 0 check (spent_cents >= 0),
  -- Reservation + forbrug kan aldrig overstige grænsen: en for dyr batch
  -- afvises af databasen, selv hvis koden regner forkert.
  constraint budget_within_limit check (reserved_cents + spent_cents <= limit_cents)
);

-- Projekter oprettet før denne migration får også version og budget.
insert into public.film_versions(org_id, project_id, number)
  select org_id, id, 1 from public.projects p
  where not exists (select 1 from public.film_versions v where v.project_id = p.id);
insert into public.project_budgets(org_id, project_id)
  select org_id, id from public.projects p
  where not exists (select 1 from public.project_budgets b where b.project_id = p.id);
update public.storyboards s set film_version_id = v.id
  from public.film_versions v where v.project_id = s.project_id and v.is_current and s.film_version_id is null;
alter table public.storyboards alter column film_version_id set not null;

create trigger projects_first_version after insert on public.projects
  for each row execute function public.create_first_film_version();

-- ---------------------------------------------------------------------------
-- Film DNA og filmregler
-- ---------------------------------------------------------------------------

create table public.film_dna (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  film_version_id uuid not null references public.film_versions(id) on delete cascade,
  version integer not null check (version >= 1),
  fields jsonb not null,
  status text not null default 'pending_approval' check (status in ('pending_approval', 'approved', 'rejected')),
  task_id uuid not null unique references public.tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (project_id, version)
);
create trigger film_dna_film_version before insert on public.film_dna
  for each row execute function public.fill_current_film_version();
create trigger film_dna_require_approval before insert or update of status on public.film_dna
  for each row execute function public.require_approval_for_approved_status();

create table public.film_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  text text not null check (length(trim(text)) between 1 and 200),
  -- Valgfrit søgemønster; uden mønster bruges reglen kun i prompten.
  pattern text check (pattern is null or length(pattern) <= 300),
  reason text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index film_rules_project_idx on public.film_rules(project_id);

-- ---------------------------------------------------------------------------
-- Medier (filer i Storage)
-- ---------------------------------------------------------------------------

create table public.media (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  storage_path text not null unique,
  kind text not null check (kind in ('image', 'video', 'audio')),
  mime text not null,
  bytes bigint not null check (bytes > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  width integer,
  height integer,
  duration_ms integer,
  source text not null check (source in ('upload', 'generation', 'render')),
  created_at timestamptz not null default now(),
  -- Stien skal ligge under organisationens og projektets mappe.
  constraint media_path_scoped check (storage_path like org_id::text || '/' || project_id::text || '/%')
);

-- ---------------------------------------------------------------------------
-- Aktiver: karakterer, locations, køretøjer, props
-- ---------------------------------------------------------------------------

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('character', 'location', 'vehicle', 'prop')),
  code text not null check (code ~ '^[A-Z]+_[A-Z0-9_]+$'),
  name text not null check (length(trim(name)) between 1 and 120),
  role text,
  master_version_id uuid,
  -- Karakterer kræver samtykke, før der må genereres billeder af dem.
  consent_status text not null default 'not_required'
    check (consent_status in ('not_required', 'missing', 'confirmed')),
  consent_confirmed_by uuid references auth.users(id),
  consent_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, code),
  constraint character_consent check (kind <> 'character' or consent_status in ('missing', 'confirmed')),
  constraint consent_who check (consent_status <> 'confirmed' or (consent_confirmed_by is not null and consent_confirmed_at is not null))
);
create index assets_project_idx on public.assets(project_id);

create table public.asset_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  version integer not null check (version >= 1),
  attributes jsonb not null default '{}'::jsonb,
  -- Kontinuitetsmønstre pr. attribut: [{ "attribute": "...", "pattern": "...", "flags": "i" }]
  continuity_rules jsonb not null default '[]'::jsonb,
  note text,
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'rejected')),
  -- Opgaven, der lavede versionens master-referencer (null for en kladde).
  task_id uuid unique references public.tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (asset_id, version)
);

alter table public.assets add constraint assets_master_fk
  foreign key (master_version_id) references public.asset_versions(id) on delete restrict;

create trigger asset_versions_require_approval before insert or update of status on public.asset_versions
  for each row execute function public.require_approval_for_approved_status();

-- En godkendt version er låst: identitet og kontinuitetsregler kan ikke ændres.
create function public.asset_version_locked()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'approved' and (new.attributes is distinct from old.attributes
      or new.continuity_rules is distinct from old.continuity_rules
      or new.status is distinct from old.status) then
    raise exception 'en godkendt version kan ikke ændres — lav en ny version' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger asset_versions_locked before update on public.asset_versions
  for each row execute function public.asset_version_locked();

create function public.asset_version_same_org()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.assets a where a.id = new.asset_id and a.org_id = new.org_id) then
    raise exception 'version og aktiv tilhører ikke samme organisation' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger asset_versions_same_org before insert or update on public.asset_versions
  for each row execute function public.asset_version_same_org();

-- Master skal være en godkendt version af netop dette aktiv.
create function public.asset_master_valid()
returns trigger
language plpgsql
as $$
begin
  if new.master_version_id is not null and not exists (
    select 1 from public.asset_versions v
    where v.id = new.master_version_id and v.asset_id = new.id and v.status = 'approved'
  ) then
    raise exception 'master skal være en godkendt version af aktivet' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger assets_master_valid before insert or update of master_version_id on public.assets
  for each row execute function public.asset_master_valid();

create table public.asset_references (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  asset_version_id uuid not null references public.asset_versions(id) on delete cascade,
  media_id uuid not null references public.media(id) on delete restrict,
  role text not null check (role ~ '^[a-z_]+$'),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (asset_version_id, role)
);

-- ---------------------------------------------------------------------------
-- Shots som produktionsenheder
-- ---------------------------------------------------------------------------

-- Fritekst om karakterer, location og props erstattes af shot_assets.
alter table public.shots drop column characters;
alter table public.shots drop column location;
alter table public.shots drop column props;

alter table public.shots
  add column code text,
  add column lens_mm integer check (lens_mm is null or lens_mm between 8 and 600),
  add column movement text not null default 'static'
    check (movement in ('static', 'pan', 'tilt', 'handheld', 'dolly', 'optical_zoom')),
  add column lighting text,
  add column performance text,
  add column audio text,
  add column notes text,
  add column start_frame_required boolean not null default true,
  add column video_required boolean not null default true,
  add column spec_version integer not null default 1 check (spec_version >= 1),
  add column approved_start_frame_id uuid,
  add column approved_video_id uuid;

update public.shots set code = 'SHOT_' || lpad(row_number::text, 2, '0')
  from (select id as sid, row_number() over (partition by storyboard_id order by scene_number, shot_number) from public.shots) n
  where n.sid = shots.id;
alter table public.shots alter column code set not null;
alter table public.shots add constraint shots_code_format check (code ~ '^SHOT_[0-9]{2,3}$');
alter table public.shots add constraint shots_code_unique unique (storyboard_id, code);

create table public.shot_assets (
  org_id uuid not null references public.orgs(id) on delete cascade,
  shot_id uuid not null references public.shots(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  -- Låst til en bestemt version; et shot følger ikke automatisk en ny master.
  asset_version_id uuid not null references public.asset_versions(id) on delete restrict,
  role text not null default 'subject' check (role in ('subject', 'background', 'vehicle', 'prop')),
  -- Brugeren har bevidst valgt at beholde en ældre version.
  pinned boolean not null default false,
  primary key (shot_id, asset_id)
);

create function public.shot_asset_valid()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.shots s
    join public.storyboards b on b.id = s.storyboard_id
    join public.assets a on a.id = new.asset_id and a.project_id = b.project_id
    join public.asset_versions v on v.id = new.asset_version_id and v.asset_id = a.id
    where s.id = new.shot_id and s.org_id = new.org_id and a.org_id = new.org_id
  ) then
    raise exception 'aktiv-versionen hører ikke til shottets projekt' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger shot_assets_valid before insert or update on public.shot_assets
  for each row execute function public.shot_asset_valid();

create table public.shot_deviations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  shot_id uuid not null references public.shots(id) on delete cascade,
  kind text not null check (kind in ('attribute', 'rule')),
  asset_id uuid references public.assets(id) on delete cascade,
  attribute text,
  rule_id uuid references public.film_rules(id) on delete cascade,
  shot_value text not null,
  reason text,
  decided_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint deviation_target check (
    (kind = 'attribute' and asset_id is not null and attribute is not null and rule_id is null)
    or (kind = 'rule' and rule_id is not null and asset_id is null)
  )
);

-- Alt, systemet selv retter i et shot, logges synligt og kan fortrydes.
create table public.shot_fix_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  shot_id uuid not null references public.shots(id) on delete cascade,
  text text not null,
  -- Felternes værdier før rettelsen; null for hændelser, der ikke kan fortrydes.
  before jsonb,
  undone_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Generationer og provider-forsøg
-- ---------------------------------------------------------------------------

create table public.generations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid not null unique references public.tasks(id) on delete cascade,
  slot text not null check (slot in ('reference', 'start_frame', 'video')),
  shot_id uuid references public.shots(id) on delete cascade,
  asset_version_id uuid references public.asset_versions(id) on delete cascade,
  version integer not null check (version >= 1),
  -- Det kompilerede input og dets hash afgør, om resultatet senere er forældet.
  input jsonb not null,
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  spec_version integer,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  review text check (review in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  cost_estimate_cents integer not null check (cost_estimate_cents >= 0),
  cost_actual_cents integer check (cost_actual_cents >= 0),
  output_media_id uuid references public.media(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint generation_target check (
    (slot = 'reference' and asset_version_id is not null and shot_id is null)
    or (slot in ('start_frame', 'video') and shot_id is not null and asset_version_id is null)
  ),
  constraint review_needs_result check (review is null or status = 'succeeded'),
  constraint result_needs_media check (status <> 'succeeded' or output_media_id is not null)
);
create unique index generations_shot_version on public.generations(shot_id, slot, version) where shot_id is not null;
create unique index generations_asset_version on public.generations(asset_version_id, version) where asset_version_id is not null;
create index generations_project_idx on public.generations(project_id);

create trigger generations_touch before update on public.generations
  for each row execute function public.touch_updated_at();

-- Portvagt: en betalt generering kan ikke forlade køen uden et ja (på
-- opgaven eller dens batch), og kan ikke startes for en karakter uden samtykke.
create function public.generation_gate()
returns trigger
language plpgsql
as $$
begin
  if new.status <> 'queued' and new.status <> 'cancelled'
     and (tg_op = 'INSERT' or old.status = 'queued') then
    if not public.task_is_approved(new.task_id) then
      raise exception 'betalt generering kræver en godkendelse' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'INSERT' and exists (
    select 1 from public.assets a
    where a.kind = 'character' and a.consent_status <> 'confirmed'
      and (a.id in (select v.asset_id from public.asset_versions v where v.id = new.asset_version_id)
        or a.id in (select sa.asset_id from public.shot_assets sa where sa.shot_id = new.shot_id))
  ) then
    raise exception 'en karakter i genereringen mangler samtykke' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger generations_gate before insert or update of status on public.generations
  for each row execute function public.generation_gate();

create table public.generation_attempts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  generation_id uuid not null references public.generations(id) on delete cascade,
  attempt integer not null check (attempt >= 1),
  provider text not null,
  model text not null,
  provider_job_id text,
  status text not null default 'waiting'
    check (status in ('waiting', 'submitted', 'running', 'succeeded', 'failed', 'cancelled')),
  error jsonb,
  -- Provideren har bekræftet, at jobbet er stoppet (og ikke faktureres).
  stop_confirmed boolean not null default false,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (generation_id, attempt),
  unique (provider, provider_job_id)
);
-- Højst ét aktivt forsøg ad gangen pr. generering.
create unique index generation_attempts_one_active on public.generation_attempts(generation_id)
  where status in ('waiting', 'submitted', 'running');

-- Failover uden dobbeltbetaling: et nyt forsøg kan kun oprettes, når alle
-- tidligere forsøg er afsluttet uden resultat, og ethvert job, der nåede
-- frem til en provider, er bekræftet stoppet.
create function public.attempt_failover_guard()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.generation_attempts p
    where p.generation_id = new.generation_id and p.attempt < new.attempt
      and (p.status not in ('failed', 'cancelled')
           or (p.provider_job_id is not null and not p.stop_confirmed))
  ) then
    raise exception 'forrige forsøg er ikke bekræftet stoppet' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger generation_attempts_failover before insert on public.generation_attempts
  for each row execute function public.attempt_failover_guard();

-- Et shot kan kun pege på godkendte resultater fra sig selv, og video kræver
-- en godkendt startframe, når shottet har en.
create function public.shot_approved_outputs_valid()
returns trigger
language plpgsql
as $$
begin
  if new.approved_start_frame_id is not null and not exists (
    select 1 from public.generations g
    where g.id = new.approved_start_frame_id and g.shot_id = new.id and g.slot = 'start_frame' and g.review = 'approved'
  ) then
    raise exception 'startframen er ikke en godkendt generation af dette shot' using errcode = '23514';
  end if;
  if new.approved_video_id is not null then
    if not exists (
      select 1 from public.generations g
      where g.id = new.approved_video_id and g.shot_id = new.id and g.slot = 'video' and g.review = 'approved'
    ) then
      raise exception 'videoen er ikke en godkendt generation af dette shot' using errcode = '23514';
    end if;
    if new.start_frame_required and new.approved_start_frame_id is null then
      raise exception 'video kræver en godkendt startframe' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
alter table public.shots add constraint shots_start_frame_fk foreign key (approved_start_frame_id) references public.generations(id) on delete set null;
alter table public.shots add constraint shots_video_fk foreign key (approved_video_id) references public.generations(id) on delete set null;
create trigger shots_approved_outputs before insert or update of approved_start_frame_id, approved_video_id, start_frame_required
  on public.shots for each row execute function public.shot_approved_outputs_valid();

-- Alle tabeller i denne migration, der peger på en forælder, skal dele org_id med den.
create function public.same_org_as_project()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.projects p where p.id = new.project_id and p.org_id = new.org_id) then
    raise exception 'rækken og projektet tilhører ikke samme organisation' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger film_versions_org before insert or update on public.film_versions for each row execute function public.same_org_as_project();
create trigger film_dna_org before insert or update on public.film_dna for each row execute function public.same_org_as_project();
create trigger film_rules_org before insert or update on public.film_rules for each row execute function public.same_org_as_project();
create trigger media_org before insert or update on public.media for each row execute function public.same_org_as_project();
create trigger assets_org before insert or update on public.assets for each row execute function public.same_org_as_project();
create trigger generations_org before insert or update on public.generations for each row execute function public.same_org_as_project();
create trigger budgets_org before insert or update on public.project_budgets for each row execute function public.same_org_as_project();

create function public.same_org_as_shot()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.shots s where s.id = new.shot_id and s.org_id = new.org_id) then
    raise exception 'rækken og shottet tilhører ikke samme organisation' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger shot_deviations_org before insert or update on public.shot_deviations for each row execute function public.same_org_as_shot();
create trigger shot_fix_log_org before insert or update on public.shot_fix_log for each row execute function public.same_org_as_shot();

create function public.same_org_as_generation()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.generations g where g.id = new.generation_id and g.org_id = new.org_id) then
    raise exception 'forsøget og genereringen tilhører ikke samme organisation' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger generation_attempts_org before insert or update on public.generation_attempts for each row execute function public.same_org_as_generation();

create function public.same_org_as_asset_version()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.asset_versions v where v.id = new.asset_version_id and v.org_id = new.org_id) then
    raise exception 'referencen og versionen tilhører ikke samme organisation' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger asset_references_org before insert or update on public.asset_references for each row execute function public.same_org_as_asset_version();

-- ---------------------------------------------------------------------------
-- RLS og grants
-- ---------------------------------------------------------------------------

alter table public.film_versions enable row level security;
alter table public.project_budgets enable row level security;
alter table public.film_dna enable row level security;
alter table public.film_rules enable row level security;
alter table public.media enable row level security;
alter table public.assets enable row level security;
alter table public.asset_versions enable row level security;
alter table public.asset_references enable row level security;
alter table public.shot_assets enable row level security;
alter table public.shot_deviations enable row level security;
alter table public.shot_fix_log enable row level security;
alter table public.generations enable row level security;
alter table public.generation_attempts enable row level security;

create policy film_versions_select on public.film_versions for select to authenticated using (public.is_org_member(org_id));
create policy project_budgets_select on public.project_budgets for select to authenticated using (public.is_org_member(org_id));
create policy film_dna_select on public.film_dna for select to authenticated using (public.is_org_member(org_id));
create policy film_rules_select on public.film_rules for select to authenticated using (public.is_org_member(org_id));
create policy media_select on public.media for select to authenticated using (public.is_org_member(org_id));
create policy assets_select on public.assets for select to authenticated using (public.is_org_member(org_id));
create policy asset_versions_select on public.asset_versions for select to authenticated using (public.is_org_member(org_id));
create policy asset_references_select on public.asset_references for select to authenticated using (public.is_org_member(org_id));
create policy shot_assets_select on public.shot_assets for select to authenticated using (public.is_org_member(org_id));
create policy shot_deviations_select on public.shot_deviations for select to authenticated using (public.is_org_member(org_id));
create policy shot_fix_log_select on public.shot_fix_log for select to authenticated using (public.is_org_member(org_id));
create policy generations_select on public.generations for select to authenticated using (public.is_org_member(org_id));
create policy generation_attempts_select on public.generation_attempts for select to authenticated using (public.is_org_member(org_id));

revoke all on public.film_versions, public.project_budgets, public.film_dna, public.film_rules,
  public.media, public.assets, public.asset_versions, public.asset_references, public.shot_assets,
  public.shot_deviations, public.shot_fix_log, public.generations, public.generation_attempts
  from anon, authenticated;

grant select on public.film_versions, public.project_budgets, public.film_dna, public.film_rules,
  public.media, public.assets, public.asset_versions, public.asset_references, public.shot_assets,
  public.shot_deviations, public.shot_fix_log, public.generations, public.generation_attempts
  to authenticated;

grant all on public.film_versions, public.project_budgets, public.film_dna, public.film_rules,
  public.media, public.assets, public.asset_versions, public.asset_references, public.shot_assets,
  public.shot_deviations, public.shot_fix_log, public.generations, public.generation_attempts
  to service_role;

revoke all on function public.task_is_approved(uuid) from public, anon;
grant execute on function public.task_is_approved(uuid) to authenticated, service_role;
