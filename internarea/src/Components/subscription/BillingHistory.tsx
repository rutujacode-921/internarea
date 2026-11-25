import React, { useState } from "react";
import { Download, History, Loader2, Receipt } from "lucide-react";
import { toast } from "react-toastify";
import { getApiError } from "@/lib/api";
import { useLanguage } from "@/i18n/LanguageProvider";
import { downloadInvoice, readBlobError } from "@/resume/payments";
import { formatRupees, PlanPayment, SubscriptionEvent } from "@/lib/subscription";

const DATE_TIME: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
const DATE: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };

const STATUS_STYLES: Record<string, string> = {
  paid: "bg-green-100 text-green-800",
  created: "bg-blue-100 text-blue-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-700",
  expired: "bg-gray-100 text-gray-700",
  refunded: "bg-amber-100 text-amber-800",
};

// Plan payments with their invoices.
export function PaymentHistory({ payments, limit }: { payments: PlanPayment[]; limit?: number }) {
  const { t, formatDate } = useLanguage();
  const [downloading, setDownloading] = useState<string | null>(null);
  const shown = limit ? payments.slice(0, limit) : payments;

  const download = async (id: string) => {
    setDownloading(id);
    try {
      await downloadInvoice(id);
    } catch (e) {
      const err = getApiError(await readBlobError(e));
      toast.error(err.message || t("errors.generic"));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200">
      <div className="border-b border-gray-200 p-4">
        <h3 className="flex items-center gap-2 font-semibold text-gray-900">
          <Receipt className="h-4 w-4 text-blue-600" />
          {t("plans.history.payments")}
        </h3>
        <p className="mt-1 text-sm text-gray-500">{t("plans.history.paymentsHelp")}</p>
      </div>
      {shown.length === 0 ? (
        <p className="p-4 text-sm text-gray-500">{t("plans.history.noPayments")}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {shown.map((p) => (
            <li key={p.transactionId} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-900">
                    {p.plan ? t(`plans.names.${p.plan}`) : p.description}
                    {p.kind ? ` · ${t(`plans.kinds.${p.kind}`)}` : ""}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[p.status]}`}>{t(`plans.statuses.${p.status}`)}</span>
                  {p.gateway === "mock" && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">{t("plans.history.test")}</span>}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                  <span>{formatDate(p.paidAt || p.createdAt, DATE_TIME)}</span>
                  <span className="font-semibold text-gray-700">{formatRupees(p.amount)}</span>
                  {p.periodStart && p.periodEnd && (
                    <span>{t("plans.history.valid", { from: formatDate(p.periodStart, DATE), to: formatDate(p.periodEnd, DATE) })}</span>
                  )}
                  {p.razorpayPaymentId && <span className="font-mono">{p.razorpayPaymentId}</span>}
                  {p.invoiceNumber && <span>{p.invoiceNumber}</span>}
                </div>
                {p.failureReason && p.status !== "paid" && <p className="mt-1 text-xs text-red-600">{p.failureReason}</p>}
                {p.status === "refunded" && <p className="mt-1 text-xs text-amber-700">{t("plans.history.refunded")}</p>}
              </div>
              {p.invoiceNumber && (
                <button
                  type="button"
                  onClick={() => download(p.transactionId)}
                  disabled={downloading !== null}
                  className="inline-flex items-center gap-1.5 self-start rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60 sm:self-center"
                >
                  {downloading === p.transactionId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {t("plans.history.invoice")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Every change to the plan: purchases, upgrades, renewals, cancellations, expiry, quota resets.
export function SubscriptionActivity({ events }: { events: SubscriptionEvent[] }) {
  const { t, formatDate } = useLanguage();
  const name = (plan: string | null) => (plan ? t(`plans.names.${plan}`) : "");
  return (
    <div className="rounded-lg border border-gray-200">
      <div className="border-b border-gray-200 p-4">
        <h3 className="flex items-center gap-2 font-semibold text-gray-900">
          <History className="h-4 w-4 text-blue-600" />
          {t("plans.history.activity")}
        </h3>
      </div>
      {events.length === 0 ? (
        <p className="p-4 text-sm text-gray-500">{t("plans.history.noActivity")}</p>
      ) : (
        <ol className="divide-y divide-gray-100">
          {events.map((e) => (
            <li key={e.id} className="flex flex-col gap-0.5 px-4 py-3 text-sm sm:flex-row sm:justify-between sm:gap-4">
              <span className="text-gray-800">
                {t(`plans.events.${e.type}`, { from: name(e.fromPlan), to: name(e.toPlan), count: e.detail })}
                {e.periodEnd && e.type !== "payment_blocked" && (
                  <span className="text-gray-500"> · {t("plans.history.until", { date: formatDate(e.periodEnd, DATE) })}</span>
                )}
              </span>
              <span className="whitespace-nowrap text-xs text-gray-500">{formatDate(e.at, DATE_TIME)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
