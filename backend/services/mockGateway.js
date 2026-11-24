const crypto = require("crypto");

// A stand-in for the Razorpay SDK, used only when PAYMENT_MODE=mock outside
// production. It has the same methods the app calls on Razorpay, so the rest of
// the payment code (signature checks, amount checks, refunds) runs unchanged.
// Orders and payments live in memory and are lost when the server restarts.

const SECRET = crypto.randomBytes(32).toString("hex");
const orders = new Map();
const payments = new Map();
const randomId = (prefix) => `${prefix}_mock${crypto.randomBytes(7).toString("hex")}`;

const notFound = (what) => Object.assign(new Error(`${what} not found`), { error: { description: `${what} not found` } });

const mockRazorpay = {
  orders: {
    async create({ amount, currency, receipt, notes }) {
      const order = { id: randomId("order"), amount, currency, receipt, notes, status: "created", created_at: Math.floor(Date.now() / 1000) };
      orders.set(order.id, order);
      return { ...order };
    },
    async fetchPayments(orderId) {
      return { items: [...payments.values()].filter((p) => p.order_id === orderId).map((p) => ({ ...p })) };
    },
  },
  payments: {
    async fetch(paymentId) {
      const payment = payments.get(paymentId);
      if (!payment) throw notFound("Payment");
      return { ...payment };
    },
    async capture(paymentId) {
      const payment = payments.get(paymentId);
      if (!payment) throw notFound("Payment");
      payment.status = "captured";
      return { ...payment };
    },
    async refund(paymentId, { amount }) {
      const payment = payments.get(paymentId);
      if (!payment) throw notFound("Payment");
      payment.refunded = true;
      return { id: randomId("rfnd"), payment_id: paymentId, amount };
    },
  },
};

// Simulates the student completing (or failing) the checkout for an order.
// Returns what Razorpay Checkout would hand to the browser.
function completeMockCheckout(orderId, outcome) {
  const order = orders.get(orderId);
  if (!order) return null;
  const payment = {
    id: randomId("pay"),
    order_id: orderId,
    amount: order.amount,
    currency: order.currency,
    status: outcome === "success" ? "captured" : "failed",
    method: "test",
    created_at: Math.floor(Date.now() / 1000),
    error_description: outcome === "success" ? null : "Simulated payment failure",
  };
  payments.set(payment.id, payment);
  if (outcome !== "success") {
    return { error: { code: "BAD_REQUEST_ERROR", description: payment.error_description, reason: "payment_failed" } };
  }
  return {
    razorpay_order_id: orderId,
    razorpay_payment_id: payment.id,
    razorpay_signature: crypto.createHmac("sha256", SECRET).update(`${orderId}|${payment.id}`).digest("hex"),
  };
}

module.exports = { mockRazorpay, completeMockCheckout, MOCK_SECRET: SECRET };
