-- Preserve legacy rows and their composite tenant keys. Expand workspace metadata in a side table.
DROP INDEX one_active_brand;
-- studio-statement
CREATE TABLE workspace_profiles (
  brand_id TEXT PRIMARY KEY REFERENCES brands(id), logo TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#445239', language TEXT NOT NULL DEFAULT 'vi' CHECK(language IN ('vi','en')),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)), version INTEGER NOT NULL DEFAULT 1
);
-- studio-statement
INSERT INTO workspace_profiles(brand_id) SELECT id FROM brands;
-- studio-statement
CREATE TABLE accounts (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, salt TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  super_admin INTEGER NOT NULL DEFAULT 0 CHECK(super_admin IN (0,1)), created INTEGER NOT NULL, auth_version INTEGER NOT NULL DEFAULT 0
);
-- studio-statement
CREATE TABLE memberships (
  account_id TEXT NOT NULL REFERENCES accounts(id), brand_id TEXT NOT NULL REFERENCES brands(id),
  role TEXT NOT NULL CHECK(role IN ('brand-admin','ai-trainer','customer-service','viewer')),
  PRIMARY KEY(account_id,brand_id)
);
-- studio-statement
CREATE TABLE account_sessions (
  token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
  brand_id TEXT REFERENCES brands(id), expires INTEGER NOT NULL, auth_version INTEGER NOT NULL
);
-- studio-statement
CREATE INDEX account_sessions_user ON account_sessions(account_id);
-- studio-statement
CREATE TABLE platform_login_attempts (bucket TEXT PRIMARY KEY, expires INTEGER NOT NULL, attempts INTEGER NOT NULL);
-- studio-statement
CREATE TABLE platform_audit (
  id TEXT PRIMARY KEY, brand_id TEXT REFERENCES brands(id), actor TEXT NOT NULL, action TEXT NOT NULL,
  target TEXT NOT NULL, at INTEGER NOT NULL
);
-- studio-statement
CREATE INDEX platform_audit_workspace ON platform_audit(brand_id,at DESC);
-- studio-statement
CREATE TABLE agents (
  brand_id TEXT NOT NULL REFERENCES brands(id), id TEXT NOT NULL, name TEXT NOT NULL,
  config TEXT NOT NULL CHECK(json_valid(config)), version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(brand_id,id)
);
-- studio-statement
CREATE TABLE channels (
  id TEXT PRIMARY KEY, brand_id TEXT NOT NULL REFERENCES brands(id),
  kind TEXT NOT NULL CHECK(kind IN ('messenger','instagram','website')),
  external_id TEXT NOT NULL, name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'connected' CHECK(state IN ('connected','disconnected')),
  paused INTEGER NOT NULL DEFAULT 1 CHECK(paused IN (0,1)), mock INTEGER NOT NULL DEFAULT 1 CHECK(mock IN (0,1)),
  token_cipher TEXT, agent_id TEXT, overrides TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(overrides)),
  version INTEGER NOT NULL DEFAULT 1, last_event INTEGER, verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0,1)),
  FOREIGN KEY(brand_id,agent_id) REFERENCES agents(brand_id,id)
);
-- studio-statement
CREATE UNIQUE INDEX channels_live_identity ON channels(kind,external_id) WHERE mock=0;
-- studio-statement
CREATE UNIQUE INDEX channels_mock_identity ON channels(brand_id,kind,external_id) WHERE mock=1;
-- studio-statement
CREATE INDEX channels_workspace ON channels(brand_id,state);
-- studio-statement
ALTER TABLE messenger_outbox ADD COLUMN connection_id TEXT REFERENCES channels(id);
-- studio-statement
CREATE TABLE platform_limits (id INTEGER PRIMARY KEY CHECK(id=1), calls INTEGER NOT NULL CHECK(calls BETWEEN 0 AND 1000), neurons INTEGER NOT NULL CHECK(neurons BETWEEN 0 AND 8000));
-- studio-statement
INSERT INTO platform_limits VALUES(1,100,8000);
-- studio-statement
CREATE TABLE platform_usage (day TEXT PRIMARY KEY, calls INTEGER NOT NULL, neurons INTEGER NOT NULL);
-- studio-statement
INSERT INTO platform_usage SELECT day,sum(calls),sum(reserved_neurons) FROM usage GROUP BY day;
-- studio-statement
CREATE TABLE channel_usage (brand_id TEXT NOT NULL REFERENCES brands(id), channel_id TEXT NOT NULL, day TEXT NOT NULL, calls INTEGER NOT NULL, neurons INTEGER NOT NULL, PRIMARY KEY(brand_id,channel_id,day));
-- studio-statement
CREATE TABLE inference_reservations (id INTEGER PRIMARY KEY, brand_id TEXT NOT NULL REFERENCES brands(id), channel_id TEXT NOT NULL, day TEXT NOT NULL, neurons INTEGER NOT NULL);
-- studio-statement
CREATE TRIGGER reserve_inference AFTER INSERT ON inference_reservations BEGIN
  INSERT INTO usage VALUES(NEW.brand_id,NEW.day,1,NEW.neurons)
    ON CONFLICT(brand_id,day) DO UPDATE SET calls=calls+1,reserved_neurons=reserved_neurons+NEW.neurons;
  INSERT INTO platform_usage VALUES(NEW.day,1,NEW.neurons)
    ON CONFLICT(day) DO UPDATE SET calls=calls+1,neurons=neurons+NEW.neurons;
  INSERT INTO channel_usage VALUES(NEW.brand_id,NEW.channel_id,NEW.day,1,NEW.neurons)
    ON CONFLICT(brand_id,channel_id,day) DO UPDATE SET calls=calls+1,neurons=neurons+NEW.neurons;
END;
-- studio-statement
CREATE TRIGGER protect_last_superadmin BEFORE UPDATE ON accounts
WHEN OLD.active=1 AND OLD.super_admin=1 AND (NEW.active=0 OR NEW.super_admin=0)
  AND NOT EXISTS(SELECT 1 FROM accounts WHERE id<>OLD.id AND active=1 AND super_admin=1)
BEGIN SELECT RAISE(ABORT,'last_superadmin'); END;
-- studio-statement
INSERT INTO records(brand_id,kind,id,data,updated)
  SELECT 'nepmui','persona','config','{"prompt":"Bạn là trợ lý chăm sóc khách hàng của NẾP MÙI.","voice":"Ấm áp, tinh tế","rules":"Chuyển câu hỏi chưa có căn cứ cho nhân viên.","language":"vi"}',unixepoch()*1000
  WHERE EXISTS(SELECT 1 FROM brands WHERE id='nepmui') AND NOT EXISTS(SELECT 1 FROM records WHERE brand_id='nepmui' AND kind='persona' AND id='config');
-- studio-statement
CREATE TABLE scheduler_cursors (name TEXT PRIMARY KEY,cursor TEXT NOT NULL);
-- studio-statement
CREATE TRIGGER pause_archived_workspace AFTER UPDATE OF archived ON workspace_profiles WHEN NEW.archived=1 BEGIN
  UPDATE messenger_outbox SET state='paused',question='',recipient=''
    WHERE brand_id=NEW.brand_id AND state IN ('queued','retry','working');
END;
-- studio-statement
CREATE TRIGGER pause_inactive_workspace AFTER UPDATE OF active ON brands WHEN NEW.active=0 BEGIN
  UPDATE messenger_outbox SET state='paused',question='',recipient=''
    WHERE brand_id=NEW.id AND state IN ('queued','retry','working');
END;
-- studio-statement
CREATE TRIGGER pause_channel_jobs AFTER UPDATE OF paused,state ON channels WHEN NEW.paused=1 OR NEW.state='disconnected' BEGIN
  UPDATE messenger_outbox SET state='paused',question='',recipient=''
    WHERE brand_id=NEW.brand_id AND connection_id=NEW.id AND state IN ('queued','retry','working');
END;
