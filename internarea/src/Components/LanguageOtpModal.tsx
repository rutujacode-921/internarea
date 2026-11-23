import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mail, ShieldCheck, X } from "lucide-react";
import { api, getApiError } from "@/lib/api";
import { getLanguageInfo, LanguageCode } from "@/i18n/config";
import { useLanguage } from "@/i18n/LanguageProvider";

interface Props {
  targetLanguage: LanguageCode;
  onCancel: () => void;
  onVerified: (language: LanguageCode) => void;
}

interface ActiveOtp {
  id: string;
  expiresAt: number;
  maskedEmail: string;
}

// Codes that mean the current OTP can no longer be used and a new one is needed.
const DEAD_CODE_ERRORS = ["OTP_EXPIRED", "OTP_LOCKED", "OTP_USED", "OTP_NOT_FOUND"];

const formatCountdown = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

// Asks for the emailed one-time password before a protected language (French)
// is applied. It is shown in the user's current language.
export default function LanguageOtpModal({ targetLanguage, onCancel, onVerified }: Props) {
  const { t } = useLanguage();
  const info = getLanguageInfo(targetLanguage);

  const [otp, setOtp] = useState<ActiveOtp | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<"sending" | "ready" | "verifying" | "success">("sending");
  const [error, setError] = useState<string | null>(null);
  const [codeDead, setCodeDead] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const sentOnce = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const describeError = useCallback(
    (error: unknown) => {
      const err = getApiError(error);
      const retryAfter = Number(err.data?.retryAfter) || 0;
      switch (err.code) {
        case "NETWORK":
          return t("language.otp.networkError");
        case "OTP_INVALID":
          return t("language.otp.invalid", { attempts: Number(err.data?.attemptsLeft ?? 0) });
        case "OTP_EXPIRED":
          return t("language.otp.expired");
        case "OTP_LOCKED":
          return t("language.otp.locked");
        case "OTP_USED":
          return t("language.otp.used");
        case "OTP_NOT_FOUND":
          return t("language.otp.notFound");
        case "OTP_COOLDOWN":
          return t("language.otp.cooldown", { seconds: retryAfter || 60 });
        case "OTP_RATE_LIMITED":
          return t("language.otp.rateLimited", { minutes: Math.ceil((retryAfter || 3600) / 60) });
        case "EMAIL_FAILED":
          return t("language.otp.emailFailed");
        case "NO_EMAIL":
          return t("language.otp.noEmail");
        case "OTP_INVALID_FORMAT":
          return t("language.otp.codeFormat");
        case "UNAUTHORIZED":
        case "INVALID_TOKEN":
          return t("errors.unauthorized");
        default:
          return err.message || t("errors.generic");
      }
    },
    [t]
  );

  const sendCode = useCallback(async () => {
    setPhase("sending");
    setError(null);
    try {
      const { data } = await api.post("/api/language/otp", { language: targetLanguage });
      if (data.alreadyActive) {
        onVerified(targetLanguage);
        return;
      }
      const sentAt = Date.now();
      setOtp({
        id: data.otpId,
        expiresAt: sentAt + Number(data.expiresInSeconds || 300) * 1000,
        maskedEmail: data.maskedEmail,
      });
      setResendAt(sentAt + Number(data.resendInSeconds || 60) * 1000);
      setCode("");
      setCodeDead(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch (error) {
      const retryAfter = Number(getApiError(error).data?.retryAfter) || 0;
      if (retryAfter) setResendAt(Date.now() + retryAfter * 1000);
      setError(describeError(error));
    } finally {
      setPhase((current) => (current === "sending" ? "ready" : current));
    }
  }, [targetLanguage, onVerified, describeError]);

  // Send the first code as soon as the user picks the language.
  useEffect(() => {
    if (sentOnce.current) return;
    sentOnce.current = true;
    sendCode();
  }, [sendCode]);

  const expired = Boolean(otp && now >= otp.expiresAt);
  const canResend = phase !== "sending" && phase !== "verifying" && now >= resendAt;
  const canVerify =
    Boolean(otp) && !codeDead && !expired && phase === "ready" && code.length === 6;

  const verify = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!otp || phase !== "ready") return;
    if (!/^\d{6}$/.test(code)) {
      setError(t("language.otp.codeFormat"));
      return;
    }
    if (Date.now() >= otp.expiresAt) {
      setCodeDead(true);
      setError(t("language.otp.expired"));
      return;
    }

    setPhase("verifying");
    setError(null);
    try {
      await api.post("/api/language/otp/verify", { otpId: otp.id, code });
      setPhase("success");
      onVerified(targetLanguage);
    } catch (error) {
      const err = getApiError(error);
      // If the connection dropped after the server accepted the code, the
      // change is already saved; check before reporting a failure.
      if (err.code === "NETWORK" || err.code === "OTP_USED") {
        try {
          const { data } = await api.get("/api/language/preference");
          if (data?.language === targetLanguage) {
            setPhase("success");
            onVerified(targetLanguage);
            return;
          }
        } catch {
          // Fall through to the original error.
        }
      }
      if (DEAD_CODE_ERRORS.includes(err.code)) setCodeDead(true);
      if (err.code === "OTP_INVALID") setCode("");
      setError(describeError(error));
      setPhase("ready");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && phase !== "verifying") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onCancel]);

  const shownError = error ?? (expired && !codeDead ? t("language.otp.expired") : null);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="language-otp-title"
    >
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="flex items-start justify-between border-b p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-blue-600" />
            <h2 id="language-otp-title" className="text-lg font-semibold text-gray-900">
              {t("language.otp.title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={phase === "verifying"}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
            aria-label={t("common.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={verify} className="space-y-4 p-5" noValidate>
          <p className="text-sm text-gray-600">
            {t("language.otp.description", { language: info.nativeName })}
          </p>

          {phase === "sending" && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("language.otp.sending")}
            </div>
          )}

          {otp && phase !== "sending" && (
            <>
              <div className="flex items-center gap-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
                <Mail className="h-4 w-4 shrink-0" />
                <span>{t("language.otp.sentTo", { email: otp.maskedEmail })}</span>
              </div>
              <div>
                <label htmlFor="language-otp-code" className="mb-1 block text-sm font-medium text-gray-700">
                  {t("language.otp.enterCode")}
                </label>
                <input
                  ref={inputRef}
                  id="language-otp-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  disabled={codeDead || expired || phase !== "ready"}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                    if (error && !codeDead) setError(null);
                  }}
                  placeholder={t("language.otp.codePlaceholder")}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-center text-2xl tracking-[0.5em] text-black focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                />
                {!expired && !codeDead && (
                  <p className="mt-1 text-xs text-gray-500">
                    {t("language.otp.expiresIn", { time: formatCountdown(otp.expiresAt - now) })}
                  </p>
                )}
              </div>
            </>
          )}

          {shownError && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {shownError}
            </p>
          )}

          {phase === "success" && (
            <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{t("language.otp.success")}</p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={sendCode}
              disabled={!canResend}
              className="text-sm font-medium text-blue-600 hover:text-blue-700 disabled:cursor-not-allowed disabled:text-gray-400"
            >
              {now < resendAt
                ? t("language.otp.resendIn", { seconds: Math.ceil((resendAt - now) / 1000) })
                : t("language.otp.resend")}
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={phase === "verifying"}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={!canVerify}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {phase === "verifying" && <Loader2 className="h-4 w-4 animate-spin" />}
                {phase === "verifying" ? t("language.otp.verifying") : t("language.otp.verify")}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
