import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { Loader2, ShieldAlert } from "lucide-react";
import { selectuser } from "@/Feature/Userslice";
import { api, getApiError } from "@/lib/api";
import { endSession, startPasswordSession } from "@/lib/session";
import { useLanguage } from "@/i18n/LanguageProvider";
import { AuthCard, Field, FormError, isStrongPassword, PasswordInput } from "@/Components/AuthLayout";

// Change password. Required straight after logging in with a reset password;
// until then every other page redirects here (and the server refuses other requests).
export default function ChangePasswordPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const user = useSelector(selectuser) as { provider?: string; mustChangePassword?: boolean } | null;
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const required = Boolean(user?.mustChangePassword);

  if (!user) {
    return (
      <AuthCard title={t("account.change.title")}>
        <p className="text-gray-700">{t("account.change.signIn")}</p>
        <Link href="/login" className="mt-4 inline-block font-medium text-blue-600 hover:text-blue-700">
          {t("account.nav.login")}
        </Link>
      </AuthCard>
    );
  }
  if (user.provider !== "password") {
    return (
      <AuthCard title={t("account.change.title")}>
        <p className="text-gray-700">{t("account.change.googleAccount")}</p>
      </AuthCard>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.current) return setError(t("account.change.enterCurrent"));
    if (!isStrongPassword(form.next)) return setError(t("account.passwordRule"));
    if (form.next !== form.confirm) return setError(t("account.errors.mismatch"));
    if (form.next === form.current) return setError(t("account.change.same"));
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post("/api/auth/change-password", { currentPassword: form.current, newPassword: form.next });
      startPasswordSession(data.token, data.user);
      toast.success(t("account.change.success"));
      router.replace(required ? "/" : "/profile");
    } catch (e) {
      const err = getApiError(e);
      setError(err.code === "NETWORK" ? t("errors.network") : err.message || t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title={t("account.change.title")} subtitle={required ? undefined : t("account.change.subtitle")}>
      {required && (
        <div className="mb-5 flex items-start gap-3 rounded-lg bg-amber-50 p-4 text-sm text-amber-900" role="alert">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <p>{t("account.change.required")}</p>
        </div>
      )}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field id="current" label={required ? t("account.change.temporary") : t("account.change.current")}>
          <PasswordInput id="current" value={form.current} onChange={set("current")} autoComplete="current-password" />
        </Field>
        <Field id="next" label={t("account.change.new")} hint={t("account.passwordRule")}>
          <PasswordInput id="next" value={form.next} onChange={set("next")} autoComplete="new-password" />
        </Field>
        <Field id="confirm" label={t("account.fields.confirmPassword")}>
          <PasswordInput id="confirm" value={form.confirm} onChange={set("confirm")} autoComplete="new-password" />
        </Field>
        <FormError message={error} />
        <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("account.change.submit")}
        </button>
      </form>
      {required && (
        <button type="button" onClick={() => endSession().then(() => router.replace("/login"))} className="mt-4 w-full text-sm text-gray-600 hover:text-gray-900">
          {t("nav.logout")}
        </button>
      )}
    </AuthCard>
  );
}
