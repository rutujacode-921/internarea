const mongoose = require("mongoose");

// One document per Forgot Password request. It holds the request's state
// (current code, attempts, resends) and doubles as the security audit history.
// Blocked requests (daily limit, unknown account, too many requests) are
// recorded too, without a code.
const EventSchema = new mongoose.Schema(
  { type: String, detail: String, at: { type: Date, default: Date.now } },
  { _id: false }
);

const PasswordResetSchema = new mongoose.Schema({
  // Null when no account matched the details entered.
  uid: { type: String, default: null, index: true },
  method: { type: String, enum: ["email", "phone"], required: true },
  // Masked email or phone, safe to show in the history.
  destination: { type: String, required: true },
  status: {
    type: String,
    enum: [
      "otp_sent", // waiting for the code
      "verified", // code accepted, new password being delivered
      "completed", // new password delivered and saved
      "delivery_failed", // code accepted, but sending the new password failed (retry allowed)
      "expired", // request timed out
      "locked", // too many wrong codes
      "send_failed", // the code could not be sent; did not count toward the daily limit
      "blocked_daily_limit",
      "invalid_user",
      "google_account",
      "rate_limited",
    ],
    required: true,
  },

  // Current code (keyed hash only) and limits.
  codeHash: { type: String, default: null },
  otpExpiresAt: { type: Date, default: null },
  lastSentAt: { type: Date, default: null },
  attempts: { type: Number, default: 0 },
  resendCount: { type: Number, default: 0 },
  deliveryAttempts: { type: Number, default: 0 },
  sessionExpiresAt: { type: Date, default: null },
  verifiedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },

  // Who asked, for auditing.
  ip: String,
  browser: String,
  os: String,
  device: String,
  userAgent: String,

  events: { type: [EventSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
});
PasswordResetSchema.index({ uid: 1, createdAt: -1 });
PasswordResetSchema.index({ ip: 1, createdAt: -1 });

module.exports = mongoose.model("PasswordReset", PasswordResetSchema);
