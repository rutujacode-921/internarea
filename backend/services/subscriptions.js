const User = require("../Model/User");
const { Payment } = require("../Model/Payment");
const SubscriptionEvent = require("../Model/SubscriptionEvent");
const { PLANS, PAID_PLAN_IDS, SUBSCRIPTION_SETTINGS: S } = require("../config/subscriptions");
const payments = require("./payments");
const { renderInvoicePdf } = require("../utils/invoicePdf");
const { sendSubscriptionConfirmationEmail } = require("../utils/mailer");

// Internship application plans (Task 6).
//
// A paid plan is a prepaid period of S.periodDays days. Nothing is charged
// automatically: the student renews by paying for the next period (possible in
// the last days of the current one). The state is brought up to date lazily
// whenever it is read (expiry -> Free, a prepaid renewal starting, quota resets),
// and every write checks a version number, so concurrent requests can't
// overwrite each other.

const DAY = 24 * 60 * 60 * 1000;
const periodMs = () => S.periodDays * DAY;
const timeOf = (d) => (d ? new Date(d).getTime() : null);

// =============================================================================
// Time zone helpers (IST by default)
// =============================================================================

function zoneParts(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: S.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

// The instant that is 00:00 on the 1st of the given month in the plan time zone.
function startOfZoneMonth(year, month1) {
  const guess = Date.UTC(year, month1 - 1, 1);
  const p = zoneParts(new Date(guess));
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - guess;
  return new Date(guess - offset);
}

const nextMonthStart = (now) => {
  const { year, month } = zoneParts(now);
  return month === 12 ? startOfZoneMonth(year + 1, 1) : startOfZoneMonth(year, month + 1);
};

const formatClock = (minutes) => {
  const h = Math.floor(minutes / 60);
  return `${h % 12 || 12}:${String(minutes % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

// Payments may only be started between 5:00 AM and 11:45 AM IST (inclusive).
function paymentWindow(now = new Date()) {
  const { hour, minute } = zoneParts(now);
  const current = hour * 60 + minute;
  return {
    open: current >= S.paymentWindowStart && current <= S.paymentWindowEnd,
    start: formatClock(S.paymentWindowStart),
    end: formatClock(S.paymentWindowEnd),
    zone: S.timeZone === "Asia/Kolkata" ? "IST" : S.timeZone,
  };
}

// =============================================================================
// State
// =============================================================================

const plain = (sub) => {
  const s = sub && typeof sub.toObject === "function" ? sub.toObject() : { ...(sub || {}) };
  return {
    plan: PLANS[s.plan] ? s.plan : "free",
    periodStart: s.periodStart || null,
    periodEnd: s.periodEnd || null,
    cancelAtPeriodEnd: Boolean(s.cancelAtPeriodEnd),
    scheduledPlan: s.scheduledPlan || null,
    prepaidNext: { plan: s.prepaidNext?.plan || null, paymentId: s.prepaidNext?.paymentId || null },
    usedApplications: s.usedApplications || 0,
    cycleKey: s.cycleKey || null,
    appliedPaymentIds: s.appliedPaymentIds || [],
    version: s.version || 0,
  };
};

const isPaid = (s) => s.plan !== "free";

// Which billing cycle a quota belongs to: the paid period, or the calendar
// month (in IST) on Free.
function cycleKeyFor(s, now) {
  if (isPaid(s)) return `p:${timeOf(s.periodStart)}`;
  const { year, month } = zoneParts(now);
  return `f:${year}-${String(month).padStart(2, "0")}`;
}

// Moves the state forward to `now`: ended periods expire to Free (or a prepaid
// renewal starts), and a new billing cycle resets the application count.
function advance(s, now) {
  const next = { ...s, prepaidNext: { ...s.prepaidNext } };
  const events = [];
  for (let guard = 0; isPaid(next) && next.periodEnd && next.periodEnd <= now && guard < 36; guard++) {
    if (next.prepaidNext.plan) {
      const from = next.plan;
      next.plan = next.prepaidNext.plan;
      next.periodStart = next.periodEnd;
      next.periodEnd = new Date(timeOf(next.periodEnd) + periodMs());
      events.push({ type: "renewal_started", fromPlan: from, toPlan: next.plan, paymentId: next.prepaidNext.paymentId, periodStart: next.periodStart, periodEnd: next.periodEnd, at: next.periodStart });
      next.prepaidNext = { plan: null, paymentId: null };
      next.scheduledPlan = null;
      next.cancelAtPeriodEnd = false;
    } else {
      events.push({ type: next.cancelAtPeriodEnd ? "cancellation_effective" : "expired", fromPlan: next.plan, toPlan: "free", at: next.periodEnd });
      next.plan = "free";
      next.periodStart = null;
      next.periodEnd = null;
      next.cancelAtPeriodEnd = false;
      next.scheduledPlan = null;
    }
  }
  const key = cycleKeyFor(next, now);
  if (key !== next.cycleKey) {
    if (next.cycleKey) {
      events.push({ type: "quota_reset", toPlan: next.plan, detail: String(next.usedApplications), at: now });
    }
    next.usedApplications = 0;
    next.cycleKey = key;
  }
  return { next, events };
}

const stateChanged = (a, b) =>
  a.plan !== b.plan ||
  timeOf(a.periodStart) !== timeOf(b.periodStart) ||
  timeOf(a.periodEnd) !== timeOf(b.periodEnd) ||
  a.cancelAtPeriodEnd !== b.cancelAtPeriodEnd ||
  a.scheduledPlan !== b.scheduledPlan ||
  a.prepaidNext.plan !== b.prepaidNext.plan ||
  a.usedApplications !== b.usedApplications ||
  a.cycleKey !== b.cycleKey ||
  a.appliedPaymentIds.length !== b.appliedPaymentIds.length;

// Matches the stored version (older users have no subscription field yet).
const versionFilter = (version) =>
  version === 0 ? { $or: [{ "subscription.version": 0 }, { "subscription.version": { $exists: false } }] } : { "subscription.version": version };

async function logEvents(uid, events) {
  if (events.length) await SubscriptionEvent.insertMany(events.map((e) => ({ uid, ...e })));
}

/**
 * Applies a change to a user's subscription with optimistic concurrency.
 * `change(state, now)` returns { next, events, result } or { error }.
 */
async function mutate(uid, change) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const user = await User.findOne({ uid });
    if (!user) return { error: { status: 404, code: "UNAUTHORIZED" } };
    const now = new Date();
    const current = plain(user.subscription);
    const advanced = advance(current, now);
    const outcome = change ? change(advanced.next, now, user) : { next: advanced.next, events: [] };
    if (outcome.error) {
      // Still save the expiry / quota reset that happened along the way.
      if (stateChanged(current, advanced.next)) await save(user, current, advanced.next, advanced.events);
      return outcome;
    }
    const events = [...advanced.events, ...(outcome.events || [])];
    if (!stateChanged(current, outcome.next)) return { ...outcome, user };
    if (await save(user, current, outcome.next, events)) {
      return { ...outcome, user: await User.findById(user._id) };
    }
    // Someone else changed it meanwhile: start again from the fresh state.
  }
  return { error: { status: 409, code: "SUBSCRIPTION_BUSY" } };
}

async function save(user, before, next, events) {
  const result = await User.updateOne(
    { _id: user._id, ...versionFilter(before.version) },
    { $set: { subscription: { ...next, version: before.version + 1 } } }
  );
  if (!result.modifiedCount) return false;
  await logEvents(user.uid, events);
  return true;
}

// Brings the stored state up to date (expiry, renewals, quota reset).
async function syncSubscription(uid) {
  const outcome = await mutate(uid, null);
  return outcome.user || User.findOne({ uid });
}

// What the profile and plans page show.
function summarize(user, now = new Date()) {
  const s = plain(user.subscription);
  const plan = PLANS[s.plan];
  const paid = isPaid(s);
  const remaining = plan.limit === null ? null : Math.max(0, plan.limit - s.usedApplications);
  const renewOpensAt = paid ? new Date(timeOf(s.periodEnd) - S.renewWindowDays * DAY) : null;
  return {
    plan: s.plan,
    planName: plan.name,
    price: plan.price,
    limit: plan.limit,
    used: s.usedApplications,
    remaining,
    unlimited: plan.limit === null,
    // When the application count starts again from zero.
    quotaResetsAt: paid ? s.periodEnd : nextMonthStart(now),
    periodStart: s.periodStart,
    periodEnd: s.periodEnd,
    renewsOn: paid && !s.cancelAtPeriodEnd ? s.periodEnd : null,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    scheduledPlan: s.scheduledPlan,
    nextPeriodPaid: s.prepaidNext.plan,
    renewOpensAt,
    canRenew: paid && !s.prepaidNext.plan && now >= renewOpensAt,
    renewPlan: paid ? s.scheduledPlan || s.plan : null,
  };
}

// =============================================================================
// Pricing a purchase
// =============================================================================

/**
 * Works out what buying `planId` means right now:
 *  - new:      from Free (or an expired plan); starts now
 *  - upgrade:  to a higher plan; starts now, with credit for unused days
 *  - renewal:  the current plan (or the scheduled downgrade) for the next period
 * Downgrades are not bought directly; they are scheduled for the next renewal.
 */
function quote(user, planId, now = new Date()) {
  if (!PAID_PLAN_IDS.includes(planId)) return { error: { status: 400, code: "INVALID_PLAN" } };
  const { next: s } = advance(plain(user.subscription), now);
  const target = PLANS[planId];
  const current = PLANS[s.plan];
  const basis = { basisPlan: s.plan, basisPeriodEnd: s.periodEnd };

  if (!isPaid(s)) {
    return { kind: "new", plan: planId, amount: target.price, fullPrice: target.price, credit: 0, periodStart: now, periodEnd: new Date(timeOf(now) + periodMs()), ...basis };
  }

  if (target.rank > current.rank) {
    const unused = Math.max(0, timeOf(s.periodEnd) - timeOf(now));
    // Unused days of the current plan, rounded to whole rupees.
    const credit = Math.min(current.price, Math.round((current.price * unused) / periodMs() / 100) * 100);
    const amount = Math.max(target.price - credit, S.minimumCharge);
    return { kind: "upgrade", plan: planId, amount, fullPrice: target.price, credit: target.price - amount, periodStart: now, periodEnd: new Date(timeOf(now) + periodMs()), ...basis };
  }

  if (planId === s.plan || planId === s.scheduledPlan) {
    if (s.prepaidNext.plan) return { error: { status: 409, code: "ALREADY_RENEWED", vars: {}, extra: { periodEnd: s.periodEnd } } };
    const opensAt = new Date(timeOf(s.periodEnd) - S.renewWindowDays * DAY);
    if (now < opensAt) return { error: { status: 409, code: "RENEW_TOO_EARLY", vars: { days: S.renewWindowDays }, extra: { renewOpensAt: opensAt } } };
    return { kind: "renewal", plan: planId, amount: target.price, fullPrice: target.price, credit: 0, periodStart: s.periodEnd, periodEnd: new Date(timeOf(s.periodEnd) + periodMs()), ...basis };
  }

  return { error: { status: 409, code: "DOWNGRADE_AT_RENEWAL" } };
}

// =============================================================================
// Activating a paid plan (called once the payment is verified)
// =============================================================================

async function markFulfilled(paymentId, set, event) {
  const updated = await Payment.findByIdAndUpdate(paymentId, { $set: { fulfilledAt: new Date(), fulfillmentError: null, ...set } }, { new: true });
  if (event) await payments.addEvent(paymentId, event.type, event.detail);
  return updated;
}

async function activateFromPayment(paymentDoc) {
  let payment = await Payment.findById(paymentDoc._id);
  if (!payment || payment.status !== "paid" || payment.fulfilledAt) return payment;
  const meta = payment.subscription || {};
  let refundPrepaidId = null;
  let duplicate = false;
  let applied = null;

  const outcome = await mutate(payment.uid, (s, now) => {
    if (s.appliedPaymentIds.some((id) => String(id) === String(payment._id))) return { next: s, events: [], result: "already" };

    // Was the order priced against the subscription as it is now? If another
    // payment (e.g. from a second tab) changed it first, this one is a duplicate.
    const unchanged = s.plan === meta.basisPlan && timeOf(s.periodEnd) === timeOf(meta.basisPeriodEnd);
    let kind = meta.kind;
    if (!unchanged || (kind === "renewal" && s.prepaidNext.plan)) {
      // A plan that simply ran out while the student was paying: start it now.
      if (!isPaid(s)) kind = "new";
      else {
        duplicate = true;
        return { next: s, events: [], result: "duplicate" };
      }
    }

    const next = { ...s, prepaidNext: { ...s.prepaidNext }, appliedPaymentIds: [...s.appliedPaymentIds, payment._id] };
    const from = s.plan;
    if (kind === "renewal") {
      next.prepaidNext = { plan: meta.plan, paymentId: payment._id };
      next.cancelAtPeriodEnd = false;
      next.scheduledPlan = null;
      applied = { periodStart: s.periodEnd, periodEnd: new Date(timeOf(s.periodEnd) + periodMs()) };
      return { next, events: [{ type: "renewed", fromPlan: from, toPlan: meta.plan, paymentId: payment._id, ...applied }] };
    }

    // new or upgrade: a fresh period starts now with a fresh quota.
    if (s.prepaidNext.paymentId) refundPrepaidId = s.prepaidNext.paymentId; // an early renewal of the old plan
    next.plan = meta.plan;
    next.periodStart = now;
    next.periodEnd = new Date(timeOf(now) + periodMs());
    next.prepaidNext = { plan: null, paymentId: null };
    next.cancelAtPeriodEnd = false;
    next.scheduledPlan = null;
    next.usedApplications = 0;
    next.cycleKey = cycleKeyFor(next, now);
    applied = { periodStart: next.periodStart, periodEnd: next.periodEnd };
    return { next, events: [{ type: kind === "upgrade" ? "upgraded" : "activated", fromPlan: from, toPlan: meta.plan, paymentId: payment._id, ...applied }] };
  });

  if (outcome.error) {
    await Payment.updateOne({ _id: payment._id }, { $set: { fulfillmentError: outcome.error.code } });
    return Payment.findById(payment._id);
  }

  if (duplicate) {
    await logEvents(payment.uid, [{ type: "duplicate_payment", toPlan: meta.plan, paymentId: payment._id }]);
    payment = await markFulfilled(payment._id, {}, { type: "duplicate_detected", detail: "Subscription already changed by another payment" });
    await payments.refundPayment(payment, "Duplicate subscription payment");
    return Payment.findById(payment._id);
  }

  if (outcome.result === "already") {
    return markFulfilled(payment._id, {});
  }

  payment = await markFulfilled(
    payment._id,
    { "subscription.periodStart": applied.periodStart, "subscription.periodEnd": applied.periodEnd },
    { type: "subscription_activated", detail: `${meta.plan} ${applied.periodStart.toISOString()} - ${applied.periodEnd.toISOString()}` }
  );

  if (refundPrepaidId) {
    const prepaid = await Payment.findById(refundPrepaidId);
    if (prepaid && prepaid.status === "paid") await payments.refundPayment(prepaid, "Early renewal replaced by an upgrade");
  }

  sendConfirmation(payment._id).catch((error) => console.error("Subscription email failed:", error.message));
  return payment;
}

// Emails the confirmation with the invoice attached, exactly once per payment.
async function sendConfirmation(paymentId) {
  const claimed = await Payment.findOneAndUpdate(
    { _id: paymentId, status: "paid", fulfilledAt: { $ne: null }, confirmationEmailAt: null, "invoice.number": { $ne: null } },
    { $set: { confirmationEmailAt: new Date() } },
    { new: true }
  );
  if (!claimed || !claimed.email) return;
  try {
    const user = await User.findOne({ uid: claimed.uid }).select("language");
    const pdf = await renderInvoicePdf(claimed);
    await sendSubscriptionConfirmationEmail({ payment: claimed, plan: PLANS[claimed.subscription.plan], invoicePdf: pdf, uiLanguage: user?.language || "en" });
    await payments.addEvent(claimed._id, "confirmation_emailed", claimed.email);
  } catch (error) {
    // Let a later request try again.
    await Payment.updateOne({ _id: paymentId }, { $set: { confirmationEmailAt: null } });
    await payments.addEvent(paymentId, "confirmation_email_failed", error.message);
    throw error;
  }
}

// Retries confirmation emails that failed earlier (e.g. SMTP was down).
async function retryPendingConfirmations(uid) {
  const pending = await Payment.find({
    uid,
    purpose: "subscription",
    status: "paid",
    fulfilledAt: { $ne: null },
    confirmationEmailAt: null,
    duplicateOf: null,
    paidAt: { $gte: new Date(Date.now() - 7 * DAY) },
  }).select("_id");
  for (const p of pending) await sendConfirmation(p._id).catch(() => undefined);
}

// =============================================================================
// Changes that need no payment
// =============================================================================

// Downgrade: takes effect at the next renewal (no refunds for the current period).
// Downgrading to Free is the same as cancelling.
async function scheduleDowngrade(uid, planId) {
  if (planId === "free") return cancelSubscription(uid);
  return mutate(uid, (s) => {
    if (!isPaid(s)) return { error: { status: 409, code: "NO_ACTIVE_PLAN" } };
    if (!PAID_PLAN_IDS.includes(planId) || PLANS[planId].rank >= PLANS[s.plan].rank) return { error: { status: 400, code: "INVALID_PLAN" } };
    if (s.prepaidNext.plan) return { error: { status: 409, code: "ALREADY_RENEWED", extra: { periodEnd: s.periodEnd } } };
    const next = { ...s, scheduledPlan: planId, cancelAtPeriodEnd: false };
    return { next, events: [{ type: "downgrade_scheduled", fromPlan: s.plan, toPlan: planId, periodEnd: s.periodEnd }] };
  });
}

// Cancel: the plan stays until the period ends, then becomes Free.
function cancelChange(s) {
  if (!isPaid(s)) return { error: { status: 409, code: "NO_ACTIVE_PLAN" } };
  if (s.cancelAtPeriodEnd) return { next: s, events: [] };
  const next = { ...s, cancelAtPeriodEnd: true, scheduledPlan: null, prepaidNext: { plan: null, paymentId: null } };
  return { next, events: [{ type: "cancelled", fromPlan: s.plan, toPlan: "free", periodEnd: s.periodEnd }], refundPaymentId: s.prepaidNext.paymentId };
}

async function cancelSubscription(uid) {
  const outcome = await mutate(uid, cancelChange);
  // An already paid next period is refunded.
  if (!outcome.error && outcome.refundPaymentId) {
    const prepaid = await Payment.findById(outcome.refundPaymentId);
    if (prepaid && prepaid.status === "paid") await payments.refundPayment(prepaid, "Subscription cancelled before the renewal started");
  }
  return outcome;
}

// Undo a cancellation or a scheduled downgrade.
function keepCurrentPlan(uid) {
  return mutate(uid, (s) => {
    if (!isPaid(s)) return { error: { status: 409, code: "NO_ACTIVE_PLAN" } };
    if (!s.cancelAtPeriodEnd && !s.scheduledPlan) return { next: s, events: [] };
    const next = { ...s, cancelAtPeriodEnd: false, scheduledPlan: null };
    return { next, events: [{ type: s.cancelAtPeriodEnd ? "cancellation_undone" : "downgrade_undone", toPlan: s.plan }] };
  });
}

// =============================================================================
// Application quota
// =============================================================================

/**
 * Uses one internship application from the current cycle's quota. Atomic: two
 * applications sent at the same moment can't both take the last one.
 * Returns { ok: true, cycleKey } or { ok: false, summary }.
 */
async function consumeApplication(uid) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const user = await syncSubscription(uid);
    if (!user) return { ok: false, summary: null };
    const s = plain(user.subscription);
    const limit = PLANS[s.plan].limit;
    const filter = { _id: user._id, "subscription.cycleKey": s.cycleKey, "subscription.plan": s.plan };
    if (limit !== null) filter["subscription.usedApplications"] = { $lt: limit };
    const result = await User.updateOne(filter, { $inc: { "subscription.usedApplications": 1, "subscription.version": 1 } });
    if (result.modifiedCount) return { ok: true, cycleKey: s.cycleKey };
    // Either the quota is used up, or the cycle/plan changed meanwhile (retry).
    const fresh = plain((await User.findById(user._id)).subscription);
    if (fresh.cycleKey === s.cycleKey && fresh.plan === s.plan) return { ok: false, summary: summarize(await User.findById(user._id)) };
  }
  return { ok: false, summary: summarize(await syncSubscription(uid)) };
}

// Gives the application back if saving it failed.
async function releaseApplication(uid, cycleKey) {
  await User.updateOne(
    { uid, "subscription.cycleKey": cycleKey, "subscription.usedApplications": { $gt: 0 } },
    { $inc: { "subscription.usedApplications": -1, "subscription.version": 1 } }
  );
}

module.exports = {
  PLANS,
  paymentWindow,
  syncSubscription,
  summarize,
  quote,
  activateFromPayment,
  sendConfirmation,
  retryPendingConfirmations,
  scheduleDowngrade,
  cancelSubscription,
  keepCurrentPlan,
  consumeApplication,
  releaseApplication,
  logEvents,
};
