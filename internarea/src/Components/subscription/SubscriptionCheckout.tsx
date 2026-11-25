import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, CreditCard, Loader2, X } from "lucide-react";
import { api, getApiError } from "@/lib/api";
import { useLanguage } from "@/i18n/LanguageProvider";
import {
  createCheckout,
  fetchTransaction,
  forgetPendingPayment,
  loadRazorpay,
  RazorpayError,
  rememberPendingPayment,
  Transaction,
} from "@/resume/payments";
import { formatRupees, notifySubscriptionChanged, Plan, Quote } from "@/lib/subscription";

type Phase = "ready" | "creating" | "checkout" | "mockCheckout" | "confirming" | "success" | "failed" | "cancelled" | "pending" | "blocked";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DATE: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };

// Pays for a plan: server order -> Razorpay Checkout (or the simulated one) ->
// signature verification on the server -> plan activated. If the connection
// drops or the window closes mid-payment, the server is asked for the outcome
// (it checks Razorpay directly), so nothing is lost or charged twice.
export default function SubscriptionCheckout({
  plan,
  quote,
  onClose,
  onDone,
}: {
  plan: Plan;
  quote: Quote;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, formatDate } = useLanguage();
  const [phase, setPhase] = useState<Phase>("ready");
  const [error, setError] = useState<string | null>(null);
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [mockOrder, setMockOrder] = useState<{ transactionId: string; orderId: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);

  const finish = useCallback(
    (tx: Transaction) => {
      forgetPendingPayment(tx.transactionId);
      setTransaction(tx);
      setPhase(tx.status === "refunded" ? "failed" : "success");
      if (tx.status === "refunded") setError(t("plans.checkout.refundedDuplicate"));
      notifySubscriptionChanged();
      onDone();
    },
    [onDone, t]
  );

  // Asks the server (which checks Razorpay) until the outcome is known.
  const poll = useCallback(
    async (transactionId: string) => {
      setPhase("confirming");
      for (let i = 0; i < 20 && mounted.current; i++) {
        try {
          const tx = await fetchTransaction(transactionId);
          if (!mounted.current) return;
          if (tx.status === "refunded" || (tx.status === "paid" && tx.fulfilled)) return finish(tx);
          if (["failed", "cancelled", "expired"].includes(tx.status)) {
            forgetPendingPayment(transactionId);
            setError(tx.failureReason ? t("plans.checkout.failedReason", { reason: tx.failureReason }) : t("plans.checkout.failed"));
            return setPhase("failed");
          }
        } catch {
          // Offline: keep trying.
        }
        await wait(3000);
      }
      if (mounted.current) setPhase("pending");
    },
    [finish, t]
  );

  const confirm = useCallback(
    async (transactionId: string, response: Record<string, string>) => {
      setPhase("confirming");
      try {
        const { data } = await api.post("/api/payments/verify", {
          orderId: response.razorpay_order_id,
          paymentId: response.razorpay_payment_id,
          signature: response.razorpay_signature,
        });
        if (!mounted.current) return;
        const tx: Transaction = data.transaction;
        if (tx.status === "refunded" || tx.fulfilled) return finish(tx);
        return poll(transactionId);
      } catch (e) {
        const err = getApiError(e);
        // A forged or mismatched payment is final; anything else may still succeed.
        if (["PAYMENT_SIGNATURE_INVALID", "PAYMENT_AMOUNT_MISMATCH"].includes(err.code)) {
          forgetPendingPayment(transactionId);
          setError(err.message || t("plans.checkout.verifyFailed"));
          return setPhase("failed");
        }
        if (mounted.current) poll(transactionId);
      }
    },
    [finish, poll, t]
  );

  const cancel = useCallback(
    async (transactionId: string, lastError: RazorpayError | null) => {
      try {
        const { data } = await api.post(`/api/payments/${transactionId}/cancel`, { reason: lastError ? "failed" : "dismissed", error: lastError });
        const tx: Transaction = data.transaction;
        // Paid just before the window was closed.
        if (tx.status === "paid" || tx.status === "refunded") return tx.fulfilled || tx.status === "refunded" ? finish(tx) : poll(transactionId);
        forgetPendingPayment(transactionId);
      } catch {
        // The pending record lets it be settled later.
      }
      if (!mounted.current) return;
      if (lastError) {
        setError(lastError.description ? t("plans.checkout.failedReason", { reason: lastError.description }) : t("plans.checkout.failed"));
        setPhase("failed");
      } else setPhase("cancelled");
    },
    [finish, poll, t]
  );

  const start = async () => {
    if (["creating", "checkout", "mockCheckout", "confirming"].includes(phase)) return;
    setPhase("creating");
    setError(null);
    let order: { transaction: { transactionId: string }; checkout: Record<string, unknown> & { prefill: Record<string, string> } };
    try {
      const { data } = await api.post("/api/subscriptions/order", { plan: plan.id });
      if (!mounted.current) return;
      if (data.alreadyPaid) return poll(data.transaction.transactionId);
      order = data;
    } catch (e) {
      const err = getApiError(e);
      setError(err.code === "NETWORK" ? t("errors.network") : err.message || t("errors.generic"));
      return setPhase(err.code === "PAYMENT_WINDOW_CLOSED" ? "blocked" : "failed");
    }

    const transactionId = order.transaction.transactionId;
    rememberPendingPayment(transactionId, "subscription");

    if (order.checkout.mode === "mock") {
      setMockOrder({ transactionId, orderId: String(order.checkout.orderId) });
      return setPhase("mockCheckout");
    }
    try {
      await loadRazorpay();
    } catch {
      forgetPendingPayment(transactionId);
      setError(t("plans.checkout.scriptFailed"));
      return setPhase("failed");
    }
    let handled = false;
    let lastError: RazorpayError | null = null;
    const checkout = createCheckout({
      key: order.checkout.keyId,
      order_id: order.checkout.orderId,
      amount: order.checkout.amount,
      currency: order.checkout.currency,
      name: "InternArea",
      description: order.checkout.description,
      prefill: order.checkout.prefill,
      notes: { transactionId },
      theme: { color: "#2563eb" },
      handler: (response: Record<string, string>) => {
        handled = true;
        confirm(transactionId, response);
      },
      modal: {
        confirm_close: true,
        ondismiss: () => {
          if (!handled) cancel(transactionId, lastError);
        },
      },
    });
    checkout.on("payment.failed", (response) => {
      lastError = response.error || { description: "" };
    });
    setPhase("checkout");
    checkout.open();
  };

  const finishMock = async (outcome: "success" | "fail" | "cancel") => {
    if (!mockOrder) return;
    const { transactionId, orderId } = mockOrder;
    setMockOrder(null);
    if (outcome === "cancel") return cancel(transactionId, null);
    setPhase("confirming");
    try {
      const { data } = await api.post("/api/payments/mock/complete", { orderId, outcome });
      if (data.error) return cancel(transactionId, data.error);
      return confirm(transactionId, data);
    } catch {
      return poll(transactionId);
    }
  };

  const busy = ["creating", "confirming", "checkout"].includes(phase);
  const kindLabel = t(`plans.kinds.${quote.kind}`);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <CreditCard className="h-5 w-5 text-blue-600" />
            {t("plans.checkout.title", { plan: plan.name })}
          </h2>
          <button type="button" onClick={onClose} disabled={busy || phase === "mockCheckout"} className="text-gray-400 hover:text-gray-600 disabled:opacity-40" aria-label={t("common.close")}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Summary */}
          <dl className="space-y-2 rounded-lg bg-gray-50 p-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-600">{t("plans.checkout.type")}</dt>
              <dd className="font-medium text-gray-900">{kindLabel}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-600">{t("plans.checkout.applications")}</dt>
              <dd className="font-medium text-gray-900">{plan.limit === null ? t("plans.unlimited") : t("plans.perMonth", { count: plan.limit })}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-600">{t("plans.checkout.validity")}</dt>
              <dd className="text-right font-medium text-gray-900">
                {formatDate(quote.periodStart, DATE)} – {formatDate(quote.periodEnd, DATE)}
              </dd>
            </div>
            {quote.credit > 0 && (
              <>
                <div className="flex justify-between">
                  <dt className="text-gray-600">{t("plans.checkout.price")}</dt>
                  <dd className="text-gray-900">{formatRupees(quote.fullPrice)}</dd>
                </div>
                <div className="flex justify-between text-green-700">
                  <dt>{t("plans.checkout.credit")}</dt>
                  <dd>−{formatRupees(quote.credit)}</dd>
                </div>
              </>
            )}
            <div className="flex justify-between border-t border-gray-200 pt-2 text-base">
              <dt className="font-semibold text-gray-900">{t("plans.checkout.total")}</dt>
              <dd className="font-bold text-gray-900">{formatRupees(quote.amount)}</dd>
            </div>
          </dl>
          {quote.kind === "renewal" && <p className="text-xs text-gray-500">{t("plans.checkout.renewalNote")}</p>}

          {phase === "mockCheckout" && (
            <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">{t("plans.checkout.mockTitle")}</p>
              <p className="text-xs text-amber-900">{t("plans.checkout.mockNote")}</p>
              <button type="button" onClick={() => finishMock("success")} className="w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700">
                {t("plans.checkout.mockPay", { amount: formatRupees(quote.amount) })}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => finishMock("fail")} className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm text-red-700 hover:bg-red-50">
                  {t("plans.checkout.mockFail")}
                </button>
                <button type="button" onClick={() => finishMock("cancel")} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                  {t("plans.checkout.mockCancel")}
                </button>
              </div>
            </div>
          )}

          {(phase === "creating" || phase === "confirming" || phase === "checkout") && (
            <p className="flex items-center gap-2 text-sm text-gray-700">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              {phase === "confirming" ? t("plans.checkout.confirming") : phase === "checkout" ? t("plans.checkout.inCheckout") : t("plans.checkout.creating")}
            </p>
          )}

          {phase === "success" && (
            <div className="flex gap-3 rounded-lg bg-green-50 p-4 text-sm text-green-900">
              <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-600" />
              <div>
                <p className="font-semibold">{t(quote.kind === "renewal" ? "plans.checkout.successRenewal" : "plans.checkout.success", { plan: plan.name })}</p>
                <p className="mt-1">{t("plans.checkout.emailSent")}</p>
                {transaction?.razorpayPaymentId && <p className="mt-1 font-mono text-xs">{t("plans.checkout.transactionId", { id: transaction.razorpayPaymentId })}</p>}
              </div>
            </div>
          )}

          {phase === "pending" && (
            <div className="flex gap-3 rounded-lg bg-blue-50 p-4 text-sm text-blue-900">
              <Clock className="h-5 w-5 flex-shrink-0 text-blue-600" />
              <p>{t("plans.checkout.pending")}</p>
            </div>
          )}

          {phase === "cancelled" && <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{t("plans.checkout.cancelled")}</p>}

          {(phase === "failed" || phase === "blocked") && error && (
            <div className={`flex gap-3 rounded-lg p-3 text-sm ${phase === "blocked" ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-800"}`} role="alert">
              {phase === "blocked" ? <Clock className="h-5 w-5 flex-shrink-0" /> : <AlertTriangle className="h-5 w-5 flex-shrink-0" />}
              <p>{error}</p>
            </div>
          )}

          {/* Actions */}
          {phase === "ready" && (
            <button type="button" onClick={start} className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white hover:bg-blue-700">
              {t("plans.checkout.pay", { amount: formatRupees(quote.amount) })}
            </button>
          )}
          {(phase === "failed" || phase === "cancelled") && transaction?.status !== "refunded" && (
            <button type="button" onClick={start} className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white hover:bg-blue-700">
              {t("plans.checkout.tryAgain")}
            </button>
          )}
          {["success", "pending", "blocked"].includes(phase) && (
            <button type="button" onClick={onClose} className="w-full rounded-lg border border-gray-300 px-4 py-2.5 font-medium text-gray-700 hover:bg-gray-50">
              {t("common.close")}
            </button>
          )}
          <p className="text-center text-xs text-gray-400">{t("plans.checkout.secure")}</p>
        </div>
      </div>
    </div>
  );
}
