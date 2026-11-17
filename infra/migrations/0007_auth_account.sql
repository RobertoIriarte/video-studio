CREATE TABLE "account" (
  "id" text not null primary key, "accountId" text not null, "providerId" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date,
  "refreshTokenExpiresAt" date, "scope" text, "password" text,
  "createdAt" date not null, "updatedAt" date not null
);
