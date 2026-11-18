CREATE UNIQUE INDEX usage_active_job_idx ON usage_records(job_id) WHERE status IN('RESERVED','UNKNOWN');
