const mongoose = require("mongoose");

// A one-time password issued to confirm a protected language change.
// Only a keyed hash of the code is stored, never the code itself.
const LanguageOtpSchema = new mongoose.Schema({
  uid: { type: String, required: true, index: true },
  email: { type: String, required: true },
  targetLanguage: { type: String, required: true },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  consumedAt: { type: Date, default: null },
  // Set when a newer code is issued, so only the latest code works.
  invalidatedAt: { type: Date, default: null },
  ip: String,
  userAgent: String,
  // Records are kept for a day for rate limiting, then removed automatically.
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 },
});

LanguageOtpSchema.index({ uid: 1, createdAt: -1 });

module.exports = mongoose.model("LanguageOtp", LanguageOtpSchema);
