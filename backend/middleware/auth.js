const admin = require("firebase-admin");
const User = require("../Model/User");
const { sendError } = require("../utils/errors");
const { verifySession } = require("../utils/passwords");
const { checkSession } = require("../services/loginSecurity");

// Verifying Firebase ID tokens only needs the project id (no service account).
// They are only used once, in POST /api/auth/google, to start a session.
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || "internshala-9e300",
  });
}

// Routes a user who must change their password may still call.
const ALLOWED_WHILE_CHANGE_REQUIRED = ["/api/auth/me", "/api/auth/change-password", "/api/auth/logout"];

// Rejects requests without a valid session. Every account (password or Google)
// signs in through /api/auth and gets our own session token, so the login rules
// (Chrome OTP, mobile hours) and "sign out other devices" apply to everyone.
// A user can only ever act on their own data.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return sendError(req, res, 401, "UNAUTHORIZED");

  const payload = verifySession(match[1]);
  if (!payload) return sendError(req, res, 401, "INVALID_TOKEN");

  try {
    const checked = await checkSession(req, payload);
    if (checked.error) return sendError(req, res, checked.status, checked.error, checked.vars || {});

    const user = await User.findOne({ uid: payload.sub });
    if (!user) return sendError(req, res, 401, "INVALID_TOKEN");
    const provider = user.authProvider === "password" ? "password" : "google";
    // A password change bumps passwordVersion, which signs out older sessions.
    if (provider === "password" && (user.passwordVersion || 0) !== payload.pv) return sendError(req, res, 401, "INVALID_TOKEN");
    // After a reset, nothing else is allowed until the temporary password is replaced.
    if (user.mustChangePassword && !ALLOWED_WHILE_CHANGE_REQUIRED.includes(req.originalUrl.split("?")[0])) {
      return sendError(req, res, 403, "PASSWORD_CHANGE_REQUIRED");
    }
    req.sessionId = String(checked.session._id);
    req.authUser = {
      uid: user.uid,
      email: user.email || null,
      phone: user.phone || null,
      // Google verified the address when the session was started.
      emailVerified: provider === "google",
      name: user.name || null,
      photo: user.photo || null,
      provider,
    };
    return next();
  } catch (error) {
    console.error("Session check failed:", error);
    return sendError(req, res, 500, "SERVER_ERROR");
  }
}

// Like requireAuth, but lets requests without a token through (req.authUser
// stays unset). A token that is present must still be valid.
function optionalAuth(req, res, next) {
  if (!req.headers.authorization) return next();
  return requireAuth(req, res, next);
}

// Checks a Firebase ID token from "Continue with Google".
async function verifyGoogleIdToken(idToken) {
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    if (decoded.firebase?.sign_in_provider && decoded.firebase.sign_in_provider !== "google.com") return null;
    return decoded;
  } catch (error) {
    console.warn("Rejected Firebase token:", error.code || error.message);
    return null;
  }
}

module.exports = { requireAuth, optionalAuth, verifyGoogleIdToken };
