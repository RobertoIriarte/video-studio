ALTER TABLE job_attempts ADD COLUMN provider_id TEXT REFERENCES provider_configs(id) ON DELETE RESTRICT;
