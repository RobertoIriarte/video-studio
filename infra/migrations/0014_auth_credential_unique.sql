CREATE UNIQUE INDEX auth_credential_user_unique ON account(userId,providerId) WHERE providerId = 'credential';
