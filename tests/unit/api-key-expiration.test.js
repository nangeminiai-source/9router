import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.setConfig({ testTimeout: 30000 });

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-api-key-exp-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("API key expiration", () => {
  it("uses actual elapsed duration for standard presets", async () => {
    const { resolveApiKeyExpiresAt } = await import("@/shared/utils/apiKeyExpiration.js");
    const createdAt = new Date("2026-06-15T17:00:00.000Z");

    expect(resolveApiKeyExpiresAt({ expirationPreset: "1d" }, createdAt)).toBe("2026-06-16T17:00:00.000Z");
    expect(resolveApiKeyExpiresAt({ expirationPreset: "7d" }, createdAt)).toBe("2026-06-22T17:00:00.000Z");
    expect(resolveApiKeyExpiresAt({ expirationPreset: "30d" }, createdAt)).toBe("2026-07-15T17:00:00.000Z");
  });

  it("accepts future custom expiration and rejects past custom expiration", async () => {
    const { resolveApiKeyExpiresAt } = await import("@/shared/utils/apiKeyExpiration.js");
    const now = new Date("2026-06-15T17:00:00.000Z");

    expect(resolveApiKeyExpiresAt({
      expirationPreset: "custom",
      customExpiresAt: "2026-06-15T19:30:00.000Z",
    }, now)).toBe("2026-06-15T19:30:00.000Z");

    expect(() => resolveApiKeyExpiresAt({
      expirationPreset: "custom",
      customExpiresAt: "2026-06-15T16:59:00.000Z",
    }, now)).toThrow(/future/i);
  });

  it("supports custom duration when creating API keys", async () => {
    const { resolveApiKeyExpiresAt } = await import("@/shared/utils/apiKeyExpiration.js");
    const now = new Date("2026-06-15T17:00:00.000Z");

    expect(resolveApiKeyExpiresAt({
      expirationPreset: "custom_duration",
      customDurationValue: 6,
      customDurationUnit: "days",
    }, now)).toBe("2026-06-21T17:00:00.000Z");

    expect(resolveApiKeyExpiresAt({
      expirationPreset: "custom_duration",
      customDurationValue: 12,
      customDurationUnit: "hours",
    }, now)).toBe("2026-06-16T05:00:00.000Z");
  });

  it("rejects invalid custom duration when creating API keys", async () => {
    const { resolveApiKeyExpiresAt } = await import("@/shared/utils/apiKeyExpiration.js");

    expect(() => resolveApiKeyExpiresAt({
      expirationPreset: "custom_duration",
      customDurationValue: 0,
      customDurationUnit: "days",
    })).toThrow(/greater than 0/i);
  });

  it("validates active non-expired keys", async () => {
    const { createApiKey, validateApiKeyDetailed } = await import("@/lib/db/index.js");
    const key = await createApiKey("temporary", "machine-test", {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const validation = await validateApiKeyDetailed(key.key);

    expect(validation.valid).toBe(true);
    expect(validation.reason).toBe("active");
  });

  it("marks expired keys inactive during validation", async () => {
    const { createApiKey, validateApiKeyDetailed, getApiKeys } = await import("@/lib/db/index.js");
    const key = await createApiKey("expired", "machine-test", {
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const validation = await validateApiKeyDetailed(key.key);
    const keys = await getApiKeys();

    expect(validation.valid).toBe(false);
    expect(validation.reason).toBe("expired");
    expect(validation.message).toBe("API key has expired");
    expect(keys[0].isActive).toBe(false);
    expect(keys[0].status).toBe("expired");
    expect(keys[0].expiredAt).toBeTruthy();
  });

  it("rejects expired provided keys even when API keys are not required", async () => {
    const { createApiKey } = await import("@/lib/db/index.js");
    const { validateRequestApiKey } = await import("@/sse/services/auth.js");
    const key = await createApiKey("expired-local", "machine-test", {
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const request = new Request("http://localhost:20128/v1/chat/completions", {
      headers: { Authorization: `Bearer ${key.key}` },
    });
    const validation = await validateRequestApiKey(request, { requireApiKey: false });

    expect(validation.valid).toBe(false);
    expect(validation.reason).toBe("expired");
    expect(validation.message).toBe("API key has expired");
  });

  it("renews active keys from their current expiration time", async () => {
    const { resolveApiKeyRenewedExpiresAt } = await import("@/shared/utils/apiKeyExpiration.js");
    const now = new Date("2026-06-15T17:00:00.000Z");

    expect(resolveApiKeyRenewedExpiresAt(
      { renewalPreset: "7d" },
      "2026-06-16T17:00:00.000Z",
      now
    )).toBe("2026-06-23T17:00:00.000Z");
  });

  it("renews expired keys from now", async () => {
    const { resolveApiKeyRenewedExpiresAt } = await import("@/shared/utils/apiKeyExpiration.js");
    const now = new Date("2026-06-15T17:00:00.000Z");

    expect(resolveApiKeyRenewedExpiresAt(
      { renewalPreset: "1d" },
      "2026-06-14T17:00:00.000Z",
      now
    )).toBe("2026-06-16T17:00:00.000Z");
  });

  it("renews keys to a specific future date and time", async () => {
    const { resolveApiKeyRenewedExpiresAt } = await import("@/shared/utils/apiKeyExpiration.js");
    const now = new Date("2026-06-15T17:00:00.000Z");

    expect(resolveApiKeyRenewedExpiresAt({
      renewalPreset: "specific",
      customExpiresAt: "2026-06-30T23:59:00.000Z",
    }, "2026-06-16T17:00:00.000Z", now)).toBe("2026-06-30T23:59:00.000Z");

    expect(() => resolveApiKeyRenewedExpiresAt({
      renewalPreset: "specific",
      customExpiresAt: "2026-06-15T16:59:00.000Z",
    }, null, now)).toThrow(/future/i);
  });

  it("can remove expiration by setting renewal to never", async () => {
    const { resolveApiKeyRenewedExpiresAt } = await import("@/shared/utils/apiKeyExpiration.js");

    expect(resolveApiKeyRenewedExpiresAt({
      renewalPreset: "never",
    }, "2026-06-16T17:00:00.000Z")).toBeNull();
  });

  it("renews an expired key without changing the key value", async () => {
    const { createApiKey, getApiKeys, updateApiKey } = await import("@/lib/db/index.js");
    const { resolveApiKeyRenewedExpiresAt } = await import("@/shared/utils/apiKeyExpiration.js");
    const key = await createApiKey("renew-me", "machine-test", {
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await getApiKeys();

    const renewedExpiresAt = resolveApiKeyRenewedExpiresAt({ renewalPreset: "1d" }, key.expiresAt);
    const renewed = await updateApiKey(key.id, {
      isActive: true,
      expiresAt: renewedExpiresAt,
      expiredAt: null,
    });

    expect(renewed.key).toBe(key.key);
    expect(renewed.isActive).toBe(true);
    expect(renewed.status).toBe("active");
    expect(renewed.expiredAt).toBeNull();
    expect(new Date(renewed.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("tracks request quota and rejects requests after the limit is reached", async () => {
    const { createApiKey, consumeApiKeyRequest, validateApiKeyDetailed } = await import("@/lib/db/index.js");
    const key = await createApiKey("limited", "machine-test", {
      requestLimit: 2,
    });

    const first = await consumeApiKeyRequest(key.key);
    const second = await consumeApiKeyRequest(key.key);
    const third = await consumeApiKeyRequest(key.key);
    const validation = await validateApiKeyDetailed(key.key);

    expect(first.valid).toBe(true);
    expect(first.key.requestRemaining).toBe(1);
    expect(second.valid).toBe(true);
    expect(second.key.requestRemaining).toBe(0);
    expect(third.valid).toBe(false);
    expect(third.reason).toBe("quota_exceeded");
    expect(validation.valid).toBe(false);
    expect(validation.reason).toBe("quota_exceeded");
  });

  it("top ups quota without changing the key value", async () => {
    const { createApiKey, consumeApiKeyRequest, addApiKeyQuota } = await import("@/lib/db/index.js");
    const key = await createApiKey("top-up", "machine-test", {
      requestLimit: 1,
    });

    await consumeApiKeyRequest(key.key);
    const toppedUp = await addApiKeyQuota(key.id, 5);

    expect(toppedUp.key).toBe(key.key);
    expect(toppedUp.requestLimit).toBe(6);
    expect(toppedUp.requestUsed).toBe(1);
    expect(toppedUp.requestRemaining).toBe(5);
    expect(toppedUp.status).toBe("active");
  });

  it("supports explicit quota management modes", async () => {
    const { createApiKey, consumeApiKeyRequest, updateApiKeyQuota } = await import("@/lib/db/index.js");
    const key = await createApiKey("manage-quota", "machine-test", {
      requestLimit: 5,
    });

    await consumeApiKeyRequest(key.key);
    await consumeApiKeyRequest(key.key);

    const setTotal = await updateApiKeyQuota(key.id, {
      mode: "set_total",
      requestLimit: 10,
    });
    expect(setTotal.requestLimit).toBe(10);
    expect(setTotal.requestUsed).toBe(2);
    expect(setTotal.requestRemaining).toBe(8);

    const resetUsed = await updateApiKeyQuota(key.id, {
      mode: "reset_used",
    });
    expect(resetUsed.requestLimit).toBe(10);
    expect(resetUsed.requestUsed).toBe(0);

    const unlimited = await updateApiKeyQuota(key.id, {
      mode: "unlimited",
    });
    expect(unlimited.requestLimit).toBeNull();
    expect(unlimited.requestUsed).toBe(0);
    expect(unlimited.status).toBe("active");
  });

  it("does not silently unpause a key while managing quota", async () => {
    const { createApiKey, updateApiKey, updateApiKeyQuota } = await import("@/lib/db/index.js");
    const key = await createApiKey("paused-quota", "machine-test", {
      requestLimit: 5,
    });

    await updateApiKey(key.id, { isActive: false });
    const updated = await updateApiKeyQuota(key.id, {
      mode: "add",
      additionalRequests: 5,
    });

    expect(updated.requestLimit).toBe(10);
    expect(updated.status).toBe("inactive");
    expect(updated.isActive).toBe(false);
  });

  it("keeps stored active flag when managing expiration on quota-exceeded keys", async () => {
    const { createApiKey, consumeApiKeyRequest, updateApiKey, updateApiKeyQuota } = await import("@/lib/db/index.js");
    const key = await createApiKey("quota-expiration", "machine-test", {
      requestLimit: 1,
    });

    await consumeApiKeyRequest(key.key);
    const quotaExceeded = await updateApiKey(key.id, {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      expiredAt: null,
    });
    expect(quotaExceeded.status).toBe("quota_exceeded");

    const toppedUp = await updateApiKeyQuota(key.id, {
      mode: "add",
      additionalRequests: 1,
    });
    expect(toppedUp.status).toBe("active");
    expect(toppedUp.isActive).toBe(true);
  });

  it("does not consume quota for unlimited keys", async () => {
    const { createApiKey, consumeApiKeyRequest } = await import("@/lib/db/index.js");
    const key = await createApiKey("unlimited", "machine-test");

    const first = await consumeApiKeyRequest(key.key);
    const second = await consumeApiKeyRequest(key.key);

    expect(first.valid).toBe(true);
    expect(first.key.requestLimit).toBeNull();
    expect(first.key.requestUsed).toBe(0);
    expect(second.valid).toBe(true);
    expect(second.key.requestUsed).toBe(0);
  });
});
