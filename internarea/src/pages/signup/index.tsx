import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { toast } from "react-toastify";
import { Loader2 } from "lucide-react";
import { api, getApiError } from "@/lib/api";
import { startPasswordSession } from "@/lib/session";
import { useLanguage } from "@/i18n/LanguageProvider";
import GoogleSignInButton from "@/Components/GoogleSignInButton";
import { AuthCard, Field, fieldClass, FormError, isStrongPassword, PasswordInput } from "@/Components/AuthLayout";

// Create an account with email and/or mobile number + password.
export default function SignupPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (form.name.trim().length < 2) return setError(t("account.signup.errors.name"));
    if (!form.email.trim() && !form.phone.trim()) return setError(t("account.signup.errors.contact"));
    if (!isStrongPassword(form.password)) return setError(t("account.passwordRule"));
    if (form.password !== form.confirm) return setError(t("account.errors.mismatch"));
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post("/api/auth/register", {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        password: form.password,
      });
      startPasswordSession(data.token, data.user);
      toast.success(t("account.signup.success"));
      router.push("/");
    } catch (e) {
      const err = getApiError(e);
      setError(err.code === "NETWORK" ? t("errors.network") : err.message || t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title={t("account.signup.title")} subtitle={t("account.signup.subtitle")}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field id="name" label={t("account.fields.name")}>
          <input id="name" value={form.name} onChange={(e) => set("name")(e.target.value)} autoComplete="name" maxLength={80} className={fieldClass} />
        </Field>
        <Field id="email" label={t("account.fields.email")}>
          <input id="email" type="email" value={form.email} onChange={(e) => set("email")(e.target.value)} autoComplete="email" maxLength={120} className={fieldClass} />
        </Field>
        <Field id="phone" label={t("account.fields.phone")} hint={t("account.signup.contactHint")}>
          <input id="phone" type="tel" value={form.phone} onChange={(e) => set("phone")(e.target.value)} autoComplete="tel" maxLength={20} placeholder="98765 43210" className={fieldClass} />
        </Field>
        <Field id="password" label={t("account.fields.password")} hint={t("account.passwordRule")}>
          <PasswordInput id="password" value={form.password} onChange={set("password")} autoComplete="new-password" />
        </Field>
        <Field id="confirm" label={t("account.fields.confirmPassword")}>
          <PasswordInput id="confirm" value={form.confirm} onChange={set("confirm")} autoComplete="new-password" />
        </Field>
        <FormError message={error} />
        <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("account.signup.submit")}
        </button>
      </form>
      <div className="my-5 flex items-center gap-3 text-xs text-gray-400">
        <span className="h-px flex-1 bg-gray-200" />
        {t("account.or")}
        <span className="h-px flex-1 bg-gray-200" />
      </div>
      <GoogleSignInButton onSignedIn={() => router.push("/")} />
      <p className="mt-6 text-center text-sm text-gray-600">
        {t("account.signup.haveAccount")}{" "}
        <Link href="/login" className="font-medium text-blue-600 hover:text-blue-700">
          {t("account.nav.login")}
        </Link>
      </p>
    </AuthCard>
  );
}
