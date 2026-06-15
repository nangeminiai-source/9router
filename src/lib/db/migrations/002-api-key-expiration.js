export default {
  version: 2,
  name: "api-key-expiration",
  up(db) {
    const columns = new Set(db.all(`PRAGMA table_info(apiKeys)`).map((row) => row.name));
    if (!columns.has("expiresAt")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN expiresAt TEXT`);
    }
    if (!columns.has("expiredAt")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN expiredAt TEXT`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ak_expires ON apiKeys(expiresAt)`);
  },
};
