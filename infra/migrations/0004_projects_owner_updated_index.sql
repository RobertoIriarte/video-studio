CREATE INDEX projects_owner_updated_id ON projects(owner_id, updated_at DESC, id DESC);
