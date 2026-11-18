CREATE TABLE job_attempts (
 id TEXT PRIMARY KEY NOT NULL,job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,attempt_no INTEGER NOT NULL CHECK(typeof(attempt_no)='integer' AND attempt_no BETWEEN 1 AND 9007199254740991),request_id TEXT NOT NULL,
 lease_token TEXT NOT NULL,provider_operation_id TEXT,start_at TEXT NOT NULL,end_at TEXT,
 status TEXT NOT NULL CHECK(status IN('RUNNING','SUCCEEDED','FAILED','UNKNOWN','CANCELLED')),error_code TEXT,result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
 UNIQUE(job_id,attempt_no),CHECK((status='RUNNING' AND end_at IS NULL) OR (status<>'RUNNING' AND end_at IS NOT NULL)));
