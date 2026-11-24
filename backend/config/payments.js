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

// PAYMENT_MODE=mock swaps Razorpay for a simulated checkout, for local demos
// without Razorpay keys. It is refused in production so it can never be used
// to skip a real payment.
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const MOCK_REQUESTED = (process.env.PAYMENT_MODE || "").toLowerCase() === "mock";
if (MOCK_REQUESTED && IS_PRODUCTION) {
  console.error("PAYMENT_MODE=mock is ignored because NODE_ENV=production. Using Razorpay.");
}
const PAYMENT_MODE = MOCK_REQUESTED && !IS_PRODUCTION ? "mock" : "razorpay";
if (PAYMENT_MODE === "mock") {
  console.warn("Payments are SIMULATED (PAYMENT_MODE=mock). No real money is charged. Do not use in production.");
}

const isPurpose = (value) => value === "premium" || value === "resume";

module.exports = { CURRENCY, PRODUCTS, PAYMENT_SETTINGS, PAYMENT_MODE, isPurpose };
