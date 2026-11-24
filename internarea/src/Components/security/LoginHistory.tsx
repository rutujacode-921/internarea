import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, History, Loader2, MapPin, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { useLanguage } from "@/i18n/LanguageProvider";
import { browserLine, DATE_TIME, DeviceIcon, deviceLine, LoginEntry, locationLine } from "./shared";

const STATUS_STYLES: Record<string, string> = {
  success: "bg-green-100 text-green-800",
  otp_pending: "bg-blue-100 text-blue-800",
  failed_password: "bg-red-100 text-red-800",
  otp_locked: "bg-red-100 text-red-800",
  account_locked: "bg-red-100 text-red-800",
  blocked_mobile_hours: "bg-amber-100 text-amber-800",
  otp_expired: "bg-gray-100 text-gray-700",
  otp_send_failed: "bg-amber-100 text-amber-800",
};

function Flag({ children, tone = "blue" }: { children: React.ReactNode; tone?: "blue" | "amber" | "green" | "gray" }) {
  const tones = {
    blue: "bg-blue-50 text-blue-700 ring-blue-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    green: "bg-green-50 text-green-700 ring-green-200",
    gray: "bg-gray-50 text-gray-600 ring-gray-200",
  };
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tones[tone]}`}>{children}</span>;
}

// Every sign-in attempt on the account, with its environment and verification log.
export default function LoginHistory() {
  const { t, formatDate } = useLanguage();
  const [entries, setEntries] = useState<LoginEntry[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    setEntries(null);
    try {
      const { data } = await api.get("/api/auth/login-history");
      setEntries(data.entries || []);
      setHasMore(Boolean(data.hasMore));
    } catch {
      setFailed(true);
      setEntries([]);
    }
  }, []);

  const loadMore = async () => {
    if (!entries?.length || loadingMore) return;
    setLoadingMore(true);
    try {
      const before = entries[entries.length - 1].createdAt;
      const { data } = await api.get("/api/auth/login-history", { params: { before } });
      setEntries((current) => {
        const seen = new Set((current || []).map((e) => e._id));
        return [...(current || []), ...(data.entries || []).filter((e: LoginEntry) => !seen.has(e._id))];
      });
      setHasMore(Boolean(data.hasMore));
    } catch {
      // Keep what is shown; the button stays for another try.
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="rounded-lg border border-gray-200">
      <div className="flex items-start justify-between gap-4 border-b border-gray-200 p-4">
        <div>
          <h3 className="flex items-center gap-2 font-semibold text-gray-900">
            <History className="h-4 w-4 text-blue-600" />
            {t("security.history.title")}
          </h3>
          <p className="mt-1 text-sm text-gray-500">{t("security.history.subtitle")}</p>
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
        <p className="p-4 text-sm text-red-700">{t("security.loadFailed")}</p>
      ) : entries.length === 0 ? (
        <p className="p-4 text-sm text-gray-500">{t("security.history.empty")}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {entries.map((e) => {
            const expanded = open === e._id;
            const ipChanges = (e.events || []).filter((ev) => ev.type === "ip_changed").length;
            return (
              <li key={e._id} className="p-4">
                <div className="flex gap-3">
                  <div className="mt-0.5 text-gray-400">
                    <DeviceIcon type={e.deviceType} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900">{browserLine(e) || t("security.unknownBrowser")}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[e.status] || "bg-gray-100 text-gray-700"}`}>
                        {t(`security.statuses.${e.status}`)}
                      </span>
                      {e.current && <Flag tone="green">{t("security.thisDevice")}</Flag>}
                    </div>
                    <div className="mt-1 text-sm text-gray-600">{deviceLine(t, e)}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                      <span>{formatDate(e.createdAt, DATE_TIME)}</span>
                      <span className="font-mono">{e.publicIp || e.ip}</span>
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {locationLine(t, e)}
                      </span>
                      <span>{t(e.provider === "google" ? "security.viaGoogle" : "security.viaPassword")}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {e.isNewDevice && <Flag tone="amber">{t("security.flags.newDevice")}</Flag>}
                      {e.isNewBrowser && <Flag tone="amber">{t("security.flags.newBrowser")}</Flag>}
                      {e.isNewIp && <Flag tone="amber">{t("security.flags.newIp")}</Flag>}
                      {e.isNewCountry && <Flag tone="amber">{t("security.flags.newCountry")}</Flag>}
                      {e.otpRequired && <Flag>{e.verifiedAt ? t("security.flags.otpVerified") : t("security.flags.otpRequired")}</Flag>}
                      {e.status === "success" && e.trustedDevice && <Flag tone="green">{t("security.flags.trusted")}</Flag>}
                      {ipChanges > 0 && <Flag tone="gray">{t("security.flags.ipChanged", { count: ipChanges })}</Flag>}
                      {e.status === "success" && !e.active && e.revokeReason && (
                        <Flag tone="gray">{t(`security.endReasons.${e.revokeReason}`)}</Flag>
                      )}
                      {e.status === "success" && !e.active && !e.revokeReason && <Flag tone="gray">{t("security.endReasons.expired")}</Flag>}
                    </div>
                    {(e.events?.length || 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => setOpen(expanded ? null : e._id)}
                        className="mt-2 flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                        aria-expanded={expanded}
                      >
                        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        {t("security.history.log")}
                      </button>
                    )}
                    {expanded && (
                      <ol className="mt-2 space-y-1 border-l-2 border-gray-200 pl-3 text-xs text-gray-600">
                        {(e.events || []).map((ev, i) => (
                          <li key={i}>
                            <span className="text-gray-400">{formatDate(ev.at, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>{" "}
                            {t(`security.events.${ev.type}`)}
                            {ev.type === "ip_changed" && ev.detail ? <span className="font-mono"> ({ev.detail})</span> : null}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {hasMore && entries && entries.length > 0 && (
        <div className="border-t border-gray-100 p-3 text-center">
          <button type="button" onClick={loadMore} disabled={loadingMore} className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700 disabled:opacity-60">
            {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("security.history.loadMore")}
          </button>
        </div>
      )}
    </div>
  );
}
