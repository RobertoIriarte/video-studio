CREATE TRIGGER scene_duration_guard BEFORE UPDATE OF status ON scene_versions
WHEN NEW.status <> 'DRAFT' AND EXISTS(SELECT 1 FROM shots WHERE scene_version_id=NEW.id)
AND (SELECT sum(duration_ms) FROM shots WHERE scene_version_id=NEW.id) <> NEW.duration_ms
BEGIN SELECT RAISE(ABORT,'SCENE_DURATION_INVALID'); END;
