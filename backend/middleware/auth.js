const admin = require("firebase-admin");
const User = require("../Model/User");
const { sendError } = require("../utils/errors");
const { verifySession } = require("../utils/passwords");

// Verifying Firebase ID tokens only needs the project id (no service account).
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || "internshala-9e300",
  });
}

// Routes a user who must change their password may still call.
const ALLOWED_WHILE_CHANGE_REQUIRED = ["/api/auth/me", "/api/auth/change-password", "/api/auth/logout"];

// Rejects requests without a valid session. Two kinds are accepted:
// - password accounts: our own signed session token (utils/passwords.js)
// - Google accounts: a Firebase ID token
// Either way, a user can only ever act on their own data.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return sendError(req, res, 401, "UNAUTHORIZED");
  const token = match[1];

  const session = verifySession(token);
  if (session) {
    try {
      const user = await User.findOne({ uid: session.sub, authProvider: "password" });
      // A password change bumps passwordVersion, which signs out older sessions.
      if (!user || user.passwordVersion !== session.pv) return sendError(req, res, 401, "INVALID_TOKEN");
      // After a reset, nothing else is allowed until the temporary password is replaced.
      if (user.mustChangePassword && !ALLOWED_WHILE_CHANGE_REQUIRED.includes(req.originalUrl.split("?")[0])) {
        return sendError(req, res, 403, "PASSWORD_CHANGE_REQUIRED");
      }
      req.authUser = {
        uid: user.uid,
        email: user.email || null,
        phone: user.phone || null,
        emailVerified: false,
        name: user.name || null,
        provider: "password",
      };
      return next();
    } catch (error) {
      console.error("Session check failed:", error);
      return sendError(req, res, 500, "SERVER_ERROR");
    }
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.authUser = {
      uid: decoded.uid,
      email: decoded.email || null,
      emailVerified: Boolean(decoded.email_verified),
      name: decoded.name || null,
      photo: decoded.picture || null,
      provider: "google",
    };
    next();
  } catch (error) {
    console.warn("Rejected Firebase token:", error.code || error.message);
    sendError(req, res, 401, "INVALID_TOKEN");
  }
}

// Like requireAuth, but lets requests without a token through (req.authUser
// stays unset). A token that is present must still be valid.
function optionalAuth(req, res, next) {
  if (!req.headers.authorization) return next();
  return requireAuth(req, res, next);
}

module.exports = { requireAuth, optionalAuth };
