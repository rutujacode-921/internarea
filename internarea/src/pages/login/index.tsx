import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { Loader2 } from "lucide-react";
import { selectuser } from "@/Feature/Userslice";
import { api, getApiError } from "@/lib/api";
import { startPasswordSession } from "@/lib/session";
import { useLanguage } from "@/i18n/LanguageProvider";
import GoogleSignInButton from "@/Components/GoogleSignInButton";
import { AuthCard, Field, fieldClass, FormError, PasswordInput } from "@/Components/AuthLayout";

// Log in with email or mobile number + password, or with Google.
export default function LoginPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const user = useSelector(selectuser);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goNext = () => {
    const next = typeof router.query.next === "string" && router.query.next.startsWith("/") ? router.query.next : "/";
    router.push(next);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!identifier.trim() || !password) return setError(t("account.login.fillAll"));
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post("/api/auth/login", { identifier: identifier.trim(), password });
      startPasswordSession(data.token, data.user);
      toast.success(t("auth.loginSuccess"));
      if (data.user.mustChangePassword) router.replace("/change-password");
      else goNext();
    } catch (e) {
      const err = getApiError(e);
      setError(err.code === "NETWORK" ? t("errors.network") : err.message || t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  if (user) {
    return (
      <AuthCard title={t("account.login.title")}>
        <p className="text-gray-700">{t("account.login.alreadySignedIn")}</p>
        <Link href="/profile" className="mt-4 inline-block font-medium text-blue-600 hover:text-blue-700">
          {t("account.login.goToProfile")}
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("account.login.title")} subtitle={t("account.login.subtitle")}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field id="identifier" label={t("account.fields.identifier")}>
          <input
            id="identifier"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
            placeholder={t("account.placeholders.identifier")}
            className={fieldClass}
          />
        </Field>
        <Field id="password" label={t("account.fields.password")}>
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
        </Field>
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-sm font-medium text-blue-600 hover:text-blue-700">
            {t("account.login.forgot")}
          </Link>
        </div>
        <FormError message={error} />
        <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("account.login.submit")}
        </button>
      </form>
      <div className="my-5 flex items-center gap-3 text-xs text-gray-400">
        <span className="h-px flex-1 bg-gray-200" />
        {t("account.or")}
        <span className="h-px flex-1 bg-gray-200" />
      </div>
      <GoogleSignInButton onSignedIn={goNext} />
      <p className="mt-6 text-center text-sm text-gray-600">
        {t("account.login.noAccount")}{" "}
        <Link href="/signup" className="font-medium text-blue-600 hover:text-blue-700">
          {t("account.nav.signup")}
        </Link>
      </p>
    </AuthCard>
  );
}
