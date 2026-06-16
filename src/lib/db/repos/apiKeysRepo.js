import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { isApiKeyExpired } from "@/shared/utils/apiKeyExpiration.js";

const syncedQuotaAdapters = new WeakSet();

function syncApiKeyQuotaColumns(db) {
  if (syncedQuotaAdapters.has(db)) return;
  const columns = new Set(db.all(`PRAGMA table_info(apiKeys)`).map((row) => row.name));
  if (!columns.has("requestLimit")) {
    db.exec(`ALTER TABLE apiKeys ADD COLUMN requestLimit INTEGER`);
  }
  if (!columns.has("requestUsed")) {
    db.exec(`ALTER TABLE apiKeys ADD COLUMN requestUsed INTEGER DEFAULT 0`);
    db.exec(`UPDATE apiKeys SET requestUsed = 0 WHERE requestUsed IS NULL`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ak_quota ON apiKeys(requestLimit, requestUsed)`);
  syncedQuotaAdapters.add(db);
}

function rowToKey(row) {
  if (!row) return null;
  const expired = isApiKeyExpired(row.expiresAt) || !!row.expiredAt;
  const requestLimit = row.requestLimit === null || row.requestLimit === undefined || row.requestLimit === ""
    ? null
    : Number(row.requestLimit);
  const requestUsed = Math.max(0, Number(row.requestUsed || 0));
  const quotaExceeded = requestLimit !== null && Number.isFinite(requestLimit) && requestUsed >= requestLimit;
  const active = (row.isActive === 1 || row.isActive === true) && !expired && !quotaExceeded;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: active,
    expiresAt: row.expiresAt || null,
    expiredAt: row.expiredAt || null,
    requestLimit,
    requestUsed,
    requestRemaining: requestLimit === null ? null : Math.max(requestLimit - requestUsed, 0),
    status: expired ? "expired" : quotaExceeded ? "quota_exceeded" : active ? "active" : "inactive",
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
  syncApiKeyQuotaColumns(db);
  await markExpiredApiKeys(db);
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  syncApiKeyQuotaColumns(db);
  await markExpiredApiKeys(db);
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, options = {}) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  syncApiKeyQuotaColumns(db);
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
    requestLimit: options.requestLimit ?? null,
    requestUsed: 0,
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, expiresAt, expiredAt, requestLimit, requestUsed, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.expiresAt, apiKey.expiredAt, apiKey.requestLimit, apiKey.requestUsed, apiKey.createdAt]
  );
  return rowToKey(apiKey);
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  syncApiKeyQuotaColumns(db);
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const current = rowToKey(row);
    const merged = { ...current, ...data };
    const nextIsActive = data.isActive !== undefined ? data.isActive : (row.isActive === 1 || row.isActive === true);
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, expiresAt = ?, expiredAt = ?, requestLimit = ?, requestUsed = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, nextIsActive ? 1 : 0, merged.expiresAt || null, merged.expiredAt || null, merged.requestLimit ?? null, merged.requestUsed || 0, id]
    );
    result = rowToKey(db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]));
  });
  return result;
}

export async function addApiKeyQuota(id, additionalRequests) {
  return updateApiKeyQuota(id, { mode: "add", additionalRequests });
}

export async function updateApiKeyQuota(id, {
  mode,
  requestLimit = null,
  additionalRequests = null,
  resetUsed = false,
} = {}) {
  const db = await getAdapter();
  syncApiKeyQuotaColumns(db);
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;

    const currentUsed = Math.max(0, Number(row.requestUsed || 0));
    const currentLimit = row.requestLimit === null || row.requestLimit === undefined || row.requestLimit === ""
      ? null
      : Number(row.requestLimit);
    let nextLimit = currentLimit;
    let nextUsed = currentUsed;

    if (mode === "unlimited") {
      nextLimit = null;
    } else if (mode === "set_total") {
      const total = Number(requestLimit);
      if (!Number.isInteger(total) || total <= 0) {
        throw new Error("Request limit must be a positive integer");
      }
      nextLimit = total;
    } else if (mode === "add") {
      const amount = Number(additionalRequests);
      if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error("Additional requests must be a positive integer");
      }
      nextLimit = (currentLimit ?? currentUsed) + amount;
    } else if (mode === "reset_used") {
      nextUsed = 0;
    } else {
      throw new Error("Invalid quota update mode");
    }

    if (resetUsed) nextUsed = 0;

    db.run(
      `UPDATE apiKeys SET requestLimit = ?, requestUsed = ? WHERE id = ?`,
      [nextLimit, nextUsed, id]
    );
    result = rowToKey(db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]));
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
  syncApiKeyQuotaColumns(db);
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

  const normalized = rowToKey(row);
  if (normalized.status === "quota_exceeded") {
    return { valid: false, reason: "quota_exceeded", message: "API key request quota exceeded", key: normalized };
  }

  return { valid: true, reason: "active", message: null, key: normalized };
}

export async function consumeApiKeyRequest(key) {
  const db = await getAdapter();
  syncApiKeyQuotaColumns(db);
  let result;

  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
    if (!row) {
      result = { valid: false, reason: "not_found", message: "Invalid API key" };
      return;
    }

    const validationKey = rowToKey(row);
    if (validationKey.status === "expired") {
      markExpiredApiKeys(db);
      result = { valid: false, reason: "expired", message: "API key has expired", key: validationKey };
      return;
    }
    if (validationKey.status === "inactive") {
      result = { valid: false, reason: "inactive", message: "API key is inactive", key: validationKey };
      return;
    }
    if (validationKey.status === "quota_exceeded") {
      result = { valid: false, reason: "quota_exceeded", message: "API key request quota exceeded", key: validationKey };
      return;
    }

    if (validationKey.requestLimit !== null) {
      db.run(`UPDATE apiKeys SET requestUsed = requestUsed + 1 WHERE id = ?`, [row.id]);
    }

    const updated = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [row.id]);
    result = { valid: true, reason: "active", message: null, key: rowToKey(updated) };
  });

  return result;
}
