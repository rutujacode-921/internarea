const crypto = require("crypto");

// Shared helpers for email one-time passwords (language change and payments).

const OTP_SECRET =
  process.env.OTP_SECRET ||
  (() => {
    console.warn("OTP_SECRET is not set; using a random secret (codes reset on restart).");
    return crypto.randomBytes(32).toString("hex");
  })();

// Only a keyed hash of each code is stored, salted with the OTP record id.
const hashOtp = (otpId, code) =>
  crypto.createHmac("sha256", OTP_SECRET).update(`${otpId}:${code}`).digest("hex");

const generateOtpCode = () => crypto.randomInt(0, 1000000).toString().padStart(6, "0");

// Constant-time comparison of two hex strings.
const safeEqual = (a, b) => {
  const left = Buffer.from(String(a), "hex");
  const right = Buffer.from(String(b), "hex");
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
};

const maskEmail = (email) => {
  const [name, domain] = String(email).split("@");
  if (!domain) return email;
  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}${"*".repeat(Math.max(name.length - visible.length, 3))}@${domain}`;
};

module.exports = { hashOtp, generateOtpCode, safeEqual, maskEmail };
