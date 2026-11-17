CREATE TABLE "verification" (
  "id" text not null primary key, "identifier" text not null, "value" text not null,
  "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null
);
