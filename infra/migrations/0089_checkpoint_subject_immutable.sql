CREATE TRIGGER checkpoint_subject_immutable BEFORE UPDATE OF id,project_id,job_id,stage,subject_version_id,script_version_id,scene_version_id,blocking ON checkpoints
BEGIN SELECT RAISE(ABORT,'CHECKPOINT_SUBJECT_IMMUTABLE'); END;
