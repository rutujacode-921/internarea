const axios = require("axios");

// Sends an SMS through Twilio's REST API when TWILIO_* is configured.
// In development without Twilio, the message is printed to the console instead
// (like OTP emails). In production without Twilio, sending fails.
async function sendSms(to, body) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from } = process.env;
  if (!sid || !token || !from) {
    if (process.env.NODE_ENV === "production") throw new Error("SMS is not configured");
    console.log(`\n[DEV SMS] To: ${to} | ${body}\n`);
    return;
  }
  await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
    new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    {
      auth: { username: sid, password: token },
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
    }
  );
}

module.exports = { sendSms };
