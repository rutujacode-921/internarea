import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { selectuser } from "@/Feature/Userslice";
import { hasActiveSession } from "@/lib/session";
import { api, getApiError, isNetworkError, setApiUiLanguage } from "@/lib/api";
import LanguageOtpModal from "@/Components/LanguageOtpModal";
import en from "./locales/en.json";
import {
  DEFAULT_LANGUAGE,
  getLanguageInfo,
  isSupportedLanguage,
  languageRequiresOtp,
  LanguageCode,
  LANGUAGES,
} from "./config";
import { loadMessages, Messages, translate, TranslateFn } from "./messages";
import {
  clearPendingSync,
  detectBrowserLanguage,
  LANGUAGE_STORAGE_KEY,
  readPendingSync,
  readStoredLanguage,
  writePendingSync,
  writeStoredLanguage,
} from "./storage";

export type ChangeLanguageResult =
  | "applied"
  | "unchanged"
  | "otp_required"
  | "login_required"
  | "error";

interface LanguageContextValue {
  language: LanguageCode;
  locale: string;
  languages: typeof LANGUAGES;
  t: TranslateFn;
  changeLanguage: (language: LanguageCode) => Promise<ChangeLanguageResult>;
  switchingTo: LanguageCode | null;
  formatDate: (value: unknown, options?: Intl.DateTimeFormatOptions) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const user = useSelector(selectuser) as { uid?: string } | null;
  const uid = user?.uid ?? null;

  // Start in English on both server and client to avoid hydration mismatches;
  // the saved language is applied right after mount.
  const [state, setState] = useState<{ language: LanguageCode; messages: Messages }>({
    language: DEFAULT_LANGUAGE,
    messages: en,
  });
  const [switchingTo, setSwitchingTo] = useState<LanguageCode | null>(null);
  const [otpTarget, setOtpTarget] = useState<LanguageCode | null>(null);

  const stateRef = useRef(state);
  stateRef.current = state;
  const uidRef = useRef(uid);
  uidRef.current = uid;
  const applySeq = useRef(0);

  // Translates with whatever language is active right now (safe in callbacks).
  const tNow: TranslateFn = useCallback(
    (key, vars) => translate(stateRef.current.messages, stateRef.current.language, key, vars),
    []
  );

  // Switches the UI in place. No reload, so the page, form state and session stay.
  const applyLanguage = useCallback(
    async (language: LanguageCode, { persist = true } = {}): Promise<boolean> => {
      const seq = ++applySeq.current;
      const messages = await loadMessages(language);
      if (seq !== applySeq.current) return false; // A newer switch won the race.
      stateRef.current = { language, messages };
      setState({ language, messages });
      setApiUiLanguage(language);
      document.documentElement.lang = getLanguageInfo(language).locale;
      if (persist) writeStoredLanguage(language);
      return true;
    },
    []
  );

  // Apply the language saved in this browser (or the browser's own preference).
  useEffect(() => {
    const initial = readStoredLanguage() ?? detectBrowserLanguage() ?? DEFAULT_LANGUAGE;
    if (initial === DEFAULT_LANGUAGE) return;
    applyLanguage(initial).catch(() => {
      toast.error(
        translate(en, "en", "language.loadFailed", { language: getLanguageInfo(initial).nativeName })
      );
    });
  }, [applyLanguage]);

  // The profile is the source of truth for signed-in users, so the language
  // follows them across devices. Changes made offline are pushed first.
  const syncWithServer = useCallback(async () => {
    const currentUid = uidRef.current;
    if (!currentUid || !hasActiveSession()) return;

    const pending = readPendingSync();
    if (pending && pending.uid === currentUid) {
      try {
        await api.put("/api/language/preference", { language: pending.language, method: "sync" });
        clearPendingSync();
        return;
      } catch (error) {
        if (isNetworkError(error)) return; // Still offline; try again later.
        clearPendingSync();
      }
    }

    try {
      const { data } = await api.get("/api/language/preference");
      if (uidRef.current !== currentUid) return;

      if (isSupportedLanguage(data?.language)) {
        if (data.language !== stateRef.current.language) await applyLanguage(data.language);
        return;
      }

      // No saved preference yet: seed it from this device. A protected language
      // is never seeded, because that would skip OTP verification.
      const local = stateRef.current.language;
      const seed = languageRequiresOtp(local) ? DEFAULT_LANGUAGE : local;
      const res = await api.put("/api/language/preference", { language: seed, method: "initial" });
      if (isSupportedLanguage(res.data?.language) && res.data.language !== stateRef.current.language) {
        await applyLanguage(res.data.language);
      }
    } catch (error) {
      if (!isNetworkError(error)) console.warn("[i18n] Could not sync language preference", error);
    }
  }, [applyLanguage]);

  useEffect(() => {
    if (uid) {
      syncWithServer();
    } else {
      setOtpTarget(null); // Signed out mid-verification.
    }
  }, [uid, syncWithServer]);

  useEffect(() => {
    let lastSync = 0;
    const onOnline = () => syncWithServer();
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastSync > 30_000) {
        lastSync = Date.now();
        syncWithServer();
      }
    };
    // Keep other open tabs in step with this one.
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === LANGUAGE_STORAGE_KEY &&
        isSupportedLanguage(event.newValue) &&
        event.newValue !== stateRef.current.language
      ) {
        applyLanguage(event.newValue, { persist: false }).catch(() => {});
      }
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", onStorage);
    };
  }, [syncWithServer, applyLanguage]);

  const changeLanguage = useCallback(
    async (language: LanguageCode): Promise<ChangeLanguageResult> => {
      if (!isSupportedLanguage(language)) {
        toast.error(tNow("language.unsupported"));
        return "error";
      }
      if (language === stateRef.current.language) return "unchanged";

      const info = getLanguageInfo(language);
      if (info.requiresOtp && (!uidRef.current || !hasActiveSession())) {
        toast.info(tNow("language.loginRequired", { language: info.nativeName }));
        return "login_required";
      }

      setSwitchingTo(language);
      try {
        // Download the translations first, so a failure never leaves the UI
        // half-translated or burns an OTP that can't be used.
        let messages: Messages;
        try {
          messages = await loadMessages(language);
        } catch {
          toast.error(tNow("language.loadFailed", { language: info.nativeName }));
          return "error";
        }

        if (info.requiresOtp) {
          setOtpTarget(language);
          return "otp_required";
        }

        let savedOffline = false;
        if (uidRef.current && hasActiveSession()) {
          try {
            await api.put("/api/language/preference", { language, method: "direct" });
            clearPendingSync();
          } catch (error) {
            if (isNetworkError(error)) {
              writePendingSync({ uid: uidRef.current, language, at: Date.now() });
              savedOffline = true;
            } else {
              toast.error(getApiError(error).message || tNow("language.syncFailed"));
              return "error";
            }
          }
        }

        const applied = await applyLanguage(language);
        if (!applied) return "unchanged";
        if (savedOffline) {
          toast.info(translate(messages, language, "language.savedLocally"));
        } else {
          toast.success(translate(messages, language, "language.changed", { language: info.nativeName }));
        }
        return "applied";
      } finally {
        setSwitchingTo(null);
      }
    },
    [applyLanguage, tNow]
  );

  const handleOtpVerified = useCallback(
    async (language: LanguageCode) => {
      setOtpTarget(null);
      clearPendingSync(); // An older offline change must not overwrite this one.
      const info = getLanguageInfo(language);
      try {
        const messages = await loadMessages(language);
        await applyLanguage(language);
        toast.success(translate(messages, language, "language.changed", { language: info.nativeName }));
      } catch {
        toast.error(tNow("language.loadFailed", { language: info.nativeName }));
      }
    },
    [applyLanguage, tNow]
  );

  const t: TranslateFn = useCallback(
    (key, vars) => translate(state.messages, state.language, key, vars),
    [state]
  );

  const locale = getLanguageInfo(state.language).locale;

  const formatDate = useCallback(
    (value: unknown, options: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric" }) => {
      if (value === null || value === undefined || value === "") return "";
      const date = new Date(value as string);
      if (Number.isNaN(date.getTime())) return String(value);
      // Plain dates like "2025-04-01" are calendar days; don't shift them by time zone.
      const opts = typeof value === "string" && DATE_ONLY.test(value) ? { ...options, timeZone: "UTC" } : options;
      try {
        return new Intl.DateTimeFormat(locale, opts).format(date);
      } catch {
        return date.toLocaleDateString();
      }
    },
    [locale]
  );

  const value = useMemo<LanguageContextValue>(
    () => ({
      language: state.language,
      locale,
      languages: LANGUAGES,
      t,
      changeLanguage,
      switchingTo,
      formatDate,
    }),
    [state.language, locale, t, changeLanguage, switchingTo, formatDate]
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
      {otpTarget && (
        <LanguageOtpModal
          targetLanguage={otpTarget}
          onCancel={() => setOtpTarget(null)}
          onVerified={handleOtpVerified}
        />
      )}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used inside <LanguageProvider>");
  return context;
}

export const useTranslation = () => useLanguage().t;
