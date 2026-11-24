import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { Loader2, LogOut, MapPin, MonitorSmartphone, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { api, getApiError } from "@/lib/api";
import { useLanguage } from "@/i18n/LanguageProvider";
import { browserLine, DATE_TIME, DeviceIcon, deviceLine, LoginEntry, locationLine } from "./shared";

interface TrustedDevice {
  _id: string;
  browserName?: string;
  osName?: string;
  deviceType?: LoginEntry["deviceType"];
  deviceModel?: string | null;
  lastIp?: string;
  lastCountry?: string;
  trustedAt: string;
  lastUsedAt: string;
  current: boolean;
}

// Devices signed in right now (with "sign out" for each, or all others) and the
// devices trusted after a verified sign-in.
export default function ActiveSessions() {
  const { t, formatDate } = useLanguage();
  const [sessions, setSessions] = useState<LoginEntry[] | null>(null);
  const [devices, setDevices] = useState<TrustedDevice[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [s, d] = await Promise.all([api.get("/api/auth/sessions"), api.get("/api/auth/trusted-devices")]);
      setSessions(s.data.sessions || []);
      setDevices(d.data.devices || []);
    } catch {
      setFailed(true);
      setSessions((current) => current || []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(key);
    try {
      await action();
      toast.success(success);
    } catch (e) {
      const err = getApiError(e);
      toast.error(err.code === "NETWORK" ? t("errors.network") : err.message || t("errors.generic"));
    } finally {
      setBusy(null);
      load();
    }
  };

  const others = (sessions || []).filter((s) => !s.current);

  return (
    <div className="rounded-lg border border-gray-200">
      <div className="flex items-start justify-between gap-4 border-b border-gray-200 p-4">
        <div>
          <h3 className="flex items-center gap-2 font-semibold text-gray-900">
            <MonitorSmartphone className="h-4 w-4 text-blue-600" />
            {t("security.sessions.title")}
          </h3>
          <p className="mt-1 text-sm text-gray-500">{t("security.sessions.subtitle")}</p>
        </div>
        <button type="button" onClick={load} className="text-gray-400 hover:text-gray-600" aria-label={t("common.retry")}>
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {sessions === null ? (
        <div className="flex justify-center p-6">
          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
        </div>
      ) : failed && sessions.length === 0 ? (
        <p className="p-4 text-sm text-red-700">{t("security.loadFailed")}</p>
      ) : (
        <>
          <ul className="divide-y divide-gray-100">
            {sessions.map((s) => (
              <li key={s._id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 gap-3">
                  <div className="mt-0.5 text-gray-400">
                    <DeviceIcon type={s.deviceType} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900">{browserLine(s) || t("security.unknownBrowser")}</span>
                      {s.current && (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">{t("security.thisDevice")}</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-sm text-gray-600">{deviceLine(t, s)}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {locationLine(t, s)}
                      </span>
                      <span className="font-mono">{s.lastIp || s.publicIp || s.ip}</span>
                      <span>{t("security.sessions.signedIn", { date: formatDate(s.createdAt, DATE_TIME) })}</span>
                      {s.lastSeenAt && <span>{t("security.sessions.lastActive", { date: formatDate(s.lastSeenAt, DATE_TIME) })}</span>}
                    </div>
                  </div>
                </div>
                {!s.current && (
                  <button
                    type="button"
                    onClick={() => run(s._id, () => api.delete(`/api/auth/sessions/${s._id}`), t("security.sessions.signedOutOne"))}
                    disabled={busy !== null}
                    className="inline-flex items-center justify-center gap-1.5 self-start rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 sm:self-center"
                  >
                    {busy === s._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                    {t("security.sessions.signOut")}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="border-t border-gray-100 p-4">
            {others.length > 0 ? (
              <button
                type="button"
                onClick={() => run("others", () => api.post("/api/auth/sessions/revoke-others"), t("security.sessions.signedOutAll"))}
                disabled={busy !== null}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60 sm:w-auto"
              >
                {busy === "others" ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                {t("security.sessions.signOutOthers", { count: others.length })}
              </button>
            ) : (
              <p className="text-sm text-gray-500">{t("security.sessions.onlyThis")}</p>
            )}
          </div>

          {devices.length > 0 && (
            <div className="border-t border-gray-200">
              <div className="p-4 pb-2">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <ShieldCheck className="h-4 w-4 text-green-600" />
                  {t("security.devices.title")}
                </h4>
                <p className="mt-1 text-xs text-gray-500">{t("security.devices.subtitle")}</p>
              </div>
              <ul className="divide-y divide-gray-100">
                {devices.map((d) => (
                  <li key={d._id} className="flex items-center gap-3 px-4 py-3">
                    <div className="text-gray-400">
                      <DeviceIcon type={d.deviceType} className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="text-gray-900">
                        {[d.browserName, d.osName === "Mac OS" ? "macOS" : d.osName].filter(Boolean).join(" · ")}
                        {d.deviceModel ? ` · ${d.deviceModel}` : ""}
                        {d.current && <span className="ml-2 text-xs font-medium text-green-700">{t("security.thisDevice")}</span>}
                      </div>
                      <div className="text-xs text-gray-500">
                        {t("security.devices.trustedOn", { date: formatDate(d.trustedAt, DATE_TIME) })} ·{" "}
                        {t("security.devices.lastUsed", { date: formatDate(d.lastUsedAt, DATE_TIME) })}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => run(`device-${d._id}`, () => api.delete(`/api/auth/trusted-devices/${d._id}`), t("security.devices.removed"))}
                      disabled={busy !== null}
                      className="text-gray-400 hover:text-red-600 disabled:opacity-60"
                      aria-label={t("security.devices.remove")}
                      title={t("security.devices.remove")}
                    >
                      {busy === `device-${d._id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
