CREATE TRIGGER agent_identity BEFORE UPDATE OF id,owner_id,token_hash,created_at ON local_agents BEGIN SELECT RAISE(ABORT,'AGENT_IDENTITY_IMMUTABLE'); END;
