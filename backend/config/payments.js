// Prices and limits for paid features. Amounts are in paise (₹1 = 100 paise).

const intFromEnv = (name, fallback) => {
  const value = parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const CURRENCY = "INR";

const PRODUCTS = {
  // Premium unlocks the Resume Builder for a fixed period.
  premium: {
    amount: intFromEnv("PREMIUM_PRICE_PAISE", 5000),
    durationDays: intFromEnv("PREMIUM_DURATION_DAYS", 90),
  },
  // Charged once for each resume PDF that is generated.
  resume: {
    amount: intFromEnv("RESUME_PRICE_PAISE", 5000),
  },
};

const PAYMENT_SETTINGS = {
  // A verified OTP may be used to start a payment for this long.
  verificationWindowMinutes: intFromEnv("PAYMENT_VERIFICATION_WINDOW_MINUTES", 15),
  // Orders that are not paid within this time are marked expired.
  orderTtlMinutes: intFromEnv("PAYMENT_ORDER_TTL_MINUTES", 30),
  // How many checkout attempts one OTP verification allows (after cancels or failures).
  maxOrdersPerVerification: intFromEnv("PAYMENT_MAX_ORDERS_PER_VERIFICATION", 3),
};

const isPurpose = (value) => value === "premium" || value === "resume";

module.exports = { CURRENCY, PRODUCTS, PAYMENT_SETTINGS, isPurpose };
