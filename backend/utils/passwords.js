const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { PASSWORD_RULES, LOGIN_SETTINGS } = require("../config/auth");

const BCRYPT_ROUNDS = 12;
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const LETTERS = UPPER + LOWER;

// A random password made only of English letters (no digits or symbols), as
// the task requires. It always mixes upper- and lowercase. Uses a CSPRNG.
function generateLetterPassword(length) {
  const chars = [UPPER[crypto.randomInt(UPPER.length)], LOWER[crypto.randomInt(LOWER.length)]];
  while (chars.length < length) chars.push(LETTERS[crypto.randomInt(LETTERS.length)]);
  // Fisher-Yates shuffle so the guaranteed letters aren't always first.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

const hashPassword = (password) => bcrypt.hash(password, BCRYPT_ROUNDS);
const checkPassword = (password, hash) => (hash ? bcrypt.compare(password, hash) : Promise.resolve(false));

// Rules for passwords that users choose themselves.
function passwordProblem(password) {
  if (typeof password !== "string" || password.length < PASSWORD_RULES.min) return "WEAK_PASSWORD";
  if (Buffer.byteLength(password, "utf8") > PASSWORD_RULES.max) return "WEAK_PASSWORD";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "WEAK_PASSWORD";
  return null;
}

// ---- Sessions for password accounts -------------------------------------------
// Signed with HS256, so they can't be confused with Firebase's RS256 tokens.
// "pv" is the password version: changing the password signs out old sessions.

const JWT_SECRET =
  process.env.JWT_SECRET ||
  (() => {
    console.warn("JWT_SECRET is not set; using a random secret (users are signed out on restart).");
    return crypto.randomBytes(48).toString("hex");
  })();

const signSession = (user) =>
  jwt.sign({ sub: user.uid, pv: user.passwordVersion }, JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: `${LOGIN_SETTINGS.sessionDays}d`,
    issuer: "internarea",
  });

function verifySession(token) {
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"], issuer: "internarea" });
  } catch {
    return null;
  }
}

module.exports = { generateLetterPassword, hashPassword, checkPassword, passwordProblem, signSession, verifySession };
