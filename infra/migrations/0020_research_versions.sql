CREATE TABLE research_versions (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36 AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-' AND substr(id,24,1)='-' AND length(replace(id,'-',''))=32 AND lower(replace(id,'-','')) NOT GLOB '*[^0-9a-f]*'),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  version_no INTEGER NOT NULL CHECK(typeof(version_no)='integer' AND version_no BETWEEN 1 AND 9007199254740991),
  data_json TEXT NOT NULL CHECK(json_valid(data_json) AND json_type(data_json)='object'),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL CHECK(status IN ('DRAFT','CANDIDATE','APPROVED','SUPERSEDED','INVALIDATED')),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at),
  UNIQUE(project_id,version_no),
  UNIQUE(id,project_id));
