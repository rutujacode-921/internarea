import { api } from "@/lib/api";

export type Purpose = "premium" | "resume" | "subscription";
export type TransactionStatus = "created" | "paid" | "failed" | "cancelled" | "expired" | "refunded";

export interface Transaction {
  transactionId: string;
  purpose: Purpose;
  gateway: "razorpay" | "mock";
  status: TransactionStatus;
  amount: number;
  currency: string;
  description: string;
  resumeTitle: string | null;
  createdAt: string;
  paidAt: string | null;
  method: string | null;
  failureReason: string | null;
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  invoiceNumber: string | null;
  invoiceIssuedAt: string | null;
  fulfilled: boolean;
  fulfillmentFailed: boolean;
  generatedResumeId: string | null;
  premiumUntil: string | null;
  duplicate: boolean;
  refundStatus: "processed" | "failed" | null;
}

export interface Plans {
  configured: boolean;
  mode: "razorpay" | "mock";
  currency: string;
  premium: { price: number; durationDays: number };
  resume: { price: number };
  status: { active: boolean; until: string | null };
}

// ---- Razorpay Checkout ------------------------------------------------------

interface RazorpayInstance {
  open: () => void;
  on: (event: string, handler: (response: { error?: RazorpayError }) => void) => void;
}
export interface RazorpayError {
  code?: string;
  description?: string;
  reason?: string;
  source?: string;
  step?: string;
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

let scriptPromise: Promise<void> | null = null;

// Loads checkout.js once. A failed load can be retried.
export function loadRazorpay(): Promise<void> {
  if (typeof window !== "undefined" && window.Razorpay) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.onload = () => (window.Razorpay ? resolve() : reject(new Error("Razorpay unavailable")));
      script.onerror = () => {
        script.remove();
        reject(new Error("Could not load Razorpay"));
      };
      document.body.appendChild(script);
    }).catch((error) => {
      scriptPromise = null;
      throw error;
    });
  }
  return scriptPromise;
}

export function createCheckout(options: Record<string, unknown>): RazorpayInstance {
  if (!window.Razorpay) throw new Error("Razorpay not loaded");
  return new window.Razorpay(options);
}

// ---- Interrupted payments ---------------------------------------------------
// The transaction in progress is remembered so that if the tab closes or the
// connection drops mid-payment, its result is picked up on the next visit.

const PENDING_KEY = "internarea.pendingPayment";

export function rememberPendingPayment(transactionId: string, purpose: Purpose) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ transactionId, purpose, at: Date.now() }));
  } catch {
    // Storage unavailable; the webhook still completes the payment server-side.
  }
}

export function forgetPendingPayment(transactionId?: string) {
  try {
    const current = readPendingPayment();
    if (!transactionId || current?.transactionId === transactionId) localStorage.removeItem(PENDING_KEY);
  } catch {
    // Ignore.
  }
}

export function readPendingPayment(): { transactionId: string; purpose: Purpose; at: number } | null {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_KEY) || "null");
    if (value && typeof value.transactionId === "string") {
      // Give up after a day; the payment history still shows the outcome.
      if (Date.now() - value.at > 24 * 60 * 60 * 1000) {
        localStorage.removeItem(PENDING_KEY);
        return null;
      }
      return value;
    }
  } catch {
    // Ignore.
  }
  return null;
}

export const isFinal = (t: Transaction) =>
  t.status === "refunded" ||
  (t.status === "paid" && t.fulfilled) ||
  t.status === "failed" ||
  t.status === "cancelled" ||
  t.status === "expired";

export async function fetchTransaction(transactionId: string): Promise<Transaction> {
  const { data } = await api.get(`/api/payments/${transactionId}`);
  return data.transaction;
}

// ---- Files --------------------------------------------------------------------

async function saveBlob(url: string, fallbackName: string) {
  const response = await api.get(url, { responseType: "blob", timeout: 60000 });
  const disposition = String(response.headers["content-disposition"] || "");
  const name = disposition.match(/filename="([^"]+)"/)?.[1] || fallbackName;
  const href = URL.createObjectURL(response.data as Blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10000);
}

export const downloadGeneratedResume = (id: string) =>
  saveBlob(`/api/resumes/generated/${id}/download`, "Resume.pdf");

export const downloadInvoice = (transactionId: string) =>
  saveBlob(`/api/payments/${transactionId}/invoice`, "Invoice.pdf");

// Opens a generated resume in a new tab (the request needs the auth header,
// so it is fetched first and shown from a blob URL).
export async function viewGeneratedResume(id: string) {
  const tab = window.open("", "_blank");
  const response = await api.get(`/api/resumes/generated/${id}/download?inline=1`, { responseType: "blob", timeout: 60000 });
  const href = URL.createObjectURL(new Blob([response.data as Blob], { type: "application/pdf" }));
  if (tab) tab.location.href = href;
  else window.location.href = href;
}

// Blob error bodies need decoding before the API error message can be read.
export async function readBlobError(error: unknown): Promise<unknown> {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (data instanceof Blob) {
    try {
      (error as { response: { data: unknown } }).response.data = JSON.parse(await data.text());
    } catch {
      // Not JSON.
    }
  }
  return error;
}
