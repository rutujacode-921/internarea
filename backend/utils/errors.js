const { translate, getRequestLanguage } = require("../i18n/messages");

// Sends a JSON error with a stable machine-readable code and a message
// translated into the caller's UI language.
function sendError(req, res, status, code, vars = {}, extra = {}) {
  const lang = getRequestLanguage(req);
  return res.status(status).json({
    code,
    message: translate(lang, `errors.${code}`, vars),
    ...extra,
  });
}

module.exports = { sendError };

// Wraps an async route so unexpected errors become a localized 500.
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((error) => {
    console.error(`API error on ${req.method} ${req.originalUrl}:`, error);
    if (!res.headersSent) sendError(req, res, 500, "SERVER_ERROR");
  });

module.exports.asyncHandler = asyncHandler;
