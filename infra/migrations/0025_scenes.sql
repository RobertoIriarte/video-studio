CREATE TABLE scenes (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36 AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-' AND substr(id,24,1)='-' AND length(replace(id,'-',''))=32 AND lower(replace(id,'-','')) NOT GLOB '*[^0-9a-f]*'),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  stable_key TEXT NOT NULL CHECK(length(trim(stable_key)) BETWEEN 1 AND 128),
  order_index INTEGER NOT NULL CHECK(typeof(order_index)='integer' AND order_index BETWEEN 0 AND 9007199254740991),
  active_version_id TEXT,
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
  archived_at TEXT,
  UNIQUE(project_id,stable_key),
  UNIQUE(id,project_id),
  FOREIGN KEY(active_version_id,id,project_id) REFERENCES scene_versions(id,scene_id,project_id) ON DELETE RESTRICT);
