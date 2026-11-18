CREATE TABLE usage_records (
 id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,project_id TEXT NOT NULL,job_id TEXT NOT NULL,provider_id TEXT NOT NULL,generation_id TEXT,event_key TEXT NOT NULL,request_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('RESERVED','SETTLED','RELEASED','UNKNOWN')),amount_micros INTEGER NOT NULL CHECK(typeof(amount_micros)='integer' AND amount_micros BETWEEN 0 AND 9007199254740991),reserved_micros INTEGER NOT NULL CHECK(typeof(reserved_micros)='integer' AND reserved_micros BETWEEN 0 AND 9007199254740991),currency TEXT NOT NULL,
 units INTEGER NOT NULL CHECK(typeof(units)='integer' AND units BETWEEN 0 AND 9007199254740991),reserved_units INTEGER NOT NULL CHECK(typeof(reserved_units)='integer' AND reserved_units BETWEEN 0 AND 9007199254740991),window_start INTEGER NOT NULL,units_json TEXT NOT NULL CHECK(json_valid(units_json)),observed_micros INTEGER,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(owner_id,event_key),
 FOREIGN KEY(project_id,owner_id) REFERENCES projects(id,owner_id) ON DELETE RESTRICT,FOREIGN KEY(job_id,project_id) REFERENCES jobs(id,project_id) ON DELETE RESTRICT,
 FOREIGN KEY(provider_id,owner_id) REFERENCES provider_configs(id,owner_id) ON DELETE RESTRICT);
