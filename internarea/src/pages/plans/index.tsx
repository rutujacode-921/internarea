import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { Check, Clock, Loader2, ShieldCheck } from "lucide-react";
import { selectuser } from "@/Feature/Userslice";
import { api, getApiError } from "@/lib/api";
import { useLanguage } from "@/i18n/LanguageProvider";
import {
  fetchHistory,
  fetchQuote,
  fetchSubscription,
  formatRupees,
  notifySubscriptionChanged,
  Plan,
  PlanPayment,
  Quote,
  SubscriptionEvent,
  SubscriptionState,
} from "@/lib/subscription";
import { fetchTransaction, forgetPendingPayment, isFinal, readPendingPayment } from "@/resume/payments";
import SubscriptionOverview from "@/Components/subscription/SubscriptionOverview";
import SubscriptionCheckout from "@/Components/subscription/SubscriptionCheckout";
import { PaymentHistory, SubscriptionActivity } from "@/Components/subscription/BillingHistory";

type Action = { label: string; kind: "buy" | "downgrade" | "none"; style: "primary" | "secondary" | "muted"; note?: string };

// Compare plans, buy, upgrade, downgrade, renew or cancel (Task 6).
export default function PlansPage() {
  const { t, formatDate } = useLanguage();
  const user = useSelector(selectuser);
  const [state, setState] = useState<SubscriptionState | null>(null);
  const [history, setHistory] = useState<{ events: SubscriptionEvent[]; payments: PlanPayment[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<{ plan: Plan; quote: Quote } | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [s, h] = await Promise.all([fetchSubscription(), fetchHistory()]);
      setState(s);
      setHistory(h);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  // Settle a plan payment interrupted by a closed tab or lost connection.
  useEffect(() => {
    if (!user) return;
    const pending = readPendingPayment();
    if (!pending || pending.purpose !== "subscription") return;
    fetchTransaction(pending.transactionId)
      .then((tx) => {
        if (!isFinal(tx)) return toast.info(t("plans.checkout.pending"));
        forgetPendingPayment(tx.transactionId);
        if (tx.status === "paid") toast.success(t("plans.recovered"));
        load();
      })
      .catch(() => undefined);
  }, [user, load, t]);

  const showError = (e: unknown) => {
    const err = getApiError(e);
    toast.error(err.code === "NETWORK" ? t("errors.network") : err.message || t("errors.generic"));
  };

  const buy = async (plan: Plan) => {
    if (busy) return;
    setBusy(plan.id);
    try {
      const quote = await fetchQuote(plan.id);
      setCheckout({ plan, quote });
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
    }
  };

  const change = async (key: string, url: string, body: object | undefined, success: string, confirmText?: string) => {
    if (busy) return;
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(key);
    try {
      await api.post(url, body);
      toast.success(success);
      notifySubscriptionChanged();
      await load();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
    }
  };

  if (!user) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center bg-gray-50 px-4">
        <p className="text-gray-600">
          {t("plans.signIn")}{" "}
          <Link href="/login?next=/plans" className="font-medium text-blue-600">
            {t("account.nav.login")}
          </Link>
        </p>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        {failed ? (
          <button type="button" onClick={load} className="text-blue-600">
            {t("common.retry")}
          </button>
        ) : (
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        )}
      </div>
    );
  }

  const s = state.subscription;
  const current = state.plans.find((p) => p.id === s.plan)!;
  const win = state.paymentWindow;
  const paymentsOff = !state.payments.configured;

  // What the button on each plan card does.
  const actionFor = (plan: Plan): Action => {
    if (plan.id === "free") {
      if (s.plan === "free") return { label: t("plans.actions.current"), kind: "none", style: "muted" };
      return { label: t("plans.actions.freeViaCancel"), kind: "none", style: "muted" };
    }
    if (plan.id === s.plan || plan.id === s.scheduledPlan) {
      if (s.nextPeriodPaid) return { label: t("plans.actions.renewed"), kind: "none", style: "muted" };
      if (s.canRenew && plan.id === s.renewPlan) return { label: t("plans.actions.renew", { price: formatRupees(plan.price) }), kind: "buy", style: "primary" };
      if (plan.id === s.scheduledPlan) return { label: t("plans.actions.scheduled"), kind: "none", style: "muted" };
      return { label: t("plans.actions.current"), kind: "none", style: "muted", note: s.renewOpensAt ? t("plans.actions.renewFrom", { date: formatDate(s.renewOpensAt, { month: "short", day: "numeric" }) }) : undefined };
    }
    if (plan.rank > current.rank) {
      return { label: s.plan === "free" ? t("plans.actions.choose", { price: formatRupees(plan.price) }) : t("plans.actions.upgrade"), kind: "buy", style: "primary" };
    }
    return { label: t("plans.actions.downgrade"), kind: "downgrade", style: "secondary" };
  };

  return (
    <div className="min-h-screen bg-gray-50 py-10">
      <div className="mx-auto max-w-6xl space-y-8 px-4">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">{t("plans.title")}</h1>
          <p className="mt-2 text-gray-600">{t("plans.subtitle")}</p>
        </div>

        {/* Payment window */}
        <div className={`flex items-start gap-3 rounded-lg border p-4 text-sm ${win.open ? "border-green-200 bg-green-50 text-green-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          <Clock className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <p>
            <span className="font-semibold">{win.open ? t("plans.window.open") : t("plans.window.closed")}</span>{" "}
            {t("plans.window.hours", { start: win.start, end: win.end, zone: win.zone })}
          </p>
        </div>
        {paymentsOff && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{t("plans.paymentsOff")}</p>}
        {state.payments.mode === "mock" && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t("plans.mockMode")}</p>}
        {!state.hasEmail && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t("plans.noEmail")}</p>}

        {/* Plan cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {state.plans.map((plan) => {
            const action = actionFor(plan);
            const isCurrent = plan.id === s.plan;
            const disabled = action.kind === "none" || busy !== null || (action.kind === "buy" && (paymentsOff || !win.open || !state.hasEmail));
            return (
              <div key={plan.id} className={`flex flex-col rounded-2xl border bg-white p-6 shadow-sm ${isCurrent ? "border-blue-600 ring-2 ring-blue-600" : "border-gray-200"}`}>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900">{t(`plans.names.${plan.id}`)}</h2>
                  {isCurrent && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-medium text-white">{t("plans.yourPlan")}</span>}
                  {plan.id === "silver" && !isCurrent && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">{t("plans.popular")}</span>}
                </div>
                <p className="mt-3">
                  <span className="text-3xl font-bold text-gray-900">{plan.price ? formatRupees(plan.price) : formatRupees(0)}</span>
                  <span className="text-sm text-gray-500"> {t("plans.perMonthShort")}</span>
                </p>
                <ul className="mt-4 flex-1 space-y-2 text-sm text-gray-700">
                  <li className="flex gap-2">
                    <Check className="h-4 w-4 flex-shrink-0 text-green-600" />
                    {plan.limit === null ? t("plans.features.unlimited") : t("plans.features.limit", { count: plan.limit })}
                  </li>
                  <li className="flex gap-2">
                    <Check className="h-4 w-4 flex-shrink-0 text-green-600" />
                    {plan.price ? t("plans.features.period", { days: state.periodDays }) : t("plans.features.monthly")}
                  </li>
                  <li className="flex gap-2">
                    <Check className="h-4 w-4 flex-shrink-0 text-green-600" />
                    {t("plans.features.jobs")}
                  </li>
                  {plan.price > 0 && (
                    <li className="flex gap-2">
                      <Check className="h-4 w-4 flex-shrink-0 text-green-600" />
                      {t("plans.features.invoice")}
                    </li>
                  )}
                </ul>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    action.kind === "buy"
                      ? buy(plan)
                      : action.kind === "downgrade"
                      ? change(`down-${plan.id}`, "/api/subscriptions/downgrade", { plan: plan.id }, t("plans.toast.downgradeScheduled"), t("plans.confirm.downgrade", { plan: t(`plans.names.${plan.id}`), date: formatDate(s.periodEnd, { month: "short", day: "numeric" }) }))
                      : undefined
                  }
                  className={`mt-6 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed ${
                    action.style === "primary"
                      ? "bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                      : action.style === "secondary"
                      ? "border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {(busy === plan.id || busy === `down-${plan.id}`) && <Loader2 className="h-4 w-4 animate-spin" />}
                  {action.label}
                </button>
                {action.note && <p className="mt-2 text-center text-xs text-gray-500">{action.note}</p>}
              </div>
            );
          })}
        </div>
        <p className="flex items-center justify-center gap-2 text-xs text-gray-500">
          <ShieldCheck className="h-4 w-4" />
          {t("plans.howItWorks", { days: state.renewWindowDays })}
        </p>

        {/* Current plan + management */}
        <div className="grid gap-6 lg:grid-cols-2">
          <SubscriptionOverview
            summary={s}
            actions={
              s.plan !== "free" &&
              (s.cancelAtPeriodEnd || s.scheduledPlan ? (
                <button
                  type="button"
                  onClick={() => change("keep", "/api/subscriptions/keep", undefined, t("plans.toast.kept"))}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {busy === "keep" && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("plans.actions.keep", { plan: t(`plans.names.${s.plan}`) })}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    change("cancel", "/api/subscriptions/cancel", undefined, t("plans.toast.cancelled"), t(s.nextPeriodPaid ? "plans.confirm.cancelRefund" : "plans.confirm.cancel", { date: formatDate(s.periodEnd, { month: "short", day: "numeric" }) }))
                  }
                  disabled={busy !== null}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  {busy === "cancel" && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("plans.actions.cancel")}
                </button>
              ))
            }
          />
          {history && <PaymentHistory payments={history.payments} />}
        </div>
        {history && <SubscriptionActivity events={history.events} />}
      </div>

      {checkout && (
        <SubscriptionCheckout
          plan={checkout.plan}
          quote={checkout.quote}
          onClose={() => setCheckout(null)}
          onDone={() => {
            load();
          }}
        />
      )}
    </div>
  );
}
