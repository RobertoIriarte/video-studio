CREATE TRIGGER manifest_immutable BEFORE UPDATE OF id,project_id,version_no,content_hash,manifest_json,created_at ON render_manifests BEGIN SELECT RAISE(ABORT,'IMMUTABLE_MANIFEST'); END;
