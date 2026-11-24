const axios = require("axios");
const { LOGIN_SECURITY: S } = require("../config/loginSecurity");

// Approximate location (city / region / country) for an IP address, from a free
// IP geolocation service (ipwho.is by default, no key needed). Lookups never
// block or fail a sign-in: on any problem the location is simply left empty.
// Set GEOIP_DISABLED=true to turn lookups off entirely.

const cache = new Map(); // ip -> { value, at }
const CACHE_MS = 6 * 60 * 60 * 1000;
const MAX_CACHE = 2000;

// Loopback and private ranges have no public location.
function isPrivateIp(ip) {
  if (!ip || ip === "unknown") return true;
  if (ip === "127.0.0.1" || ip === "::1" || ip.startsWith("127.")) return true;
  if (/^(10\.|192\.168\.|169\.254\.)/.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  return /^(fc|fd|fe80)/i.test(ip);
}

async function fetchLocation(ip) {
  // An empty IP asks the service about the caller, i.e. this server's own
  // public address. Used only in local development, where the server and the
  // browser share one internet connection.
  const { data } = await axios.get(`${S.geoipUrl}${ip ? encodeURIComponent(ip) : ""}`, {
    timeout: 3000,
    params: { fields: "success,ip,city,region,country,country_code,timezone,connection" },
  });
  if (!data || data.success === false) return null;
  return {
    publicIp: typeof data.ip === "string" ? data.ip : ip,
    city: data.city || null,
    region: data.region || null,
    country: data.country || null,
    countryCode: data.country_code || null,
    timezone: data.timezone?.id || null,
    isp: data.connection?.isp || null,
  };
}

async function lookupLocation(ip) {
  if (S.geoipDisabled) return null;
  let target = ip;
  if (isPrivateIp(ip)) {
    if (process.env.NODE_ENV === "production") return null;
    target = "";
  }
  const key = target || "self";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  try {
    const value = await fetchLocation(target);
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(key, { value, at: Date.now() });
    return value;
  } catch (error) {
    console.warn("Location lookup failed:", error.code || error.message);
    return null;
  }
}

module.exports = { lookupLocation, isPrivateIp };
