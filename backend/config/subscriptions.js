// Internship application plans (Task 6). Prices are in paise (₹1 = 100 paise).

const intFromEnv = (name, fallback) => {
  const value = parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

// "HH:MM" -> minutes after midnight.
const minutesFromEnv = (name, fallback) => {
  const match = String(process.env[name] || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const value = Number(match[1]) * 60 + Number(match[2]);
  return value >= 0 && value < 24 * 60 ? value : fallback;
};

// limit: internship applications per billing cycle (null = unlimited).
// rank orders the plans for upgrades and downgrades.
const PLANS = {
  free: { id: "free", name: "Free", price: 0, limit: 1, rank: 0 },
  bronze: { id: "bronze", name: "Bronze", price: intFromEnv("PLAN_BRONZE_PRICE_PAISE", 10000), limit: 3, rank: 1 },
  silver: { id: "silver", name: "Silver", price: intFromEnv("PLAN_SILVER_PRICE_PAISE", 30000), limit: 5, rank: 2 },
  gold: { id: "gold", name: "Gold", price: intFromEnv("PLAN_GOLD_PRICE_PAISE", 100000), limit: null, rank: 3 },
};
const PLAN_IDS = Object.keys(PLANS);
const PAID_PLAN_IDS = PLAN_IDS.filter((id) => PLANS[id].price > 0);

const SUBSCRIPTION_SETTINGS = {
  // A paid plan is a prepaid period of this many days ("per month").
  periodDays: intFromEnv("SUBSCRIPTION_PERIOD_DAYS", 30),
  // Renewing is possible in the last few days of a period (or after it ends).
  renewWindowDays: intFromEnv("SUBSCRIPTION_RENEW_WINDOW_DAYS", 7),
  // Free quotas reset on the 1st of each month, and payments are only allowed
  // in a daily window, both in this time zone (IST).
  timeZone: process.env.SUBSCRIPTION_TIME_ZONE || "Asia/Kolkata",
  paymentWindowStart: minutesFromEnv("PAYMENT_WINDOW_START", 5 * 60), // 5:00 AM
  paymentWindowEnd: minutesFromEnv("PAYMENT_WINDOW_END", 11 * 60 + 45), // 11:45 AM (inclusive)
  // Smallest amount charged for an upgrade after the unused-days credit.
  minimumCharge: 100,
};

module.exports = { PLANS, PLAN_IDS, PAID_PLAN_IDS, SUBSCRIPTION_SETTINGS };
