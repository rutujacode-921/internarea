const crypto = require("crypto");
const mongoose = require("mongoose");

const User = require("../Model/User");
const LoginActivity = require("../Model/LoginActivity");
const TrustedDevice = require("../Model/TrustedDevice");
const { LOGIN_SECURITY: S } = require("../config/loginSecurity");
const { getDeviceInfo, isChrome, isMobile } = require("../utils/deviceInfo");
const { lookupLocation } = require("../utils/geoip");
const { hashOtp, generateOtpCode, safeEqual, maskEmail } = require("../utils/otp");
const { maskPhone } = require("../utils/contact");
const { sendLoginOtpEmail, sendNewSignInAlertEmail } = require("../utils/mailer");
const { sendSms } = require("../utils/sms");
const { signSession, sessionLifetimeMs } = require("../utils/passwords");
const { sendError } = require("../utils/errors");
const { translate, getRequestLanguage } = require("../i18n/messages");

const secondsUntil = (date) => Math.max(0, Math.ceil((new Date(date).getTime() - Date.now()) / 1000));
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

// =============================================================================
// Mobile access window
// =============================================================================

// Minutes after midnight in the configured time zone (IST by default).
function minutesInZone(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: S.mobileTimeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  return get("hour") * 60 + get("minute");
}

const mobileWindowOpen = (date = new Date()) => {
  const now = minutesInZone(date);
  return now >= S.mobileWindowStart && now < S.mobileWindowEnd;
};

const formatClock = (minutes) => {
  const h = Math.floor(minutes / 60) % 24;
  const m = String(minutes % 60).padStart(2, "0");
  return `${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}`;
};

const mobileWindowLabel = () => ({
  start: formatClock(S.mobileWindowStart),
  end: formatClock(S.mobileWindowEnd),
  zone: S.mobileTimeZone === "Asia/Kolkata" ? "IST" : S.mobileTimeZone,
});

// =============================================================================
// Shared helpers
// =============================================================================

const publicUser = (user) => ({
  uid: user.uid,
  name: user.name || null,
  email: user.email || null,
  phone: user.phone || null,
  photo: user.photo || null,
  provider: user.authProvider === "password" ? "password" : "google",
  mustChangePassword: Boolean(user.mustChangePassword),
  passwordChangedAt: user.passwordChangedAt || null,
});

const deviceKeyFor = (info) => (info.deviceId ? `${info.deviceId}:${info.browserName}` : null);
const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");
const describeDevice = (a) =>
  [`${a.browserName || ""} ${a.browserVersion ? a.browserVersion.split(".")[0] : ""}`.trim(), a.osName, a.deviceModel || a.deviceType]
    .filter(Boolean)
    .join(" · ");

async function addEvent(id, type, detail = "", ip = undefined) {
  await LoginActivity.updateOne({ _id: id }, { $push: { events: { type, detail: String(detail).slice(0, 300), ip, at: new Date() } } });
}

// A pending verification that ran out of time is reported (and saved) as expired.
const effectiveStatus = (a) =>
  a.status === "otp_pending" && a.challengeExpiresAt && a.challengeExpiresAt <= new Date() ? "otp_expired" : a.status;

const sessionIsActive = (a) => a.status === "success" && !a.revokedAt && a.expiresAt && a.expiresAt > new Date();

// What the verification screen needs. Never includes the code.
function challengeState(a) {
  const status = effectiveStatus(a);
  return {
    challengeId: a._id,
    status,
    channel: a.otpChannel,
    destination: a.otpDestination,
    otpExpiresInSeconds: status === "otp_pending" && a.otpExpiresAt ? secondsUntil(a.otpExpiresAt) : 0,
    challengeExpiresInSeconds: status === "otp_pending" && a.challengeExpiresAt ? secondsUntil(a.challengeExpiresAt) : 0,
    resendInSeconds: a.lastSentAt ? secondsUntil(a.lastSentAt.getTime() + S.resendCooldownSeconds * 1000) : 0,
    resendsLeft: Math.max(0, S.maxResends - a.resendCount),
    attemptsLeft: Math.max(0, S.maxVerifyAttempts - a.attempts),
    browser: a.browserName,
  };
}

// Fills in the approximate location after the response has been sent, so a slow
// lookup never delays signing in. Also flags a sign-in from a new country and,
// for a device that wasn't trusted before, emails the owner about it.
function enrichInBackground(activityId, user, uiLanguage, { alert }) {
  (async () => {
    const activity = await LoginActivity.findById(activityId);
    if (!activity) return;
    const loc = await lookupLocation(activity.ip);
    let isNewCountry = false;
    if (loc) {
      if (loc.countryCode && activity.uid) {
        const seen = await LoginActivity.exists({
          uid: activity.uid,
          _id: { $ne: activity._id },
          status: "success",
          "location.countryCode": loc.countryCode,
        });
        const hadAny = await LoginActivity.exists({ uid: activity.uid, _id: { $ne: activity._id }, status: "success", "location.lookedUp": true });
        isNewCountry = Boolean(hadAny && !seen);
      }
      await LoginActivity.updateOne(
        { _id: activity._id },
        {
          $set: {
            publicIp: loc.publicIp || activity.ip,
            location: { ...loc, publicIp: undefined, lookedUp: true },
            isNewCountry,
          },
        }
      );
      if (activity.deviceId && loc.countryCode) {
        await TrustedDevice.updateOne({ uid: activity.uid, deviceKey: `${activity.deviceId}:${activity.browserName}` }, { $set: { lastCountry: loc.countryCode } });
      }
    }
    if (alert && user.email) {
      const where = [describeDevice(activity), loc && [loc.city, loc.country].filter(Boolean).join(", ")].filter(Boolean).join(" — ");
      const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(activity.createdAt) + " IST";
      await sendNewSignInAlertEmail({ to: user.email, uiLanguage, where, when, ip: (loc && loc.publicIp) || activity.ip });
    }
  })().catch((error) => console.error("Login enrichment failed:", error.message));
}

// =============================================================================
// Starting a sign-in (after the password or Google account has been verified)
// =============================================================================

// Records an attempt that never got a session (wrong password, blocked, ...).
async function recordAttempt(req, fields, client) {
  const info = getDeviceInfo(req, client);
  // Only sign-ins carry the request id (it is unique per account).
  const { requestId, ...rest } = fields;
  try {
    const activity = await LoginActivity.create({ ...info, ...rest, events: [{ type: fields.status, ip: info.ip }] });
    enrichInBackground(activity._id, {}, null, { alert: false });
  } catch (error) {
    console.error("Failed to record login attempt:", error.message);
  }
}

// Keeps at most maxActiveSessions; the least recently used ones are signed out.
async function pruneSessions(uid, keepId) {
  const active = await LoginActivity.find({ uid, status: "success", revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ lastSeenAt: -1, createdAt: -1 })
    .select("_id");
  const extra = active.filter((a) => String(a._id) !== String(keepId)).slice(S.maxActiveSessions - 1);
  if (extra.length) {
    await LoginActivity.updateMany(
      { _id: { $in: extra.map((a) => a._id) }, revokedAt: null },
      { $set: { revokedAt: new Date(), revokeReason: "session_limit" }, $push: { events: { type: "revoked", detail: "session_limit" } } }
    );
  }
}

// Turns an attempt into a signed-in session and trusts its device.
async function openSession(activity, user) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionLifetimeMs());
  const session = await LoginActivity.findOneAndUpdate(
    { _id: activity._id, status: { $in: ["otp_pending", "success"] } },
    {
      $set: {
        status: "success",
        expiresAt,
        lastSeenAt: now,
        lastIp: activity.ip,
        codeHash: null,
        trustedDevice: true,
      },
      $push: { events: { type: "session_started", ip: activity.ip, at: now } },
    },
    { new: true }
  );
  const key = deviceKeyFor(activity);
  if (key) {
    await TrustedDevice.updateOne(
      { uid: user.uid, deviceKey: key },
      {
        $set: {
          browserName: activity.browserName,
          osName: activity.osName,
          deviceType: activity.deviceType,
          deviceModel: activity.deviceModel,
          lastIp: activity.ip,
          lastUsedAt: now,
        },
        $setOnInsert: { trustedAt: now },
      },
      { upsert: true }
    );
  }
  await pruneSessions(user.uid, session._id);
  return session;
}

async function sendLoginCode(user, channel, code, uiLanguage, where) {
  if (channel === "email") {
    await sendLoginOtpEmail({ to: user.email, code, uiLanguage, minutes: S.otpTtlMinutes, where });
  } else {
    await sendSms(user.phone, translate(uiLanguage, "loginSms.otp", { code, minutes: S.otpTtlMinutes }));
  }
}

// Replies to the browser with either a session or an OTP step.
function replyWithSession(res, user, session, status = 200) {
  return res.status(status).json({
    status: "success",
    token: signSession(user, session._id, session.expiresAt),
    user: publicUser(user),
    session: { id: session._id, isNewDevice: session.isNewDevice, isNewIp: session.isNewIp },
  });
}

async function replyWithChallenge(res, activity) {
  // A fresh random token proves the OTP step belongs to this browser. Only its
  // hash is stored; issuing a new one (e.g. for a retried request) retires the old one.
  const challengeToken = crypto.randomBytes(32).toString("hex");
  const updated = await LoginActivity.findOneAndUpdate(
    { _id: activity._id },
    { $set: { challengeTokenHash: hashToken(challengeToken) } },
    { new: true }
  );
  return res.json({ status: "otp_required", challenge: challengeState(updated), challengeToken });
}

/**
 * Applies the environment-based rules and finishes a sign-in whose credentials
 * (password or Google account) have already been checked.
 *   - mobile devices: only inside the allowed window (10:00 AM - 1:00 PM IST)
 *   - Google Chrome: an OTP sent to the registered email must be entered first
 *   - everything else: signed in straight away
 */
async function beginSignIn(req, res, { user, kind = "login", client = {}, requestId }) {
  const uiLanguage = user.language || getRequestLanguage(req);
  const info = getDeviceInfo(req, client);
  const reqId = typeof requestId === "string" && REQUEST_ID.test(requestId) ? requestId : null;
  const now = new Date();

  // ---- Duplicate request (double click, retry after a lost response) ----
  // Gives the earlier request's result again. Returns false when there is
  // nothing to repeat (e.g. that attempt expired), so a new one starts.
  const repeatPrevious = (previous) => {
    if (!previous || previous.deviceId !== info.deviceId) return false;
    if (previous.createdAt < new Date(now - S.duplicateWindowSeconds * 1000)) return false;
    // A session that needed an OTP is never handed out again on a password alone.
    if (sessionIsActive(previous) && !previous.otpRequired) return replyWithSession(res, user, previous);
    if (effectiveStatus(previous) === "otp_pending") return replyWithChallenge(res, previous);
    if (previous.status === "blocked_mobile_hours") {
      return sendError(req, res, 403, "MOBILE_LOGIN_HOURS", mobileWindowLabel(), { window: mobileWindowLabel() });
    }
    return false;
  };
  let saveRequestId = reqId;
  if (reqId) {
    const previous = await LoginActivity.findOne({ uid: user.uid, requestId: reqId });
    const repeated = repeatPrevious(previous);
    if (repeated) return repeated;
    if (previous) saveRequestId = null; // the request id is already taken by a finished attempt
  }

  // Request ids are unique per account (database index), so if two copies of
  // the same request arrive at the same moment, only one creates a record (and
  // sends a code); the other gets the winner's result.
  const createOnce = async (doc) => {
    try {
      return { activity: await LoginActivity.create(doc) };
    } catch (error) {
      if (error?.code !== 11000 || !doc.requestId) throw error;
      const winner = await LoginActivity.findOne({ uid: user.uid, requestId: doc.requestId });
      return { repeated: repeatPrevious(winner) || sendError(req, res, 409, "LOGIN_CHALLENGE_USED") };
    }
  };

  // ---- Paused after repeated failed verifications ----
  if (user.lockedUntil && user.lockedUntil > now) {
    const minutes = Math.ceil(secondsUntil(user.lockedUntil) / 60);
    await recordAttempt(req, { uid: user.uid, provider: publicUser(user).provider, kind, status: "account_locked" }, client);
    return sendError(req, res, 429, "LOGIN_LOCKED", { minutes }, { retryAfter: minutes * 60 });
  }

  const base = {
    uid: user.uid,
    provider: publicUser(user).provider,
    kind,
    requestId: saveRequestId,
    ...info,
  };

  // ---- Mobile time window ----
  if (isMobile(info) && !mobileWindowOpen(now)) {
    const { activity, repeated } = await createOnce({ ...base, status: "blocked_mobile_hours", events: [{ type: "blocked_mobile_hours", ip: info.ip }] });
    if (repeated) return repeated;
    enrichInBackground(activity._id, user, uiLanguage, { alert: false });
    return sendError(req, res, 403, "MOBILE_LOGIN_HOURS", mobileWindowLabel(), { window: mobileWindowLabel() });
  }

  // ---- What's new about this environment ----
  const previousOk = { uid: user.uid, status: "success" };
  const key = deviceKeyFor(info);
  const [seenDevice, seenBrowser, seenIp, trusted] = await Promise.all([
    info.deviceId ? LoginActivity.exists({ ...previousOk, deviceId: info.deviceId }) : null,
    LoginActivity.exists({ ...previousOk, browserName: info.browserName }),
    LoginActivity.exists({ ...previousOk, $or: [{ ip: info.ip }, { lastIp: info.ip }] }),
    key ? TrustedDevice.exists({ uid: user.uid, deviceKey: key }) : null,
  ]);
  Object.assign(base, {
    isNewDevice: !seenDevice,
    isNewBrowser: !seenBrowser,
    isNewIp: !seenIp,
    trustedDevice: Boolean(trusted),
  });
  const alert = !trusted && kind === "login";

  // ---- Google Chrome: email OTP first ----
  if (isChrome(info)) {
    const channel = user.email ? "email" : user.phone ? "sms" : null;
    if (!channel) return sendError(req, res, 400, "LOGIN_OTP_NO_CONTACT");

    // The same browser already has an open verification (another tab, or the
    // user went back and logged in again): continue it instead of sending
    // another code. "Resend" is there if the first code went missing.
    if (info.deviceId) {
      const open = await LoginActivity.findOne({
        uid: user.uid,
        deviceId: info.deviceId,
        status: "otp_pending",
        challengeExpiresAt: { $gt: now },
      }).sort({ createdAt: -1 });
      if (open && open.attempts < S.maxVerifyAttempts) {
        await addEvent(open._id, "otp_step_resumed", "", info.ip);
        return replyWithChallenge(res, open);
      }
    }

    const id = new mongoose.Types.ObjectId();
    const code = generateOtpCode();
    const { activity, repeated } = await createOnce({
      _id: id,
      ...base,
      status: "otp_pending",
      otpRequired: true,
      otpChannel: channel,
      otpDestination: channel === "email" ? maskEmail(user.email) : maskPhone(user.phone),
      codeHash: hashOtp(`login.${id}.0`, code),
      otpExpiresAt: new Date(now.getTime() + S.otpTtlMinutes * 60000),
      challengeExpiresAt: new Date(now.getTime() + S.challengeMinutes * 60000),
      lastSentAt: now,
      events: [{ type: "otp_sent", detail: channel, ip: info.ip }],
    });
    if (repeated) return repeated;
    try {
      await sendLoginCode(user, channel, code, uiLanguage, describeDevice(activity));
    } catch (error) {
      console.error("Failed to send login code:", error.message);
      await LoginActivity.updateOne({ _id: id }, { $set: { status: "otp_send_failed", codeHash: null } });
      await addEvent(id, "otp_send_failed", error.message);
      return sendError(req, res, 502, channel === "email" ? "EMAIL_FAILED" : "SMS_FAILED");
    }
    enrichInBackground(id, user, uiLanguage, { alert: false });
    return replyWithChallenge(res, activity);
  }

  // ---- Everything else: signed in now ----
  const { activity, repeated } = await createOnce({ ...base, status: "success", events: [{ type: "credentials_ok", ip: info.ip }] });
  if (repeated) return repeated;
  const session = await openSession(activity, user);
  enrichInBackground(session._id, user, uiLanguage, { alert });
  return replyWithSession(res, user, session, kind === "signup" ? 201 : 200);
}

// =============================================================================
// The OTP step
// =============================================================================

// Finds the challenge and checks it belongs to this browser.
async function loadChallenge(req, res) {
  const { challengeId, challengeToken } = req.body || {};
  if (!mongoose.isValidObjectId(challengeId) || typeof challengeToken !== "string" || !challengeToken) {
    sendError(req, res, 404, "LOGIN_CHALLENGE_NOT_FOUND");
    return null;
  }
  const activity = await LoginActivity.findById(challengeId);
  if (!activity || !activity.challengeTokenHash || !safeEqual(hashToken(challengeToken), activity.challengeTokenHash)) {
    sendError(req, res, 404, "LOGIN_CHALLENGE_NOT_FOUND");
    return null;
  }
  if (effectiveStatus(activity) === "otp_expired" && activity.status !== "otp_expired") {
    await LoginActivity.updateOne({ _id: activity._id, status: "otp_pending" }, { $set: { status: "otp_expired", codeHash: null } });
    await addEvent(activity._id, "otp_expired");
    activity.status = "otp_expired";
  }
  return activity;
}

// Already verified, e.g. the success response was lost on a bad connection:
// hand the same session back to the browser that holds the challenge token.
async function replyIfAlreadyVerified(req, res, activity) {
  if (activity.status !== "success" || !activity.verifiedAt) return false;
  const withinWindow = activity.verifiedAt.getTime() + S.challengeMinutes * 60000 > Date.now();
  if (!sessionIsActive(activity) || !withinWindow) {
    sendError(req, res, 409, "LOGIN_CHALLENGE_USED");
    return true;
  }
  const user = await User.findOne({ uid: activity.uid });
  replyWithSession(res, user, activity);
  return true;
}

function challengeError(req, res, activity) {
  const state = challengeState(activity);
  if (state.status === "otp_expired") return sendError(req, res, 410, "LOGIN_CHALLENGE_EXPIRED", {}, { challenge: state });
  if (state.status === "otp_locked") return sendError(req, res, 429, "LOGIN_OTP_LOCKED", {}, { challenge: state });
  return sendError(req, res, 409, "LOGIN_CHALLENGE_USED", {}, { challenge: state });
}

// After a challenge locks, too many locks in an hour pause sign-in for the account.
async function lockAfterRepeatedFailures(uid) {
  const locks = await LoginActivity.countDocuments({
    uid,
    status: "otp_locked",
    createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) },
  });
  if (locks >= S.maxLockedChallengesPerHour) {
    await User.updateOne({ uid }, { $set: { lockedUntil: new Date(Date.now() + S.otpLockoutMinutes * 60000) } });
    return true;
  }
  return false;
}

async function verifyChallenge(req, res) {
  const { code } = req.body || {};
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return sendError(req, res, 400, "OTP_INVALID_FORMAT");
  const activity = await loadChallenge(req, res);
  if (!activity) return;
  if (await replyIfAlreadyVerified(req, res, activity)) return;
  if (activity.status !== "otp_pending") return challengeError(req, res, activity);
  const ip = getDeviceInfo(req).ip;

  if (activity.otpExpiresAt <= new Date()) {
    await addEvent(activity._id, "otp_code_expired", "", ip);
    return sendError(req, res, 410, "OTP_EXPIRED", {}, { challenge: challengeState(activity) });
  }

  const expected = activity.codeHash;
  if (!expected || !safeEqual(hashOtp(`login.${activity._id}.${activity.resendCount}`, code), expected)) {
    const failed = await LoginActivity.findOneAndUpdate(
      { _id: activity._id, status: "otp_pending", attempts: { $lt: S.maxVerifyAttempts } },
      { $inc: { attempts: 1 }, $push: { events: { type: "otp_failed", ip, at: new Date() } } },
      { new: true }
    );
    if (!failed || failed.attempts >= S.maxVerifyAttempts) {
      await LoginActivity.updateOne({ _id: activity._id, status: "otp_pending" }, { $set: { status: "otp_locked", codeHash: null } });
      await addEvent(activity._id, "otp_locked", "", ip);
      const paused = await lockAfterRepeatedFailures(activity.uid);
      const locked = await LoginActivity.findById(activity._id);
      return sendError(req, res, 429, paused ? "LOGIN_OTP_PAUSED" : "LOGIN_OTP_LOCKED", { minutes: S.otpLockoutMinutes }, { challenge: challengeState(locked) });
    }
    const attemptsLeft = S.maxVerifyAttempts - failed.attempts;
    return sendError(req, res, 400, "OTP_INVALID", { attemptsLeft }, { attemptsLeft, challenge: challengeState(failed) });
  }

  // Accept the code exactly once, even if two requests arrive together.
  const verified = await LoginActivity.findOneAndUpdate(
    { _id: activity._id, status: "otp_pending", codeHash: expected },
    { $set: { verifiedAt: new Date(), codeHash: null }, $push: { events: { type: "otp_verified", ip, at: new Date() } } },
    { new: true }
  );
  if (!verified) {
    const fresh = await LoginActivity.findById(activity._id);
    if (await replyIfAlreadyVerified(req, res, fresh)) return;
    return sendError(req, res, 409, "LOGIN_CHALLENGE_USED");
  }

  const user = await User.findOne({ uid: verified.uid });
  if (!user) return sendError(req, res, 404, "LOGIN_CHALLENGE_NOT_FOUND");
  // The mobile window could have closed while the code was being typed.
  if (isMobile(verified) && !mobileWindowOpen()) {
    await LoginActivity.updateOne({ _id: verified._id }, { $set: { status: "blocked_mobile_hours" } });
    return sendError(req, res, 403, "MOBILE_LOGIN_HOURS", mobileWindowLabel(), { window: mobileWindowLabel() });
  }
  const session = await openSession(verified, user);
  // Email the owner if this browser wasn't trusted yet (the location lookup has
  // usually finished by now).
  if (!verified.trustedDevice && verified.kind === "login") enrichInBackground(session._id, user, user.language || getRequestLanguage(req), { alert: true });
  return replyWithSession(res, user, session);
}

async function resendChallenge(req, res) {
  const activity = await loadChallenge(req, res);
  if (!activity) return;
  if (activity.status !== "otp_pending") return challengeError(req, res, activity);
  const state = challengeState(activity);
  if (activity.resendCount >= S.maxResends) return sendError(req, res, 429, "RESEND_LIMIT", {}, { challenge: state });
  if (state.resendInSeconds > 0) {
    return sendError(req, res, 429, "OTP_COOLDOWN", { seconds: state.resendInSeconds }, { retryAfter: state.resendInSeconds, challenge: state });
  }

  const code = generateOtpCode();
  const now = new Date();
  const updated = await LoginActivity.findOneAndUpdate(
    { _id: activity._id, status: "otp_pending", resendCount: activity.resendCount },
    {
      $set: {
        codeHash: hashOtp(`login.${activity._id}.${activity.resendCount + 1}`, code),
        otpExpiresAt: new Date(now.getTime() + S.otpTtlMinutes * 60000),
        lastSentAt: now,
      },
      $inc: { resendCount: 1 },
      $push: { events: { type: "otp_resent", ip: getDeviceInfo(req).ip, at: now } },
    },
    { new: true }
  );
  // Another resend won the race.
  if (!updated) return sendError(req, res, 429, "OTP_COOLDOWN", { seconds: S.resendCooldownSeconds }, { retryAfter: S.resendCooldownSeconds });

  const user = await User.findOne({ uid: activity.uid });
  try {
    await sendLoginCode(user, activity.otpChannel, code, user.language || getRequestLanguage(req), describeDevice(activity));
  } catch (error) {
    await addEvent(activity._id, "otp_send_failed", error.message);
    return sendError(req, res, 502, activity.otpChannel === "email" ? "EMAIL_FAILED" : "SMS_FAILED", {}, { challenge: challengeState(updated) });
  }
  res.json({ challenge: challengeState(updated) });
}

// Lets the page resume the OTP step after a reload or a dropped connection.
async function getChallenge(req, res) {
  const activity = await loadChallenge(req, res);
  if (!activity) return;
  if (await replyIfAlreadyVerified(req, res, activity)) return;
  res.json({ challenge: challengeState(activity) });
}

// =============================================================================
// Checking sessions on every request
// =============================================================================

async function revokeSessions(filter, reason) {
  return LoginActivity.updateMany(
    { ...filter, status: "success", revokedAt: null },
    { $set: { revokedAt: new Date(), revokeReason: reason }, $push: { events: { type: "revoked", detail: reason, at: new Date() } } }
  );
}

/**
 * Validates the session behind a token. Returns { session } or { error, status }.
 *  - the session must exist, belong to the token's user, and not be signed out or expired
 *  - the token only works in the browser it was issued to (X-Device-Id)
 *  - mobile sessions end when the mobile window closes
 *  - an IP change (VPN, switching networks) is logged on the session, not punished
 */
async function checkSession(req, payload) {
  if (!payload.sid || !mongoose.isValidObjectId(payload.sid)) return { status: 401, error: "INVALID_TOKEN" };
  const session = await LoginActivity.findById(payload.sid);
  if (!session || session.uid !== payload.sub) return { status: 401, error: "INVALID_TOKEN" };
  if (session.revokedAt) return { status: 401, error: session.revokeReason === "signed_out" ? "INVALID_TOKEN" : "SESSION_REVOKED" };
  if (!sessionIsActive(session)) return { status: 401, error: "INVALID_TOKEN" };

  const ip = getDeviceInfo(req).ip;
  const deviceId = String(req.headers["x-device-id"] || "");
  if (session.deviceId && deviceId !== session.deviceId) {
    // The token was copied to another browser. Refuse it there; the real one keeps working.
    await addEvent(session._id, "device_mismatch", deviceId ? "other browser" : "no device id", ip);
    return { status: 401, error: "SESSION_DEVICE_MISMATCH" };
  }

  if (session.deviceType === "mobile" && !mobileWindowOpen()) {
    await revokeSessions({ _id: session._id }, "mobile_hours_ended");
    return { status: 403, error: "MOBILE_SESSION_ENDED", vars: mobileWindowLabel() };
  }

  const update = {};
  if (ip && ip !== session.lastIp) {
    update.$set = { lastIp: ip, lastSeenAt: new Date() };
    update.$push = { events: { type: "ip_changed", detail: `${session.lastIp || "?"} -> ${ip}`, ip, at: new Date() } };
  } else if (!session.lastSeenAt || Date.now() - session.lastSeenAt.getTime() > S.lastSeenWriteSeconds * 1000) {
    update.$set = { lastSeenAt: new Date() };
  }
  if (update.$set) await LoginActivity.updateOne({ _id: session._id }, update);
  return { session };
}

module.exports = {
  beginSignIn,
  recordAttempt,
  verifyChallenge,
  resendChallenge,
  getChallenge,
  checkSession,
  revokeSessions,
  publicUser,
  effectiveStatus,
  sessionIsActive,
  mobileWindowOpen,
  mobileWindowLabel,
  describeDevice,
};
