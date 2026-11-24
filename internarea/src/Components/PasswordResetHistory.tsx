import React, { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { useLanguage } from "@/i18n/LanguageProvider";

interface Entry {
  _id: string;
  method: "email" | "phone";
  destination: string;
  status: string;
  attempts: number;
  resendCount: number;
  ip?: string;
  browser?: string;
  os?: string;
  device?: string;
  createdAt: string;
  completedAt?: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  completed: "bg-green-100 text-green-800",
  otp_sent: "bg-blue-100 text-blue-800",
  verified: "bg-blue-100 text-blue-800",
  delivery_failed: "bg-amber-100 text-amber-800",
  send_failed: "bg-amber-100 text-amber-800",
  expired: "bg-gray-100 text-gray-700",
  locked: "bg-red-100 text-red-800",
  blocked_daily_limit: "bg-red-100 text-red-800",
};

// The signed-in user's password reset audit trail, shown on the profile page.
export default function PasswordResetHistory() {
  const { t, formatDate } = useLanguage();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    setEntries(null);
    try {
      const { data } = await api.get("/api/auth/reset-history");
      setEntries(data.entries || []);
    } catch {
      setFailed(true);
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="rounded-lg border border-gray-200">
      <div className="flex items-start justify-between gap-4 border-b border-gray-200 p-4">
        <div>
          <h3 className="flex items-center gap-2 font-semibold text-gray-900">
            <KeyRound className="h-4 w-4 text-blue-600" />
            {t("account.history.title")}
          </h3>
          <p className="mt-1 text-sm text-gray-500">{t("account.history.subtitle")}</p>
        </div>
        <button type="button" onClick={load} className="text-gray-400 hover:text-gray-600" aria-label={t("common.retry")}>
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>
      {entries === null ? (
        <div className="flex justify-center p-6">
          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
        </div>
      ) : failed ? (
        <p className="p-4 text-sm text-red-700">{t("account.history.loadFailed")}</p>
      ) : entries.length === 0 ? (
        <p className="p-4 text-sm text-gray-500">{t("account.history.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2">{t("account.history.date")}</th>
                <th className="px-4 py-2">{t("account.history.method")}</th>
                <th className="px-4 py-2">{t("account.history.status")}</th>
                <th className="px-4 py-2">{t("account.history.ip")}</th>
                <th className="px-4 py-2">{t("account.history.device")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.map((e) => (
                <tr key={e._id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-2 text-gray-700">
                    {formatDate(e.createdAt, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-4 py-2 text-gray-700">
                    <div>{e.method === "email" ? t("account.history.methods.email") : t("account.history.methods.phone")}</div>
                    <div className="text-xs text-gray-500">{e.destination}</div>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[e.status] || "bg-gray-100 text-gray-700"}`}>
                      {t(`account.history.statuses.${e.status}`)}
                    </span>
                    {e.attempts > 0 && <div className="mt-1 text-xs text-gray-500">{t("account.history.wrongCodes", { count: e.attempts })}</div>}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-600">{e.ip}</td>
                  <td className="px-4 py-2 text-xs text-gray-600">
                    {[e.browser, e.os, e.device].filter(Boolean).join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
