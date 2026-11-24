const mongoose = require("mongoose");

// A browser on a device that has completed a successful, fully verified sign-in.
// Keyed by the random device id the browser keeps plus the browser name, so a
// different browser on the same computer is a new device.
const TrustedDeviceSchema = new mongoose.Schema(
  {
    uid: { type: String, required: true, index: true },
    deviceKey: { type: String, required: true },
    browserName: String,
    osName: String,
    deviceType: String,
    deviceModel: String,
    lastIp: String,
    lastCountry: String,
    trustedAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);
TrustedDeviceSchema.index({ uid: 1, deviceKey: 1 }, { unique: true });

module.exports = mongoose.model("TrustedDevice", TrustedDeviceSchema);
