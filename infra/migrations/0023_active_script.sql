ALTER TABLE projects ADD COLUMN active_script_version_id TEXT REFERENCES script_versions(id) ON DELETE RESTRICT;
