-- Keep replay protection independent of deletable customer conversation data.
ALTER TABLE deliveries ADD COLUMN event_hash TEXT;
-- studio-statement
CREATE TABLE event_tombstones (
  brand_id TEXT NOT NULL REFERENCES brands(id), channel TEXT NOT NULL,
  event_hash TEXT NOT NULL, expires INTEGER NOT NULL,
  PRIMARY KEY(brand_id,channel,event_hash)
);
-- studio-statement
CREATE INDEX event_tombstones_expiry ON event_tombstones(brand_id,expires);
-- studio-statement
-- Refuse buffered pre-upgrade provider events whose legacy receipts lack hashes.
-- Existing conversations and pending outbox rows remain intact.
CREATE TABLE replay_policy (
  id INTEGER PRIMARY KEY CHECK(id=1), live_not_before INTEGER NOT NULL
);
-- studio-statement
INSERT INTO replay_policy VALUES(1,CAST(unixepoch('subsec')*1000 AS INTEGER)+300000);
-- studio-statement
CREATE TRIGGER admit_delivery_once BEFORE INSERT ON deliveries WHEN NEW.event_hash IS NOT NULL BEGIN
  INSERT INTO event_tombstones VALUES(NEW.brand_id,NEW.channel,NEW.event_hash,NEW.at+172800000)
    ON CONFLICT(brand_id,channel,event_hash) DO UPDATE SET expires=excluded.expires
    WHERE expires<=NEW.at;
  SELECT RAISE(IGNORE) WHERE changes()=0;
END;
