-- Modelo user de Better Auth. Sesiones/cuentas y adaptación ejecutable: F2-02.
CREATE TABLE "user" (
  id TEXT PRIMARY KEY NOT NULL CHECK (
    length(id) = 36 AND substr(id,9,1) = '-' AND substr(id,14,1) = '-'
    AND substr(id,19,1) = '-' AND substr(id,24,1) = '-'
    AND length(replace(id,'-','')) = 32
    AND lower(replace(id,'-','')) NOT GLOB '*[^0-9a-f]*'
  ),
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0 CHECK (emailVerified IN (0,1)),
  image TEXT,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL
);
