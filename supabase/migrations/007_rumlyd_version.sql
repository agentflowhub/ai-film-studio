-- 007 — Versioner tælles pr. slags på en aktiv-version, ligesom på shots.
-- En location har både referencebilleder (slot 'reference') og rumlyd (slot
-- 'ambience'); begge starter på version 1. Det gamle indeks talte på tværs af
-- slags og afviste derfor den første rumlyd til en location med billeder.

drop index public.generations_asset_version;
create unique index generations_asset_version on public.generations(asset_version_id, slot, version) where asset_version_id is not null;
