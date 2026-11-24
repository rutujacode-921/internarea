const crypto = require("crypto");
const { SPACE_SETTINGS: S } = require("../config/space");

// Words that are never allowed in posts or comments (abuse, slurs, sexual
// content). Matched as whole words after undoing common character swaps
// (@ -> a, 0 -> o, ...). Extend with BLOCKED_WORDS in .env (comma separated).
const BLOCKED_WORDS = new Set(
  [
    "fuck", "fucking", "fucker", "motherfucker", "fck", "fuk", "fack", "phuck", "fcuk", "shit", "bullshit", "bitch", "bastard", "asshole", "dick", "pussy", "cunt",
    "slut", "whore", "porn", "nude", "nudes", "nigger", "nigga", "faggot", "retard", "rapist",
    "madarchod", "behenchod", "bhenchod", "chutiya", "chutiye", "bhosdike", "bhosdi", "randi", "gandu", "harami", "lauda", "lund",
    "kys",
    ...(process.env.BLOCKED_WORDS || "").split(",").map((w) => w.trim().toLowerCase()).filter(Boolean),
  ]
);
const BLOCKED_PHRASES = ["kill yourself", "go die"];

const LEET = { "@": "a", "4": "a", "0": "o", "1": "i", "!": "i", "3": "e", "$": "s", "5": "s", "7": "t" };

// Cleans user text: trims, normalises line breaks, drops control characters.
function cleanText(value, max) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u2028-\u202E]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, max + 1); // one extra so "too long" can be detected
}

const extractHashtags = (text) => [...new Set((text.match(/#[\p{L}\p{N}_]{1,50}/gu) || []).map((t) => t.slice(1).toLowerCase()))];
const extractMentions = (text) => [...new Set((text.match(/(?<![\w.])@[a-z0-9_.]{3,20}/gi) || []).map((m) => m.slice(1).toLowerCase()))];
const countLinks = (text) => (text.match(/https?:\/\/|www\.[a-z0-9-]+\.[a-z]/gi) || []).length;

function hasBlockedContent(text) {
  const normalized = text
    .toLowerCase()
    .replace(/(\p{L})[*.\-_]+(?=\p{L})/gu, "$1") // "f*ck", "s.h.i.t" -> "fck", "shit"
    .replace(/[@401!35$7]/g, (c) => LEET[c] || c);
  const words = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.some((w) => BLOCKED_WORDS.has(w))) return true;
  const squashed = ` ${words.join(" ")} `;
  return BLOCKED_PHRASES.some((p) => squashed.includes(` ${p} `));
}

// Returns null if the text is acceptable, otherwise an error code.
function textProblem(text, { maxLength, allowEmpty = true }) {
  if (!text && !allowEmpty) return "EMPTY_POST";
  if (text.length > maxLength) return "TEXT_TOO_LONG";
  if (hasBlockedContent(text)) return "INAPPROPRIATE_CONTENT";
  // Spam patterns: a character repeated 15+ times, or too many links.
  if (/(.)\1{14,}/u.test(text.replace(/\s/g, ""))) return "SPAM_CONTENT";
  if (countLinks(text) > S.maxLinks) return "TOO_MANY_LINKS";
  if (extractHashtags(text).length > S.maxHashtags) return "TOO_MANY_HASHTAGS";
  if (extractMentions(text).length > S.maxMentions) return "TOO_MANY_MENTIONS";
  return null;
}

// Identifies identical content (same text, ignoring case and spacing, and same media).
const contentHash = (text, mediaHashes = []) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify([text.toLowerCase().replace(/\s+/g, " ").trim(), [...mediaHashes].sort()]))
    .digest("hex");

module.exports = { cleanText, extractHashtags, extractMentions, textProblem, contentHash, hasBlockedContent };
