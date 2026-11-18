CREATE TABLE provider_configs (
 id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,name TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('TEXT','IMAGE','VIDEO','VOICE','STOCK','GRAPHICS')),
 adapter_key TEXT NOT NULL CHECK(adapter_key IN('MANUAL_ASSIST','MOCK_FIXTURE')),integration_mode TEXT NOT NULL CHECK(integration_mode IN('MANUAL','MOCK')),
 enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),priority INTEGER NOT NULL CHECK(priority BETWEEN 0 AND 1000),
 caps_json TEXT NOT NULL CHECK(json_valid(caps_json)),limits_json TEXT NOT NULL CHECK(json_valid(limits_json)),pricing_json TEXT NOT NULL CHECK(json_valid(pricing_json)),credential_ref TEXT,
 status TEXT NOT NULL CHECK(status IN('MANUAL_ONLY','AVAILABLE','NOT_CONFIGURED','UNAVAILABLE')),revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),updated_at TEXT NOT NULL,
 UNIQUE(id,owner_id),CHECK((adapter_key='MANUAL_ASSIST' AND integration_mode='MANUAL' AND status='MANUAL_ONLY') OR (adapter_key='MOCK_FIXTURE' AND integration_mode='MOCK')));
