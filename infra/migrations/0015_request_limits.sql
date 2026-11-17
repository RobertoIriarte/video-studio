CREATE TABLE request_limits (
  key TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  window_start INTEGER NOT NULL
);
