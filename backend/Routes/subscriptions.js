const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const { Payment } = require("../Model/Payment");
const SubscriptionEvent = require("../Model/SubscriptionEvent");
const { requireAuth } = require("../middleware/auth");
const { sendError, asyncHandler } = require("../utils/errors");
const { CURRENCY, PAYMENT_SETTINGS, PAYMENT_MODE } = require("../config/payments");
const { PLANS, PLAN_IDS, SUBSCRIPTION_SETTINGS } = require("../config/subscriptions");
const payments = require("../services/payments");
const subs = require("../services/subscriptions");

// Task 6: internship application plans. Payment verification, cancelling a
// checkout, status checks, invoices and the webhook are shared with the other
// payments in Routes/payment.js (/api/payments/...).

router.use(requireAuth);

const planList = () =>
  PLAN_IDS.map((id) => ({ id, name: PLANS[id].name, price: PLANS[id].price, limit: PLANS[id].limit, rank: PLANS[id].rank }));

function serializePayment(p) {
  return {
    transactionId: p._id,
    status: p.status,
    gateway: p.gateway,
    amount: p.amount,
    currency: p.currency,
    description: p.description,
    plan: p.subscription?.plan || null,
    kind: p.subscription?.kind || null,
    credit: p.subscription?.credit || 0,
    periodStart: p.subscription?.periodStart || null,
    periodEnd: p.subscription?.periodEnd || null,
    createdAt: p.createdAt,
    paidAt: p.paidAt,
    method: p.method,
    failureReason: p.failureReason,
    razorpayOrderId: p.razorpayOrderId,
    razorpayPaymentId: p.razorpayPaymentId,
    invoiceNumber: p.invoice?.number || null,
    fulfilled: Boolean(p.fulfilledAt),
    refundStatus: p.refundStatus,
    confirmationEmailed: Boolean(p.confirmationEmailAt),
  };
}

// GET /api/subscriptions - current plan, quota, renewal date, plans, payment window.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await subs.syncSubscription(req.authUser.uid);
    subs.retryPendingConfirmations(user.uid).catch(() => undefined);
    res.json({
      subscription: subs.summarize(user),
      plans: planList(),
      currency: CURRENCY,
      periodDays: SUBSCRIPTION_SETTINGS.periodDays,
      renewWindowDays: SUBSCRIPTION_SETTINGS.renewWindowDays,
      paymentWindow: subs.paymentWindow(),
      payments: { configured: Boolean(payments.getRazorpay()), mode: PAYMENT_MODE },
      hasEmail: Boolean(user.email),
    });
  })
);

// GET /api/subscriptions/quote?plan=silver - what buying a plan would cost now.
router.get(
  "/quote",
  asyncHandler(async (req, res) => {
    const user = await subs.syncSubscription(req.authUser.uid);
    const q = subs.quote(user, String(req.query.plan || ""));
    if (q.error) return sendError(req, res, q.error.status, q.error.code, q.error.vars || {}, q.error.extra || {});
    res.json({ quote: q, paymentWindow: subs.paymentWindow() });
  })
);

// POST /api/subscriptions/order { plan } - start a payment for a plan.
router.post(
  "/order",
  asyncHandler(async (req, res) => {
    const planId = String(req.body?.plan || "");
    const uid = req.authUser.uid;

    // Payments may only be started inside the daily window (IST).
    const window = subs.paymentWindow();
    if (!window.open) {
      await subs.logEvents(uid, [{ type: "payment_blocked", toPlan: PLANS[planId] ? planId : null, detail: `outside ${window.start}-${window.end} ${window.zone}` }]);
      return sendError(req, res, 403, "PAYMENT_WINDOW_CLOSED", window, { window });
    }
    const razorpay = payments.getRazorpay();
    if (!razorpay) return sendError(req, res, 503, "PAYMENTS_UNAVAILABLE");

    const user = await subs.syncSubscription(uid);
    if (!user.email) return sendError(req, res, 400, "NO_EMAIL");

    const respondWithOrder = (payment) =>
      res.json({
        transaction: serializePayment(payment),
        checkout: {
          mode: PAYMENT_MODE,
          keyId: PAYMENT_MODE === "mock" ? "mock" : process.env.RAZORPAY_KEY_ID,
          orderId: payment.razorpayOrderId,
          amount: payment.amount,
          currency: payment.currency,
          description: payment.description,
          prefill: { name: user.name || "", email: user.email || "" },
        },
      });

    // An unfinished order already exists (double click, second tab, reload).
    const open = await Payment.findOne({ uid, purpose: "subscription", status: "created" });
    if (open) {
      const fresh = await payments.reconcile(open);
      // It was paid after all: don't take a second payment.
      if (fresh.status === "paid" || fresh.status === "refunded") {
        return res.json({ alreadyPaid: true, transaction: serializePayment(fresh) });
      }
      if (fresh.status === "created") {
        if (fresh.subscription?.plan === planId && fresh.expiresAt > new Date()) return respondWithOrder(fresh);
        await Payment.updateOne({ _id: fresh._id, status: "created" }, { $set: { status: "cancelled", failureReason: "Replaced by a newer payment attempt" } });
        await payments.addEvent(fresh._id, "superseded");
      }
    }

    const q = subs.quote(user, planId);
    if (q.error) return sendError(req, res, q.error.status, q.error.code, q.error.vars || {}, q.error.extra || {});

    const transactionId = new mongoose.Types.ObjectId();
    let order;
    try {
      order = await razorpay.orders.create({
        amount: q.amount,
        currency: CURRENCY,
        receipt: `sub_${transactionId}`,
        notes: { transactionId: String(transactionId), purpose: "subscription", plan: planId, kind: q.kind, uid },
      });
    } catch (error) {
      console.error("Razorpay order failed:", payments.describeGatewayError(error));
      return sendError(req, res, 502, "PAYMENT_GATEWAY_ERROR");
    }

    const label = { new: "new subscription", upgrade: "upgrade", renewal: "renewal" }[q.kind];
    try {
      const payment = await Payment.create({
        _id: transactionId,
        uid,
        email: user.email,
        name: user.name,
        purpose: "subscription",
        description: `${PLANS[planId].name} plan - ${SUBSCRIPTION_SETTINGS.periodDays} days (${label})`,
        amount: q.amount,
        currency: CURRENCY,
        subscription: {
          plan: planId,
          kind: q.kind,
          credit: q.credit,
          fullPrice: q.fullPrice,
          basisPlan: q.basisPlan,
          basisPeriodEnd: q.basisPeriodEnd,
        },
        razorpayOrderId: order.id,
        gateway: PAYMENT_MODE,
        expiresAt: new Date(Date.now() + PAYMENT_SETTINGS.orderTtlMinutes * 60 * 1000),
        events: [{ type: "created", detail: `${order.id} ${q.kind}` }],
      });
      return respondWithOrder(payment);
    } catch (error) {
      if (error?.code !== 11000) throw error;
      // Another request created an order at the same moment; use that one.
      const winner = await Payment.findOne({ uid, purpose: "subscription", status: "created" });
      if (winner && winner.subscription?.plan === planId) return respondWithOrder(winner);
      return sendError(req, res, 409, "PAYMENT_IN_PROGRESS");
    }
  })
);

const replyWithState = async (req, res, outcome) => {
  if (outcome.error) return sendError(req, res, outcome.error.status, outcome.error.code, outcome.error.vars || {}, outcome.error.extra || {});
  const user = await subs.syncSubscription(req.authUser.uid);
  res.json({ subscription: subs.summarize(user) });
};

// POST /api/subscriptions/downgrade { plan } - switch to a lower plan at the next renewal.
router.post(
  "/downgrade",
  asyncHandler(async (req, res) => replyWithState(req, res, await subs.scheduleDowngrade(req.authUser.uid, String(req.body?.plan || ""))))
);

// POST /api/subscriptions/cancel - keep the plan until the period ends, then Free.
router.post(
  "/cancel",
  asyncHandler(async (req, res) => replyWithState(req, res, await subs.cancelSubscription(req.authUser.uid)))
);

// POST /api/subscriptions/keep - undo a cancellation or a scheduled downgrade.
router.post(
  "/keep",
  asyncHandler(async (req, res) => replyWithState(req, res, await subs.keepCurrentPlan(req.authUser.uid)))
);

// GET /api/subscriptions/history - subscription events and plan payments (invoices).
router.get(
  "/history",
  asyncHandler(async (req, res) => {
    const uid = req.authUser.uid;
    await subs.syncSubscription(uid);
    const [events, list] = await Promise.all([
      SubscriptionEvent.find({ uid }).sort({ at: -1, _id: -1 }).limit(100),
      Payment.find({ uid, purpose: "subscription" }).sort({ createdAt: -1 }).limit(100).select("-events"),
    ]);
    res.json({
      events: events.map((e) => ({ id: e._id, type: e.type, fromPlan: e.fromPlan, toPlan: e.toPlan, periodStart: e.periodStart, periodEnd: e.periodEnd, detail: e.detail, at: e.at })),
      payments: list.map(serializePayment),
    });
  })
);

module.exports = router;
