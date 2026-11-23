const { isSupportedLanguage, DEFAULT_LANGUAGE } = require("../config/languages");

// Server-side translations for API error messages and transactional emails.
const messages = {
  en: {
    languageNames: { en: "English", es: "Spanish", hi: "Hindi", pt: "Portuguese", zh: "Chinese", fr: "French" },
    errors: {
      UNAUTHORIZED: "Please sign in to continue.",
      INVALID_TOKEN: "Your session has expired. Please sign in again.",
      UNSUPPORTED_LANGUAGE: "This language is not supported.",
      OTP_REQUIRED: "Switching to {{language}} requires email verification.",
      OTP_NOT_REQUIRED: "{{language}} does not require verification.",
      NO_EMAIL: "Your account has no registered email address.",
      OTP_COOLDOWN: "Please wait {{seconds}} seconds before requesting another code.",
      OTP_RATE_LIMITED: "Too many code requests. Please try again in {{minutes}} minutes.",
      OTP_INVALID_FORMAT: "Please enter the 6-digit code.",
      OTP_NOT_FOUND: "This code is no longer valid. Please request a new one.",
      OTP_USED: "This code has already been used.",
      OTP_EXPIRED: "This code has expired. Please request a new one.",
      OTP_LOCKED: "Too many incorrect attempts. Please request a new code.",
      OTP_INVALID: "Incorrect code. {{attemptsLeft}} attempt(s) left.",
      EMAIL_FAILED: "We couldn't send the verification email. Please try again.",
      SERVER_ERROR: "Something went wrong. Please try again.",
    },
    email: {
      subject: "Your InternArea verification code",
      heading: "Confirm your language change",
      intro: "We received a request to change your InternArea language to {{language}}. Enter this code to confirm:",
      expiry: "This code expires in {{minutes}} minutes and can only be used once.",
      ignore: "If you didn't request this change, you can ignore this email. Your language will not change. Never share this code with anyone.",
    },
  },
  es: {
    languageNames: { en: "inglés", es: "español", hi: "hindi", pt: "portugués", zh: "chino", fr: "francés" },
    errors: {
      UNAUTHORIZED: "Inicia sesión para continuar.",
      INVALID_TOKEN: "Tu sesión ha caducado. Vuelve a iniciar sesión.",
      UNSUPPORTED_LANGUAGE: "Este idioma no está disponible.",
      OTP_REQUIRED: "Cambiar a {{language}} requiere verificación por correo electrónico.",
      OTP_NOT_REQUIRED: "{{language}} no requiere verificación.",
      NO_EMAIL: "Tu cuenta no tiene un correo electrónico registrado.",
      OTP_COOLDOWN: "Espera {{seconds}} segundos antes de solicitar otro código.",
      OTP_RATE_LIMITED: "Demasiadas solicitudes de código. Inténtalo de nuevo en {{minutes}} minutos.",
      OTP_INVALID_FORMAT: "Introduce el código de 6 dígitos.",
      OTP_NOT_FOUND: "Este código ya no es válido. Solicita uno nuevo.",
      OTP_USED: "Este código ya se ha utilizado.",
      OTP_EXPIRED: "Este código ha caducado. Solicita uno nuevo.",
      OTP_LOCKED: "Demasiados intentos incorrectos. Solicita un código nuevo.",
      OTP_INVALID: "Código incorrecto. Te quedan {{attemptsLeft}} intento(s).",
      EMAIL_FAILED: "No pudimos enviar el correo de verificación. Inténtalo de nuevo.",
      SERVER_ERROR: "Algo salió mal. Inténtalo de nuevo.",
    },
    email: {
      subject: "Tu código de verificación de InternArea",
      heading: "Confirma el cambio de idioma",
      intro: "Recibimos una solicitud para cambiar el idioma de InternArea a {{language}}. Introduce este código para confirmarlo:",
      expiry: "Este código caduca en {{minutes}} minutos y solo se puede usar una vez.",
      ignore: "Si no solicitaste este cambio, ignora este correo. Tu idioma no cambiará. No compartas este código con nadie.",
    },
  },
  hi: {
    languageNames: { en: "अंग्रेज़ी", es: "स्पेनिश", hi: "हिन्दी", pt: "पुर्तगाली", zh: "चीनी", fr: "फ़्रेंच" },
    errors: {
      UNAUTHORIZED: "जारी रखने के लिए कृपया साइन इन करें।",
      INVALID_TOKEN: "आपका सत्र समाप्त हो गया है। कृपया फिर से साइन इन करें।",
      UNSUPPORTED_LANGUAGE: "यह भाषा समर्थित नहीं है।",
      OTP_REQUIRED: "{{language}} पर स्विच करने के लिए ईमेल सत्यापन आवश्यक है।",
      OTP_NOT_REQUIRED: "{{language}} के लिए सत्यापन आवश्यक नहीं है।",
      NO_EMAIL: "आपके खाते में कोई पंजीकृत ईमेल पता नहीं है।",
      OTP_COOLDOWN: "नया कोड माँगने से पहले कृपया {{seconds}} सेकंड प्रतीक्षा करें।",
      OTP_RATE_LIMITED: "बहुत अधिक कोड अनुरोध। कृपया {{minutes}} मिनट बाद फिर से प्रयास करें।",
      OTP_INVALID_FORMAT: "कृपया 6 अंकों का कोड दर्ज करें।",
      OTP_NOT_FOUND: "यह कोड अब मान्य नहीं है। कृपया नया कोड माँगें।",
      OTP_USED: "यह कोड पहले ही उपयोग किया जा चुका है।",
      OTP_EXPIRED: "यह कोड समाप्त हो गया है। कृपया नया कोड माँगें।",
      OTP_LOCKED: "बहुत अधिक गलत प्रयास। कृपया नया कोड माँगें।",
      OTP_INVALID: "गलत कोड। {{attemptsLeft}} प्रयास शेष।",
      EMAIL_FAILED: "हम सत्यापन ईमेल नहीं भेज सके। कृपया फिर से प्रयास करें।",
      SERVER_ERROR: "कुछ गलत हो गया। कृपया फिर से प्रयास करें।",
    },
    email: {
      subject: "आपका InternArea सत्यापन कोड",
      heading: "अपनी भाषा बदलने की पुष्टि करें",
      intro: "हमें आपकी InternArea भाषा को {{language}} में बदलने का अनुरोध मिला है। पुष्टि करने के लिए यह कोड दर्ज करें:",
      expiry: "यह कोड {{minutes}} मिनट में समाप्त हो जाएगा और केवल एक बार उपयोग किया जा सकता है।",
      ignore: "यदि आपने यह अनुरोध नहीं किया है, तो इस ईमेल को अनदेखा करें। आपकी भाषा नहीं बदलेगी। यह कोड किसी के साथ साझा न करें।",
    },
  },
  pt: {
    languageNames: { en: "inglês", es: "espanhol", hi: "hindi", pt: "português", zh: "chinês", fr: "francês" },
    errors: {
      UNAUTHORIZED: "Faça login para continuar.",
      INVALID_TOKEN: "Sua sessão expirou. Faça login novamente.",
      UNSUPPORTED_LANGUAGE: "Este idioma não é suportado.",
      OTP_REQUIRED: "Mudar para {{language}} exige verificação por e-mail.",
      OTP_NOT_REQUIRED: "{{language}} não exige verificação.",
      NO_EMAIL: "Sua conta não tem um e-mail cadastrado.",
      OTP_COOLDOWN: "Aguarde {{seconds}} segundos antes de solicitar outro código.",
      OTP_RATE_LIMITED: "Muitas solicitações de código. Tente novamente em {{minutes}} minutos.",
      OTP_INVALID_FORMAT: "Digite o código de 6 dígitos.",
      OTP_NOT_FOUND: "Este código não é mais válido. Solicite um novo.",
      OTP_USED: "Este código já foi usado.",
      OTP_EXPIRED: "Este código expirou. Solicite um novo.",
      OTP_LOCKED: "Muitas tentativas incorretas. Solicite um novo código.",
      OTP_INVALID: "Código incorreto. {{attemptsLeft}} tentativa(s) restante(s).",
      EMAIL_FAILED: "Não foi possível enviar o e-mail de verificação. Tente novamente.",
      SERVER_ERROR: "Algo deu errado. Tente novamente.",
    },
    email: {
      subject: "Seu código de verificação do InternArea",
      heading: "Confirme a mudança de idioma",
      intro: "Recebemos uma solicitação para mudar o idioma do InternArea para {{language}}. Digite este código para confirmar:",
      expiry: "Este código expira em {{minutes}} minutos e só pode ser usado uma vez.",
      ignore: "Se você não solicitou esta mudança, ignore este e-mail. Seu idioma não será alterado. Nunca compartilhe este código.",
    },
  },
  zh: {
    languageNames: { en: "英语", es: "西班牙语", hi: "印地语", pt: "葡萄牙语", zh: "中文", fr: "法语" },
    errors: {
      UNAUTHORIZED: "请登录后继续。",
      INVALID_TOKEN: "您的会话已过期，请重新登录。",
      UNSUPPORTED_LANGUAGE: "不支持该语言。",
      OTP_REQUIRED: "切换到{{language}}需要邮箱验证。",
      OTP_NOT_REQUIRED: "{{language}}无需验证。",
      NO_EMAIL: "您的账户没有注册邮箱。",
      OTP_COOLDOWN: "请等待 {{seconds}} 秒后再申请新验证码。",
      OTP_RATE_LIMITED: "验证码请求过多，请在 {{minutes}} 分钟后重试。",
      OTP_INVALID_FORMAT: "请输入 6 位验证码。",
      OTP_NOT_FOUND: "该验证码已失效，请重新申请。",
      OTP_USED: "该验证码已被使用。",
      OTP_EXPIRED: "该验证码已过期，请重新申请。",
      OTP_LOCKED: "错误次数过多，请重新申请验证码。",
      OTP_INVALID: "验证码错误，还剩 {{attemptsLeft}} 次机会。",
      EMAIL_FAILED: "验证邮件发送失败，请重试。",
      SERVER_ERROR: "出现问题，请重试。",
    },
    email: {
      subject: "您的 InternArea 验证码",
      heading: "确认更改语言",
      intro: "我们收到了将您的 InternArea 语言更改为{{language}}的请求。请输入以下验证码进行确认：",
      expiry: "该验证码将在 {{minutes}} 分钟后过期，且只能使用一次。",
      ignore: "如果这不是您本人的操作，请忽略此邮件，您的语言设置不会更改。请勿将此验证码告诉任何人。",
    },
  },
  fr: {
    languageNames: { en: "anglais", es: "espagnol", hi: "hindi", pt: "portugais", zh: "chinois", fr: "français" },
    errors: {
      UNAUTHORIZED: "Veuillez vous connecter pour continuer.",
      INVALID_TOKEN: "Votre session a expiré. Veuillez vous reconnecter.",
      UNSUPPORTED_LANGUAGE: "Cette langue n'est pas prise en charge.",
      OTP_REQUIRED: "Passer en {{language}} nécessite une vérification par e-mail.",
      OTP_NOT_REQUIRED: "Le {{language}} ne nécessite pas de vérification.",
      NO_EMAIL: "Votre compte n'a pas d'adresse e-mail enregistrée.",
      OTP_COOLDOWN: "Veuillez patienter {{seconds}} secondes avant de demander un nouveau code.",
      OTP_RATE_LIMITED: "Trop de demandes de code. Réessayez dans {{minutes}} minutes.",
      OTP_INVALID_FORMAT: "Veuillez saisir le code à 6 chiffres.",
      OTP_NOT_FOUND: "Ce code n'est plus valide. Veuillez en demander un nouveau.",
      OTP_USED: "Ce code a déjà été utilisé.",
      OTP_EXPIRED: "Ce code a expiré. Veuillez en demander un nouveau.",
      OTP_LOCKED: "Trop de tentatives incorrectes. Veuillez demander un nouveau code.",
      OTP_INVALID: "Code incorrect. {{attemptsLeft}} tentative(s) restante(s).",
      EMAIL_FAILED: "Impossible d'envoyer l'e-mail de vérification. Veuillez réessayer.",
      SERVER_ERROR: "Une erreur s'est produite. Veuillez réessayer.",
    },
    email: {
      subject: "Votre code de vérification InternArea",
      heading: "Confirmez le changement de langue",
      intro: "Nous avons reçu une demande pour passer votre langue InternArea en {{language}}. Saisissez ce code pour confirmer :",
      expiry: "Ce code expire dans {{minutes}} minutes et ne peut être utilisé qu'une seule fois.",
      ignore: "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail. Votre langue ne sera pas modifiée. Ne partagez jamais ce code.",
    },
  },
};

const interpolate = (text, vars = {}) =>
  text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) =>
    vars[key] !== undefined ? String(vars[key]) : match
  );

// Looks up a dotted key, falling back to English if a translation is missing.
function translate(lang, key, vars) {
  const find = (code) =>
    key.split(".").reduce((node, part) => (node ? node[part] : undefined), messages[code]);
  let value = find(isSupportedLanguage(lang) ? lang : DEFAULT_LANGUAGE);
  if (typeof value !== "string") value = find(DEFAULT_LANGUAGE);
  if (typeof value !== "string") return key;
  return interpolate(value, vars);
}

const languageName = (uiLang, code) => translate(uiLang, `languageNames.${code}`);

// Picks the UI language from the X-UI-Language header, then Accept-Language.
function getRequestLanguage(req) {
  const explicit = (req.headers["x-ui-language"] || "").toString().toLowerCase();
  if (isSupportedLanguage(explicit)) return explicit;
  const accepted = (req.headers["accept-language"] || "")
    .split(",")
    .map((part) => part.split(";")[0].trim().slice(0, 2).toLowerCase());
  return accepted.find(isSupportedLanguage) || DEFAULT_LANGUAGE;
}

module.exports = { translate, languageName, getRequestLanguage };
