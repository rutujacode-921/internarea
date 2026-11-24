import React, { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { api, getApiError } from "@/lib/api";
import { useLanguage } from "@/i18n/LanguageProvider";
import { ChallengeState, PendingChallenge, savePendingChallenge, SignInResult } from "@/lib/signIn";
import { Field, fieldClass, FormError } from "@/Components/AuthLayout";

const countdown = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

type Success = Extract<SignInResult, { status: "success" }>;

// The second step of signing in from Google Chrome: the one-time code sent to
// the account's email. Survives reloads and dropped connections: on a network
// error it asks the server what happened instead of assuming the worst.
export default function LoginOtpStep({
  pending,
  onSuccess,
  onCancel,
}: {
  pending: PendingChallenge;
  onSuccess: (result: Success) => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [challenge, setChallenge] = useState<ChallengeState>(pending.challenge);
  const [deadlines, setDeadlines] = useState(() => {
    const at = Date.now();
    const c = pending.challenge;
    return { otp: at + c.otpExpiresInSeconds * 1000, resend: at + c.resendInSeconds * 1000, challenge: at + c.challengeExpiresInSeconds * 1000 };
  });
  const [now, setNow] = useState(() => Date.now());
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"verify" | "resend" | "refresh" | null>("refresh");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ids = { challengeId: pending.challengeId, challengeToken: pending.challengeToken };

  const apply = useCallback(
    (state: ChallengeState) => {
      const at = Date.now();
      setChallenge(state);
      setDeadlines({
        otp: at + state.otpExpiresInSeconds * 1000,
        resend: at + state.resendInSeconds * 1000,
        challenge: at + state.challengeExpiresInSeconds * 1000,
      });
      savePendingChallenge(state.status === "otp_pending" ? { ...pending, challenge: state } : null);
    },
    [pending]
  );

  const finish = useCallback(
    (data: SignInResult) => {
      if (data.status !== "success") return false;
      savePendingChallenge(null);
      onSuccess(data);
      return true;
    },
    [onSuccess]
  );

  const describe = useCallback(
    (e: unknown) => {
      const err = getApiError(e);
      if (err.code === "NETWORK") return t("errors.network");
      return err.message || t("errors.generic");
    },
    [t]
  );

  // Current state from the server (also completes a sign-in whose reply was lost).
  const refresh = useCallback(async () => {
    setBusy("refresh");
    try {
      const { data } = await api.post("/api/auth/login/challenge", ids);
      if (!finish(data)) apply(data.challenge);
    } catch (e) {
      const err = getApiError(e);
      const state = err.data?.challenge as ChallengeState | undefined;
      if (state) apply(state);
      else if (err.code !== "NETWORK") {
        savePendingChallenge(null);
        setChallenge((c) => ({ ...c, status: "otp_expired" }));
      }
      setError(describe(e));
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apply, finish, describe, pending.challengeId]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending.challengeId]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!/^\d{6}$/.test(code)) return setError(t("language.otp.codeFormat"));
    setBusy("verify");
    setError(null);
    setNotice(null);
    try {
      const { data } = await api.post("/api/auth/login/verify", { ...ids, code });
      finish(data);
    } catch (e) {
      const err = getApiError(e);
      if (err.code === "NETWORK") {
        // The code may have been accepted just before the connection dropped.
        setBusy(null);
        return refresh();
      }
      const state = err.data?.challenge as ChallengeState | undefined;
      if (state) apply(state);
      if (err.code === "LOGIN_CHALLENGE_NOT_FOUND" || err.code === "LOGIN_CHALLENGE_USED") {
        savePendingChallenge(null);
        setChallenge((c) => ({ ...c, status: "otp_expired" }));
      }
      setCode("");
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  };

  const resend = async () => {
    if (busy) return;
    setBusy("resend");
    setError(null);
    setNotice(null);
    try {
      const { data } = await api.post("/api/auth/login/resend", ids);
      apply(data.challenge);
      setCode("");
      setNotice(t("security.otp.resent"));
    } catch (e) {
      const state = getApiError(e).data?.challenge as ChallengeState | undefined;
      if (state) apply(state);
      setError(describe(e));
    } finally {
      setBusy(null);
    }
  };

  const cancel = () => {
    savePendingChallenge(null);
    onCancel();
  };

  const open = challenge.status === "otp_pending" && now < deadlines.challenge;
  const codeExpired = now >= deadlines.otp;
  const resendWait = Math.ceil((deadlines.resend - now) / 1000);

  if (!open && busy !== "refresh") {
    return (
      <div className="space-y-4">
        <FormError message={error || (challenge.status === "otp_locked" ? t("security.otp.locked") : t("security.otp.expired"))} />
        <button type="button" onClick={cancel} className="w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700">
          {t("security.otp.startOver")}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-4" noValidate>
      <div className="flex gap-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
        <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600" />
        <div>
          <p className="font-medium">{t("security.otp.chromeTitle")}</p>
          <p className="mt-1">
            {t(challenge.channel === "sms" ? "security.otp.sentSms" : "security.otp.sentEmail", { destination: challenge.destination })}
          </p>
        </div>
      </div>
      <Field id="login-code" label={t("language.otp.enterCode")}>
        <input
          id="login-code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          disabled={busy === "verify"}
          placeholder={t("language.otp.codePlaceholder")}
          className={`${fieldClass} text-center font-mono text-lg tracking-[0.4em]`}
        />
      </Field>
      <div className="flex flex-wrap justify-between gap-2 text-xs text-gray-500">
        <span className={codeExpired ? "text-red-600" : ""}>
          {codeExpired ? t("security.otp.codeExpired") : t("language.otp.expiresIn", { time: countdown(deadlines.otp - now) })}
        </span>
        <span>{t("security.otp.attemptsLeft", { count: challenge.attemptsLeft })}</span>
      </div>
      {notice && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
      <FormError message={error} />
      <button
        type="submit"
        disabled={busy !== null || codeExpired || code.length !== 6}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {(busy === "verify" || busy === "refresh") && <Loader2 className="h-4 w-4 animate-spin" />}
        {t("security.otp.verify")}
      </button>
      <div className="flex items-center justify-between text-sm">
        <button type="button" onClick={cancel} className="text-gray-600 hover:text-gray-900">
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={resend}
          disabled={busy !== null || resendWait > 0 || challenge.resendsLeft <= 0}
          className="flex items-center gap-1 font-medium text-blue-600 hover:text-blue-700 disabled:cursor-not-allowed disabled:text-gray-400"
        >
          {busy === "resend" && <Loader2 className="h-3 w-3 animate-spin" />}
          {challenge.resendsLeft <= 0
            ? t("security.otp.noResends")
            : resendWait > 0
            ? t("language.otp.resendIn", { seconds: resendWait })
            : t("security.otp.resend", { count: challenge.resendsLeft })}
        </button>
      </div>
      <p className="text-xs text-gray-500">{t("security.otp.windowHint", { time: countdown(deadlines.challenge - now) })}</p>
    </form>
  );
}
