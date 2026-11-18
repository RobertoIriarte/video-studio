CREATE TABLE scene_expansions (scene_version_id TEXT PRIMARY KEY NOT NULL REFERENCES scene_versions(id) ON DELETE RESTRICT, completed_at TEXT NOT NULL);
