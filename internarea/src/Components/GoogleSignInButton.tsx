import React, { useState } from "react";
import { signInWithPopup, signOut } from "firebase/auth";
import { auth, provider } from "@/firebase/firebase";
import { useLanguage } from "@/i18n/LanguageProvider";
import { requestSignIn, SignInResult } from "@/lib/signIn";

// "Continue with Google". Firebase shows Google's popup; the resulting ID token
// is then exchanged for a server session, which applies the same login rules
// as password sign-in (Chrome OTP, mobile hours) and shows up in Login History.
export default function GoogleSignInButton({
  onResult,
  onError,
  disabled,
}: {
  onResult: (data: SignInResult) => void;
  onError: (error: unknown) => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    if (busy) return;
    setBusy(true);
    let popupDone = false;
    try {
      const credential = await signInWithPopup(auth, provider);
      popupDone = true;
      const idToken = await credential.user.getIdToken();
      const data = await requestSignIn("/api/auth/google", { idToken });
      onResult(data);
    } catch (error) {
      const code = (error as { code?: string })?.code || "";
      // Closing the popup isn't an error worth reporting.
      if (!popupDone && /popup-closed|cancelled-popup/.test(code)) return;
      console.error(error);
      onError(popupDone ? error : new Error(t("auth.loginFailed")));
    } finally {
      // The server session replaces Firebase's; nothing else uses it.
      if (auth.currentUser) signOut(auth).catch(() => undefined);
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={signIn}
      disabled={busy || disabled}
      className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 hover:bg-gray-50 disabled:opacity-60"
    >
      <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
      </svg>
      <span className="text-gray-700">{t("nav.continueWithGoogle")}</span>
    </button>
  );
}
