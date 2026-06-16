export default {
  version: 3,
  name: "api-key-quota",
  up(db) {
    const columns = new Set(db.all(`PRAGMA table_info(apiKeys)`).map((row) => row.name));
    if (!columns.has("requestLimit")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN requestLimit INTEGER`);
    }
    if (!columns.has("requestUsed")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN requestUsed INTEGER DEFAULT 0`);
    }
    db.exec(`UPDATE apiKeys SET requestUsed = 0 WHERE requestUsed IS NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ak_quota ON apiKeys(requestLimit, requestUsed)`);
  },
};
