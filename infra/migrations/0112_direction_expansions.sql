CREATE TABLE direction_expansions (script_version_id TEXT PRIMARY KEY NOT NULL REFERENCES script_versions(id) ON DELETE RESTRICT, completed_at TEXT NOT NULL);
