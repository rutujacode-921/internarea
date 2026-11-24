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
  await sendOtpEmail({
    to,
    code,
    subject: t("subject"),
    heading: t("heading"),
    intro: t("intro", { language }),
    expiry: t("expiry", { minutes }),
    ignore: t("ignore"),
  });
}

// Sends the OTP that must be verified before a Razorpay payment can start.
async function sendPaymentOtpEmail({ to, code, item, amount, uiLanguage, minutes }) {
  const t = (key, vars) => translate(uiLanguage, `paymentEmail.${key}`, vars);
  await sendOtpEmail({
    to,
    code,
    subject: t("subject"),
    heading: t("heading"),
    intro: t("intro", { item, amount }),
    expiry: t("expiry", { minutes }),
    ignore: t("ignore"),
  });
}

// Shared layout for OTP emails. Prints the code to the console in development without SMTP.
async function sendOtpEmail({ to, code, subject, heading, intro, expiry, ignore }) {
  const text = `${heading}\n\n${intro}\n\n${code}\n\n${expiry}\n\n${ignore}`;
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937">
    <h2 style="color:#2563eb;margin:0 0 16px">${escapeHtml(heading)}</h2>
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

module.exports = { sendLanguageOtpEmail, sendPaymentOtpEmail };
