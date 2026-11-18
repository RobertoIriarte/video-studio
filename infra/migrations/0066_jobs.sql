CREATE TABLE jobs (
 id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT, scene_id TEXT,
 kind TEXT NOT NULL CHECK(kind IN('VALIDATE_INPUT','RESEARCH','SCRIPT','DIRECTION','VOICE','ASSET','ALIGNMENT','EDIT','QA','RENDER','SEO')),
 execution_target TEXT NOT NULL CHECK(execution_target IN('CLOUD','LOCAL','MANUAL')),
 status TEXT NOT NULL CHECK(status IN('PENDING','READY','RUNNING','WAITING_APPROVAL','WAITING_MANUAL','WAITING_RESOURCE','RETRY_SCHEDULED','PAUSED','SUCCEEDED','FAILED','CANCELLED','STALE')),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND json_type(payload_json)='object'), input_refs_json TEXT NOT NULL CHECK(json_valid(input_refs_json) AND json_type(input_refs_json)='array'),
 output_ref TEXT CHECK(output_ref IS NULL OR json_valid(output_ref)), idempotency_key TEXT NOT NULL, input_hash TEXT NOT NULL CHECK(length(input_hash)=64),
 attempt_count INTEGER NOT NULL CHECK(typeof(attempt_count)='integer' AND attempt_count BETWEEN 0 AND 9007199254740991), max_attempts INTEGER NOT NULL CHECK(max_attempts BETWEEN 1 AND 10),
 next_run_at TEXT, lease_until TEXT, lease_token TEXT, agent_id TEXT, mutation_token TEXT, progress_json TEXT NOT NULL CHECK(json_valid(progress_json) AND json_type(progress_json)='object'), error_json TEXT CHECK(error_json IS NULL OR json_valid(error_json)),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(project_id,idempotency_key),UNIQUE(id,project_id),
 FOREIGN KEY(scene_id,project_id) REFERENCES scenes(id,project_id) ON DELETE RESTRICT,
 CHECK((status='RUNNING' AND lease_until IS NOT NULL AND lease_token IS NOT NULL) OR (status<>'RUNNING' AND lease_until IS NULL AND lease_token IS NULL))
);
