-- 004 — Dansk tale: stemmer på karakterer, replikker som lyd, talende shots.
--
-- Flow pr. shot med replik:
--   1. Karakteren, der taler, har en fast stemme (assets.voice_id).
--   2. Replikken genereres som lyd (slot 'dialogue') og godkendes af et menneske.
--   3. Videoen laves ud fra startframen OG den godkendte lyd, så munden følger
--      den danske replik. Videoen kræver derfor en godkendt replik.
-- Replik-lyd er en betalt generering og følger samme porte som billeder og
-- video: intet forlader køen uden et ja (generation_gate).

-- ---------------------------------------------------------------------------
-- Stemme på karakterer
-- ---------------------------------------------------------------------------

alter table public.assets
  add column voice_id text check (voice_id is null or voice_id ~ '^[A-Za-z0-9_-]{4,64}$'),
  add column voice_name text check (voice_name is null or length(voice_name) between 1 and 120),
  add constraint voice_only_characters check (voice_id is null or kind = 'character');

-- ---------------------------------------------------------------------------
-- Hvem taler i shottet, og hvilken replik-lyd er godkendt
-- ---------------------------------------------------------------------------

alter table public.shots
  add column speaker_asset_id uuid references public.assets(id) on delete set null,
  add column approved_dialogue_id uuid;

-- ---------------------------------------------------------------------------
-- Ny opgavetype og nyt slot
-- ---------------------------------------------------------------------------

alter table public.tasks drop constraint tasks_type_check;
alter table public.tasks add constraint tasks_type_check check (type in (
  'brief.generate', 'dna.generate', 'storyboard.generate',
  'asset.master_generate', 'frame.generate', 'video.generate', 'dialogue.generate',
  'production.batch'
));

alter table public.generations drop constraint generations_slot_check;
alter table public.generations add constraint generations_slot_check
  check (slot in ('reference', 'start_frame', 'video', 'dialogue'));
alter table public.generations drop constraint generation_target;
alter table public.generations add constraint generation_target check (
  (slot = 'reference' and asset_version_id is not null and shot_id is null)
  or (slot in ('start_frame', 'video', 'dialogue') and shot_id is not null and asset_version_id is null)
);

alter table public.shots add constraint shots_dialogue_fk
  foreign key (approved_dialogue_id) references public.generations(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Shottets godkendte resultater: også replikken skal være en godkendt
-- generation af netop dette shot, og taleren skal være en karakter i shottet.
-- ---------------------------------------------------------------------------

create or replace function public.shot_approved_outputs_valid()
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
  if new.approved_dialogue_id is not null and not exists (
    select 1 from public.generations g
    where g.id = new.approved_dialogue_id and g.shot_id = new.id and g.slot = 'dialogue' and g.review = 'approved'
  ) then
    raise exception 'replikken er ikke en godkendt generation af dette shot' using errcode = '23514';
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
  if new.speaker_asset_id is not null and not exists (
    select 1 from public.assets a
    where a.id = new.speaker_asset_id and a.kind = 'character'
      and exists (select 1 from public.storyboards sb where sb.id = new.storyboard_id and sb.project_id = a.project_id)
  ) then
    raise exception 'taleren skal være en karakter i samme film' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger shots_approved_outputs on public.shots;
create trigger shots_approved_outputs
  before insert or update of approved_start_frame_id, approved_video_id, approved_dialogue_id, start_frame_required, speaker_asset_id
  on public.shots for each row execute function public.shot_approved_outputs_valid();
