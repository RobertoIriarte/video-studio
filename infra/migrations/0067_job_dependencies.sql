CREATE TABLE job_dependencies (
 project_id TEXT NOT NULL,job_id TEXT NOT NULL,depends_on_id TEXT NOT NULL,PRIMARY KEY(job_id,depends_on_id),
 CHECK(job_id<>depends_on_id),FOREIGN KEY(job_id,project_id) REFERENCES jobs(id,project_id) ON DELETE RESTRICT,
 FOREIGN KEY(depends_on_id,project_id) REFERENCES jobs(id,project_id) ON DELETE RESTRICT);
