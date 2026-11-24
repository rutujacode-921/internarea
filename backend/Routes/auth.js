const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const User = require("../Model/User");
const PasswordReset = require("../Model/PasswordReset");
const { requireAuth } = require("../middleware/auth");
const { sendError, asyncHandler } = require("../utils/errors");
const { getClientInfo } = require("../utils/clientInfo");
const { sendResetOtpEmail, sendNewPasswordEmail } = require("../utils/mailer");
const { sendSms } = require("../utils/sms");
const { hashOtp, generateOtpCode, safeEqual, maskEmail } = require("../utils/otp");
const { normalizeEmail, normalizePhone, maskPhone } = require("../utils/contact");
const {
  generateLetterPassword,
  hashPassword,
  checkPassword,
  passwordProblem,
  signSession,
} = require("../utils/passwords");
const LoginActivity = require("../Model/LoginActivity");
const { beginSignIn, recordAttempt, revokeSessions, publicUser } = require("../services/loginSecurity");
const { translate, getRequestLanguage } = require("../i18n/messages");
const { RESET_SETTINGS: R, LOGIN_SETTINGS } = require("../config/auth");

const HOUR = 60 * 60 * 1000;
const secondsUntil = (date) => Math.max(0, Math.ceil((new Date(date).getTime() - Date.now()) / 1000));

// "email" or "phone" depending on what was typed.
function parseIdentifier(value) {
  const email = normalizeEmail(value);
  if (email) return { field: "email", value: email };
  const phone = normalizePhone(value);
  if (phone) return { field: "phone", value: phone };
  return null;
}

// =============================================================================
// Sign up, log in, change password
// =============================================================================

// POST /api/auth/register - create an account with email and/or mobile number.
router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
    if (name.length < 2) return sendError(req, res, 400, "NAME_REQUIRED");

    const emailInput = typeof body.email === "string" ? body.email.trim() : "";
    const phoneInput = typeof body.phone === "string" ? body.phone.trim() : "";
    if (!emailInput && !phoneInput) return sendError(req, res, 400, "CONTACT_REQUIRED");
    const email = emailInput ? normalizeEmail(emailInput) : null;
    const phone = phoneInput ? normalizePhone(phoneInput) : null;
    if ((emailInput && !email) || (phoneInput && !phone)) return sendError(req, res, 400, "INVALID_IDENTIFIER");

    const problem = passwordProblem(body.password);
    if (problem) return sendError(req, res, 400, problem);

    if (email && (await User.exists({ email, authProvider: { $ne: "password" } }))) {
      return sendError(req, res, 409, "GOOGLE_ACCOUNT_EXISTS");
    }
    const taken = await User.exists({
      authProvider: "password",
      $or: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
    });
    if (taken) return sendError(req, res, 409, "ACCOUNT_EXISTS");

    let user;
    try {
      const id = new mongoose.Types.ObjectId();
      user = await User.create({
        uid: `local_${id}`,
        name,
        email,
        phone,
        authProvider: "password",
        passwordHash: await hashPassword(body.password),
        passwordChangedAt: new Date(),
      });
    } catch (error) {
      // Two sign-ups with the same email/phone at the same moment.
      if (error?.code === 11000) return sendError(req, res, 409, "ACCOUNT_EXISTS");
      throw error;
    }
    // The new account's first session follows the same rules as any login.
    return beginSignIn(req, res, { user, kind: "signup", client: body.client, requestId: body.requestId });
  })
);

// POST /api/auth/login - email or mobile number + password. The password is
// checked here; the login environment rules (Chrome OTP, mobile hours) are
// applied by beginSignIn.
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { identifier, password, client, requestId } = req.body || {};
    const parsed = parseIdentifier(identifier);
    if (!parsed || typeof password !== "string" || !password) {
      return sendError(req, res, 401, "INVALID_CREDENTIALS");
    }
    const user = await User.findOne({ authProvider: "password", [parsed.field]: parsed.value });
    if (!user) return sendError(req, res, 401, "INVALID_CREDENTIALS");
    const attempt = { uid: user.uid, provider: "password", requestId };

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil(secondsUntil(user.lockedUntil) / 60);
      await recordAttempt(req, { ...attempt, status: "account_locked" }, client);
      return sendError(req, res, 429, "LOGIN_LOCKED", { minutes }, { retryAfter: minutes * 60 });
    }

    if (!(await checkPassword(password, user.passwordHash))) {
      await recordAttempt(req, { ...attempt, status: "failed_password" }, client);
      // Lock the account for a while after repeated failures.
      const failed = await User.findOneAndUpdate({ _id: user._id }, { $inc: { failedLoginCount: 1 } }, { new: true });
      if (failed.failedLoginCount >= LOGIN_SETTINGS.maxFailedAttempts) {
        await User.updateOne(
          { _id: user._id },
          { $set: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOGIN_SETTINGS.lockMinutes * 60000) } }
        );
        return sendError(req, res, 429, "LOGIN_LOCKED", { minutes: LOGIN_SETTINGS.lockMinutes }, { retryAfter: LOGIN_SETTINGS.lockMinutes * 60 });
      }
      return sendError(req, res, 401, "INVALID_CREDENTIALS");
    }

    const fresh = await User.findOneAndUpdate({ _id: user._id }, { $set: { failedLoginCount: 0, lockedUntil: null } }, { new: true });
    return beginSignIn(req, res, { user: fresh, client, requestId });
  })
);

// GET /api/auth/me - the signed-in account (password or Google).
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ uid: req.authUser.uid });
    res.json({ user: publicUser(user) });
  })
);

// POST /api/auth/change-password - required right after logging in with a reset password.
router.post(
  "/change-password",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.authUser.provider !== "password") return sendError(req, res, 400, "NOT_PASSWORD_ACCOUNT");
    const { currentPassword, newPassword } = req.body || {};
    const user = await User.findOne({ uid: req.authUser.uid });
    if (typeof currentPassword !== "string" || !(await checkPassword(currentPassword, user.passwordHash))) {
      return sendError(req, res, 400, "WRONG_CURRENT_PASSWORD");
    }
    const problem = passwordProblem(newPassword);
    if (problem) return sendError(req, res, 400, problem);
    if (newPassword === currentPassword) return sendError(req, res, 400, "SAME_PASSWORD");

    // The version bump signs out every other session, e.g. someone who saw the old password.
    const updated = await User.findOneAndUpdate(
      { _id: user._id },
      {
        $set: { passwordHash: await hashPassword(newPassword), mustChangePassword: false, passwordChangedAt: new Date() },
        $inc: { passwordVersion: 1 },
      },
      { new: true }
    );
    await revokeSessions({ uid: user.uid, _id: { $ne: req.sessionId } }, "password_changed");
    const session = await LoginActivity.findById(req.sessionId).select("expiresAt");
    res.json({ token: signSession(updated, req.sessionId, session.expiresAt), user: publicUser(updated) });
  })
);

// GET /api/auth/reset-history - the signed-in user's password reset audit trail.
router.get(
  "/reset-history",
  requireAuth,
  asyncHandler(async (req, res) => {
    const entries = await PasswordReset.find({ uid: req.authUser.uid })
      .sort({ createdAt: -1 })
      .limit(100)
      .select("method destination status attempts resendCount verifiedAt completedAt ip browser os device createdAt sessionExpiresAt");
    res.json({ entries: entries.map((e) => ({ ...e.toObject(), status: effectiveStatus(e) })) });
  })
);

// =============================================================================
// Forgot Password
// =============================================================================

const OPEN_STATUSES = ["otp_sent", "verified", "delivery_failed"];

// A request that ran out of time is reported (and later saved) as expired.
const effectiveStatus = (reset) =>
  OPEN_STATUSES.includes(reset.status) && reset.sessionExpiresAt && reset.sessionExpiresAt <= new Date()
    ? "expired"
    : reset.status;

// The state the Forgot Password page needs. Never includes codes or passwords.
function resetState(reset) {
  const status = effectiveStatus(reset);
  return {
    requestId: reset._id,
    method: reset.method,
    destination: reset.destination,
    status,
    otpExpiresInSeconds: status === "otp_sent" && reset.otpExpiresAt ? secondsUntil(reset.otpExpiresAt) : 0,
    resendInSeconds: reset.lastSentAt ? secondsUntil(reset.lastSentAt.getTime() + R.resendCooldownSeconds * 1000) : 0,
    resendsLeft: Math.max(0, R.maxResends - reset.resendCount),
    attemptsLeft: Math.max(0, R.maxVerifyAttempts - reset.attempts),
    sessionExpiresInSeconds: reset.sessionExpiresAt ? secondsUntil(reset.sessionExpiresAt) : 0,
    canRetryDelivery: status === "delivery_failed" && reset.deliveryAttempts < R.maxDeliveryAttempts,
  };
}

async function addEvent(id, type, detail = "") {
  await PasswordReset.updateOne({ _id: id }, { $push: { events: { type, detail: String(detail).slice(0, 300), at: new Date() } } });
}

// Records a blocked request in the history (no code is issued).
async function recordBlocked(req, fields) {
  const { ip, browser, os, device, userAgent } = getClientInfo(req);
  try {
    await PasswordReset.create({ ...fields, ip, browser, os, device, userAgent, events: [{ type: fields.status }] });
  } catch (error) {
    console.error("Failed to record password reset attempt:", error);
  }
}

async function sendCode(user, method, code, uiLanguage) {
  if (method === "email") {
    await sendResetOtpEmail({ to: user.email, code, uiLanguage, minutes: R.otpTtlMinutes });
  } else {
    await sendSms(user.phone, translate(uiLanguage, "sms.resetOtp", { code, minutes: R.otpTtlMinutes }));
  }
}

async function loadReset(req, res) {
  const id = req.body?.requestId || req.params.id;
  if (!mongoose.isValidObjectId(id)) {
    sendError(req, res, 404, "RESET_NOT_FOUND");
    return null;
  }
  const reset = await PasswordReset.findOne({ _id: id, status: { $in: [...OPEN_STATUSES, "completed", "locked", "expired"] } });
  if (!reset) {
    sendError(req, res, 404, "RESET_NOT_FOUND");
    return null;
  }
  if (effectiveStatus(reset) === "expired" && reset.status !== "expired") {
    await PasswordReset.updateOne({ _id: reset._id, status: reset.status }, { $set: { status: "expired" } });
    await addEvent(reset._id, "expired");
    reset.status = "expired";
  }
  return reset;
}

// Generates a letters-only password, sends it through the verified channel,
// and only then saves its hash. If sending fails, nothing changes and the old
// password keeps working, so a delivery problem can never lock the user out.
async function deliverNewPassword(req, res, reset) {
  const uiLang = getRequestLanguage(req);
  const user = await User.findOne({ uid: reset.uid, authProvider: "password" });
  if (!user) return sendError(req, res, 404, "RESET_NOT_FOUND");

  const password = generateLetterPassword(R.generatedPasswordLength);
  const passwordHash = await hashPassword(password);
  await PasswordReset.updateOne({ _id: reset._id }, { $inc: { deliveryAttempts: 1 } });

  try {
    if (reset.method === "email") {
      await sendNewPasswordEmail({ to: user.email, password, uiLanguage: uiLang });
    } else {
      await sendSms(user.phone, translate(uiLang, "sms.newPassword", { password }));
    }
  } catch (error) {
    console.error("Failed to deliver new password:", error.message);
    await PasswordReset.updateOne({ _id: reset._id }, { $set: { status: "delivery_failed" } });
    await addEvent(reset._id, "delivery_failed", error.message);
    const fresh = await PasswordReset.findById(reset._id);
    return sendError(req, res, 502, "NEW_PASSWORD_DELIVERY_FAILED", {}, { reset: resetState(fresh) });
  }

  // Save the new password (encrypted), force a change at next login, and sign
  // out every existing session.
  await User.updateOne(
    { _id: user._id },
    {
      $set: { passwordHash, mustChangePassword: true, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
      $inc: { passwordVersion: 1 },
    }
  );
  await revokeSessions({ uid: user.uid }, "password_reset");
  const done = await PasswordReset.findOneAndUpdate(
    { _id: reset._id },
    { $set: { status: "completed", completedAt: new Date() }, $push: { events: { type: "completed", at: new Date() } } },
    { new: true }
  );
  res.json({ reset: resetState(done) });
}

// POST /api/auth/forgot/request - start a reset by email or mobile number.
router.post(
  "/forgot/request",
  asyncHandler(async (req, res) => {
    const { method, identifier } = req.body || {};
    if (method !== "email" && method !== "phone") return sendError(req, res, 400, "INVALID_IDENTIFIER");
    const value = method === "email" ? normalizeEmail(identifier) : normalizePhone(identifier);
    if (!value) return sendError(req, res, 400, "INVALID_IDENTIFIER");
    const destination = method === "email" ? maskEmail(value) : maskPhone(value);
    const client = getClientInfo(req);

    // Limit requests per network, so accounts can't be probed in bulk.
    const fromIp = await PasswordReset.countDocuments({ ip: client.ip, createdAt: { $gte: new Date(Date.now() - HOUR) } });
    if (fromIp >= R.maxRequestsPerIpPerHour) {
      await recordBlocked(req, { method, destination, status: "rate_limited" });
      return sendError(req, res, 429, "RESET_RATE_LIMITED");
    }

    const user = await User.findOne({ authProvider: "password", [method]: value });
    if (!user) {
      if (method === "email" && (await User.exists({ email: value, authProvider: { $ne: "password" } }))) {
        await recordBlocked(req, { method, destination, status: "google_account" });
        return sendError(req, res, 400, "GOOGLE_ACCOUNT");
      }
      await recordBlocked(req, { method, destination, status: "invalid_user" });
      return sendError(req, res, 404, "ACCOUNT_NOT_FOUND");
    }

    // Once per 24 hours. Claimed atomically, so simultaneous requests (two tabs,
    // double clicks) can't both get through.
    const now = new Date();
    const windowMs = R.dailyWindowHours * HOUR;
    const previous = await User.findOneAndUpdate(
      { _id: user._id, $or: [{ lastResetRequestAt: null }, { lastResetRequestAt: { $lte: new Date(now - windowMs) } }] },
      { $set: { lastResetRequestAt: now } },
      { new: false }
    );
    if (!previous) {
      const fresh = await User.findById(user._id).select("lastResetRequestAt");
      const availableAt = new Date(fresh.lastResetRequestAt.getTime() + windowMs);
      await recordBlocked(req, { uid: user.uid, method, destination, status: "blocked_daily_limit" });
      return sendError(req, res, 429, "DAILY_LIMIT", {}, { availableAt, retryAfter: secondsUntil(availableAt) });
    }

    const id = new mongoose.Types.ObjectId();
    const code = generateOtpCode();
    const reset = await PasswordReset.create({
      _id: id,
      uid: user.uid,
      method,
      destination,
      status: "otp_sent",
      codeHash: hashOtp(`${id}.0`, code),
      otpExpiresAt: new Date(now.getTime() + R.otpTtlMinutes * 60000),
      lastSentAt: now,
      sessionExpiresAt: new Date(now.getTime() + R.sessionMinutes * 60000),
      ...client,
      events: [{ type: "otp_sent" }],
    });

    try {
      await sendCode(user, method, code, getRequestLanguage(req));
    } catch (error) {
      console.error("Failed to send reset code:", error.message);
      // The code never reached the user, so this attempt doesn't use up the day.
      await PasswordReset.updateOne({ _id: id }, { $set: { status: "send_failed", codeHash: null } });
      await addEvent(id, "send_failed", error.message);
      await User.updateOne({ _id: user._id, lastResetRequestAt: now }, { $set: { lastResetRequestAt: previous.lastResetRequestAt } });
      return sendError(req, res, 502, method === "email" ? "EMAIL_FAILED" : "SMS_FAILED");
    }

    res.status(201).json({ reset: resetState(reset) });
  })
);

// GET /api/auth/forgot/:id - current state, so the page can resume after a reload or lost connection.
router.get(
  "/forgot/:id",
  asyncHandler(async (req, res) => {
    const reset = await loadReset(req, res);
    if (reset) res.json({ reset: resetState(reset) });
  })
);

// POST /api/auth/forgot/resend - a new code (the previous one stops working).
router.post(
  "/forgot/resend",
  asyncHandler(async (req, res) => {
    const reset = await loadReset(req, res);
    if (!reset) return;
    const state = resetState(reset);
    if (state.status === "expired") return sendError(req, res, 410, "RESET_EXPIRED", {}, { reset: state });
    if (state.status === "locked") return sendError(req, res, 429, "OTP_LOCKED", {}, { reset: state });
    if (state.status !== "otp_sent") return sendError(req, res, 409, "RESET_ALREADY_COMPLETED", {}, { reset: state });
    if (reset.resendCount >= R.maxResends) return sendError(req, res, 429, "RESEND_LIMIT", {}, { reset: state });
    if (state.resendInSeconds > 0) {
      return sendError(req, res, 429, "OTP_COOLDOWN", { seconds: state.resendInSeconds }, { retryAfter: state.resendInSeconds, reset: state });
    }

    const code = generateOtpCode();
    const now = new Date();
    const updated = await PasswordReset.findOneAndUpdate(
      { _id: reset._id, status: "otp_sent", resendCount: reset.resendCount },
      {
        $set: {
          codeHash: hashOtp(`${reset._id}.${reset.resendCount + 1}`, code),
          otpExpiresAt: new Date(now.getTime() + R.otpTtlMinutes * 60000),
          lastSentAt: now,
        },
        $inc: { resendCount: 1 },
        $push: { events: { type: "otp_resent", at: now } },
      },
      { new: true }
    );
    // Another resend won the race.
    if (!updated) return sendError(req, res, 429, "OTP_COOLDOWN", { seconds: R.resendCooldownSeconds }, { retryAfter: R.resendCooldownSeconds });

    const user = await User.findOne({ uid: reset.uid });
    try {
      await sendCode(user, reset.method, code, getRequestLanguage(req));
    } catch (error) {
      await addEvent(reset._id, "send_failed", error.message);
      return sendError(req, res, 502, reset.method === "email" ? "EMAIL_FAILED" : "SMS_FAILED", {}, { reset: resetState(updated) });
    }
    res.json({ reset: resetState(updated) });
  })
);

// POST /api/auth/forgot/verify - check the code; on success a new password is sent.
router.post(
  "/forgot/verify",
  asyncHandler(async (req, res) => {
    const { code } = req.body || {};
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) return sendError(req, res, 400, "OTP_INVALID_FORMAT");
    const reset = await loadReset(req, res);
    if (!reset) return;
    const state = resetState(reset);

    if (state.status === "expired") return sendError(req, res, 410, "RESET_EXPIRED", {}, { reset: state });
    if (state.status === "completed") return sendError(req, res, 409, "RESET_ALREADY_COMPLETED", {}, { reset: state });
    // Already verified (e.g. the response was lost): report the state; the page offers a retry if delivery failed.
    if (state.status === "verified" || state.status === "delivery_failed") return res.json({ reset: state });
    if (state.status === "locked") return sendError(req, res, 429, "OTP_LOCKED", {}, { reset: state });
    if (reset.otpExpiresAt <= new Date()) return sendError(req, res, 410, "OTP_EXPIRED", {}, { reset: state });

    const expected = reset.codeHash;
    if (!expected || !safeEqual(hashOtp(`${reset._id}.${reset.resendCount}`, code), expected)) {
      const failed = await PasswordReset.findOneAndUpdate(
        { _id: reset._id, status: "otp_sent", attempts: { $lt: R.maxVerifyAttempts } },
        { $inc: { attempts: 1 }, $push: { events: { type: "otp_failed", at: new Date() } } },
        { new: true }
      );
      if (!failed || failed.attempts >= R.maxVerifyAttempts) {
        await PasswordReset.updateOne({ _id: reset._id, status: "otp_sent" }, { $set: { status: "locked", codeHash: null } });
        await addEvent(reset._id, "locked");
        const locked = await PasswordReset.findById(reset._id);
        return sendError(req, res, 429, "OTP_LOCKED", {}, { reset: resetState(locked) });
      }
      const attemptsLeft = R.maxVerifyAttempts - failed.attempts;
      return sendError(req, res, 400, "OTP_INVALID", { attemptsLeft }, { attemptsLeft, reset: resetState(failed) });
    }

    // Accept the code exactly once, even if two requests arrive together.
    const verified = await PasswordReset.findOneAndUpdate(
      { _id: reset._id, status: "otp_sent", codeHash: expected, otpExpiresAt: { $gt: new Date() } },
      { $set: { status: "verified", verifiedAt: new Date(), codeHash: null }, $push: { events: { type: "verified", at: new Date() } } },
      { new: true }
    );
    if (!verified) return sendError(req, res, 409, "OTP_USED");
    return deliverNewPassword(req, res, verified);
  })
);

// POST /api/auth/forgot/deliver - retry sending the new password after a delivery failure.
router.post(
  "/forgot/deliver",
  asyncHandler(async (req, res) => {
    const reset = await loadReset(req, res);
    if (!reset) return;
    const state = resetState(reset);
    if (state.status === "completed") return sendError(req, res, 409, "RESET_ALREADY_COMPLETED", {}, { reset: state });
    if (state.status === "expired") return sendError(req, res, 410, "RESET_EXPIRED", {}, { reset: state });
    if (!state.canRetryDelivery) return sendError(req, res, 409, "RESET_NOT_FOUND", {}, { reset: state });
    // Claim the retry so two clicks can't send two different passwords.
    const claimed = await PasswordReset.findOneAndUpdate(
      { _id: reset._id, status: "delivery_failed", deliveryAttempts: reset.deliveryAttempts },
      { $set: { status: "verified" } },
      { new: true }
    );
    if (!claimed) return res.json({ reset: resetState(await PasswordReset.findById(reset._id)) });
    return deliverNewPassword(req, res, claimed);
  })
);

module.exports = router;
