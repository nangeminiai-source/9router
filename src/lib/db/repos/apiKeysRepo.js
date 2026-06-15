import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { isApiKeyExpired } from "@/shared/utils/apiKeyExpiration.js";

function rowToKey(row) {
  if (!row) return null;
  const expired = isApiKeyExpired(row.expiresAt) || !!row.expiredAt;
  const active = (row.isActive === 1 || row.isActive === true) && !expired;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: active,
    expiresAt: row.expiresAt || null,
    expiredAt: row.expiredAt || null,
    status: expired ? "expired" : active ? "active" : "inactive",
    createdAt: row.createdAt,
  };
}

async function markExpiredApiKeys(db = null) {
  const adapter = db || await getAdapter();
  const now = new Date().toISOString();
  adapter.run(
    `UPDATE apiKeys SET isActive = 0, expiredAt = COALESCE(expiredAt, ?) WHERE expiresAt IS NOT NULL AND expiresAt <= ? AND expiredAt IS NULL`,
    [now, now]
  );
}

export async function getApiKeys() {
  const db = await getAdapter();
  await markExpiredApiKeys(db);
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  await markExpiredApiKeys(db);
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, options = {}) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    expiresAt: options.expiresAt || null,
    expiredAt: null,
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, expiresAt, expiredAt, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.expiresAt, apiKey.expiredAt, apiKey.createdAt]
  );
  return rowToKey(apiKey);
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, expiresAt = ?, expiredAt = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, merged.expiresAt || null, merged.expiredAt || null, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  const result = await validateApiKeyDetailed(key);
  return result.valid;
}

export async function validateApiKeyDetailed(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  if (!row) {
    return { valid: false, reason: "not_found", message: "Invalid API key" };
  }

  if (isApiKeyExpired(row.expiresAt) || row.expiredAt) {
    await markExpiredApiKeys(db);
    return { valid: false, reason: "expired", message: "API key has expired" };
  }

  const active = row.isActive === 1 || row.isActive === true;
  if (!active) {
    return { valid: false, reason: "inactive", message: "API key is inactive" };
  }

  return { valid: true, reason: "active", message: null, key: rowToKey(row) };
}
