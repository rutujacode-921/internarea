const mongoose = require("mongoose");
const { SUPPORTED_LANGUAGES } = require("../config/languages");

// One document per user. Google users are created on first sign-in (uid is the
// Firebase uid). Password users sign up with email and/or mobile number
// (uid "local_<id>"). Holds language, Premium, resume and password settings.
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

    // ---- Public Space ---------------------------------------------------------
    // Unique handle for @mentions and profile links (lowercase a-z, 0-9, _ and .).
    username: { type: String, default: null },
    // Profile photo (from Google for Google accounts).
    photo: { type: String, default: null },
    bio: { type: String, default: "" },

    // ---- Password sign-in ----------------------------------------------------
    authProvider: { type: String, enum: ["google", "password"], default: "google" },
    // E.164 format, e.g. +919876543210.
    phone: { type: String, default: null },
    // bcrypt hash; the password itself is never stored.
    passwordHash: { type: String, default: null },
    // Increases on every password change, which signs out all older sessions.
    passwordVersion: { type: Number, default: 0 },
    passwordChangedAt: { type: Date, default: null },
    // Set after a reset: the user must choose a new password right after logging in.
    mustChangePassword: { type: Boolean, default: false },
    // Start of the current 24-hour Forgot Password window.
    lastResetRequestAt: { type: Date, default: null },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
  },
  { timestamps: true }
);

// Email and mobile number each identify at most one password account.
UserSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { authProvider: "password", email: { $type: "string" } } }
);
UserSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { authProvider: "password", phone: { $type: "string" } } }
);

UserSchema.index({ username: 1 }, { unique: true, partialFilterExpression: { username: { $type: "string" } } });

UserSchema.methods.isPremium = function isPremium(now = new Date()) {
  return Boolean(this.premiumUntil && this.premiumUntil > now);
};

module.exports = mongoose.model("User", UserSchema);
