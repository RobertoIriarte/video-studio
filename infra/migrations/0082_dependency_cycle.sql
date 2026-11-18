CREATE TRIGGER dependency_cycle BEFORE INSERT ON job_dependencies WHEN EXISTS (
 WITH RECURSIVE ancestors(id) AS (SELECT NEW.depends_on_id UNION SELECT d.depends_on_id FROM job_dependencies d JOIN ancestors a ON d.job_id=a.id)
 SELECT 1 FROM ancestors WHERE id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'DAG_CYCLE'); END;
