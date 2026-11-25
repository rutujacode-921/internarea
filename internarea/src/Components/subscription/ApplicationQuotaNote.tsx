import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Ticket } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageProvider";
import { fetchSubscription, SUBSCRIPTION_CHANGED_EVENT, SubscriptionSummary } from "@/lib/subscription";

// Shown in the internship Apply dialog: applications left this cycle, or why
// applying is blocked and how to get more.
export default function ApplicationQuotaNote() {
  const { t, formatDate } = useLanguage();
  const [s, setS] = useState<SubscriptionSummary | null>(null);

  const load = useCallback(() => {
    fetchSubscription()
      .then((state) => setS(state.subscription))
      .catch(() => setS(null));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(SUBSCRIPTION_CHANGED_EVENT, load);
    return () => window.removeEventListener(SUBSCRIPTION_CHANGED_EVENT, load);
  }, [load]);

  if (!s) return null;
  const plan = t(`plans.names.${s.plan}`);
  if (s.unlimited) {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-800">
        <Ticket className="h-4 w-4" />
        {t("plans.quota.unlimited", { plan })}
      </p>
    );
  }
  if (s.remaining === 0) {
    return (
      <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div>
          <p>{t("plans.quota.exhausted", { plan, limit: s.limit ?? 0, date: formatDate(s.quotaResetsAt, { month: "short", day: "numeric" }) })}</p>
          <Link href="/plans" className="mt-1 inline-block font-semibold text-blue-700 underline">
            {t("plans.quota.upgrade")}
          </Link>
        </div>
      </div>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
      <Ticket className="h-4 w-4" />
      {t("plans.quota.left", { remaining: s.remaining ?? 0, limit: s.limit ?? 0, plan })}
      <Link href="/plans" className="font-medium text-blue-700 underline">
        {t("plans.quota.seePlans")}
      </Link>
    </p>
  );
}
