import React, { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageProvider";
import { fetchHistory, fetchSubscription, PlanPayment, SUBSCRIPTION_CHANGED_EVENT, SubscriptionSummary } from "@/lib/subscription";
import SubscriptionOverview from "./SubscriptionOverview";
import { PaymentHistory } from "./BillingHistory";

// Profile section: current plan, remaining applications, renewal date, and invoices.
export default function ProfileSubscription() {
  const { t } = useLanguage();
  const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
  const [payments, setPayments] = useState<PlanPayment[]>([]);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [state, history] = await Promise.all([fetchSubscription(), fetchHistory()]);
      setSummary(state.subscription);
      setPayments(history.payments.filter((p) => p.status !== "created"));
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(SUBSCRIPTION_CHANGED_EVENT, load);
    return () => window.removeEventListener(SUBSCRIPTION_CHANGED_EVENT, load);
  }, [load]);

  if (failed) {
    return (
      <div className="rounded-lg border border-gray-200 p-4 text-sm text-red-700">
        {t("plans.loadFailed")}{" "}
        <button type="button" onClick={load} className="font-medium text-blue-600">
          {t("common.retry")}
        </button>
      </div>
    );
  }
  if (!summary) {
    return (
      <div className="flex justify-center rounded-lg border border-gray-200 p-6">
        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
      </div>
    );
  }
  return (
    <>
      <SubscriptionOverview summary={summary} manageLink />
      <PaymentHistory payments={payments} limit={5} />
    </>
  );
}
