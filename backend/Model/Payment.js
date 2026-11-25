const mongoose = require("mongoose");

// Email OTP that must be verified before a Razorpay payment can start.
const PaymentOtpSchema = new mongoose.Schema({
  uid: { type: String, required: true, index: true },
  email: { type: String, required: true },
  purpose: { type: String, enum: ["premium", "resume"], required: true },
  resumeId: { type: mongoose.Schema.Types.ObjectId, ref: "Resume", default: null },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  // Set once the code is entered correctly.
  verifiedAt: { type: Date, default: null },
  // The verified OTP can start a payment until this time.
  verifiedUntil: { type: Date, default: null },
  // Set when a newer code is issued, so only the latest code works.
  invalidatedAt: { type: Date, default: null },
  // Orders created with this verification.
  paymentIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  ip: String,
  userAgent: String,
  // Kept for a day for rate limiting, then removed automatically.
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 },
});
PaymentOtpSchema.index({ uid: 1, createdAt: -1 });

const PaymentEventSchema = new mongoose.Schema(
  {
    type: String,
    detail: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

// One Razorpay order and what happened to it. This is the transaction history.
const PaymentSchema = new mongoose.Schema(
  {
    uid: { type: String, required: true, index: true },
    email: String,
    name: String,
    purpose: { type: String, enum: ["premium", "resume", "subscription"], required: true },
    description: String,
    amount: { type: Number, required: true }, // paise
    currency: { type: String, default: "INR" },
    status: {
      type: String,
      enum: ["created", "paid", "failed", "cancelled", "expired", "refunded"],
      default: "created",
      index: true,
    },
    // Premium and resume payments need a verified email OTP first; plan purchases don't.
    otpId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PaymentOtp",
      required: function requiredOtp() {
        return this.purpose !== "subscription";
      },
    },

    // For plan purchases (Task 6).
    subscription: {
      plan: { type: String, default: null },
      // new | upgrade | renewal
      kind: { type: String, default: null },
      // Unused days of the previous plan taken off an upgrade (paise).
      credit: { type: Number, default: 0 },
      fullPrice: { type: Number, default: null },
      // The subscription this order was priced against. If it has changed by
      // the time the payment arrives (e.g. another tab paid first), the payment
      // is a duplicate and is refunded.
      basisPlan: { type: String, default: null },
      basisPeriodEnd: { type: Date, default: null },
      // The period it bought (filled in when activated).
      periodStart: { type: Date, default: null },
      periodEnd: { type: Date, default: null },
    },
    confirmationEmailAt: { type: Date, default: null },
    // "mock" for simulated test payments (PAYMENT_MODE=mock).
    gateway: { type: String, enum: ["razorpay", "mock"], default: "razorpay" },

    // For resume payments: the exact content paid for, frozen at order time.
    resumeId: { type: mongoose.Schema.Types.ObjectId, ref: "Resume", default: null },
    resumeVersion: Number,
    resumeSnapshot: { type: Object, default: null },
    contentHash: { type: String, default: null },

    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String, default: null },
    method: { type: String, default: null },
    failureReason: { type: String, default: null },
    paidAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },

    // What the payment unlocked.
    fulfilledAt: { type: Date, default: null },
    fulfillmentError: { type: String, default: null },
    generatedResumeId: { type: mongoose.Schema.Types.ObjectId, ref: "GeneratedResume", default: null },
    premiumUntil: { type: Date, default: null },

    // Duplicate payments for content that was already generated are refunded.
    duplicateOf: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", default: null },
    refundId: { type: String, default: null },
    refundStatus: { type: String, enum: [null, "processed", "failed"], default: null },

    invoice: {
      number: { type: String, default: null },
      issuedAt: { type: Date, default: null },
    },

    events: { type: [PaymentEventSchema], default: [] },
  },
  { timestamps: true }
);
// A Razorpay payment can belong to only one order. Unpaid orders (null) are not indexed.
PaymentSchema.index(
  { razorpayPaymentId: 1 },
  { unique: true, partialFilterExpression: { razorpayPaymentId: { $type: "string" } } }
);
PaymentSchema.index({ uid: 1, createdAt: -1 });
// At most one unpaid plan order per user at a time (stops duplicate checkouts).
PaymentSchema.index(
  { uid: 1 },
  { unique: true, name: "one_open_subscription_order", partialFilterExpression: { purpose: "subscription", status: "created" } }
);

// Sequential invoice numbers.
const CounterSchema = new mongoose.Schema({
  _id: String,
  seq: { type: Number, default: 0 },
});

module.exports = {
  PaymentOtp: mongoose.model("PaymentOtp", PaymentOtpSchema),
  Payment: mongoose.model("Payment", PaymentSchema),
  Counter: mongoose.model("Counter", CounterSchema),
};
