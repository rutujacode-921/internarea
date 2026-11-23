// Supported languages. Keep in sync with backend/config/languages.js.
export const LANGUAGES = [
  { code: "en", nativeName: "English", englishName: "English", locale: "en-US", requiresOtp: false },
  { code: "es", nativeName: "Español", englishName: "Spanish", locale: "es-ES", requiresOtp: false },
  { code: "hi", nativeName: "हिन्दी", englishName: "Hindi", locale: "hi-IN", requiresOtp: false },
  { code: "pt", nativeName: "Português", englishName: "Portuguese", locale: "pt-BR", requiresOtp: false },
  { code: "zh", nativeName: "中文", englishName: "Chinese", locale: "zh-CN", requiresOtp: false },
  // French may only be activated after email OTP verification.
  { code: "fr", nativeName: "Français", englishName: "French", locale: "fr-FR", requiresOtp: true },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];
export type LanguageInfo = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: LanguageCode = "en";

export const isSupportedLanguage = (value: unknown): value is LanguageCode =>
  LANGUAGES.some((lang) => lang.code === value);

export const getLanguageInfo = (code: LanguageCode): LanguageInfo =>
  LANGUAGES.find((lang) => lang.code === code) ?? LANGUAGES[0];

export const languageRequiresOtp = (code: LanguageCode) => getLanguageInfo(code).requiresOtp;
