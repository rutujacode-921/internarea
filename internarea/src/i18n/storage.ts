import { isSupportedLanguage, languageRequiresOtp, LanguageCode } from "./config";

const LANGUAGE_KEY = "internarea.language";
const PENDING_SYNC_KEY = "internarea.language.pendingSync";

export const LANGUAGE_STORAGE_KEY = LANGUAGE_KEY;

export function readStoredLanguage(): LanguageCode | null {
  try {
    const value = window.localStorage.getItem(LANGUAGE_KEY);
    return isSupportedLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

// Saves the language in browser storage and a cookie so it survives reloads.
export function writeStoredLanguage(language: LanguageCode) {
  try {
    window.localStorage.setItem(LANGUAGE_KEY, language);
  } catch {
    // Storage can be unavailable (private mode); the cookie is a fallback.
  }
  try {
    document.cookie = `NEXT_LOCALE=${language}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {
    // Ignore.
  }
}

// First-visit default: the browser's preferred language, if supported.
// OTP-protected languages are never auto-selected.
export function detectBrowserLanguage(): LanguageCode | null {
  try {
    const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const tag of preferred) {
      const code = tag?.slice(0, 2).toLowerCase();
      if (isSupportedLanguage(code) && !languageRequiresOtp(code)) return code;
    }
  } catch {
    // Ignore.
  }
  return null;
}

// A language change that couldn't reach the server because of a network
// problem. It is retried when the connection comes back.
export interface PendingSync {
  uid: string;
  language: LanguageCode;
  at: number;
}

export function readPendingSync(): PendingSync | null {
  try {
    const raw = window.localStorage.getItem(PENDING_SYNC_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.uid === "string" &&
      isSupportedLanguage(parsed.language) &&
      !languageRequiresOtp(parsed.language)
    ) {
      return parsed;
    }
  } catch {
    // Corrupt value; fall through and clear it.
  }
  clearPendingSync();
  return null;
}

export function writePendingSync(value: PendingSync) {
  try {
    window.localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(value));
  } catch {
    // Ignore.
  }
}

export function clearPendingSync() {
  try {
    window.localStorage.removeItem(PENDING_SYNC_KEY);
  } catch {
    // Ignore.
  }
}
