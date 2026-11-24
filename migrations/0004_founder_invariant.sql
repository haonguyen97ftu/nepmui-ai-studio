-- Refuse an already unsafe pre-hotfix state instead of granting an arbitrary account Super Admin.
-- This transient validation table contains no application data. The migration runner must apply this file atomically.
CREATE TABLE founder_invariant_check (valid INTEGER NOT NULL CHECK(valid=1));
-- studio-statement
INSERT INTO founder_invariant_check SELECT CASE
  WHEN NOT EXISTS(SELECT 1 FROM accounts) OR EXISTS(SELECT 1 FROM accounts WHERE active=1 AND super_admin=1)
  THEN 1 ELSE 0 END;
-- studio-statement
DROP TABLE founder_invariant_check;
-- studio-statement
CREATE TRIGGER require_active_founder_on_insert BEFORE INSERT ON accounts
WHEN (NEW.active<>1 OR NEW.super_admin<>1) AND NOT EXISTS(
  SELECT 1 FROM accounts a WHERE a.active=1 AND a.super_admin=1
    AND a.id<>NEW.id AND a.email<>NEW.email COLLATE NOCASE
)
BEGIN SELECT RAISE(ABORT,'active_founder_required'); END;
-- studio-statement
CREATE TRIGGER require_active_founder_on_update BEFORE UPDATE ON accounts
WHEN (NEW.active<>1 OR NEW.super_admin<>1) AND NOT EXISTS(
  SELECT 1 FROM accounts a WHERE a.active=1 AND a.super_admin=1
    AND a.id<>OLD.id AND a.id<>NEW.id AND a.email<>NEW.email COLLATE NOCASE
)
BEGIN SELECT RAISE(ABORT,'active_founder_required'); END;
-- studio-statement
CREATE TRIGGER protect_last_superadmin_delete BEFORE DELETE ON accounts
WHEN OLD.active=1 AND OLD.super_admin=1 AND NOT EXISTS(
  SELECT 1 FROM accounts WHERE id<>OLD.id AND active=1 AND super_admin=1
)
BEGIN SELECT RAISE(ABORT,'active_founder_required'); END;
