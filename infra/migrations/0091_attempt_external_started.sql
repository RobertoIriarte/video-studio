ALTER TABLE job_attempts ADD COLUMN external_started INTEGER NOT NULL DEFAULT 0 CHECK(external_started IN(0,1));
