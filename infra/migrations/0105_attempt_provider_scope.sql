CREATE TRIGGER attempt_provider_scope BEFORE INSERT ON job_attempts WHEN NEW.provider_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jobs j JOIN projects p ON p.id=j.project_id JOIN provider_configs c ON c.owner_id=p.owner_id WHERE j.id=NEW.job_id AND c.id=NEW.provider_id)
BEGIN SELECT RAISE(ABORT,'ATTEMPT_PROVIDER_SCOPE'); END;
