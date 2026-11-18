CREATE TRIGGER dependency_insert_guard BEFORE INSERT ON job_dependencies WHEN NOT EXISTS(SELECT 1 FROM jobs WHERE id=NEW.job_id AND project_id=NEW.project_id AND status='PENDING' AND attempt_count=0)
BEGIN SELECT RAISE(ABORT,'DEPENDENCY_ALREADY_SCHEDULED'); END;
