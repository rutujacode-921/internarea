const nodemailer = require("nodemailer");
const { translate, languageName } = require("../i18n/messages");

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;
  const port = parseInt(process.env.SMTP_PORT, 10) || 587;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Sends the language-change OTP, written in the user's current UI language.
async function sendLanguageOtpEmail({ to, code, targetLanguage, uiLanguage, minutes }) {
  const t = (key, vars) => translate(uiLanguage, `email.${key}`, vars);
  const language = languageName(uiLanguage, targetLanguage);

  const subject = t("subject");
  const intro = t("intro", { language });
  const expiry = t("expiry", { minutes });
  const ignore = t("ignore");

  const text = `${t("heading")}\n\n${intro}\n\n${code}\n\n${expiry}\n\n${ignore}`;
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937">
    <h2 style="color:#2563eb;margin:0 0 16px">${escapeHtml(t("heading"))}</h2>
    <p>${escapeHtml(intro)}</p>
    <p style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;background:#eff6ff;border-radius:8px;padding:16px;margin:24px 0">${code}</p>
    <p>${escapeHtml(expiry)}</p>
    <p style="color:#6b7280;font-size:13px">${escapeHtml(ignore)}</p>
  </div>`;

  const smtp = getTransporter();
  if (!smtp) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SMTP is not configured");
    }
    // Development fallback so the flow can be tested without an email account.
    console.log(`\n[DEV EMAIL] To: ${to} | Subject: ${subject} | OTP: ${code}\n`);
    return;
  }

  await smtp.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    html,
  });
}

module.exports = { sendLanguageOtpEmail };
