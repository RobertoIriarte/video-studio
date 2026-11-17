CREATE TABLE sources (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36 AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-' AND substr(id,24,1)='-' AND length(replace(id,'-',''))=32 AND lower(replace(id,'-','')) NOT GLOB '*[^0-9a-f]*'),
  research_version_id TEXT NOT NULL REFERENCES research_versions(id) ON DELETE RESTRICT,
  url TEXT,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 500),
  acquired_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',acquired_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',acquired_at)=acquired_at),
  notes TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK(provenance IN ('MANUAL','PROVIDER')),
  access_status TEXT NOT NULL CHECK(access_status IN ('UNKNOWN','ACCESSIBLE','UNAVAILABLE')));
