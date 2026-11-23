const mongoose = require("mongoose");
const { SUPPORTED_LANGUAGES } = require("../config/languages");

// One document per Firebase user. Holds the user's saved language so it can
// follow them across devices and future logins.
const UserSchema = new mongoose.Schema(
  {
    uid: { type: String, required: true, unique: true, index: true },
    email: { type: String },
    name: { type: String },
    language: { type: String, enum: [...SUPPORTED_LANGUAGES, null], default: null },
    languageUpdatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);
