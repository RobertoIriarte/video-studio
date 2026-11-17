CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL CHECK (
    length(id) = 36 AND substr(id,9,1) = '-' AND substr(id,14,1) = '-'
    AND substr(id,19,1) = '-' AND substr(id,24,1) = '-'
    AND length(replace(id,'-','')) = 32
    AND lower(replace(id,'-','')) NOT GLOB '*[^0-9a-f]*'
  ),
  owner_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  input_type TEXT NOT NULL CHECK (input_type IN ('TOPIC','SCRIPT','SOURCES')),
  input_text TEXT NOT NULL CHECK (length(trim(input_text)) > 0),
  mode TEXT NOT NULL CHECK (mode IN ('AUTO','SUPERVISED')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT','RUNNING','WAITING_APPROVAL','WAITING_RESOURCE','PAUSING','PAUSED',
    'FAILED','READY_RENDER','RENDERING','COMPLETED','ARCHIVED'
  )),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(revision) = 'integer' AND revision BETWEEN 1 AND 9007199254740991
  ),
  created_at TEXT NOT NULL CHECK (
    strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at) = created_at
  ),
  updated_at TEXT NOT NULL CHECK (
    strftime('%Y-%m-%dT%H:%M:%fZ',updated_at) IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%fZ',updated_at) = updated_at
    AND updated_at >= created_at
  ),
  archived_at TEXT CHECK (
    archived_at IS NULL OR (
      strftime('%Y-%m-%dT%H:%M:%fZ',archived_at) IS NOT NULL
      AND strftime('%Y-%m-%dT%H:%M:%fZ',archived_at) = archived_at
      AND archived_at >= created_at
    )
  ),
  CHECK ((status = 'ARCHIVED' AND archived_at IS NOT NULL)
    OR (status <> 'ARCHIVED' AND archived_at IS NULL))
);
