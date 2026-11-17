CREATE TABLE project_operations (
  owner_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  operation_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  http_status INTEGER NOT NULL CHECK (http_status IN (200,201)),
  PRIMARY KEY (owner_id,operation_id)
);
