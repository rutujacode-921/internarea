const UAParser = require("ua-parser-js");
const { getClientIp } = require("./clientInfo");

// Works out browser, OS and device for a sign-in from the User-Agent header,
// refined by optional hints the login page sends (User-Agent Client Hints,
// Battery API, touch support).
//
// Everything a browser reports about itself can be changed by the person using
// it, so these details describe the environment honestly reported by a normal
// browser; they are not proof of identity. The rules built on them (Chrome OTP,
// mobile hours) add friction, while passwords, OTPs and sessions provide the
// actual security.

const clean = (value, max = 80) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const DEVICE_ID = /^[A-Za-z0-9_-]{16,64}$/;

// Brand names from navigator.userAgentData, most specific first.
const BRANDS = [
  ["Brave", "Brave"],
  ["Microsoft Edge", "Edge"],
  ["Opera", "Opera"],
  ["Opera GX", "Opera"],
  ["Yandex", "Yandex"],
  ["Vivaldi", "Vivaldi"],
  ["Samsung Internet", "Samsung Internet"],
  ["Google Chrome", "Chrome"],
];

function brandFromHints(hints) {
  const list = Array.isArray(hints?.fullVersionList) ? hints.fullVersionList : Array.isArray(hints?.brands) ? hints.brands : [];
  for (const [brand, name] of BRANDS) {
    const match = list.find((b) => b && b.brand === brand);
    if (match) return { name, version: clean(match.version, 40) };
  }
  return null;
}

// Laptops run on a battery; desktops report a permanently full, charging one (or none).
function looksLikeLaptop(battery) {
  if (!battery || battery.present !== true) return false;
  if (battery.charging === false) return true;
  if (typeof battery.level === "number" && battery.level < 1) return true;
  return typeof battery.chargingTime === "number" && battery.chargingTime > 0 && Number.isFinite(battery.chargingTime);
}

function getDeviceInfo(req, client = {}) {
  const userAgent = clean(req.headers["user-agent"], 500);
  const ua = new UAParser(userAgent).getResult();
  const hints = client && typeof client.uaData === "object" ? client.uaData : null;

  // ---- Browser ----
  let browserName = ua.browser.name || "Unknown";
  let browserVersion = ua.browser.version || "";
  // Chromium-based browsers often all look like "Chrome" in the User-Agent.
  if (/chrom/i.test(browserName) || browserName === "Edge" || browserName === "Opera") {
    const branded = brandFromHints(hints);
    if (client.brave === true) browserName = "Brave";
    else if (branded) {
      browserName = branded.name;
      if (branded.version) browserVersion = branded.version;
    }
  }
  if (/^Mobile Chrome$|^Chrome WebView$/.test(browserName)) browserName = "Chrome";

  // ---- Operating system ----
  let osName = ua.os.name || "Unknown";
  let osVersion = ua.os.version || "";
  const platformVersion = clean(hints?.platformVersion, 20);
  // Windows 11 still says "Windows NT 10.0"; client hints tell them apart.
  if (osName === "Windows" && platformVersion) {
    osVersion = parseInt(platformVersion, 10) >= 13 ? "11" : "10";
  } else if (platformVersion && (osName === "Android" || osName === "Mac OS")) {
    osVersion = platformVersion;
  }

  // ---- Device ----
  let deviceType = ua.device.type === "mobile" || ua.device.type === "tablet" ? ua.device.type : "desktop";
  // iPads in desktop mode report as a Mac; real Macs have no touch screen.
  if (deviceType === "desktop" && osName === "Mac OS" && Number(client.touchPoints) > 1) deviceType = "tablet";
  if (deviceType === "desktop" && hints?.mobile === true) deviceType = "mobile";
  if (deviceType === "desktop" && looksLikeLaptop(client.battery)) deviceType = "laptop";

  // Chrome hides the phone model in the User-Agent ("K"); client hints give it.
  const uaModel = ua.device.model && ua.device.model !== "K" ? ua.device.model : "";
  const hintModel = clean(hints?.model, 60);
  const deviceModel = [ua.device.vendor, hintModel || uaModel].filter(Boolean).join(" ").trim() || null;

  const deviceId = typeof client.deviceId === "string" && DEVICE_ID.test(client.deviceId) ? client.deviceId : null;

  return {
    ip: getClientIp(req),
    userAgent,
    browserName,
    browserVersion,
    osName,
    osVersion,
    deviceType,
    deviceModel,
    deviceId,
  };
}

const isChrome = (info) => info.browserName === "Chrome";
const isMobile = (info) => info.deviceType === "mobile";

module.exports = { getDeviceInfo, isChrome, isMobile, DEVICE_ID };
