import React from "react";
import Link from "next/link";
import { CalendarClock, Crown, Infinity as InfinityIcon } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageProvider";
import { formatRupees, SubscriptionSummary } from "@/lib/subscription";

const DATE: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };
const PLAN_COLORS: Record<string, string> = {
  free: "bg-gray-100 text-gray-700",
  bronze: "bg-amber-100 text-amber-800",
  silver: "bg-slate-200 text-slate-800",
  gold: "bg-yellow-100 text-yellow-800",
};

// Current plan, remaining applications and renewal date.
export default function SubscriptionOverview({
  summary,
  manageLink = false,
  actions,
}: {
  summary: SubscriptionSummary;
  manageLink?: boolean;
  actions?: React.ReactNode;
}) {
  const { t, formatDate } = useLanguage();
  const s = summary;
  const percent = s.unlimited || !s.limit ? 0 : Math.min(100, Math.round((s.used / s.limit) * 100));
  const exhausted = !s.unlimited && s.remaining === 0;

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-gray-900">
            <Crown className="h-4 w-4 text-blue-600" />
            {t("plans.overview.title")}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-sm font-semibold ${PLAN_COLORS[s.plan]}`}>{t(`plans.names.${s.plan}`)}</span>
            {s.price > 0 && <span className="text-sm text-gray-500">{t("plans.pricePerMonth", { price: formatRupees(s.price) })}</span>}
          </div>
        </div>
        {manageLink && (
          <Link href="/plans" className="inline-flex items-center justify-center rounded-lg border border-blue-600 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50">
            {s.plan === "free" ? t("plans.overview.upgrade") : t("plans.overview.manage")}
          </Link>
        )}
      </div>

      {/* Quota */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-gray-600">{t("plans.overview.applications")}</span>
          {s.unlimited ? (
            <span className="flex items-center gap-1 font-semibold text-gray-900">
              <InfinityIcon className="h-4 w-4" />
              {t("plans.unlimited")}
            </span>
          ) : (
            <span className={`font-semibold ${exhausted ? "text-red-600" : "text-gray-900"}`}>
              {t("plans.overview.remaining", { remaining: s.remaining ?? 0, limit: s.limit ?? 0 })}
            </span>
          )}
        </div>
        {!s.unlimited && (
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={s.used} aria-valuemin={0} aria-valuemax={s.limit ?? 0}>
            <div className={`h-full rounded-full ${exhausted ? "bg-red-500" : "bg-blue-600"}`} style={{ width: `${percent}%` }} />
          </div>
        )}
        {exhausted && <p className="mt-2 text-sm text-red-700">{t("plans.overview.exhausted", { date: formatDate(s.quotaResetsAt, DATE) })}</p>}
      </div>

      {/* Dates */}
      <div className="mt-4 space-y-1 text-sm text-gray-600">
        <p className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-gray-400" />
          {s.plan === "free"
            ? t("plans.overview.freeResets", { date: formatDate(s.quotaResetsAt, DATE) })
            : s.cancelAtPeriodEnd
            ? t("plans.overview.endsOn", { date: formatDate(s.periodEnd, DATE) })
            : t("plans.overview.renewsOn", { date: formatDate(s.renewsOn, DATE) })}
        </p>
        {s.scheduledPlan && <p className="text-amber-700">{t("plans.overview.scheduled", { plan: t(`plans.names.${s.scheduledPlan}`), date: formatDate(s.periodEnd, DATE) })}</p>}
        {s.nextPeriodPaid && <p className="text-green-700">{t("plans.overview.nextPaid", { plan: t(`plans.names.${s.nextPeriodPaid}`), date: formatDate(s.periodEnd, DATE) })}</p>}
        {s.cancelAtPeriodEnd && <p className="text-amber-700">{t("plans.overview.cancelled")}</p>}
      </div>

      {actions && <div className="mt-4 flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
