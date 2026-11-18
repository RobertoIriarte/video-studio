CREATE TRIGGER checkpoint_review_owner BEFORE UPDATE OF reviewed_by ON checkpoints WHEN NEW.reviewed_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND owner_id=NEW.reviewed_by)
BEGIN SELECT RAISE(ABORT,'CHECKPOINT_REVIEW_OWNER'); END;
