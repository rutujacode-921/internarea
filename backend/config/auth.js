// Password sign-in and Forgot Password settings. All can be tuned from .env.

const intFromEnv = (name, fallback) => {
  const value = parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const RESET_SETTINGS = {
  // A student may start one password reset per 24 hours.
  dailyWindowHours: intFromEnv("RESET_WINDOW_HOURS", 24),
  // How long one reset request stays open (to enter the code, resend, retry delivery).
  sessionMinutes: intFromEnv("RESET_SESSION_MINUTES", 30),
  // Each code expires after this many minutes.
  otpTtlMinutes: intFromEnv("RESET_OTP_TTL_MINUTES", 5),
  resendCooldownSeconds: intFromEnv("RESET_RESEND_COOLDOWN_SECONDS", 60),
  maxResends: intFromEnv("RESET_MAX_RESENDS", 3),
  // Wrong codes allowed per request, in total, before it locks.
  maxVerifyAttempts: intFromEnv("RESET_MAX_VERIFY_ATTEMPTS", 5),
  // Attempts to deliver the new password if email/SMS fails.
  maxDeliveryAttempts: intFromEnv("RESET_MAX_DELIVERY_ATTEMPTS", 3),
  // Reset requests allowed from one IP address per hour (limits account probing).
  maxRequestsPerIpPerHour: intFromEnv("RESET_MAX_REQUESTS_PER_IP_PER_HOUR", 10),
  generatedPasswordLength: intFromEnv("RESET_PASSWORD_LENGTH", 12),
};

const LOGIN_SETTINGS = {
  maxFailedAttempts: intFromEnv("LOGIN_MAX_FAILED_ATTEMPTS", 5),
  lockMinutes: intFromEnv("LOGIN_LOCK_MINUTES", 15),
  sessionDays: intFromEnv("SESSION_DAYS", 7),
};

const PASSWORD_RULES = { min: 8, max: 72 }; // bcrypt uses at most 72 bytes

module.exports = { RESET_SETTINGS, LOGIN_SETTINGS, PASSWORD_RULES };
