-- 006 — Rumlyd: hver location får en baggrundslyd (fx "stille køkken, fjern
-- trafik"), som lægges lavt under dens shots, så filmen ikke er tavs mellem
-- replikkerne. Rumlyden er en betalt generering af locationens godkendte
-- master-version og følger samme porte som alt andet: intet forlader køen
-- uden et ja (generation_gate), og resultatet bruges først, når det er godkendt.

alter table public.tasks drop constraint tasks_type_check;
alter table public.tasks add constraint tasks_type_check check (type in (
  'brief.generate', 'dna.generate', 'storyboard.generate',
  'asset.master_generate', 'frame.generate', 'video.generate', 'dialogue.generate', 'ambience.generate',
  'production.batch'
));

alter table public.generations drop constraint generations_slot_check;
alter table public.generations add constraint generations_slot_check
  check (slot in ('reference', 'start_frame', 'video', 'dialogue', 'ambience'));
alter table public.generations drop constraint generation_target;
alter table public.generations add constraint generation_target check (
  (slot in ('reference', 'ambience') and asset_version_id is not null and shot_id is null)
  or (slot in ('start_frame', 'video', 'dialogue') and shot_id is not null and asset_version_id is null)
);
