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

function resolveCustomDurationMs(customDurationValue, customDurationUnit) {
  const value = Number(customDurationValue);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Custom duration must be greater than 0");
  }

  const unitMs = {
    hours: 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
  }[customDurationUnit];

  if (!unitMs) {
    throw new Error("Invalid custom duration unit");
  }

  return value * unitMs;
}

export function resolveApiKeyExpiresAt({
  expirationPreset = "never",
  customExpiresAt = null,
  customDurationValue = null,
  customDurationUnit = "days",
} = {}, now = new Date()) {
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

  if (expirationPreset === "custom_duration") {
    const durationMs = resolveCustomDurationMs(customDurationValue, customDurationUnit);
    return new Date(now.getTime() + durationMs).toISOString();
  }

  const durationMs = API_KEY_EXPIRATION_PRESETS[expirationPreset];
  if (!durationMs) {
    throw new Error("Invalid expiration preset");
  }

  return new Date(now.getTime() + durationMs).toISOString();
}

export function resolveApiKeyRenewedExpiresAt({
  renewalPreset = "7d",
  customDurationValue = null,
  customDurationUnit = "days",
  customExpiresAt = null,
} = {}, currentExpiresAt = null, now = new Date()) {
  if (!renewalPreset || renewalPreset === "never") return null;

  const currentExpiresMs = currentExpiresAt ? new Date(currentExpiresAt).getTime() : NaN;
  const baseMs = Number.isFinite(currentExpiresMs) && currentExpiresMs > now.getTime()
    ? currentExpiresMs
    : now.getTime();

  if (renewalPreset === "specific") {
    if (!customExpiresAt) {
      throw new Error("Specific expiration date is required");
    }
    const custom = new Date(customExpiresAt);
    if (!Number.isFinite(custom.getTime())) {
      throw new Error("Invalid specific expiration date");
    }
    if (custom.getTime() <= now.getTime()) {
      throw new Error("Specific expiration date must be in the future");
    }
    return custom.toISOString();
  }

  let durationMs = API_KEY_EXPIRATION_PRESETS[renewalPreset];

  if (renewalPreset === "custom") {
    durationMs = resolveCustomDurationMs(customDurationValue, customDurationUnit);
  }

  if (!durationMs) {
    throw new Error("Invalid renewal duration");
  }

  return new Date(baseMs + durationMs).toISOString();
}
