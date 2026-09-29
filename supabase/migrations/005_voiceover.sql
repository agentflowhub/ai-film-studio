-- 005 — Voiceover: en replik kan høres over andre billeder.
--
-- 'on_camera': taleren ses i shottet, og munden følger lyden (Speak).
-- 'voiceover': stemmen lægges over billedet uden læbesynk og må fortsætte
--   hen over de følgende shots — som interviewstemmen over dækbilleder.
--   Taleren behøver ikke være med i shottet; den skal blot være en karakter
--   i samme film (tjekkes allerede af shot_approved_outputs_valid).

alter table public.shots
  add column dialogue_mode text not null default 'on_camera'
    check (dialogue_mode in ('on_camera', 'voiceover'));
