const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const { PaymentOtp, Payment } = require("../Model/Payment");
const { Resume, GeneratedResume } = require("../Model/Resume");
const { requireAuth } = require("../middleware/auth");
const { sendError, asyncHandler } = require("../utils/errors");
const { getClientInfo } = require("../utils/clientInfo");
const { sendPaymentOtpEmail } = require("../utils/mailer");
const { hashOtp, generateOtpCode, safeEqual, maskEmail } = require("../utils/otp");
const { getOrCreateUser, premiumInfo } = require("../utils/users");
const { buildResumeSnapshot } = require("../utils/resumeSnapshot");
const { renderInvoicePdf } = require("../utils/invoicePdf");
const { translate, getRequestLanguage } = require("../i18n/messages");
const { OTP_SETTINGS } = require("../config/languages");
const { CURRENCY, PRODUCTS, PAYMENT_SETTINGS, PAYMENT_MODE, isPurpose } = require("../config/payments");
const payments = require("../services/payments");
const { completeMockCheckout } = require("../services/mockGateway");

const formatAmount = (paise) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: CURRENCY }).format(paise / 100);

// What the client sees about a transaction.
function serialize(payment) {
  if (!payment) return null;
  return {
    transactionId: payment._id,
    purpose: payment.purpose,
    gateway: payment.gateway || "razorpay",
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    description: payment.description,
    resumeTitle: payment.resumeSnapshot?.title || null,
    createdAt: payment.createdAt,
    paidAt: payment.paidAt,
    method: payment.method,
    failureReason: payment.failureReason,
    razorpayOrderId: payment.razorpayOrderId,
    razorpayPaymentId: payment.razorpayPaymentId,
    invoiceNumber: payment.invoice?.number || null,
    invoiceIssuedAt: payment.invoice?.issuedAt || null,
    fulfilled: Boolean(payment.fulfilledAt),
    fulfillmentFailed: Boolean(payment.fulfillmentError && !payment.fulfilledAt),
    generatedResumeId: payment.generatedResumeId,
    premiumUntil: payment.premiumUntil,
    duplicate: Boolean(payment.duplicateOf),
    refundStatus: payment.refundStatus,
    subscription: payment.purpose === "subscription" ? payment.subscription : undefined,
  };
}

// Checks the user may buy this right now and works out what they are buying.
// Runs both before the OTP is sent and again before the order is created.
async function preparePurchase(req, user, purpose, resumeId) {
  const uiLang = getRequestLanguage(req);
  const fail = (status, code, vars = {}, extra = {}) => ({ error: { status, code, vars, extra } });

  if (!isPurpose(purpose)) return fail(400, "INVALID_PURPOSE");

  if (purpose === "premium") {
    const vars = { days: PRODUCTS.premium.durationDays };
    return {
      amount: PRODUCTS.premium.amount,
      description: translate("en", "products.premium", vars),
      item: translate(uiLang, "products.premium", vars),
    };
  }

  // Resume: Premium only, complete, and not already generated.
  if (!user.isPremium()) return fail(403, "PREMIUM_REQUIRED");
  if (!mongoose.isValidObjectId(resumeId)) return fail(404, "RESUME_NOT_FOUND");
  const resume = await Resume.findOne({ _id: resumeId, uid: user.uid });
  if (!resume) return fail(404, "RESUME_NOT_FOUND");

  const { snapshot, issues, contentHash } = buildResumeSnapshot(resume);
  if (issues.length) return fail(422, "RESUME_INCOMPLETE", {}, { issues });

  const existing = await GeneratedResume.findOne({ uid: user.uid, contentHash }).select("_id title");
  if (existing) return fail(409, "ALREADY_GENERATED", {}, { generatedResumeId: existing._id });

  const vars = { title: resume.title };
  return {
    amount: PRODUCTS.resume.amount,
    description: translate("en", "products.resume", vars),
    item: translate(uiLang, "products.resume", vars),
    resume,
    snapshot,
    contentHash,
  };
}

const sendPrepError = (req, res, prep) =>
  sendError(req, res, prep.error.status, prep.error.code, prep.error.vars, prep.error.extra);

// ---------------------------------------------------------------------------
// Razorpay webhook (no user session; authenticated by its signature).
// Catches payments whose browser never reported back, e.g. a closed tab.
router.post(
  "/webhook",
  asyncHandler(async (req, res) => {
    if (!payments.isValidWebhookSignature(req.rawBody, req.headers["x-razorpay-signature"])) {
      return res.status(400).json({ ok: false });
    }
    const event = req.body?.event;
    const entity = req.body?.payload?.payment?.entity;
    if (entity?.order_id) {
      const payment = await Payment.findOne({ razorpayOrderId: entity.order_id });
      if (payment) {
        await payments.addEvent(payment._id, `webhook:${event}`, entity.id);
        if (["payment.captured", "payment.authorized", "order.paid"].includes(event)) {
          await payments.applyGatewayPayment(payment, entity).catch((error) => {
            console.error("Webhook could not apply payment:", error.message);
          });
        } else if (event === "payment.failed") {
          await Payment.updateOne(
            { _id: payment._id, status: "created" },
            { $set: { status: "failed", failureReason: entity.error_description || "Payment failed" } }
          );
        }
      }
    }
    res.json({ ok: true });
  })
);

router.use(requireAuth);

// GET /api/payments/plans - prices and the user's Premium status.
router.get(
  "/plans",
  asyncHandler(async (req, res) => {
    const user = await getOrCreateUser(req.authUser);
    res.json({
      configured: Boolean(payments.getRazorpay()),
      mode: PAYMENT_MODE,
      currency: CURRENCY,
      premium: { price: PRODUCTS.premium.amount, durationDays: PRODUCTS.premium.durationDays },
      resume: { price: PRODUCTS.resume.amount },
      status: premiumInfo(user),
    });
  })
);

// POST /api/payments/otp - email a code that must be verified before paying.
router.post(
  "/otp",
  asyncHandler(async (req, res) => {
    const { purpose, resumeId } = req.body || {};
    if (!req.authUser.email) return sendError(req, res, 400, "NO_EMAIL");
    if (!payments.getRazorpay()) return sendError(req, res, 503, "PAYMENTS_UNAVAILABLE");

    const user = await getOrCreateUser(req.authUser);
    const prep = await preparePurchase(req, user, purpose, resumeId);
    if (prep.error) return sendPrepError(req, res, prep);

    const now = Date.now();
    const latest = await PaymentOtp.findOne({ uid: user.uid }).sort({ createdAt: -1 });
    const cooldownMs = OTP_SETTINGS.resendCooldownSeconds * 1000;
    if (latest && now - latest.createdAt.getTime() < cooldownMs) {
      const seconds = Math.ceil((cooldownMs - (now - latest.createdAt.getTime())) / 1000);
      return sendError(req, res, 429, "OTP_COOLDOWN", { seconds }, { retryAfter: seconds });
    }
    const hourAgo = new Date(now - 60 * 60 * 1000);
    const recent = await PaymentOtp.find({ uid: user.uid, createdAt: { $gte: hourAgo } })
      .sort({ createdAt: 1 })
      .select("createdAt");
    if (recent.length >= OTP_SETTINGS.maxRequestsPerHour) {
      const retryAfter = Math.ceil((recent[0].createdAt.getTime() + 60 * 60 * 1000 - now) / 1000);
      return sendError(req, res, 429, "OTP_RATE_LIMITED", { minutes: Math.ceil(retryAfter / 60) }, { retryAfter });
    }

    // Only the newest code (and verification) may be used.
    await PaymentOtp.updateMany(
      { uid: user.uid, invalidatedAt: null },
      { $set: { invalidatedAt: new Date(now) } }
    );

    const otpId = new mongoose.Types.ObjectId();
    const code = generateOtpCode();
    const client = getClientInfo(req);
    const otp = await PaymentOtp.create({
      _id: otpId,
      uid: user.uid,
      email: req.authUser.email,
      purpose,
      resumeId: purpose === "resume" ? prep.resume._id : null,
      codeHash: hashOtp(otpId.toString(), code),
      expiresAt: new Date(now + OTP_SETTINGS.ttlMinutes * 60 * 1000),
      ip: client.ip,
      userAgent: client.userAgent,
    });

    try {
      await sendPaymentOtpEmail({
        to: req.authUser.email,
        code,
        item: prep.item,
        amount: formatAmount(prep.amount),
        uiLanguage: getRequestLanguage(req),
        minutes: OTP_SETTINGS.ttlMinutes,
      });
    } catch (error) {
      console.error("Failed to send payment OTP email:", error);
      await otp.deleteOne();
      return sendError(req, res, 502, "EMAIL_FAILED");
    }

    res.status(201).json({
      otpId,
      expiresInSeconds: OTP_SETTINGS.ttlMinutes * 60,
      resendInSeconds: OTP_SETTINGS.resendCooldownSeconds,
      maskedEmail: maskEmail(req.authUser.email),
      maxAttempts: OTP_SETTINGS.maxVerifyAttempts,
      amount: prep.amount,
      currency: CURRENCY,
    });
  })
);

// POST /api/payments/otp/verify - check the code; unlocks payment for a short window.
router.post(
  "/otp/verify",
  asyncHandler(async (req, res) => {
    const { otpId, code } = req.body || {};
    const max = OTP_SETTINGS.maxVerifyAttempts;
    if (!mongoose.isValidObjectId(otpId) || typeof code !== "string" || !/^\d{6}$/.test(code)) {
      return sendError(req, res, 400, "OTP_INVALID_FORMAT");
    }

    const otp = await PaymentOtp.findOne({ _id: otpId, uid: req.authUser.uid });
    if (!otp || otp.invalidatedAt) return sendError(req, res, 410, "OTP_NOT_FOUND");
    if (otp.verifiedAt) return sendError(req, res, 410, "OTP_USED");
    if (otp.expiresAt.getTime() <= Date.now()) return sendError(req, res, 410, "OTP_EXPIRED");
    if (otp.attempts >= max) return sendError(req, res, 429, "OTP_LOCKED");

    if (!safeEqual(hashOtp(otpId, code), otp.codeHash)) {
      const updated = await PaymentOtp.findOneAndUpdate(
        { _id: otpId, attempts: { $lt: max } },
        { $inc: { attempts: 1 } },
        { new: true }
      );
      const attemptsLeft = updated ? Math.max(max - updated.attempts, 0) : 0;
      if (attemptsLeft === 0) return sendError(req, res, 429, "OTP_LOCKED");
      return sendError(req, res, 400, "OTP_INVALID", { attemptsLeft }, { attemptsLeft });
    }

    // Mark verified atomically so a code can never be used twice.
    const windowMs = PAYMENT_SETTINGS.verificationWindowMinutes * 60 * 1000;
    const verified = await PaymentOtp.findOneAndUpdate(
      { _id: otpId, verifiedAt: null, invalidatedAt: null, expiresAt: { $gt: new Date() }, attempts: { $lt: max } },
      { $set: { verifiedAt: new Date(), verifiedUntil: new Date(Date.now() + windowMs) } },
      { new: true }
    );
    if (!verified) return sendError(req, res, 410, "OTP_USED");

    res.json({ verified: true, otpId, verifiedForSeconds: windowMs / 1000 });
  })
);

// POST /api/payments/order - create a Razorpay order. Needs a verified OTP.
router.post(
  "/order",
  asyncHandler(async (req, res) => {
    const { otpId } = req.body || {};
    const razorpay = payments.getRazorpay();
    if (!razorpay) return sendError(req, res, 503, "PAYMENTS_UNAVAILABLE");
    if (!mongoose.isValidObjectId(otpId)) return sendError(req, res, 403, "PAYMENT_OTP_REQUIRED");

    const otp = await PaymentOtp.findOne({ _id: otpId, uid: req.authUser.uid });
    if (!otp || !otp.verifiedAt || otp.invalidatedAt) return sendError(req, res, 403, "PAYMENT_OTP_REQUIRED");
    if (!otp.verifiedUntil || otp.verifiedUntil <= new Date()) {
      return sendError(req, res, 410, "PAYMENT_VERIFICATION_EXPIRED");
    }

    const user = await getOrCreateUser(req.authUser);
    const respondWithOrder = (payment) =>
      res.json({
        transaction: serialize(payment),
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

    // One verification pays for exactly one purchase.
    const completed = await Payment.findOne({ otpId: otp._id, status: { $in: ["paid", "refunded"] } });
    if (completed) return res.json({ alreadyPaid: true, transaction: serialize(completed) });

    // Bring any unfinished orders for the same purchase up to date first, so a
    // payment made in another tab is found instead of charging twice.
    const target = { uid: user.uid, purpose: otp.purpose, ...(otp.resumeId ? { resumeId: otp.resumeId } : {}) };
    const open = await Payment.find({ ...target, status: "created" });
    for (const pending of open) {
      const fresh = await payments.reconcile(pending);
      // It was paid after all (e.g. in another tab): don't start a second payment.
      if (fresh.status === "paid" || fresh.status === "refunded") {
        return res.json({ alreadyPaid: true, transaction: serialize(fresh) });
      }
      // Double click or reopening checkout: reuse this verification's open order.
      if (fresh.status === "created" && fresh.otpId.equals(otp._id) && fresh.expiresAt > new Date()) {
        return respondWithOrder(fresh);
      }
      if (fresh.status === "created") {
        await Payment.updateOne({ _id: fresh._id, status: "created" }, { $set: { status: "cancelled", failureReason: "Replaced by a newer payment attempt" } });
        await payments.addEvent(fresh._id, "superseded");
      }
    }

    const prep = await preparePurchase(req, user, otp.purpose, otp.resumeId);
    if (prep.error) return sendPrepError(req, res, prep);

    // Claim one of the limited attempts for this verification.
    const transactionId = new mongoose.Types.ObjectId();
    const max = PAYMENT_SETTINGS.maxOrdersPerVerification;
    const claimed = await PaymentOtp.updateOne(
      { _id: otp._id, [`paymentIds.${max - 1}`]: { $exists: false } },
      { $push: { paymentIds: transactionId } }
    );
    if (!claimed.modifiedCount) return sendError(req, res, 429, "PAYMENT_ATTEMPTS_EXCEEDED");

    let order;
    try {
      order = await razorpay.orders.create({
        amount: prep.amount,
        currency: CURRENCY,
        receipt: `rcpt_${transactionId}`,
        notes: { transactionId: String(transactionId), purpose: otp.purpose, uid: user.uid },
      });
    } catch (error) {
      console.error("Razorpay order failed:", payments.describeGatewayError(error));
      await PaymentOtp.updateOne({ _id: otp._id }, { $pull: { paymentIds: transactionId } });
      return sendError(req, res, 502, "PAYMENT_GATEWAY_ERROR");
    }

    const payment = await Payment.create({
      _id: transactionId,
      uid: user.uid,
      email: user.email,
      name: user.name,
      purpose: otp.purpose,
      description: prep.description,
      amount: prep.amount,
      currency: CURRENCY,
      otpId: otp._id,
      resumeId: prep.resume?._id || null,
      resumeVersion: prep.resume?.version,
      resumeSnapshot: prep.snapshot || null,
      contentHash: prep.contentHash || null,
      razorpayOrderId: order.id,
      gateway: PAYMENT_MODE,
      expiresAt: new Date(Date.now() + PAYMENT_SETTINGS.orderTtlMinutes * 60 * 1000),
      events: [{ type: "created", detail: order.id }],
    });
    respondWithOrder(payment);
  })
);

// POST /api/payments/verify - called by checkout's success handler.
router.post(
  "/verify",
  asyncHandler(async (req, res) => {
    const { orderId, paymentId, signature } = req.body || {};
    if (typeof orderId !== "string" || typeof paymentId !== "string" || typeof signature !== "string") {
      return sendError(req, res, 400, "PAYMENT_SIGNATURE_INVALID");
    }
    const payment = await Payment.findOne({ razorpayOrderId: orderId, uid: req.authUser.uid });
    if (!payment) return sendError(req, res, 404, "PAYMENT_NOT_FOUND");

    if (!payments.isValidCheckoutSignature(orderId, paymentId, signature)) {
      await payments.addEvent(payment._id, "invalid_signature", paymentId);
      return sendError(req, res, 400, "PAYMENT_SIGNATURE_INVALID");
    }

    let rzPayment;
    try {
      rzPayment = await payments.getRazorpay().payments.fetch(paymentId);
    } catch (error) {
      console.error("Could not fetch Razorpay payment:", payments.describeGatewayError(error));
      return sendError(req, res, 502, "PAYMENT_GATEWAY_ERROR", {}, { transactionId: payment._id });
    }

    try {
      const updated = await payments.applyGatewayPayment(payment, rzPayment);
      if (!["paid", "refunded"].includes(updated.status)) {
        return sendError(req, res, 402, "PAYMENT_NOT_COMPLETED", {}, { transaction: serialize(updated) });
      }
      res.json({ transaction: serialize(updated) });
    } catch (error) {
      if (error.code) return sendError(req, res, 400, error.code);
      throw error;
    }
  })
);

// POST /api/payments/mock/complete - the simulated checkout's Pay / Fail
// buttons (PAYMENT_MODE=mock only). Returns what Razorpay Checkout would.
router.post(
  "/mock/complete",
  asyncHandler(async (req, res) => {
    if (PAYMENT_MODE !== "mock") return sendError(req, res, 404, "PAYMENT_NOT_FOUND");
    const { orderId, outcome } = req.body || {};
    const payment = await Payment.findOne({ razorpayOrderId: orderId, uid: req.authUser.uid });
    if (!payment) return sendError(req, res, 404, "PAYMENT_NOT_FOUND");
    const result = completeMockCheckout(orderId, outcome === "success" ? "success" : "fail");
    if (!result) return sendError(req, res, 410, "PAYMENT_VERIFICATION_EXPIRED");
    res.json(result);
  })
);

// GET /api/payments - the user's transaction history.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const list = await Payment.find({ uid: req.authUser.uid })
      .sort({ createdAt: -1 })
      .limit(100)
      .select("-events -resumeSnapshot.photo");
    res.json({ transactions: list.map(serialize) });
  })
);

async function findOwnPayment(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    sendError(req, res, 404, "PAYMENT_NOT_FOUND");
    return null;
  }
  const payment = await Payment.findOne({ _id: id, uid: req.authUser.uid });
  if (!payment) sendError(req, res, 404, "PAYMENT_NOT_FOUND");
  return payment;
}

// GET /api/payments/:id - current status. Checks Razorpay for unfinished
// payments and retries a failed completion, so interruptions recover.
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const payment = await findOwnPayment(req, res);
    if (!payment) return;
    const recent = Date.now() - payment.createdAt.getTime() < 24 * 60 * 60 * 1000;
    const needsCheck =
      (payment.status === "paid" && !payment.fulfilledAt) ||
      (recent && ["created", "cancelled", "failed", "expired"].includes(payment.status));
    const fresh = needsCheck ? await payments.reconcile(payment) : payment;
    res.json({ transaction: serialize(fresh) });
  })
);

// POST /api/payments/:id/cancel - checkout was closed or the payment failed.
router.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const payment = await findOwnPayment(req, res);
    if (!payment) return;
    const failed = req.body?.reason === "failed";
    const detail = String(req.body?.error?.description || req.body?.error?.reason || "").slice(0, 300);

    // The user may have paid just before closing; check before cancelling.
    const fresh = await payments.reconcile(payment);
    if (fresh.status === "created") {
      await Payment.updateOne(
        { _id: fresh._id, status: "created" },
        {
          $set: failed
            ? { status: "failed", failureReason: detail || "Payment failed" }
            : { status: "cancelled", failureReason: "Cancelled by user" },
        }
      );
      await payments.addEvent(fresh._id, failed ? "failed" : "cancelled", detail);
    }
    res.json({ transaction: serialize(await Payment.findById(fresh._id)) });
  })
);

// GET /api/payments/:id/invoice - invoice PDF for a completed payment.
router.get(
  "/:id/invoice",
  asyncHandler(async (req, res) => {
    const payment = await findOwnPayment(req, res);
    if (!payment) return;
    if (!payment.invoice?.number || !payment.razorpayPaymentId) {
      return sendError(req, res, 409, "INVOICE_NOT_AVAILABLE");
    }
    const pdf = await renderInvoicePdf(payment);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${payment.invoice.number}.pdf"`);
    res.send(pdf);
  })
);

module.exports = router;
