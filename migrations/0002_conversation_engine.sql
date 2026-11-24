CREATE VIRTUAL TABLE studio_search USING fts5(
  brand_id UNINDEXED, kind UNINDEXED, record_id UNINDEXED, title, body,
  tokenize='unicode61 remove_diacritics 2'
);
-- studio-statement
INSERT INTO studio_search SELECT brand_id, kind, id,
  replace(replace(json_extract(data,'$.title'),'đ','d'),'Đ','D'),
  replace(replace(coalesce(json_extract(data,'$.body'),json_extract(data,'$.notes'),''),'đ','d'),'Đ','D')
FROM records WHERE kind IN ('knowledge','products');
-- studio-statement
CREATE TRIGGER studio_search_insert AFTER INSERT ON records WHEN NEW.kind IN ('knowledge','products') BEGIN
  INSERT INTO studio_search VALUES (NEW.brand_id, NEW.kind, NEW.id,
    replace(replace(json_extract(NEW.data,'$.title'),'đ','d'),'Đ','D'),
    replace(replace(coalesce(json_extract(NEW.data,'$.body'),json_extract(NEW.data,'$.notes'),''),'đ','d'),'Đ','D'));
END;
-- studio-statement
CREATE TRIGGER studio_search_update AFTER UPDATE ON records WHEN NEW.kind IN ('knowledge','products') BEGIN
  UPDATE studio_search SET title=replace(replace(json_extract(NEW.data,'$.title'),'đ','d'),'Đ','D'),
    body=replace(replace(coalesce(json_extract(NEW.data,'$.body'),json_extract(NEW.data,'$.notes'),''),'đ','d'),'Đ','D')
  WHERE brand_id=NEW.brand_id AND kind=NEW.kind AND record_id=NEW.id;
END;
-- studio-statement
CREATE TRIGGER studio_search_delete AFTER DELETE ON records WHEN OLD.kind IN ('knowledge','products') BEGIN
  DELETE FROM studio_search WHERE brand_id=OLD.brand_id AND kind=OLD.kind AND record_id=OLD.id;
END;
-- studio-statement
ALTER TABLE deliveries ADD COLUMN thread_id TEXT;
-- studio-statement
ALTER TABLE deliveries ADD COLUMN batch_key TEXT;
-- studio-statement
CREATE INDEX deliveries_thread ON deliveries(brand_id,thread_id);
-- studio-statement
CREATE TABLE messenger_outbox (
  brand_id TEXT NOT NULL REFERENCES brands(id),
  channel TEXT NOT NULL,
  external_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  question TEXT NOT NULL,
  received INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  due INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(brand_id,channel,external_id)
);
-- studio-statement
CREATE INDEX outbox_due ON messenger_outbox(brand_id,channel,state,due);
-- studio-statement
CREATE INDEX outbox_thread ON messenger_outbox(brand_id,thread_id,received,external_id);
-- studio-statement
CREATE TABLE login_attempts (
  brand_id TEXT NOT NULL REFERENCES brands(id), bucket TEXT NOT NULL,
  expires INTEGER NOT NULL, attempts INTEGER NOT NULL, PRIMARY KEY(brand_id,bucket)
);
-- studio-statement
CREATE TABLE revoked_sessions (
  brand_id TEXT NOT NULL REFERENCES brands(id), session_id TEXT NOT NULL,
  expires INTEGER NOT NULL, PRIMARY KEY(brand_id,session_id)
);
-- studio-statement
CREATE TABLE retention (
  brand_id TEXT PRIMARY KEY REFERENCES brands(id), days INTEGER NOT NULL CHECK(days BETWEEN 1 AND 365)
);
-- studio-statement
UPDATE records SET data=json_set(data,'$.model','@cf/meta/llama-3.3-70b-instruct-fp8-fast'),
  version=version+1, updated=unixepoch()*1000
WHERE kind='models' AND json_extract(data,'$.model')='@cf/meta/llama-3.1-8b-instruct-fp8';
