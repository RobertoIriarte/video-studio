CREATE TABLE shots (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36 AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-' AND substr(id,24,1)='-' AND length(replace(id,'-',''))=32 AND lower(replace(id,'-','')) NOT GLOB '*[^0-9a-f]*'),
  project_id TEXT NOT NULL,
  scene_version_id TEXT NOT NULL,
  order_index INTEGER NOT NULL CHECK(typeof(order_index)='integer' AND order_index BETWEEN 0 AND 9007199254740991),
  duration_ms INTEGER NOT NULL CHECK(typeof(duration_ms)='integer' AND duration_ms BETWEEN 1 AND 9007199254740991),
  type TEXT NOT NULL CHECK(type IN ('IMAGE','VIDEO','GRAPHIC')),
  prompt TEXT NOT NULL,
  camera_json TEXT NOT NULL CHECK(json_valid(camera_json) AND json_type(camera_json)='object'),
  transition_json TEXT NOT NULL CHECK(json_valid(transition_json) AND json_type(transition_json)='object'),
  asset_id TEXT,
  UNIQUE(scene_version_id,order_index),
  FOREIGN KEY(scene_version_id,project_id) REFERENCES scene_versions(id,project_id) ON DELETE RESTRICT,
  FOREIGN KEY(asset_id,project_id) REFERENCES assets(id,project_id) ON DELETE RESTRICT);
