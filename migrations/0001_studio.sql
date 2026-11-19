CREATE TABLE brands (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0,1))
);
-- studio-statement
CREATE UNIQUE INDEX one_active_brand ON brands(active) WHERE active=1;
-- studio-statement
INSERT INTO brands VALUES ('nepmui', 'NẾP MÙI', 1);
-- studio-statement
CREATE TABLE records (
  brand_id TEXT NOT NULL REFERENCES brands(id),
  kind TEXT NOT NULL CHECK (kind IN ('knowledge','products','persona','models','training','conversations')),
  id TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  version INTEGER NOT NULL DEFAULT 1,
  updated INTEGER NOT NULL,
  PRIMARY KEY (brand_id, kind, id)
);
-- studio-statement
CREATE INDEX records_recent ON records(brand_id, kind, updated DESC, id);
-- studio-statement
CREATE TABLE revisions (
  brand_id TEXT NOT NULL REFERENCES brands(id),
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  record_id TEXT NOT NULL,
  action TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  at INTEGER NOT NULL,
  PRIMARY KEY (brand_id, id)
);
-- studio-statement
CREATE INDEX revisions_recent ON revisions(brand_id, at DESC, id);
-- studio-statement
CREATE TABLE usage (
  brand_id TEXT NOT NULL REFERENCES brands(id),
  day TEXT NOT NULL,
  calls INTEGER NOT NULL,
  reserved_neurons INTEGER NOT NULL,
  PRIMARY KEY (brand_id, day)
);
-- studio-statement
CREATE TABLE deliveries (
  brand_id TEXT NOT NULL REFERENCES brands(id),
  channel TEXT NOT NULL,
  external_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (brand_id, channel, external_id)
);
-- studio-statement
CREATE TRIGGER record_created AFTER INSERT ON records BEGIN
  INSERT INTO revisions SELECT NEW.brand_id, lower(hex(randomblob(16))), NEW.kind, NEW.id, 'create', CASE WHEN NEW.kind='conversations' THEN json_object('status',json_extract(NEW.data,'$.status')) ELSE NEW.data END, NEW.updated;
END;
-- studio-statement
CREATE TRIGGER record_updated AFTER UPDATE ON records BEGIN
  INSERT INTO revisions SELECT NEW.brand_id, lower(hex(randomblob(16))), NEW.kind, NEW.id, 'update', CASE WHEN NEW.kind='conversations' THEN json_object('status',json_extract(NEW.data,'$.status')) ELSE NEW.data END, NEW.updated;
END;
-- studio-statement
CREATE TRIGGER record_deleted AFTER DELETE ON records BEGIN
  INSERT INTO revisions SELECT OLD.brand_id, lower(hex(randomblob(16))), OLD.kind, OLD.id, 'delete', CASE WHEN OLD.kind='conversations' THEN json_object('status',json_extract(OLD.data,'$.status')) ELSE OLD.data END, unixepoch()*1000;
END;
