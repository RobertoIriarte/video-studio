CREATE TABLE checkpoints (
 id TEXT PRIMARY KEY NOT NULL,project_id TEXT NOT NULL,job_id TEXT NOT NULL,stage TEXT NOT NULL CHECK(stage IN('SCRIPT','DIRECTION')),
 subject_version_id TEXT NOT NULL,script_version_id TEXT,scene_version_id TEXT,blocking INTEGER NOT NULL CHECK(blocking IN(0,1)),
 status TEXT NOT NULL CHECK(status IN('PENDING','APPROVED','REJECTED','SUPERSEDED')),reviewed_by TEXT REFERENCES user(id) ON DELETE RESTRICT,reviewed_at TEXT,revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
 UNIQUE(job_id,stage,subject_version_id),FOREIGN KEY(job_id,project_id) REFERENCES jobs(id,project_id) ON DELETE RESTRICT,
 FOREIGN KEY(script_version_id,project_id) REFERENCES script_versions(id,project_id) ON DELETE RESTRICT,
 FOREIGN KEY(scene_version_id,project_id) REFERENCES scene_versions(id,project_id) ON DELETE RESTRICT,
 CHECK((stage='SCRIPT' AND script_version_id=subject_version_id AND scene_version_id IS NULL AND script_version_id IS NOT NULL) OR (stage='DIRECTION' AND scene_version_id=subject_version_id AND script_version_id IS NULL AND scene_version_id IS NOT NULL)),
 CHECK((status IN('APPROVED','REJECTED') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL) OR (status IN('PENDING','SUPERSEDED') AND reviewed_by IS NULL AND reviewed_at IS NULL)));
