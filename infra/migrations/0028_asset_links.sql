CREATE TABLE asset_links (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36 AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-' AND substr(id,24,1)='-' AND length(replace(id,'-',''))=32 AND lower(replace(id,'-','')) NOT GLOB '*[^0-9a-f]*'),
  project_id TEXT NOT NULL,
  scene_version_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('VISUAL','VOICE','MUSIC','AMBIENCE','SFX')),
  offset_ms INTEGER NOT NULL CHECK(typeof(offset_ms)='integer' AND offset_ms BETWEEN 0 AND 9007199254740991),
  trim_start_ms INTEGER NOT NULL CHECK(typeof(trim_start_ms)='integer' AND trim_start_ms BETWEEN 0 AND 9007199254740991),
  trim_end_ms INTEGER CHECK(trim_end_ms IS NULL OR (typeof(trim_end_ms)='integer' AND trim_end_ms BETWEEN 1 AND 9007199254740991 AND trim_end_ms>trim_start_ms)),
  FOREIGN KEY(scene_version_id,project_id) REFERENCES scene_versions(id,project_id) ON DELETE RESTRICT,
  FOREIGN KEY(asset_id,project_id) REFERENCES assets(id,project_id) ON DELETE RESTRICT);
