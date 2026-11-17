CREATE TABLE project_settings (
  project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  language TEXT NOT NULL CHECK (length(trim(language)) BETWEEN 1 AND 35),
  audience TEXT NOT NULL CHECK (length(trim(audience)) BETWEEN 1 AND 500),
  objective TEXT NOT NULL CHECK (objective = 'YOUTUBE_LONG'),
  target_duration_ms INTEGER NOT NULL CHECK (
    typeof(target_duration_ms) = 'integer' AND target_duration_ms BETWEEN 1 AND 9007199254740991
  ),
  style TEXT NOT NULL CHECK (style IN ('DOCUMENTARY','PREMIUM_REALISTIC','HORROR_MYSTERY')),
  style_version INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(style_version) = 'integer' AND style_version BETWEEN 1 AND 9007199254740991
  ),
  modality TEXT NOT NULL CHECK (modality IN ('DYNAMIC_IMAGES','HYBRID','CINEMATIC','EXPLAINER')),
  checkpoint_policy_json TEXT NOT NULL CHECK (
    json_valid(checkpoint_policy_json) AND json_type(checkpoint_policy_json) = 'array'
    AND json_array_length(checkpoint_policy_json) <= 16
  ),
  provider_policy_json TEXT NOT NULL CHECK (
    json_valid(provider_policy_json) AND json_type(provider_policy_json) = 'object'
    AND coalesce(json_type(provider_policy_json,'$.allowPaidFallback') IN ('true','false'),0)
    AND coalesce(json_type(provider_policy_json,'$.preferredIds') = 'array',0)
    AND json_array_length(provider_policy_json,'$.preferredIds') <= 32
  ),
  budget_currency TEXT NOT NULL CHECK (budget_currency GLOB '[A-Z][A-Z][A-Z]'),
  max_cost_micros INTEGER NOT NULL CHECK (
    typeof(max_cost_micros) = 'integer' AND max_cost_micros BETWEEN 0 AND 9007199254740991
  ),
  storage_policy_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(storage_policy_json) AND json_type(storage_policy_json) = 'object'
  ),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(revision) = 'integer' AND revision BETWEEN 1 AND 9007199254740991
  )
);
