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
