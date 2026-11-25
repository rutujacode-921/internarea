const mongoose = require("mongoose");

// Subscription history: one document per change to a user's plan or quota
// (activated, upgraded, renewed, downgrade scheduled, cancelled, expired,
// quota reset, payment blocked outside the payment window, ...).
const SubscriptionEventSchema = new mongoose.Schema({
  uid: { type: String, required: true, index: true },
  type: { type: String, required: true },
  fromPlan: { type: String, default: null },
  toPlan: { type: String, default: null },
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", default: null },
  periodStart: { type: Date, default: null },
  periodEnd: { type: Date, default: null },
  detail: { type: String, default: "" },
  at: { type: Date, default: Date.now },
});
SubscriptionEventSchema.index({ uid: 1, at: -1 });

module.exports = mongoose.model("SubscriptionEvent", SubscriptionEventSchema);
