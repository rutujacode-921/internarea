const mongoose = require("mongoose");

// One document per sign-in attempt. It is at once:
// - the Login History entry (browser, OS, device, IP, location, time, status),
// - the verification log (OTP sent / resent / wrong / expired / locked events),
// - and, once the sign-in succeeds, the session itself. A session is active while
//   status is "success", revokedAt is empty and expiresAt is in the future.
// Codes and challenge tokens are only ever stored as keyed hashes.

const EventSchema = new mongoose.Schema(
  { type: String, detail: String, ip: String, at: { type: Date, default: Date.now } },
  { _id: false }
);

const LoginActivitySchema = new mongoose.Schema({
  // Null when no account matched the details entered.
  uid: { type: String, default: null, index: true },
  provider: { type: String, enum: ["password", "google"], required: true },
  // "login" or "signup" (a new account's first session).
  kind: { type: String, enum: ["login", "signup"], default: "login" },
  // Masked email/phone typed for a failed lookup, so the owner can recognise it.
  identifier: { type: String, default: null },

  status: {
    type: String,
    enum: [
      "otp_pending", // waiting for the Chrome email OTP
      "success", // signed in (this document is now the session)
      "failed_password", // wrong password
      "blocked_mobile_hours", // mobile sign-in outside the allowed window
      "account_locked", // too many failed passwords / OTP lockouts
      "otp_locked", // too many wrong codes
      "otp_expired", // the verification step timed out
      "otp_send_failed", // the code could not be sent
      "unknown_account",
    ],
    required: true,
  },
  // Why the session ended: signed_out, revoked, password_changed, password_reset,
  // mobile_hours_ended, session_limit, device_mismatch.
  revokedAt: { type: Date, default: null },
  revokeReason: { type: String, default: null },
  expiresAt: { type: Date, default: null },
  lastSeenAt: { type: Date, default: null },
  lastIp: { type: String, default: null },

  // ---- Environment ----
  ip: String,
  publicIp: String, // differs from ip only in local development (behind localhost)
  userAgent: String,
  browserName: String,
  browserVersion: String,
  osName: String,
  osVersion: String,
  deviceType: { type: String, enum: ["desktop", "laptop", "tablet", "mobile"] },
  deviceModel: String,
  // Random id kept in the browser's storage: identifies "this browser on this device".
  deviceId: { type: String, index: true },
  location: {
    city: String,
    region: String,
    country: String,
    countryCode: String,
    timezone: String,
    isp: String,
    lookedUp: { type: Boolean, default: false },
  },

  // What was new about this sign-in compared with the account's earlier successful ones.
  isNewDevice: { type: Boolean, default: false },
  isNewBrowser: { type: Boolean, default: false },
  isNewIp: { type: Boolean, default: false },
  isNewCountry: { type: Boolean, default: false },
  trustedDevice: { type: Boolean, default: false },

  // Which rules applied.
  otpRequired: { type: Boolean, default: false },
  otpChannel: { type: String, enum: ["email", "sms", null], default: null },
  otpDestination: { type: String, default: null },

  // ---- Verification state (only while status is otp_pending) ----
  codeHash: { type: String, default: null },
  challengeTokenHash: { type: String, default: null },
  otpExpiresAt: { type: Date, default: null },
  challengeExpiresAt: { type: Date, default: null },
  lastSentAt: { type: Date, default: null },
  attempts: { type: Number, default: 0 },
  resendCount: { type: Number, default: 0 },
  verifiedAt: { type: Date, default: null },

  // Client-generated id for one press of "Log in"; makes retries idempotent.
  requestId: { type: String, default: null },

  events: { type: [EventSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
});

LoginActivitySchema.index({ uid: 1, createdAt: -1 });
LoginActivitySchema.index({ uid: 1, status: 1, revokedAt: 1 });
// One sign-in per request id: duplicate copies of one request can't both create one.
LoginActivitySchema.index(
  { uid: 1, requestId: 1 },
  { unique: true, partialFilterExpression: { requestId: { $type: "string" } } }
);

module.exports = mongoose.model("LoginActivity", LoginActivitySchema);
