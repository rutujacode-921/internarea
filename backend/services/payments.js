const crypto = require("crypto");
const Razorpay = require("razorpay");

const User = require("../Model/User");
const { Payment, Counter } = require("../Model/Payment");
const { GeneratedResume } = require("../Model/Resume");
const { PRODUCTS } = require("../config/payments");
const { renderResumePdf } = require("../utils/resumePdf");

let client = null;

// The Razorpay client, or null when keys are not configured.
function getRazorpay() {
  if (client) return client;
  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = process.env;
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) return null;
  client = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
  return client;
}

const hmacHex = (secret, payload) => crypto.createHmac("sha256", secret).update(payload).digest("hex");

const safeEqualHex = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

// Checkout success handler signature: HMAC(order_id|payment_id, key_secret).
function isValidCheckoutSignature(orderId, paymentId, signature) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;
  return safeEqualHex(hmacHex(secret, `${orderId}|${paymentId}`), signature);
}

// Webhook signature: HMAC(raw request body, webhook secret).
function isValidWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !rawBody) return false;
  return safeEqualHex(hmacHex(secret, rawBody), signature);
}

const describeGatewayError = (error) =>
  error?.error?.description || error?.description || error?.message || "Unknown gateway error";

async function addEvent(paymentId, type, detail = "") {
  await Payment.updateOne(
    { _id: paymentId },
    { $push: { events: { type, detail: String(detail).slice(0, 500), at: new Date() } } }
  );
}

// Sequential invoice numbers per year, e.g. INV-2026-000042.
async function assignInvoice(payment) {
  if (payment.invoice?.number) return payment;
  const year = new Date().getFullYear();
  const counter = await Counter.findOneAndUpdate(
    { _id: `invoice-${year}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  const number = `INV-${year}-${String(counter.seq).padStart(6, "0")}`;
  // Only the first caller sets the number, so a payment never gets two.
  const updated = await Payment.findOneAndUpdate(
    { _id: payment._id, "invoice.number": null },
    { $set: { "invoice.number": number, "invoice.issuedAt": new Date() } },
    { new: true }
  );
  return updated || Payment.findById(payment._id);
}

// Refunds a captured payment in full. By default the order is marked refunded;
// for a stray extra payment on an already paid order, pass { extraPaymentId }
// so only that payment is refunded and the order keeps its paid status.
async function refundPayment(payment, reason, { extraPaymentId = null } = {}) {
  const razorpay = getRazorpay();
  const gatewayPaymentId = extraPaymentId || payment.razorpayPaymentId;
  try {
    const refund = await razorpay.payments.refund(gatewayPaymentId, {
      amount: payment.amount,
      notes: { reason },
    });
    if (!extraPaymentId) {
      await Payment.updateOne(
        { _id: payment._id },
        { $set: { status: "refunded", refundId: refund.id, refundStatus: "processed" } }
      );
    }
    await addEvent(payment._id, "refunded", `${gatewayPaymentId}: ${reason}`);
  } catch (error) {
    // Flag the refund for manual follow-up; the money is not lost track of.
    console.error("Refund failed:", describeGatewayError(error));
    if (!extraPaymentId) {
      await Payment.updateOne({ _id: payment._id }, { $set: { refundStatus: "failed" } });
    }
    await addEvent(payment._id, "refund_failed", `${gatewayPaymentId}: ${reason}: ${describeGatewayError(error)}`);
  }
}

// Unlocks what the payment was for. Safe to call any number of times.
async function fulfill(paymentDoc) {
  let payment = await Payment.findById(paymentDoc._id);
  if (!payment || payment.status !== "paid" || payment.fulfilledAt) return payment;

  try {
    if (payment.purpose === "premium") {
      const durationMs = PRODUCTS.premium.durationDays * 24 * 60 * 60 * 1000;
      const now = new Date();
      // Extends from the current expiry if still active, otherwise from now.
      // The $ne guard makes sure one payment is only ever applied once.
      await User.updateOne({ uid: payment.uid, premiumPaymentIds: { $ne: payment._id } }, [
        {
          $set: {
            premiumUntil: { $add: [{ $max: [{ $ifNull: ["$premiumUntil", now] }, now] }, durationMs] },
            premiumPaymentIds: { $concatArrays: [{ $ifNull: ["$premiumPaymentIds", []] }, [payment._id]] },
          },
        },
      ]);
      const user = await User.findOne({ uid: payment.uid });
      payment = await Payment.findByIdAndUpdate(
        payment._id,
        { $set: { fulfilledAt: new Date(), fulfillmentError: null, premiumUntil: user?.premiumUntil || null } },
        { new: true }
      );
      await addEvent(payment._id, "premium_activated", user?.premiumUntil?.toISOString());
      return payment;
    }

    // Resume: refuse to charge twice for identical content.
    const existing = await GeneratedResume.findOne({
      uid: payment.uid,
      contentHash: payment.contentHash,
      paymentId: { $ne: payment._id },
    }).select("_id paymentId");
    if (existing) {
      payment = await Payment.findByIdAndUpdate(
        payment._id,
        { $set: { fulfilledAt: new Date(), duplicateOf: existing.paymentId, generatedResumeId: existing._id } },
        { new: true }
      );
      await addEvent(payment._id, "duplicate_detected", `Same content as payment ${existing.paymentId}`);
      await refundPayment(payment, "Duplicate payment for an already generated resume");
      return Payment.findById(payment._id);
    }

    const snapshot = payment.resumeSnapshot;
    const pdf = await renderResumePdf(snapshot);
    const safeName = (snapshot.data.personal.fullName || "resume").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_");
    let generated;
    let created = false;
    try {
      generated = await GeneratedResume.create({
        uid: payment.uid,
        resumeId: payment.resumeId,
        resumeVersion: payment.resumeVersion,
        title: snapshot.title,
        ...snapshot.design,
        contentHash: payment.contentHash,
        paymentId: payment._id,
        fileName: `${safeName || "resume"}_Resume.pdf`,
        pdf,
        size: pdf.length,
        shareToken: crypto.randomBytes(24).toString("hex"),
      });
      created = true;
    } catch (error) {
      if (error?.code !== 11000) throw error;
      // Another request completed this payment at the same moment.
      generated = await GeneratedResume.findOne({ paymentId: payment._id }).select("_id");
    }

    // A newly generated resume becomes the default for applications.
    if (created) {
      await User.updateOne({ uid: payment.uid }, { $set: { defaultResumeId: generated._id } });
    }
    payment = await Payment.findByIdAndUpdate(
      payment._id,
      { $set: { fulfilledAt: new Date(), fulfillmentError: null, generatedResumeId: generated._id } },
      { new: true }
    );
    if (created) await addEvent(payment._id, "resume_generated", String(generated._id));
    return payment;
  } catch (error) {
    console.error("Fulfilment failed:", error);
    await Payment.updateOne({ _id: payment._id }, { $set: { fulfillmentError: String(error.message || error).slice(0, 300) } });
    await addEvent(payment._id, "fulfilment_failed", error.message);
    return Payment.findById(payment._id);
  }
}

// Applies a Razorpay payment entity to our order: checks it belongs to the
// order and matches the amount, captures it if needed, marks the order paid
// and fulfils it. Returns the updated payment document.
async function applyGatewayPayment(payment, rzPayment) {
  if (rzPayment.order_id !== payment.razorpayOrderId) {
    await addEvent(payment._id, "mismatch", `Payment ${rzPayment.id} belongs to ${rzPayment.order_id}`);
    const error = new Error("Order mismatch");
    error.code = "PAYMENT_SIGNATURE_INVALID";
    throw error;
  }
  if (Number(rzPayment.amount) !== payment.amount || rzPayment.currency !== payment.currency) {
    await addEvent(payment._id, "amount_mismatch", `${rzPayment.amount} ${rzPayment.currency}`);
    const error = new Error("Amount mismatch");
    error.code = "PAYMENT_AMOUNT_MISMATCH";
    throw error;
  }

  let status = rzPayment.status;
  if (status === "authorized") {
    // Accounts without auto-capture leave payments authorized; capture now.
    try {
      const captured = await getRazorpay().payments.capture(rzPayment.id, payment.amount, payment.currency);
      status = captured.status;
    } catch (error) {
      // It may have been captured meanwhile (auto-capture or a parallel call).
      const fresh = await getRazorpay().payments.fetch(rzPayment.id);
      status = fresh.status;
    }
  }

  if (status === "failed") {
    await Payment.updateOne(
      { _id: payment._id, status: "created" },
      { $set: { status: "failed", failureReason: rzPayment.error_description || "Payment failed" } }
    );
    return Payment.findById(payment._id);
  }
  if (status !== "captured") return Payment.findById(payment._id);

  // Move to "paid" once. Cancelled or expired orders that were paid anyway
  // (e.g. from another open checkout window) are still honoured.
  let updated = await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $in: ["created", "failed", "cancelled", "expired"] }, razorpayPaymentId: null },
    {
      $set: {
        status: "paid",
        razorpayPaymentId: rzPayment.id,
        method: rzPayment.method || null,
        paidAt: rzPayment.created_at ? new Date(rzPayment.created_at * 1000) : new Date(),
        failureReason: null,
      },
    },
    { new: true }
  );

  if (updated) {
    await addEvent(updated._id, "paid", rzPayment.id);
  } else {
    updated = await Payment.findById(payment._id);
    if (updated.razorpayPaymentId && updated.razorpayPaymentId !== rzPayment.id) {
      // A second successful payment on an order that was already paid.
      console.warn(`Second payment ${rzPayment.id} on order ${payment.razorpayOrderId}; refunding.`);
      const alreadyRefunded = updated.events.some((e) => e.type === "refunded" && e.detail.startsWith(rzPayment.id));
      if (!alreadyRefunded) {
        await refundPayment(updated, "Second payment on an already paid order", { extraPaymentId: rzPayment.id });
      }
      return Payment.findById(payment._id);
    }
  }

  updated = await assignInvoice(updated);
  return fulfill(updated);
}

// Brings a payment up to date with Razorpay. Used after interruptions, when the
// browser closed or lost connection before it could report the result.
async function reconcile(payment) {
  if (payment.status === "paid") {
    return payment.fulfilledAt ? payment : fulfill(payment);
  }
  if (payment.status === "refunded") return payment;

  const razorpay = getRazorpay();
  if (razorpay) {
    try {
      const result = await razorpay.orders.fetchPayments(payment.razorpayOrderId);
      const items = Array.isArray(result?.items) ? result.items : [];
      const success = items.find((p) => p.status === "captured") || items.find((p) => p.status === "authorized");
      if (success) return applyGatewayPayment(payment, success);
      const failed = items.find((p) => p.status === "failed");
      if (failed && payment.status === "created") {
        await Payment.updateOne(
          { _id: payment._id, status: "created" },
          { $set: { status: "failed", failureReason: failed.error_description || "Payment failed" } }
        );
      }
    } catch (error) {
      console.warn("Could not reconcile payment with Razorpay:", describeGatewayError(error));
    }
  }

  if (payment.status === "created" && payment.expiresAt <= new Date()) {
    await Payment.updateOne({ _id: payment._id, status: "created" }, { $set: { status: "expired" } });
    await addEvent(payment._id, "expired");
  }
  return Payment.findById(payment._id);
}

module.exports = {
  getRazorpay,
  isValidCheckoutSignature,
  isValidWebhookSignature,
  describeGatewayError,
  applyGatewayPayment,
  reconcile,
  fulfill,
  addEvent,
};
