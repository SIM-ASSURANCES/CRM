-- Journal d'audit en ajout seul (CDC A.5 : « audit_logs append-only »).
-- Interdit UPDATE, DELETE et TRUNCATE, y compris pour le rôle applicatif.
-- Pour purger légalement des traces (durée de conservation), il faudra une migration dédiée et validée.

CREATE OR REPLACE FUNCTION audit_logs_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs est en ajout seul : % interdit', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_block_mutation();
