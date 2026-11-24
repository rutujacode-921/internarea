const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const User = require("../Model/User");
const LoginActivity = require("../Model/LoginActivity");
const TrustedDevice = require("../Model/TrustedDevice");
const { requireAuth, verifyGoogleIdToken } = require("../middleware/auth");
const { sendError, asyncHandler } = require("../utils/errors");
const {
  beginSignIn,
  verifyChallenge,
  resendChallenge,
  getChallenge,
  revokeSessions,
  effectiveStatus,
  sessionIsActive,
} = require("../services/loginSecurity");

// Task 5: Google sign-in, the Chrome OTP step, Login History, active sessions
// and trusted devices. Mounted at /api/auth next to the password routes.

// POST /api/auth/google - exchange a Firebase ID token for a session.
router.post(
  "/google",
  asyncHandler(async (req, res) => {
    const { idToken, client, requestId } = req.body || {};
    if (typeof idToken !== "string" || !idToken) return sendError(req, res, 401, "INVALID_TOKEN");
    const decoded = await verifyGoogleIdToken(idToken);
    if (!decoded) return sendError(req, res, 401, "INVALID_TOKEN");

    const profile = { email: decoded.email || null, name: decoded.name || null, photo: decoded.picture || null };
    let user = await User.findOne({ uid: decoded.uid });
    let kind = "login";
    if (!user) {
      try {
        user = await User.create({ uid: decoded.uid, ...profile, authProvider: "google" });
        kind = "signup";
      } catch (error) {
        if (error?.code !== 11000) throw error;
        user = await User.findOne({ uid: decoded.uid }); // created by a simultaneous request
      }
    } else {
      const changes = {};
      for (const [key, value] of Object.entries(profile)) if (value && user[key] !== value) changes[key] = value;
      if (Object.keys(changes).length) user = await User.findOneAndUpdate({ _id: user._id }, { $set: changes }, { new: true });
    }
    return beginSignIn(req, res, { user, kind, client, requestId });
  })
);

// The OTP step for Google Chrome sign-ins. The challenge token returned by the
// login call proves the request comes from the browser that started it.
router.post("/login/verify", asyncHandler(verifyChallenge));
router.post("/login/resend", asyncHandler(resendChallenge));
router.post("/login/challenge", asyncHandler(getChallenge));

// POST /api/auth/logout - end this session on the server.
router.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeSessions({ _id: req.sessionId, uid: req.authUser.uid }, "signed_out");
    res.json({ ok: true });
  })
);

// ---- Login History ------------------------------------------------------------

const HISTORY_FIELDS =
  "provider kind status revokedAt revokeReason expiresAt lastSeenAt lastIp ip publicIp browserName browserVersion osName osVersion deviceType deviceModel location isNewDevice isNewBrowser isNewIp isNewCountry trustedDevice otpRequired otpChannel otpDestination attempts resendCount verifiedAt events createdAt";

const toEntry = (a, currentId) => {
  const o = a.toObject();
  const status = effectiveStatus(a);
  return {
    ...o,
    status,
    active: sessionIsActive(a),
    current: String(a._id) === currentId,
    // In local development the server sees 127.0.0.1; publicIp is the real one.
    publicIp: o.publicIp || o.ip,
    events: (o.events || []).slice(-30),
  };
};

// GET /api/auth/login-history?before=<ISO date> - newest first, 25 per page.
router.get(
  "/login-history",
  requireAuth,
  asyncHandler(async (req, res) => {
    const filter = { uid: req.authUser.uid };
    const before = req.query.before ? new Date(req.query.before) : null;
    if (before && !Number.isNaN(before.getTime())) filter.createdAt = { $lt: before };
    const entries = await LoginActivity.find(filter).sort({ createdAt: -1 }).limit(26).select(HISTORY_FIELDS);
    res.json({
      entries: entries.slice(0, 25).map((a) => toEntry(a, req.sessionId)),
      hasMore: entries.length > 25,
    });
  })
);

// ---- Active sessions ------------------------------------------------------------

// GET /api/auth/sessions - every device currently signed in.
router.get(
  "/sessions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const sessions = await LoginActivity.find({
      uid: req.authUser.uid,
      status: "success",
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    })
      .sort({ lastSeenAt: -1 })
      .select(HISTORY_FIELDS);
    res.json({ sessions: sessions.map((a) => toEntry(a, req.sessionId)) });
  })
);

// DELETE /api/auth/sessions/:id - sign out one other device.
router.delete(
  "/sessions/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return sendError(req, res, 404, "SESSION_NOT_FOUND");
    if (req.params.id === req.sessionId) return sendError(req, res, 400, "SESSION_IS_CURRENT");
    const result = await revokeSessions({ _id: req.params.id, uid: req.authUser.uid }, "revoked");
    // Already signed out (e.g. a double click) counts as done.
    if (!result.matchedCount && !(await LoginActivity.exists({ _id: req.params.id, uid: req.authUser.uid }))) {
      return sendError(req, res, 404, "SESSION_NOT_FOUND");
    }
    res.json({ ok: true });
  })
);

// POST /api/auth/sessions/revoke-others - sign out everywhere except here.
router.post(
  "/sessions/revoke-others",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await revokeSessions({ uid: req.authUser.uid, _id: { $ne: req.sessionId } }, "revoked");
    res.json({ ok: true, count: result.modifiedCount });
  })
);

// ---- Trusted devices ------------------------------------------------------------

router.get(
  "/trusted-devices",
  requireAuth,
  asyncHandler(async (req, res) => {
    const current = await LoginActivity.findById(req.sessionId).select("deviceId browserName");
    const currentKey = current?.deviceId ? `${current.deviceId}:${current.browserName}` : null;
    const devices = await TrustedDevice.find({ uid: req.authUser.uid }).sort({ lastUsedAt: -1 }).limit(50);
    res.json({
      devices: devices.map((d) => ({
        _id: d._id,
        browserName: d.browserName,
        osName: d.osName,
        deviceType: d.deviceType,
        deviceModel: d.deviceModel,
        lastIp: d.lastIp,
        lastCountry: d.lastCountry,
        trustedAt: d.trustedAt,
        lastUsedAt: d.lastUsedAt,
        current: d.deviceKey === currentKey,
      })),
    });
  })
);

// DELETE /api/auth/trusted-devices/:id - forget a device; its next sign-in counts
// as new again (and its sessions are signed out).
router.delete(
  "/trusted-devices/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return sendError(req, res, 404, "SESSION_NOT_FOUND");
    const device = await TrustedDevice.findOneAndDelete({ _id: req.params.id, uid: req.authUser.uid });
    if (!device) return res.json({ ok: true });
    const [deviceId, ...browser] = device.deviceKey.split(":");
    await revokeSessions(
      { uid: req.authUser.uid, deviceId, browserName: browser.join(":"), _id: { $ne: req.sessionId } },
      "revoked"
    );
    res.json({ ok: true });
  })
);

module.exports = router;
