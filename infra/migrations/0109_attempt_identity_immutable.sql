CREATE TRIGGER attempt_identity_immutable BEFORE UPDATE OF id,job_id,attempt_no,request_id,lease_token,start_at,provider_id ON job_attempts
WHEN NEW.id IS NOT OLD.id OR NEW.job_id IS NOT OLD.job_id OR NEW.attempt_no IS NOT OLD.attempt_no OR NEW.request_id IS NOT OLD.request_id OR NEW.lease_token IS NOT OLD.lease_token OR NEW.start_at IS NOT OLD.start_at OR NEW.provider_id IS NOT OLD.provider_id
BEGIN SELECT RAISE(ABORT,'ATTEMPT_IDENTITY_IMMUTABLE'); END;
