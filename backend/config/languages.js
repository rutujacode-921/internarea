// Central definition of the languages the platform supports.
// Keep this list in sync with internarea/src/i18n/config.ts.
const SUPPORTED_LANGUAGES = ["en", "es", "hi", "pt", "zh", "fr"];

// Languages that can only be activated after email OTP verification.
const OTP_PROTECTED_LANGUAGES = ["fr"];

const DEFAULT_LANGUAGE = "en";

const isSupportedLanguage = (code) =>
  typeof code === "string" && SUPPORTED_LANGUAGES.includes(code);

const requiresOtp = (code) => OTP_PROTECTED_LANGUAGES.includes(code);

const intFromEnv = (name, fallback) => {
  const value = parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const OTP_SETTINGS = {
  ttlMinutes: intFromEnv("OTP_TTL_MINUTES", 5),
  resendCooldownSeconds: intFromEnv("OTP_RESEND_COOLDOWN_SECONDS", 60),
  maxRequestsPerHour: intFromEnv("OTP_MAX_REQUESTS_PER_HOUR", 5),
  maxVerifyAttempts: intFromEnv("OTP_MAX_VERIFY_ATTEMPTS", 5),
};

module.exports = {
  SUPPORTED_LANGUAGES,
  OTP_PROTECTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  OTP_SETTINGS,
  isSupportedLanguage,
  requiresOtp,
};
