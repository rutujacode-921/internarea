const mongoose = require("mongoose");

// Audit trail of language preference activity for each user.
const LanguageChangeLogSchema = new mongoose.Schema({
  uid: { type: String, required: true, index: true },
  email: String,
  previousLanguage: { type: String, default: null },
  language: { type: String, required: true },
  // changed       - the preference was updated
  // otp_requested - a verification code was emailed
  // otp_failed    - a wrong code was entered
  // blocked       - the change was refused (OTP missing, rate limited, ...)
  status: {
    type: String,
    enum: ["changed", "otp_requested", "otp_failed", "blocked"],
    required: true,
  },
  method: {
    type: String,
    enum: ["direct", "otp", "sync", "initial"],
    default: "direct",
  },
  reason: String,
  ip: String,
  userAgent: String,
  browser: String,
  os: String,
  device: String,
  createdAt: { type: Date, default: Date.now, index: true },
});

module.exports = mongoose.model("LanguageChangeLog", LanguageChangeLogSchema);
