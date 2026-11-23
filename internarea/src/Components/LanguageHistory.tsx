import React, { useCallback, useEffect, useState } from "react";
import { History, Loader2, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { getLanguageInfo, isSupportedLanguage } from "@/i18n/config";
import { useLanguage } from "@/i18n/LanguageProvider";

interface HistoryEntry {
  _id: string;
  previousLanguage: string | null;
  language: string;
  status: "changed" | "otp_requested" | "otp_failed" | "blocked";
  method: "direct" | "otp" | "sync" | "initial";
  ip?: string;
  browser?: string;
  os?: string;
  device?: string;
  createdAt: string;
}

const STATUS_STYLES: Record<HistoryEntry["status"], string> = {
  changed: "bg-green-100 text-green-800",
  otp_requested: "bg-blue-100 text-blue-800",
  otp_failed: "bg-red-100 text-red-800",
  blocked: "bg-amber-100 text-amber-800",
};

// The signed-in user's language audit trail, shown on the profile page.
export default function LanguageHistory() {
  const { t, language, formatDate } = useLanguage();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const { data } = await api.get("/api/language/history");
      setEntries(Array.isArray(data?.entries) ? data.entries : []);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload whenever the language changes so the new entry appears.
  useEffect(() => {
    load();
  }, [load, language]);

  const languageLabel = (code: string | null) =>
    code && isSupportedLanguage(code) ? getLanguageInfo(code).nativeName : t("language.history.none");

  return (
    <div className="rounded-lg border border-gray-200">
      <div className="flex items-start justify-between gap-4 border-b border-gray-200 p-4">
        <div>
          <h3 className="flex items-center gap-2 font-semibold text-gray-900">
            <History className="h-4 w-4 text-blue-600" />
            {t("language.history.title")}
          </h3>
          <p className="mt-1 text-sm text-gray-500">{t("language.history.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="text-gray-500 hover:text-blue-600 disabled:opacity-50"
          aria-label={t("common.retry")}
          title={t("common.retry")}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading && entries.length === 0 ? (
        <div className="flex items-center justify-center gap-2 p-6 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      ) : failed ? (
        <div className="p-6 text-center text-sm text-red-600">
          {t("language.history.loadFailed")}{" "}
          <button type="button" onClick={load} className="font-medium underline">
            {t("common.retry")}
          </button>
        </div>
      ) : entries.length === 0 ? (
        <p className="p-6 text-center text-sm text-gray-500">{t("language.history.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">{t("language.history.date")}</th>
                <th className="px-4 py-2 font-medium">{t("language.history.change")}</th>
                <th className="px-4 py-2 font-medium">{t("language.history.status")}</th>
                <th className="px-4 py-2 font-medium">{t("language.history.ip")}</th>
                <th className="px-4 py-2 font-medium">{t("language.history.browser")}</th>
                <th className="px-4 py-2 font-medium">{t("language.history.device")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-700">
              {entries.map((entry) => (
                <tr key={entry._id}>
                  <td className="whitespace-nowrap px-4 py-2">
                    {formatDate(entry.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2">
                    {languageLabel(entry.previousLanguage)} → {languageLabel(entry.language)}
                    <span className="block text-xs text-gray-400">
                      {t(`language.history.methods.${entry.method}`)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[entry.status] ?? "bg-gray-100 text-gray-700"}`}>
                      {t(`language.history.statuses.${entry.status}`)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{entry.ip || "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2">{entry.browser || "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2">
                    {entry.device || "—"}
                    {entry.os && <span className="block text-xs text-gray-400">{entry.os}</span>}
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
