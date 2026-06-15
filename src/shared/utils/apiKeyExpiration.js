export const API_KEY_EXPIRATION_PRESETS = {
  never: null,
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export function isApiKeyExpired(expiresAt, now = new Date()) {
  if (!expiresAt) return false;
  const expiresMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresMs)) return false;
  return expiresMs <= now.getTime();
}

export function resolveApiKeyExpiresAt({ expirationPreset = "never", customExpiresAt = null } = {}, now = new Date()) {
  if (!expirationPreset || expirationPreset === "never") return null;

  if (expirationPreset === "custom") {
    if (!customExpiresAt) {
      throw new Error("Custom expiration date is required");
    }
    const custom = new Date(customExpiresAt);
    if (!Number.isFinite(custom.getTime())) {
      throw new Error("Invalid custom expiration date");
    }
    if (custom.getTime() <= now.getTime()) {
      throw new Error("Custom expiration date must be in the future");
    }
    return custom.toISOString();
  }

  const durationMs = API_KEY_EXPIRATION_PRESETS[expirationPreset];
  if (!durationMs) {
    throw new Error("Invalid expiration preset");
  }

  return new Date(now.getTime() + durationMs).toISOString();
}
