import { api } from "@/lib/api";

// Internship application plans (Task 6).

export type PlanId = "free" | "bronze" | "silver" | "gold";

export interface Plan {
  id: PlanId;
  name: string;
  price: number; // paise
  limit: number | null; // null = unlimited
  rank: number;
}

export interface SubscriptionSummary {
  plan: PlanId;
  planName: string;
  price: number;
  limit: number | null;
  used: number;
  remaining: number | null;
  unlimited: boolean;
  quotaResetsAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  renewsOn: string | null;
  cancelAtPeriodEnd: boolean;
  scheduledPlan: PlanId | null;
  nextPeriodPaid: PlanId | null;
  renewOpensAt: string | null;
  canRenew: boolean;
  renewPlan: PlanId | null;
}

export interface PaymentWindow {
  open: boolean;
  start: string;
  end: string;
  zone: string;
}

export interface SubscriptionState {
  subscription: SubscriptionSummary;
  plans: Plan[];
  currency: string;
  periodDays: number;
  renewWindowDays: number;
  paymentWindow: PaymentWindow;
  payments: { configured: boolean; mode: "razorpay" | "mock" };
  hasEmail: boolean;
}

export interface Quote {
  kind: "new" | "upgrade" | "renewal";
  plan: PlanId;
  amount: number;
  fullPrice: number;
  credit: number;
  periodStart: string;
  periodEnd: string;
}

export interface PlanPayment {
  transactionId: string;
  status: "created" | "paid" | "failed" | "cancelled" | "expired" | "refunded";
  gateway: "razorpay" | "mock";
  amount: number;
  currency: string;
  description: string;
  plan: PlanId | null;
  kind: Quote["kind"] | null;
  credit: number;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
  paidAt: string | null;
  method: string | null;
  failureReason: string | null;
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  invoiceNumber: string | null;
  fulfilled: boolean;
  refundStatus: "processed" | "failed" | null;
}

export interface SubscriptionEvent {
  id: string;
  type: string;
  fromPlan: PlanId | null;
  toPlan: PlanId | null;
  periodStart: string | null;
  periodEnd: string | null;
  detail: string;
  at: string;
}

export const fetchSubscription = async (): Promise<SubscriptionState> => (await api.get("/api/subscriptions")).data;

export const fetchHistory = async (): Promise<{ events: SubscriptionEvent[]; payments: PlanPayment[] }> =>
  (await api.get("/api/subscriptions/history")).data;

export const fetchQuote = async (plan: PlanId): Promise<Quote> => (await api.get("/api/subscriptions/quote", { params: { plan } })).data.quote;

export const formatRupees = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: paise % 100 ? 2 : 0 }).format(paise / 100);

export const SUBSCRIPTION_CHANGED_EVENT = "internarea:subscription-changed";
export const notifySubscriptionChanged = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SUBSCRIPTION_CHANGED_EVENT));
};
