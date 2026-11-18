CREATE TABLE activity_events (
 id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,project_id TEXT NOT NULL,job_id TEXT,actor_type TEXT NOT NULL CHECK(actor_type IN('SYSTEM','USER','AGENT')),actor_id TEXT,
 action TEXT NOT NULL CHECK(action IN('JOB_CREATED','JOB_READY','JOB_CLAIMED','JOB_SUCCEEDED','JOB_FAILED','JOB_RETRY','JOB_UNKNOWN','PROJECT_PAUSED','PROJECT_RESUMED','CHECKPOINT_APPROVED','CHECKPOINT_CREATED')),
 details_json TEXT NOT NULL CHECK(json_valid(details_json) AND json_type(details_json)='object'),created_at TEXT NOT NULL,FOREIGN KEY(project_id,owner_id) REFERENCES projects(id,owner_id) ON DELETE RESTRICT,
 FOREIGN KEY(job_id,project_id) REFERENCES jobs(id,project_id) ON DELETE RESTRICT);
