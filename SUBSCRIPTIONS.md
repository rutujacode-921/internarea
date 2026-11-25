# Internship Application Plans (Task 6)

Students get a monthly limit on internship applications, set by their plan. They can raise it by buying a plan with Razorpay (Test Mode).

| Plan | Price | Internship applications |
|---|---|---|
| Free | ₹0 | 1 per month (resets on the 1st, IST) |
| Bronze | ₹100 / month | 3 per billing cycle |
| Silver | ₹300 / month | 5 per billing cycle |
| Gold | ₹1000 / month | Unlimited |

Job applications are not limited.

## Setup

It uses the same Razorpay setup as the Resume Builder (see `RESUME_BUILDER.md`):

- `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`, from Test Mode. Test card: `4111 1111 1111 1111`.
- `RAZORPAY_WEBHOOK_SECRET` is recommended.
- **No keys?** Set `PAYMENT_MODE=mock` in `backend/.env` for a simulated checkout with Pay / Fail / Cancel buttons. Everything else runs exactly as with Razorpay.
- **Emails:** the confirmation email uses the existing `SMTP_*` settings. Without SMTP in development, it's printed in the backend console.

Prices, the payment window and the period length can be changed in `.env` (see `.env.example`).

## Where to see it

| Place | What's there |
|---|---|
| `/plans` (navbar: **Plans**) | Compare the plans, and buy, upgrade, downgrade, renew or cancel. Also shows the payment-window status, current plan, payments and invoices, and subscription history. |
| `/profile` | Current plan, applications left, renewal or reset date, and recent invoices (downloadable PDFs) |
| Internship **Apply** dialog | Applications left. When the limit is reached, a message with a link to upgrade. |

## How it works

### Plans and billing

A paid plan is a **prepaid 30-day period**. Nothing is charged automatically; the student renews by paying for the next period.

| Action | Behaviour |
|---|---|
| **Purchase** (from Free) | Starts now, for 30 days, with a fresh quota |
| **Upgrade** | Starts **immediately** with a new 30-day period and a fresh quota. The unused days of the current plan are credited, so Bronze → Silver on day 1 costs about ₹200. An early renewal already paid for the old plan is refunded. |
| **Downgrade** | Scheduled. The current plan continues until the period ends, and the renewal is then for the lower plan. Can be undone. |
| **Renew** | Possible in the last 7 days of the period. The paid next period starts automatically when the current one ends. |
| **Cancel** | The plan stays active until the period ends, then the student moves to Free. No refund for the current period. An already paid next period is refunded. Can be undone. |

### Payment time window

Payments can only be **started** between **5:00 AM and 11:45 AM IST**.

- The check runs on the server, against the server's clock, before any Razorpay order is created.
- Attempts outside the window get a clear message and are logged in the subscription history.
- The Plans page shows whether payments are open right now.
- A payment started at 11:44 that completes at 11:47 is still honoured.

### After a successful payment

1. The Razorpay signature is checked, the payment is fetched from Razorpay, and the order and amount are matched.
2. The plan is activated and the quota is updated in the database. This happens exactly once, even if verification runs twice.
3. An invoice number is assigned, and a confirmation email is sent automatically, once, with the invoice PDF attached. It contains:
   - the plan name
   - the amount paid (and the credit, for upgrades)
   - the transaction ID (Razorpay payment ID), plus the order ID and invoice number
   - the validity period
   - the billing details (name, email, payment method)

   If the email fails to send, it is retried later.

### Quota enforcement

- Internship applications now require sign-in.
- Each application uses one from the quota, through an atomic database update. Applications sent at the same moment can't go over the limit; the test sends four at once with one slot left, and exactly one succeeds.
- When the limit is reached, the application is refused with a message saying when the quota renews and how to upgrade.
- Applying twice to the same internship is refused and doesn't use quota.
- If saving the application fails, its quota is given back.

### History

| Record | Contents |
|---|---|
| `Payment` (purpose `subscription`) | Every attempt: paid, failed (with Razorpay's reason), cancelled, expired or refunded. Includes order/payment IDs, invoice number, plan, period and a full event log. |
| `SubscriptionEvent` | Every change: activated, upgraded, renewed, renewal started, downgrade scheduled or undone, cancelled or undone, cancellation effective, expired, quota reset, payment blocked (outside hours), duplicate payment refunded |

## Edge cases

| Case | Handling |
|---|---|
| **Failed payment** | Recorded as failed with the reason; the plan doesn't change, and the student can try again |
| **Cancelled checkout** | Recorded as cancelled. The server first checks with Razorpay, in case it was paid just before the window closed. |
| **Duplicate payment attempts** | Only one unpaid plan order can exist per user (database index), so a double click reuses it. If two tabs pay anyway, the second payment no longer matches the subscription it was priced for, and it's **refunded automatically**. A second payment on the same order is also refunded. |
| **Payment verification failure** | A forged signature, wrong amount or wrong order is rejected and nothing is activated. A temporary gateway error makes the page keep checking with the server, which asks Razorpay directly. |
| **Interrupted payment** | The pending payment is remembered and settled on the next visit to `/plans`; the webhook also completes it. Unpaid orders expire after 30 minutes. |
| **Expired subscription** | When the period ends without a renewal, the student moves to Free automatically (checked on every request; no cron job needed) |
| **Quota reset each billing cycle** | Paid plans: a new period gives a fresh quota. Free: resets on the 1st of each month, IST. Each reset is logged. |
| **Limit exhausted** | Applying is blocked until the quota renews or the plan is upgraded. An upgrade gives a fresh quota at once. |
| **Concurrent changes** | Every change to a subscription checks a version number, so simultaneous requests (a payment arriving while the student cancels, for example) can't overwrite each other |

All new screens, messages and the confirmation email are translated into the six supported languages.

## Testing tips

- **Payment window:** to test outside 5:00–11:45 AM IST, temporarily set `PAYMENT_WINDOW_START=00:00` and `PAYMENT_WINDOW_END=23:59` in `.env` and restart. Remove them for the real window.
- **Quota:** a new account is on Free. Apply to one internship and the second is blocked. Buy Bronze and you can apply 3 more times.
