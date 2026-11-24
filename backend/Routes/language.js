const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const User = require("../Model/User");
const LanguageOtp = require("../Model/LanguageOtp");
const LanguageChangeLog = require("../Model/LanguageChangeLog");
const { requireAuth } = require("../middleware/auth");
const { sendError } = require("../utils/errors");
const { getClientInfo } = require("../utils/clientInfo");
const { sendLanguageOtpEmail } = require("../utils/mailer");
const { hashOtp, generateOtpCode, safeEqual, maskEmail } = require("../utils/otp");
const { getRequestLanguage, languageName } = require("../i18n/messages");
const {
  OTP_SETTINGS,
  isSupportedLanguage,
  requiresOtp,
} = require("../config/languages");

const asyncHandler = (fn) => (req, res, next) =>
  fn(req, res, next).catch((error) => {
    console.error("Language API error:", error);
    sendError(req, res, 500, "SERVER_ERROR");
  });

async function getOrCreateUser(authUser) {
  return User.findOneAndUpdate(
    { uid: authUser.uid },
    {
      $set: { email: authUser.email, name: authUser.name },
      $setOnInsert: { uid: authUser.uid },
    },
    { upsert: true, new: true }
  );
}

async function logEvent(req, entry) {
  try {
    await LanguageChangeLog.create({
      uid: req.authUser.uid,
      email: req.authUser.email,
      ...getClientInfo(req),
      ...entry,
    });
  } catch (error) {
    // Auditing must never break the user's request.
    console.error("Failed to write language audit log:", error);
  }
}

router.use(requireAuth);

// GET /api/language/preference - the saved language for the signed-in user.
router.get(
  "/preference",
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ uid: req.authUser.uid });
    res.json({
      language: user?.language || null,
      updatedAt: user?.languageUpdatedAt || null,
    });
  })
);

// PUT /api/language/preference - change to a language that needs no OTP.
router.put(
  "/preference",
  asyncHandler(async (req, res) => {
    const { language } = req.body || {};
    const method = ["direct", "sync", "initial"].includes(req.body?.method)
      ? req.body.method
      : "direct";
    const uiLang = getRequestLanguage(req);

    if (!isSupportedLanguage(language)) {
      return sendError(req, res, 400, "UNSUPPORTED_LANGUAGE");
    }

    const user = await getOrCreateUser(req.authUser);

    // "initial" only seeds a preference for users who have never saved one.
    if (method === "initial" && user.language) {
      return res.json({ language: user.language, changed: false, updatedAt: user.languageUpdatedAt });
    }
    if (user.language === language) {
      return res.json({ language, changed: false, updatedAt: user.languageUpdatedAt });
    }

    if (requiresOtp(language)) {
      await logEvent(req, {
        previousLanguage: user.language,
        language,
        status: "blocked",
        method,
        reason: "otp_required",
      });
      return sendError(req, res, 403, "OTP_REQUIRED", {
        language: languageName(uiLang, language),
      });
    }

    const previousLanguage = user.language;
    user.language = language;
    user.languageUpdatedAt = new Date();
    await user.save();

    await logEvent(req, { previousLanguage, language, status: "changed", method });
    res.json({ language, changed: true, updatedAt: user.languageUpdatedAt });
  })
);

// POST /api/language/otp - email a code for a protected language (French).
router.post(
  "/otp",
  asyncHandler(async (req, res) => {
    const { language } = req.body || {};
    const uiLang = getRequestLanguage(req);

    if (!isSupportedLanguage(language)) {
      return sendError(req, res, 400, "UNSUPPORTED_LANGUAGE");
    }
    if (!requiresOtp(language)) {
      return sendError(req, res, 400, "OTP_NOT_REQUIRED", {
        language: languageName(uiLang, language),
      });
    }
    if (!req.authUser.email) {
      return sendError(req, res, 400, "NO_EMAIL");
    }

    const user = await getOrCreateUser(req.authUser);
    if (user.language === language) {
      return res.json({ alreadyActive: true, language });
    }

    const now = Date.now();
    const latest = await LanguageOtp.findOne({ uid: user.uid }).sort({ createdAt: -1 });
    const cooldownMs = OTP_SETTINGS.resendCooldownSeconds * 1000;
    if (latest && now - latest.createdAt.getTime() < cooldownMs) {
      const seconds = Math.ceil((cooldownMs - (now - latest.createdAt.getTime())) / 1000);
      return sendError(req, res, 429, "OTP_COOLDOWN", { seconds }, { retryAfter: seconds });
    }

    const hourAgo = new Date(now - 60 * 60 * 1000);
    const recent = await LanguageOtp.find({ uid: user.uid, createdAt: { $gte: hourAgo } })
      .sort({ createdAt: 1 })
      .select("createdAt");
    if (recent.length >= OTP_SETTINGS.maxRequestsPerHour) {
      const retryAfter = Math.ceil(
        (recent[0].createdAt.getTime() + 60 * 60 * 1000 - now) / 1000
      );
      await logEvent(req, {
        previousLanguage: user.language,
        language,
        status: "blocked",
        method: "otp",
        reason: "otp_rate_limited",
      });
      return sendError(
        req,
        res,
        429,
        "OTP_RATE_LIMITED",
        { minutes: Math.ceil(retryAfter / 60) },
        { retryAfter }
      );
    }

    // Only the newest code may be used.
    await LanguageOtp.updateMany(
      { uid: user.uid, consumedAt: null, invalidatedAt: null },
      { $set: { invalidatedAt: new Date(now) } }
    );

    const otpId = new mongoose.Types.ObjectId();
    const code = generateOtpCode();
    const expiresAt = new Date(now + OTP_SETTINGS.ttlMinutes * 60 * 1000);
    const clientInfo = getClientInfo(req);

    const otp = await LanguageOtp.create({
      _id: otpId,
      uid: user.uid,
      email: req.authUser.email,
      targetLanguage: language,
      codeHash: hashOtp(otpId.toString(), code),
      expiresAt,
      ip: clientInfo.ip,
      userAgent: clientInfo.userAgent,
    });

    try {
      await sendLanguageOtpEmail({
        to: req.authUser.email,
        code,
        targetLanguage: language,
        uiLanguage: uiLang,
        minutes: OTP_SETTINGS.ttlMinutes,
      });
    } catch (error) {
      console.error("Failed to send OTP email:", error);
      await otp.deleteOne();
      return sendError(req, res, 502, "EMAIL_FAILED");
    }

    await logEvent(req, {
      previousLanguage: user.language,
      language,
      status: "otp_requested",
      method: "otp",
    });

    res.status(201).json({
      otpId: otpId.toString(),
      expiresAt,
      resendAvailableAt: new Date(now + cooldownMs),
      // Relative values let the client count down without trusting its clock.
      expiresInSeconds: OTP_SETTINGS.ttlMinutes * 60,
      resendInSeconds: OTP_SETTINGS.resendCooldownSeconds,
      maskedEmail: maskEmail(req.authUser.email),
      maxAttempts: OTP_SETTINGS.maxVerifyAttempts,
    });
  })
);

// POST /api/language/otp/verify - check the code and apply the language.
router.post(
  "/otp/verify",
  asyncHandler(async (req, res) => {
    const { otpId, code } = req.body || {};
    const max = OTP_SETTINGS.maxVerifyAttempts;

    if (!mongoose.isValidObjectId(otpId) || typeof code !== "string" || !/^\d{6}$/.test(code)) {
      return sendError(req, res, 400, "OTP_INVALID_FORMAT");
    }

    const otp = await LanguageOtp.findOne({ _id: otpId, uid: req.authUser.uid });
    if (!otp || otp.invalidatedAt) return sendError(req, res, 410, "OTP_NOT_FOUND");
    if (otp.consumedAt) return sendError(req, res, 410, "OTP_USED");
    if (otp.expiresAt.getTime() <= Date.now()) return sendError(req, res, 410, "OTP_EXPIRED");
    if (otp.attempts >= max) return sendError(req, res, 429, "OTP_LOCKED");

    const user = await getOrCreateUser(req.authUser);

    if (!safeEqual(hashOtp(otpId, code), otp.codeHash)) {
      const updated = await LanguageOtp.findOneAndUpdate(
        { _id: otpId, attempts: { $lt: max } },
        { $inc: { attempts: 1 } },
        { new: true }
      );
      const attemptsLeft = updated ? Math.max(max - updated.attempts, 0) : 0;
      await logEvent(req, {
        previousLanguage: user.language,
        language: otp.targetLanguage,
        status: "otp_failed",
        method: "otp",
        reason: attemptsLeft === 0 ? "otp_locked" : "otp_invalid",
      });
      if (attemptsLeft === 0) return sendError(req, res, 429, "OTP_LOCKED");
      return sendError(req, res, 400, "OTP_INVALID", { attemptsLeft }, { attemptsLeft });
    }

    // Consume atomically so a code can never be used twice, even by parallel requests.
    const consumed = await LanguageOtp.findOneAndUpdate(
      {
        _id: otpId,
        consumedAt: null,
        invalidatedAt: null,
        expiresAt: { $gt: new Date() },
        attempts: { $lt: max },
      },
      { $set: { consumedAt: new Date() } },
      { new: true }
    );
    if (!consumed) return sendError(req, res, 410, "OTP_USED");

    const previousLanguage = user.language;
    user.language = otp.targetLanguage;
    user.languageUpdatedAt = new Date();
    await user.save();

    await logEvent(req, {
      previousLanguage,
      language: otp.targetLanguage,
      status: "changed",
      method: "otp",
    });

    res.json({ language: user.language, changed: true, updatedAt: user.languageUpdatedAt });
  })
);

// GET /api/language/history - the signed-in user's audit trail.
router.get(
  "/history",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const entries = await LanguageChangeLog.find({ uid: req.authUser.uid })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("-uid -email -userAgent -__v")
      .lean();
    res.json({ entries });
  })
);

module.exports = router;
