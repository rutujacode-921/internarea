import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, CreditCard, Download, FlaskConical, Loader2, Lock, Mail, ShieldCheck, X, XCircle } from "lucide-react";
import { toast } from "react-toastify";
import { api, getApiError } from "@/lib/api";
import { useLanguage } from "@/i18n/LanguageProvider";
import { formatPaise, ResumeIssue } from "@/resume/config";
import {
  createCheckout,
  downloadGeneratedResume,
  fetchTransaction,
  forgetPendingPayment,
  loadRazorpay,
  Purpose,
  RazorpayError,
  readBlobError,
  rememberPendingPayment,
  Transaction,
} from "@/resume/payments";

interface Props {
  purpose: Purpose;
  resumeId?: string;
  price: number;
  itemLabel: string;
  onClose: () => void;
  onCompleted: (transaction: Transaction) => void;
  onIncomplete?: (issues: ResumeIssue[]) => void;
}

type Phase =
  | "sending" // sending the email OTP
  | "otp" // waiting for the code
  | "verifying"
  | "verified" // OTP accepted; payment unlocked
  | "creating" // creating the order / loading checkout
  | "checkout" // Razorpay window open
  | "mockCheckout" // simulated checkout (PAYMENT_MODE=mock, local demos only)
  | "confirming" // checking the payment with the server
  | "success"
  | "failed"
  | "cancelled"
  | "pending" // still unconfirmed after polling
  | "blocked"; // cannot continue (e.g. already generated)

const BUSY: Phase[] = ["sending", "verifying", "creating", "confirming"];
const DEAD_CODE_ERRORS = ["OTP_EXPIRED", "OTP_LOCKED", "OTP_USED", "OTP_NOT_FOUND"];
const REVERIFY_ERRORS = ["PAYMENT_VERIFICATION_EXPIRED", "PAYMENT_OTP_REQUIRED", "PAYMENT_ATTEMPTS_EXCEEDED"];
const BLOCKING_ERRORS = ["ALREADY_GENERATED", "PREMIUM_REQUIRED", "PAYMENTS_UNAVAILABLE", "NO_EMAIL", "RESUME_NOT_FOUND", "INVALID_PURPOSE"];

const countdown = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Email OTP first, then Razorpay. Payment cannot start until the code is verified,
// and nothing is generated until the server has confirmed the payment.
export default function PaymentFlowModal({ purpose, resumeId, price, itemLabel, onClose, onCompleted, onIncomplete }: Props) {
  const { t, formatDate, locale } = useLanguage();
  const [phase, setPhase] = useState<Phase>("sending");
  const [otp, setOtp] = useState<{ id: string; expiresAt: number; maskedEmail: string } | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [code, setCode] = useState("");
  const [codeDead, setCodeDead] = useState(false);
  const [verifiedUntil, setVerifiedUntil] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [mockOrder, setMockOrder] = useState<{ transactionId: string; orderId: string } | null>(null);
  const [mockBusy, setMockBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);
  const started = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const priceLabel = formatPaise(price, locale);

  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, []);

  const messageFor = useCallback(
    (e: unknown) => {
      const err = getApiError(e);
      switch (err.code) {
        case "NETWORK":
          return t("errors.network");
        case "OTP_INVALID":
          return t("language.otp.invalid", { attempts: Number(err.data?.attemptsLeft ?? 0) });
        case "OTP_EXPIRED":
          return t("language.otp.expired");
        case "OTP_LOCKED":
          return t("language.otp.locked");
        case "OTP_COOLDOWN":
          return t("language.otp.cooldown", { seconds: Number(err.data?.retryAfter) || 60 });
        default:
          return err.message || t("errors.generic");
      }
    },
    [t]
  );

  // Errors that end the flow or send the user back to fix their resume.
  const handleBlocking = useCallback(
    (e: unknown) => {
      const err = getApiError(e);
      if (err.code === "RESUME_INCOMPLETE" && onIncomplete) {
        onIncomplete((err.data?.issues as ResumeIssue[]) || []);
        onClose();
        return true;
      }
      if (BLOCKING_ERRORS.includes(err.code)) {
        setError(messageFor(e));
        setPhase("blocked");
        return true;
      }
      return false;
    },
    [messageFor, onClose, onIncomplete]
  );

  const sendCode = useCallback(async () => {
    setPhase("sending");
    setError(null);
    try {
      const { data } = await api.post("/api/payments/otp", { purpose, resumeId });
      if (!mounted.current) return;
      const sentAt = Date.now();
      setOtp({ id: data.otpId, expiresAt: sentAt + Number(data.expiresInSeconds) * 1000, maskedEmail: data.maskedEmail });
      setResendAt(sentAt + Number(data.resendInSeconds) * 1000);
      setCode("");
      setCodeDead(false);
      setPhase("otp");
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch (e) {
      if (!mounted.current || handleBlocking(e)) return;
      const retryAfter = Number(getApiError(e).data?.retryAfter) || 0;
      if (retryAfter) setResendAt(Date.now() + retryAfter * 1000);
      setError(messageFor(e));
      setPhase("otp");
    }
  }, [purpose, resumeId, handleBlocking, messageFor]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    sendCode();
  }, [sendCode]);

  const verifyCode = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!otp || phase !== "otp") return;
    if (!/^\d{6}$/.test(code)) return setError(t("language.otp.codeFormat"));
    if (Date.now() >= otp.expiresAt) {
      setCodeDead(true);
      return setError(t("language.otp.expired"));
    }
    setPhase("verifying");
    setError(null);
    try {
      const { data } = await api.post("/api/payments/otp/verify", { otpId: otp.id, code });
      if (!mounted.current) return;
      setVerifiedUntil(Date.now() + Number(data.verifiedForSeconds) * 1000);
      setPhase("verified");
    } catch (e) {
      if (!mounted.current) return;
      const err = getApiError(e);
      if (DEAD_CODE_ERRORS.includes(err.code)) setCodeDead(true);
      if (err.code === "OTP_INVALID") setCode("");
      setError(messageFor(e));
      setPhase("otp");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const finish = useCallback(
    (tx: Transaction) => {
      forgetPendingPayment(tx.transactionId);
      setTransaction(tx);
      setError(null);
      setPhase("success");
      onCompleted(tx);
    },
    [onCompleted]
  );

  // Polls the server, which also asks Razorpay directly, until the outcome is known.
  const pollUntilSettled = useCallback(
    async (transactionId: string) => {
      setPhase("confirming");
      for (let attempt = 0; attempt < 20 && mounted.current; attempt++) {
        try {
          const tx = await fetchTransaction(transactionId);
          if (!mounted.current) return;
          setTransaction(tx);
          if (tx.status === "refunded" || (tx.status === "paid" && tx.fulfilled)) return finish(tx);
          if (["failed", "cancelled", "expired"].includes(tx.status)) {
            forgetPendingPayment(transactionId);
            setError(tx.failureReason ? t("resume.pay.failed", { reason: tx.failureReason }) : t("resume.pay.failedGeneric"));
            return setPhase("failed");
          }
        } catch {
          // Offline or server busy: keep trying.
        }
        await wait(3000);
      }
      if (mounted.current) setPhase("pending");
    },
    [finish, t]
  );

  const confirmPayment = useCallback(
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
        return pollUntilSettled(transactionId); // Paid, PDF still being generated.
      } catch {
        // Connection dropped, gateway slow, or not captured yet: the server
        // checks with Razorpay on every status request.
        if (mounted.current) pollUntilSettled(transactionId);
      }
    },
    [finish, pollUntilSettled]
  );

  const cancelPayment = useCallback(
    async (transactionId: string, lastError: RazorpayError | null) => {
      try {
        const { data } = await api.post(`/api/payments/${transactionId}/cancel`, {
          reason: lastError ? "failed" : "dismissed",
          error: lastError,
        });
        const tx: Transaction = data.transaction;
        if (!mounted.current) return;
        // Paid just before the window closed.
        if (tx.status === "paid" || tx.status === "refunded") return tx.fulfilled || tx.status === "refunded" ? finish(tx) : pollUntilSettled(transactionId);
        forgetPendingPayment(transactionId);
      } catch {
        // Couldn't reach the server; the pending record lets it reconcile later.
      }
      if (!mounted.current) return;
      if (lastError) {
        setError(lastError.description ? t("resume.pay.failed", { reason: lastError.description }) : t("resume.pay.failedGeneric"));
        setPhase("failed");
      } else {
        setError(null);
        setPhase("cancelled");
      }
    },
    [finish, pollUntilSettled, t]
  );

  const startPayment = async () => {
    if (!otp) return;
    if (Date.now() >= verifiedUntil) {
      setError(t("resume.pay.reverify"));
      return sendCode();
    }
    setPhase("creating");
    setError(null);

    let order: { transaction: Transaction; checkout: Record<string, unknown> & { prefill: Record<string, string> } };
    try {
      const { data } = await api.post("/api/payments/order", { otpId: otp.id });
      if (!mounted.current) return;
      if (data.alreadyPaid) {
        toast.info(t("resume.pay.alreadyPaid"));
        return data.transaction.fulfilled || data.transaction.status === "refunded"
          ? finish(data.transaction)
          : pollUntilSettled(data.transaction.transactionId);
      }
      order = data;
    } catch (e) {
      if (!mounted.current || handleBlocking(e)) return;
      const err = getApiError(e);
      if (REVERIFY_ERRORS.includes(err.code)) {
        setError(messageFor(e));
        setOtp(null);
        setVerifiedUntil(0);
        setPhase("otp");
        return;
      }
      setError(messageFor(e));
      return setPhase("verified");
    }

    const transactionId = order.transaction.transactionId;
    rememberPendingPayment(transactionId, purpose);

    // Simulated checkout for local demos without Razorpay keys.
    if (order.checkout.mode === "mock") {
      setMockOrder({ transactionId, orderId: String(order.checkout.orderId) });
      return setPhase("mockCheckout");
    }

    try {
      await loadRazorpay();
    } catch {
      if (!mounted.current) return;
      // The order stays unpaid and expires on its own; the student can retry.
      forgetPendingPayment(transactionId);
      setError(t("resume.pay.scriptFailed"));
      return setPhase("verified");
    }
    if (!mounted.current) return;

    let handled = false;
    let lastError: RazorpayError | null = null;
    try {
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
          confirmPayment(transactionId, response);
        },
        modal: {
          confirm_close: true,
          ondismiss: () => {
            if (!handled) cancelPayment(transactionId, lastError);
          },
        },
      });
      checkout.on("payment.failed", (response) => {
        // Checkout lets the user retry in the same window; remember the reason.
        lastError = response.error || { description: "" };
      });
      setPhase("checkout");
      checkout.open();
    } catch {
      setError(t("resume.pay.scriptFailed"));
      setPhase("verified");
    }
  };

  const finishMock = async (outcome: "success" | "fail" | "cancel") => {
    if (!mockOrder || mockBusy) return;
    const { transactionId, orderId } = mockOrder;
    if (outcome === "cancel") {
      setMockOrder(null);
      return cancelPayment(transactionId, null);
    }
    setMockBusy(true);
    try {
      const { data } = await api.post("/api/payments/mock/complete", { orderId, outcome });
      setMockOrder(null);
      if (data.error) return cancelPayment(transactionId, data.error);
      return confirmPayment(transactionId, data);
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setMockBusy(false);
    }
  };

  const tryAgain = () => {
    setError(null);
    if (otp && Date.now() < verifiedUntil) startPayment();
    else sendCode();
  };

  const busy = BUSY.includes(phase) || phase === "checkout" || phase === "mockCheckout";
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const step = ["sending", "otp", "verifying"].includes(phase) ? 1 : phase === "success" ? 3 : 2;
  const expired = Boolean(otp && now >= otp.expiresAt);
  const canResend = !busy && now >= resendAt;
  const title = purpose === "premium" ? t("resume.pay.titlePremium") : t("resume.pay.titleResume");

  const download = async () => {
    if (!transaction?.generatedResumeId) return;
    setDownloading(true);
    try {
      await downloadGeneratedResume(transaction.generatedResumeId);
    } catch (e) {
      toast.error(messageFor(await readBlobError(e)));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4" role="dialog" aria-modal="true" aria-labelledby="payment-title">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="flex items-start justify-between border-b p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-blue-600" />
            <h2 id="payment-title" className="text-lg font-semibold text-gray-900">
              {title}
            </h2>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="text-gray-400 hover:text-gray-600 disabled:opacity-40" aria-label={t("common.close")}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="flex items-center justify-between rounded-lg bg-gray-50 p-3 text-sm">
            <span className="text-gray-700">{itemLabel}</span>
            <span className="font-semibold text-gray-900">{priceLabel}</span>
          </div>

          <ol className="flex items-center gap-2 text-xs font-medium" aria-label={t("resume.pay.progress")}>
            {[t("resume.pay.step1"), t("resume.pay.step2"), t("resume.pay.step3")].map((label, i) => (
              <li key={label} className={`flex flex-1 items-center gap-1 rounded-full px-2 py-1 ${step > i + 1 ? "bg-green-100 text-green-800" : step === i + 1 ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-500"}`} aria-current={step === i + 1 ? "step" : undefined}>
                <span>{i + 1}.</span>
                <span className="truncate">{label}</span>
              </li>
            ))}
          </ol>

          {/* Step 1: email OTP */}
          {["sending", "otp", "verifying"].includes(phase) && (
            <form onSubmit={verifyCode} className="space-y-3" noValidate>
              <p className="text-sm text-gray-600">{t("resume.pay.otpIntro")}</p>
              {phase === "sending" && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("language.otp.sending")}
                </div>
              )}
              {otp && phase !== "sending" && (
                <>
                  <div className="flex items-center gap-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
                    <Mail className="h-4 w-4 shrink-0" />
                    <span>{t("language.otp.sentTo", { email: otp.maskedEmail })}</span>
                  </div>
                  <div>
                    <label htmlFor="payment-otp" className="mb-1 block text-sm font-medium text-gray-700">
                      {t("language.otp.enterCode")}
                    </label>
                    <input
                      ref={inputRef}
                      id="payment-otp"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={code}
                      disabled={codeDead || expired || phase !== "otp"}
                      onChange={(e) => {
                        setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                        if (error && !codeDead) setError(null);
                      }}
                      placeholder={t("language.otp.codePlaceholder")}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-center text-2xl tracking-[0.5em] text-black focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                    />
                    {!expired && !codeDead && (
                      <p className="mt-1 text-xs text-gray-500">{t("language.otp.expiresIn", { time: countdown(otp.expiresAt - now) })}</p>
                    )}
                  </div>
                </>
              )}
              {(error || (expired && !codeDead)) && (
                <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  {error || t("language.otp.expired")}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <button type="button" onClick={sendCode} disabled={!canResend} className="text-sm font-medium text-blue-600 hover:text-blue-700 disabled:cursor-not-allowed disabled:text-gray-400">
                  {now < resendAt ? t("language.otp.resendIn", { seconds: Math.ceil((resendAt - now) / 1000) }) : otp ? t("language.otp.resend") : t("resume.pay.sendCode")}
                </button>
                <button
                  type="submit"
                  disabled={!otp || codeDead || expired || phase !== "otp" || code.length !== 6}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {phase === "verifying" && <Loader2 className="h-4 w-4 animate-spin" />}
                  {phase === "verifying" ? t("language.otp.verifying") : t("resume.pay.verify")}
                </button>
              </div>
            </form>
          )}

          {/* Step 2: pay */}
          {["verified", "creating", "checkout"].includes(phase) && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-800">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{t("resume.pay.verified")}</span>
              </div>
              {verifiedUntil > now && (
                <p className="text-xs text-gray-500">{t("resume.pay.verifiedFor", { time: countdown(verifiedUntil - now) })}</p>
              )}
              {error && (
                <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </p>
              )}
              <button
                type="button"
                onClick={startPayment}
                disabled={phase !== "verified"}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {phase === "verified" ? <CreditCard className="h-5 w-5" /> : <Loader2 className="h-5 w-5 animate-spin" />}
                {phase === "verified" ? t("resume.pay.payNow", { price: priceLabel }) : t("resume.pay.opening")}
              </button>
              <p className="flex items-center justify-center gap-1 text-xs text-gray-500">
                <Lock className="h-3 w-3" />
                {t("resume.pay.secureNote")}
              </p>
            </div>
          )}

          {phase === "mockCheckout" && (
            <div className="space-y-3 rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 p-4">
              <p className="flex items-center gap-2 font-semibold text-amber-900">
                <FlaskConical className="h-5 w-5" />
                {t("resume.pay.mock.title")}
              </p>
              <p className="text-sm text-amber-900">{t("resume.pay.mock.note")}</p>
              {error && (
                <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">
                  {error}
                </p>
              )}
              <button
                type="button"
                onClick={() => finishMock("success")}
                disabled={mockBusy}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 font-medium text-white hover:bg-green-700 disabled:opacity-60"
              >
                {mockBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("resume.pay.mock.pay", { price: priceLabel })}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => finishMock("fail")} disabled={mockBusy} className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60">
                  {t("resume.pay.mock.fail")}
                </button>
                <button type="button" onClick={() => finishMock("cancel")} disabled={mockBusy} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60">
                  {t("resume.pay.mock.cancel")}
                </button>
              </div>
            </div>
          )}

          {phase === "confirming" && (
            <div className="flex items-center gap-3 rounded-lg bg-blue-50 p-4 text-sm text-blue-800" role="status">
              <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
              <span>{transaction?.status === "paid" && purpose === "resume" ? t("resume.pay.generating") : t("resume.pay.confirming")}</span>
            </div>
          )}

          {phase === "pending" && (
            <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800" role="status">
              {t("resume.pay.stillConfirming")}
            </p>
          )}

          {(phase === "failed" || phase === "cancelled") && (
            <div className="space-y-3">
              <div className={`flex items-start gap-2 rounded-lg p-3 text-sm ${phase === "failed" ? "bg-red-50 text-red-700" : "bg-gray-50 text-gray-700"}`} role="alert">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{phase === "failed" ? error || t("resume.pay.failedGeneric") : t("resume.pay.cancelled")}</span>
              </div>
              <button type="button" onClick={tryAgain} className="w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700">
                {t("resume.pay.tryAgain")}
              </button>
            </div>
          )}

          {phase === "blocked" && (
            <div className="space-y-3">
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800" role="alert">
                {error}
              </p>
              <Link href="/resume" onClick={onClose} className="block text-center text-sm font-medium text-blue-600 hover:text-blue-700">
                {t("resume.pay.viewMyResumes")}
              </Link>
            </div>
          )}

          {/* Step 3: done */}
          {phase === "success" && transaction && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-800" role="status">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {transaction.duplicate
                    ? t("resume.pay.duplicateRefunded")
                    : purpose === "premium"
                    ? t("resume.pay.successPremium", { date: formatDate(transaction.premiumUntil) })
                    : t("resume.pay.successResume")}
                </span>
              </div>
              {purpose === "resume" && transaction.generatedResumeId && (
                <button type="button" onClick={download} disabled={downloading} className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60">
                  {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {t("resume.pay.download")}
                </button>
              )}
              {transaction.invoiceNumber && (
                <p className="text-center text-xs text-gray-500">{t("resume.pay.invoiceNote", { number: transaction.invoiceNumber })}</p>
              )}
            </div>
          )}

          {!busy && (
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                {t("common.close")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
