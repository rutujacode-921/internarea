import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, Mail, Smartphone, XCircle } from "lucide-react";
import { api, getApiError, isNetworkError } from "@/lib/api";
import { useLanguage } from "@/i18n/LanguageProvider";
import { AuthCard, Field, fieldClass, FormError } from "@/Components/AuthLayout";

type Method = "email" | "phone";
type Status = "otp_sent" | "verified" | "completed" | "delivery_failed" | "expired" | "locked";

interface ResetState {
  requestId: string;
  method: Method;
  destination: string;
  status: Status;
  otpExpiresInSeconds: number;
  resendInSeconds: number;
  resendsLeft: number;
  attemptsLeft: number;
  sessionExpiresInSeconds: number;
  canRetryDelivery: boolean;
}

// The open request is kept for this tab, so a reload or dropped connection resumes it.
const STORAGE_KEY = "internarea.passwordReset";
const remember = (id: string | null) => {
  try {
    if (id) sessionStorage.setItem(STORAGE_KEY, id);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable.
  }
};
const recall = () => {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const countdown = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

export default function ForgotPasswordPage() {
  const { t, formatDate } = useLanguage();
  const [method, setMethod] = useState<Method>("email");
  const [identifier, setIdentifier] = useState("");
  const [reset, setReset] = useState<ResetState | null>(null);
  // Absolute deadlines, so countdowns don't drift.
  const [deadlines, setDeadlines] = useState({ otp: 0, resend: 0, session: 0 });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedUntil, setBlockedUntil] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [restoring, setRestoring] = useState(true);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const apply = useCallback((state: ResetState) => {
    const at = Date.now();
    setReset(state);
    setDeadlines({
      otp: at + state.otpExpiresInSeconds * 1000,
      resend: at + state.resendInSeconds * 1000,
      session: at + state.sessionExpiresInSeconds * 1000,
    });
    remember(["otp_sent", "verified", "delivery_failed"].includes(state.status) ? state.requestId : null);
  }, []);

  const messageFor = useCallback(
    (e: unknown) => {
      const err = getApiError(e);
      if (err.code === "NETWORK") return t("errors.network");
      if (err.code === "OTP_INVALID") return t("language.otp.invalid", { attempts: Number(err.data?.attemptsLeft ?? 0) });
      return err.message || t("errors.generic");
    },
    [t]
  );

  // Applies the request state included in an error response, if any.
  const applyFromError = useCallback(
    (e: unknown) => {
      const state = getApiError(e).data?.reset as ResetState | undefined;
      if (state) apply(state);
    },
    [apply]
  );

  // Resume an open request after a reload.
  useEffect(() => {
    const id = recall();
    if (!id) return setRestoring(false);
    api
      .get(`/api/auth/forgot/${id}`)
      .then(({ data }) => apply(data.reset))
      .catch(() => remember(null))
      .finally(() => setRestoring(false));
  }, [apply]);

  const refresh = useCallback(async () => {
    if (!reset) return null;
    try {
      const { data } = await api.get(`/api/auth/forgot/${reset.requestId}`);
      apply(data.reset);
      return data.reset as ResetState;
    } catch {
      return null;
    }
  }, [reset, apply]);

  const request = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!identifier.trim()) return setError(method === "email" ? t("account.forgot.enterEmail") : t("account.forgot.enterPhone"));
    setBusy(true);
    setError(null);
    setBlockedUntil(null);
    try {
      const { data } = await api.post("/api/auth/forgot/request", { method, identifier: identifier.trim() });
      apply(data.reset);
      setCode("");
      setTimeout(() => codeRef.current?.focus(), 0);
    } catch (e) {
      const err = getApiError(e);
      if (err.code === "DAILY_LIMIT" && typeof err.data?.availableAt === "string") setBlockedUntil(err.data.availableAt);
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reset) return;
    if (!/^\d{6}$/.test(code)) return setError(t("language.otp.codeFormat"));
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post("/api/auth/forgot/verify", { requestId: reset.requestId, code });
      apply(data.reset);
    } catch (e) {
      // If the connection dropped, the server may have finished anyway: check.
      if (isNetworkError(e)) {
        const state = await refresh();
        if (state && state.status !== "otp_sent") return setBusy(false);
      }
      applyFromError(e);
      if (getApiError(e).code === "OTP_INVALID") setCode("");
      setError(messageFor(e));
      setTimeout(() => codeRef.current?.focus(), 0);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!reset) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post("/api/auth/forgot/resend", { requestId: reset.requestId });
      apply(data.reset);
      setCode("");
      setTimeout(() => codeRef.current?.focus(), 0);
    } catch (e) {
      applyFromError(e);
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  };

  const retryDelivery = async () => {
    if (!reset) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post("/api/auth/forgot/deliver", { requestId: reset.requestId });
      apply(data.reset);
    } catch (e) {
      if (isNetworkError(e)) await refresh();
      applyFromError(e);
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  };

  const startOver = () => {
    remember(null);
    setReset(null);
    setCode("");
    setError(null);
  };

  if (restoring) {
    return (
      <AuthCard title={t("account.forgot.title")}>
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-blue-600" />
      </AuthCard>
    );
  }

  // ---- Step 1: email or mobile number ----------------------------------------
  if (!reset) {
    return (
      <AuthCard title={t("account.forgot.title")} subtitle={t("account.forgot.subtitle")}>
        <form onSubmit={request} className="space-y-4" noValidate>
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-100 p-1" role="radiogroup" aria-label={t("account.forgot.methodLabel")}>
            {(["email", "phone"] as Method[]).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={method === m}
                onClick={() => {
                  setMethod(m);
                  setIdentifier("");
                  setError(null);
                  setBlockedUntil(null);
                }}
                className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${method === m ? "bg-white text-blue-700 shadow" : "text-gray-600 hover:text-gray-900"}`}
              >
                {m === "email" ? <Mail className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
                {m === "email" ? t("account.forgot.byEmail") : t("account.forgot.byPhone")}
              </button>
            ))}
          </div>
          <Field id="identifier" label={method === "email" ? t("account.fields.email") : t("account.fields.phone")}>
            <input
              id="identifier"
              type={method === "email" ? "email" : "tel"}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete={method === "email" ? "email" : "tel"}
              placeholder={method === "email" ? "you@example.com" : "98765 43210"}
              maxLength={method === "email" ? 120 : 20}
              className={fieldClass}
            />
          </Field>
          <p className="text-xs text-gray-500">{t("account.forgot.onceADayNote")}</p>
          <FormError message={error} />
          {blockedUntil && (
            <p className="-mt-2 text-xs text-gray-600">
              {t("account.forgot.availableAgain", {
                date: formatDate(blockedUntil, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
              })}
            </p>
          )}
          <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("account.forgot.sendCode")}
          </button>
        </form>
        <p className="mt-6 text-center text-sm">
          <Link href="/login" className="font-medium text-blue-600 hover:text-blue-700">
            {t("account.forgot.backToLogin")}
          </Link>
        </p>
      </AuthCard>
    );
  }

  const channel = reset.method === "email" ? t("account.forgot.channelEmail") : t("account.forgot.channelSms");

  // ---- Step 3: finished --------------------------------------------------------
  if (reset.status === "completed") {
    return (
      <AuthCard title={t("account.forgot.doneTitle")}>
        <div className="flex items-start gap-3 rounded-lg bg-green-50 p-4 text-green-800" role="status">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <p>{t("account.forgot.done", { channel, destination: reset.destination })}</p>
        </div>
        <p className="mt-4 text-sm text-gray-600">{t("account.forgot.doneNext")}</p>
        <Link href="/login" onClick={() => remember(null)} className="mt-6 block w-full rounded-lg bg-blue-600 px-4 py-2 text-center font-medium text-white hover:bg-blue-700">
          {t("account.forgot.goToLogin")}
        </Link>
      </AuthCard>
    );
  }

  // ---- Dead ends: expired or locked --------------------------------------------
  if (reset.status === "expired" || reset.status === "locked") {
    return (
      <AuthCard title={t("account.forgot.title")}>
        <div className="flex items-start gap-3 rounded-lg bg-red-50 p-4 text-red-800" role="alert">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <p>{reset.status === "expired" ? t("account.forgot.expired") : t("account.forgot.locked")}</p>
        </div>
        <p className="mt-4 text-sm text-gray-600">{t("account.forgot.oldPasswordWorks")}</p>
        <div className="mt-6 flex flex-col gap-2">
          <Link href="/login" onClick={startOver} className="rounded-lg bg-blue-600 px-4 py-2 text-center font-medium text-white hover:bg-blue-700">
            {t("account.forgot.goToLogin")}
          </Link>
          <button type="button" onClick={startOver} className="text-sm text-gray-600 hover:text-gray-900">
            {t("account.forgot.startOver")}
          </button>
        </div>
      </AuthCard>
    );
  }

  // ---- Code accepted but the new password couldn't be sent --------------------
  if (reset.status === "delivery_failed" || reset.status === "verified") {
    return (
      <AuthCard title={t("account.forgot.title")}>
        {reset.status === "verified" ? (
          <p className="flex items-center gap-2 text-gray-700" role="status">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("account.forgot.sendingPassword")}
          </p>
        ) : (
          <>
            <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900" role="alert">
              {t("account.forgot.deliveryFailed", { channel })}
            </p>
            <FormError message={error} />
            {reset.canRetryDelivery ? (
              <button type="button" onClick={retryDelivery} disabled={busy} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("account.forgot.retryDelivery")}
              </button>
            ) : (
              <p className="mt-4 text-sm text-gray-600">{t("account.forgot.noMoreRetries")}</p>
            )}
          </>
        )}
        {reset.status === "verified" && (
          <button type="button" onClick={refresh} className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-700">
            {t("account.forgot.checkAgain")}
          </button>
        )}
      </AuthCard>
    );
  }

  // ---- Step 2: enter the code --------------------------------------------------
  const otpExpired = now >= deadlines.otp;
  const canResend = !busy && reset.resendsLeft > 0 && now >= deadlines.resend;
  return (
    <AuthCard title={t("account.forgot.verifyTitle")}>
      <form onSubmit={verify} className="space-y-4" noValidate>
        <div className="flex items-center gap-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
          {reset.method === "email" ? <Mail className="h-4 w-4 shrink-0" /> : <Smartphone className="h-4 w-4 shrink-0" />}
          <span>{t("account.forgot.codeSent", { channel, destination: reset.destination })}</span>
        </div>
        <Field id="code" label={t("language.otp.enterCode")}>
          <input
            ref={codeRef}
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            disabled={otpExpired || busy}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
              setError(null);
            }}
            placeholder={t("language.otp.codePlaceholder")}
            className={`${fieldClass} text-center text-2xl tracking-[0.5em]`}
          />
        </Field>
        <div className="flex flex-wrap justify-between gap-2 text-xs text-gray-500">
          <span>{otpExpired ? t("language.otp.expired") : t("language.otp.expiresIn", { time: countdown(deadlines.otp - now) })}</span>
          <span>{t("account.forgot.attemptsLeft", { count: reset.attemptsLeft })}</span>
        </div>
        <FormError message={error} />
        <button type="submit" disabled={busy || otpExpired || code.length !== 6} className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("account.forgot.verify")}
        </button>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button type="button" onClick={resend} disabled={!canResend} className="font-medium text-blue-600 hover:text-blue-700 disabled:cursor-not-allowed disabled:text-gray-400">
            {reset.resendsLeft === 0
              ? t("account.forgot.noResends")
              : now < deadlines.resend
              ? t("language.otp.resendIn", { seconds: Math.ceil((deadlines.resend - now) / 1000) })
              : t("account.forgot.resend", { count: reset.resendsLeft })}
          </button>
          <span className="text-xs text-gray-500">{t("account.forgot.requestExpiresIn", { time: countdown(deadlines.session - now) })}</span>
        </div>
      </form>
    </AuthCard>
  );
}
