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

// Sends the Forgot Password verification code.
async function sendResetOtpEmail({ to, code, uiLanguage, minutes }) {
  const t = (key, vars) => translate(uiLanguage, `resetEmail.${key}`, vars);
  await sendOtpEmail({
    to,
    code,
    subject: t("subject"),
    heading: t("heading"),
    intro: t("intro"),
    expiry: t("expiry", { minutes }),
    ignore: t("ignore"),
  });
}

// Sends the newly generated password after a verified reset.
async function sendNewPasswordEmail({ to, password, uiLanguage }) {
  const t = (key) => translate(uiLanguage, `newPasswordEmail.${key}`);
  await sendOtpEmail({
    to,
    code: password,
    label: "NEW PASSWORD",
    subject: t("subject"),
    heading: t("heading"),
    intro: t("intro"),
    expiry: t("mustChange"),
    ignore: t("notYou"),
  });
}

// Sends the OTP required to finish signing in from Google Chrome.
async function sendLoginOtpEmail({ to, code, uiLanguage, minutes, where }) {
  const t = (key, vars) => translate(uiLanguage, `loginOtpEmail.${key}`, vars);
  await sendOtpEmail({
    to,
    code,
    subject: t("subject"),
    heading: t("heading"),
    intro: t("intro", { where }),
    expiry: t("expiry", { minutes }),
    ignore: t("ignore"),
  });
}

// Tells the account owner about a sign-in from a device or browser not seen before.
async function sendNewSignInAlertEmail({ to, uiLanguage, where, when, ip }) {
  const t = (key, vars) => translate(uiLanguage, `newSignInEmail.${key}`, vars);
  const subject = t("subject");
  const lines = [t("intro"), `${where}\n${when}\nIP: ${ip}`, t("notYou")];
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937">
    <h2 style="color:#2563eb;margin:0 0 16px">${escapeHtml(t("heading"))}</h2>
    <p>${escapeHtml(lines[0])}</p>
    <p style="background:#eff6ff;border-radius:8px;padding:16px;margin:24px 0;white-space:pre-line">${escapeHtml(lines[1])}</p>
    <p style="color:#6b7280;font-size:13px">${escapeHtml(lines[2])}</p>
  </div>`;
  const smtp = getTransporter();
  if (!smtp) {
    if (process.env.NODE_ENV === "production") throw new Error("SMTP is not configured");
    console.log(`\n[DEV EMAIL] To: ${to} | Subject: ${subject} | ${lines[1].replace(/\n/g, " | ")}\n`);
    return;
  }
  await smtp.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text: lines.join("\n\n"), html });
}

// Subscription confirmation with the invoice PDF attached (Task 6).
async function sendSubscriptionConfirmationEmail({ payment, plan, invoicePdf, uiLanguage }) {
  const t = (key, vars) => translate(uiLanguage, `subscriptionEmail.${key}`, vars);
  const date = (d) =>
    d ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(d)) + " IST" : "-";
  const amount = new Intl.NumberFormat("en-IN", { style: "currency", currency: payment.currency || "INR" }).format(payment.amount / 100);
  const sub = payment.subscription || {};
  const quota = plan.limit === null ? t("unlimited") : t("perMonth", { count: plan.limit });
  const rows = [
    [t("plan"), `${plan.name} (${quota})`],
    [t("amount"), amount + (sub.credit ? ` (${t("credit", { amount: new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(sub.credit / 100) })})` : "")],
    [t("validity"), `${date(sub.periodStart)} → ${date(sub.periodEnd)}`],
    [t("transactionId"), payment.razorpayPaymentId],
    [t("orderId"), payment.razorpayOrderId],
    [t("invoice"), payment.invoice.number],
    [t("paidOn"), date(payment.paidAt)],
    [t("billedTo"), [payment.name, payment.email].filter(Boolean).join(", ")],
    [t("method"), payment.gateway === "mock" ? t("testPayment") : payment.method || "Razorpay"],
  ];
  const subject = t("subject", { plan: plan.name });
  const intro = t(sub.kind === "renewal" ? "introRenewal" : sub.kind === "upgrade" ? "introUpgrade" : "intro", { plan: plan.name });
  const text = `${t("heading")}\n\n${intro}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${t("footer")}`;
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1f2937">
    <h2 style="color:#2563eb;margin:0 0 16px">${escapeHtml(t("heading"))}</h2>
    <p>${escapeHtml(intro)}</p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px">
      ${rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600">${escapeHtml(v)}</td></tr>`
        )
        .join("")}
    </table>
    <p style="color:#6b7280;font-size:13px">${escapeHtml(t("footer"))}</p>
  </div>`;

  const smtp = getTransporter();
  if (!smtp) {
    if (process.env.NODE_ENV === "production") throw new Error("SMTP is not configured");
    console.log(`\n[DEV EMAIL] To: ${payment.email} | Subject: ${subject} | Invoice ${payment.invoice.number} attached (${invoicePdf.length} bytes)\n${text}\n`);
    return;
  }
  await smtp.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: payment.email,
    subject,
    text,
    html,
    attachments: [{ filename: `${payment.invoice.number}.pdf`, content: invoicePdf, contentType: "application/pdf" }],
  });
}

// Shared layout for code emails. Prints the code to the console in development without SMTP.
async function sendOtpEmail({ to, code, subject, heading, intro, expiry, ignore, label = "OTP" }) {
  const text = `${heading}\n\n${intro}\n\n${code}\n\n${expiry}\n\n${ignore}`;
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937">
    <h2 style="color:#2563eb;margin:0 0 16px">${escapeHtml(heading)}</h2>
    <p>${escapeHtml(intro)}</p>
    <p style="font-family:Consolas,'Courier New',monospace;font-size:${code.length > 6 ? 26 : 32}px;font-weight:bold;letter-spacing:${code.length > 6 ? 3 : 8}px;text-align:center;background:#eff6ff;border-radius:8px;padding:16px;margin:24px 0">${code}</p>
    <p>${escapeHtml(expiry)}</p>
    <p style="color:#6b7280;font-size:13px">${escapeHtml(ignore)}</p>
  </div>`;

  const smtp = getTransporter();
  if (!smtp) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SMTP is not configured");
    }
    // Development fallback so the flow can be tested without an email account.
    console.log(`\n[DEV EMAIL] To: ${to} | Subject: ${subject} | ${label}: ${code}\n`);
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

module.exports = {
  sendLanguageOtpEmail,
  sendPaymentOtpEmail,
  sendResetOtpEmail,
  sendNewPasswordEmail,
  sendLoginOtpEmail,
  sendNewSignInAlertEmail,
  sendSubscriptionConfirmationEmail,
};
