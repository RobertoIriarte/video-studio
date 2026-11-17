CREATE TABLE owner_bootstrap (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  operation_id TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('CLAIMED','READY')),
  user_id TEXT REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);
