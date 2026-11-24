# Premium Resume Builder

Students with **Premium** can build professional, ATS-friendly resumes, preview them live, and generate a PDF for **₹50 each**.
Premium itself costs **₹50 for 3 months** (90 days).
Every payment goes through **email OTP verification first, then Razorpay**.

## Setup

### Backend (`backend/`)

1. Run `npm install` (this adds `razorpay` and `pdfkit`).
2. Add the Razorpay settings to `backend/.env` (see `.env.example`):
   - `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`: from the Razorpay Dashboard, **Test Mode**, then **API Keys**.
   - `RAZORPAY_WEBHOOK_SECRET` (recommended): add a webhook for `https://<your-backend>/api/payments/webhook` with the events `payment.captured`, `payment.failed` and `order.paid`, using the same secret. This confirms payments even if the student's browser closes.
3. The email OTP uses the same SMTP settings as the language feature. Without SMTP in development, the code is printed in the backend console.

Prices and durations can be changed with `PREMIUM_PRICE_PAISE`, `PREMIUM_DURATION_DAYS` and `RESUME_PRICE_PAISE`.
Without Razorpay keys, the pay buttons are disabled and a notice is shown.

**Testing payments:** in Test Mode, use Razorpay's test card `4111 1111 1111 1111` (any future expiry and any CVV) or the test UPI ID `success@razorpay`.

### Frontend (`internarea/`)

Nothing new to install. Razorpay Checkout is loaded on demand from `checkout.razorpay.com`.

## How it works

| Requirement | Where |
|---|---|
| Resume Builder, available to Premium users only | `/resume` (dashboard) and `/resume/[id]` (builder). The server returns `PREMIUM_REQUIRED` for anyone else. |
| Personal details, education, skills, experience, internships, projects, certifications, achievements, languages, social links, career objective, references, profile photo | `internarea/src/pages/resume/[id].tsx`. Validated and cleaned on the server in `backend/utils/resumeData.js`. |
| Multiple ATS-friendly templates (Classic, Modern, Minimal, Executive), custom colours, fonts and text size | Single-column layout with real, selectable text: `backend/utils/resumePdf.js` (PDF) and `internarea/src/resume/ResumePreview.tsx` (matching live preview) |
| Preview before downloading | Live preview next to the form, which updates as you type |
| Several resumes and versions | Several drafts per student. Every save creates a version that can be previewed or restored (the latest 30 are kept). |
| ₹50 per resume, Premium ₹50 for 3 months | `backend/config/payments.js` |
| Email OTP before Razorpay; payment opens only after verification | `POST /api/payments/otp`, then `/otp/verify`. `POST /api/payments/order` refuses requests without a verified OTP. |
| PDF generated only after verified payment | `backend/services/payments.js`: the Razorpay signature is checked, the payment is fetched from Razorpay, and the amount and order are matched before the PDF is generated |
| PDF linked to the profile and set as default; default can be changed | `User.defaultResumeId`, set on the **Generated resumes** tab, shown on **Profile**, and preselected (and changeable) in every Apply dialog |
| Complete history | **Payments & invoices** (every order, with status, IDs and a downloadable invoice PDF), **Download history** (your downloads and recruiter views), **Generated resumes**, and **Versions** |

Recruiters see an attached resume on the application detail page, through a private, unguessable link.

### Edge cases handled

- **Wrong OTP:** each code allows 5 attempts and then locks. Codes are compared in constant time and stored only as a keyed hash.
- **Expired OTP:** a code is valid for 5 minutes, with a countdown in the dialog. After verification, the student has 15 minutes to start paying, otherwise they must verify again.
- **Repeated OTP requests:** 60-second cooldown, at most 5 per hour, and a new code cancels the previous one.
- **Cancelled checkout:** recorded as *Cancelled*, and the student can retry without a new OTP (up to 3 attempts per verification).
- **Failed payment:** recorded as *Failed* with Razorpay's reason, and the student can retry.
- **Duplicate payments:**
  - A double click reuses the same order.
  - Starting again closes older unpaid orders.
  - Paying for content that was already generated is refused up front.
  - If two tabs both pay anyway, the second payment is **refunded automatically**.
  - One verification pays for exactly one purchase.
- **Incomplete resume:** missing or invalid fields are listed and highlighted, and the OTP and payment can't start until they're fixed. Text the PDF fonts can't display (for example Devanagari) is also flagged.
- **Payment interrupted (connection lost, tab closed):**
  - The dialog keeps checking with the server, which checks Razorpay directly.
  - The pending payment is remembered in the browser and settled on the next visit.
  - The webhook completes it even if the student never returns.
  - If PDF generation fails after a payment, it's retried. The student is never charged twice.
- **Payment amount or order mismatch, or a forged signature:** rejected, and nothing is generated.
- **Edits in two tabs:** a save based on an older version is rejected so changes aren't silently overwritten.

All new screens and messages are translated into the six supported languages.
Resume content and headings are in English, which is what applicant tracking systems expect.
