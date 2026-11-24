import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { toast } from "react-toastify";
import { Clock } from "lucide-react";
import { getApiError } from "@/lib/api";
import { startSession } from "@/lib/session";
import { useLanguage } from "@/i18n/LanguageProvider";
import { PendingChallenge, readPendingChallenge, savePendingChallenge, SignInResult } from "@/lib/signIn";
import LoginOtpStep from "@/Components/LoginOtpStep";

// What the log-in and sign-up pages do with a sign-in reply: start the session,
// or show the Chrome OTP step. Also turns errors into messages.
export function useSignInFlow({ successMessage }: { successMessage: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, setPending] = useState<PendingChallenge | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  const next = typeof router.query.next === "string" && router.query.next.startsWith("/") ? router.query.next : "/";

  // Resume an OTP step that was open before a reload.
  useEffect(() => {
    const saved = readPendingChallenge();
    if (saved) setPending(saved);
  }, []);

  const onSuccess = useCallback(
    (data: Extract<SignInResult, { status: "success" }>, goTo?: string) => {
      startSession(data.token, data.user);
      toast.success(successMessage);
      if (data.user.mustChangePassword) router.replace("/change-password");
      else router.push(goTo || next);
    },
    [router, next, successMessage]
  );

  const handleResult = useCallback(
    (data: SignInResult) => {
      setBlocked(null);
      if (data.status === "success") return onSuccess(data);
      const challenge = { challengeId: data.challenge.challengeId, challengeToken: data.challengeToken, challenge: data.challenge, next };
      savePendingChallenge(challenge);
      setPending(challenge);
    },
    [onSuccess, next]
  );

  // Returns a message for the form, or shows the mobile-hours notice.
  const describeError = useCallback(
    (e: unknown): string | null => {
      const err = getApiError(e);
      if (err.code === "MOBILE_LOGIN_HOURS") {
        setBlocked(err.message || t("security.mobileBlocked"));
        return null;
      }
      return err.code === "NETWORK" ? t("errors.network") : err.message || t("errors.generic");
    },
    [t]
  );

  const otpStep = pending ? (
    <LoginOtpStep
      key={pending.challengeId}
      pending={pending}
      onSuccess={(data) => onSuccess(data, pending.next)}
      onCancel={() => setPending(null)}
    />
  ) : null;

  const blockedNotice = blocked ? (
    <div role="alert" className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <Clock className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
      <div>
        <p className="font-medium">{t("security.mobileBlockedTitle")}</p>
        <p className="mt-1">{blocked}</p>
      </div>
    </div>
  ) : null;

  return { pending, otpStep, blockedNotice, handleResult, describeError };
}
