CREATE INDEX projects_owner_status_updated_id ON projects(owner_id, status, updated_at DESC, id DESC);
