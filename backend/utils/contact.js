// Cleans up and masks the email addresses and mobile numbers users type.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 120 && EMAIL_RE.test(email) ? email : null;
}

// Returns E.164 (e.g. +919876543210). A plain 10-digit number is treated as Indian.
function normalizePhone(value) {
  if (typeof value !== "string") return null;
  const raw = value.trim().replace(/[\s\-().]/g, "");
  if (/^[6-9]\d{9}$/.test(raw)) return `+91${raw}`;
  if (/^0[6-9]\d{9}$/.test(raw)) return `+91${raw.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(raw)) return `+${raw}`;
  if (/^\+[1-9]\d{7,14}$/.test(raw)) return raw;
  return null;
}

const maskPhone = (phone) => `${phone.slice(0, phone.length - 10)}******${phone.slice(-4)}`;

module.exports = { normalizeEmail, normalizePhone, maskPhone };
