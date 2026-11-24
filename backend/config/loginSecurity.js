// Login security settings (Task 5). Everything can be tuned from .env.

const intFromEnv = (name, fallback) => {
  const value = parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

// "HH:MM" -> minutes after midnight.
const minutesFromEnv = (name, fallback) => {
  const match = String(process.env[name] || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const value = Number(match[1]) * 60 + Number(match[2]);
  return value >= 0 && value <= 24 * 60 ? value : fallback;
};

const LOGIN_SECURITY = {
  // ---- Mobile access window (Indian Standard Time by default) ----
  mobileTimeZone: process.env.MOBILE_LOGIN_TIME_ZONE || "Asia/Kolkata",
  mobileWindowStart: minutesFromEnv("MOBILE_LOGIN_START", 10 * 60), // 10:00 AM
  mobileWindowEnd: minutesFromEnv("MOBILE_LOGIN_END", 13 * 60), // 1:00 PM (exclusive)

  // ---- Chrome sign-in OTP ----
  otpTtlMinutes: intFromEnv("LOGIN_OTP_TTL_MINUTES", 5),
  // How long the whole verification step stays open (to resend, retry, reload the page).
  challengeMinutes: intFromEnv("LOGIN_CHALLENGE_MINUTES", 15),
  resendCooldownSeconds: intFromEnv("LOGIN_OTP_RESEND_COOLDOWN_SECONDS", 60),
  maxResends: intFromEnv("LOGIN_OTP_MAX_RESENDS", 3),
  maxVerifyAttempts: intFromEnv("LOGIN_OTP_MAX_ATTEMPTS", 5),
  // Locked verifications allowed per hour before sign-in is paused for the account.
  maxLockedChallengesPerHour: intFromEnv("LOGIN_OTP_MAX_LOCKS_PER_HOUR", 3),
  otpLockoutMinutes: intFromEnv("LOGIN_OTP_LOCKOUT_MINUTES", 30),

  // ---- Sessions ----
  // Oldest sessions are signed out when a user goes over this many.
  maxActiveSessions: intFromEnv("MAX_ACTIVE_SESSIONS", 10),
  // A repeated login request with the same request id within this window gets the
  // same result instead of creating a second session or sending a second code.
  duplicateWindowSeconds: intFromEnv("LOGIN_DUPLICATE_WINDOW_SECONDS", 120),
  // "Last active" is written at most this often per session.
  lastSeenWriteSeconds: 60,

  // ---- Location lookup ----
  // Set GEOIP_DISABLED=true to never send IP addresses to the lookup service.
  geoipDisabled: process.env.GEOIP_DISABLED === "true",
  geoipUrl: (process.env.GEOIP_URL || "https://ipwho.is/").replace(/\/?$/, "/"),
};

module.exports = { LOGIN_SECURITY };
