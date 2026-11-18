ALTER TABLE jobs ADD COLUMN selected_provider_id TEXT REFERENCES provider_configs(id) ON DELETE RESTRICT;
