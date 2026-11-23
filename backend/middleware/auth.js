const admin = require("firebase-admin");
const { sendError } = require("../utils/errors");

// Verifying Firebase ID tokens only needs the project id (no service account).
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || "internshala-9e300",
  });
}

// Rejects requests that do not carry a valid Firebase ID token, so a user can
// only ever read or change their own language preference.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return sendError(req, res, 401, "UNAUTHORIZED");

  try {
    const decoded = await admin.auth().verifyIdToken(match[1]);
    req.authUser = {
      uid: decoded.uid,
      email: decoded.email || null,
      emailVerified: Boolean(decoded.email_verified),
      name: decoded.name || null,
    };
    next();
  } catch (error) {
    console.warn("Rejected Firebase token:", error.code || error.message);
    sendError(req, res, 401, "INVALID_TOKEN");
  }
}

module.exports = { requireAuth };
