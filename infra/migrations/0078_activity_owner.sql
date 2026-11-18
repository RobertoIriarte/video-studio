CREATE INDEX activity_owner_idx ON activity_events(owner_id,created_at DESC,id DESC);
