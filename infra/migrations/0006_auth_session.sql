CREATE TABLE "session" (
  "id" text not null primary key, "expiresAt" date not null, "token" text not null unique,
  "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text,
  "userId" text not null references "user" ("id") on delete cascade
);
