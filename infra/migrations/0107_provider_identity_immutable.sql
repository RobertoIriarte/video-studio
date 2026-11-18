CREATE TRIGGER provider_identity_immutable BEFORE UPDATE OF id,owner_id ON provider_configs WHEN NEW.id IS NOT OLD.id OR NEW.owner_id IS NOT OLD.owner_id
BEGIN SELECT RAISE(ABORT,'PROVIDER_IDENTITY_IMMUTABLE'); END;
