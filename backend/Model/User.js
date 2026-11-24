const mongoose = require("mongoose");
const { SUPPORTED_LANGUAGES } = require("../config/languages");

// One document per Firebase user. Holds the user's saved language so it can
// follow them across devices and future logins, plus Premium and resume settings.
const UserSchema = new mongoose.Schema(
  {
    uid: { type: String, required: true, unique: true, index: true },
    email: { type: String },
    name: { type: String },
    language: { type: String, enum: [...SUPPORTED_LANGUAGES, null], default: null },
    languageUpdatedAt: { type: Date, default: null },

    // Premium is active while premiumUntil is in the future.
    premiumUntil: { type: Date, default: null },
    // Payments already applied to premiumUntil, so a payment is never counted twice.
    premiumPaymentIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },

    // The generated resume sent with internship and job applications.
    defaultResumeId: { type: mongoose.Schema.Types.ObjectId, ref: "GeneratedResume", default: null },
  },
  { timestamps: true }
);

UserSchema.methods.isPremium = function isPremium(now = new Date()) {
  return Boolean(this.premiumUntil && this.premiumUntil > now);
};

module.exports = mongoose.model("User", UserSchema);
