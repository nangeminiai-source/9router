import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
});
