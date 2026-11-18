ALTER TABLE projects ADD COLUMN active_manifest_id TEXT REFERENCES render_manifests(id) ON DELETE RESTRICT;
