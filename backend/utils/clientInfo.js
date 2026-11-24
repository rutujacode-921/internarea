const UAParser = require("ua-parser-js");

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  let ip =
    (typeof forwarded === "string" && forwarded.split(",")[0].trim()) ||
    req.ip ||
    req.socket?.remoteAddress ||
    "unknown";
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  if (ip === "::1") ip = "127.0.0.1";
  return ip;
}

// Extracts IP, browser, OS and device details for the audit log.
function getClientInfo(req) {
  const userAgent = (req.headers["user-agent"] || "").slice(0, 500);
  const result = new UAParser(userAgent).getResult();
  const join = (...parts) => parts.filter(Boolean).join(" ").trim();

  const deviceType = result.device.type || "desktop";
  const deviceName = join(result.device.vendor, result.device.model);

  return {
    ip: getClientIp(req),
    userAgent,
    browser: join(result.browser.name, result.browser.version) || "Unknown",
    os: join(result.os.name, result.os.version) || "Unknown",
    device: deviceName ? `${deviceType} (${deviceName})` : deviceType,
  };
}

module.exports = { getClientInfo, getClientIp };
