# Multi-language support

InternArea supports **English, Spanish, Hindi, Portuguese, Chinese and French**.
Switching to **French** needs a one-time password (OTP) sent to the user's registered email.

## Setup

### Backend (`backend/`)

1. Copy `.env.example` to `.env` and fill in the values:
   - `DATABASE_URL`: your MongoDB connection string
   - `OTP_SECRET`: a long random string, used to hash OTPs
   - `SMTP_*` / `MAIL_FROM`: your email account for sending OTPs. For Gmail, use `smtp.gmail.com`, port `465`, and an [App Password](https://myaccount.google.com/apppasswords).
2. Run `npm install`, then `npm start` (runs on port 5000).

> **Testing without email:** if `SMTP_HOST` is empty and `NODE_ENV` is not `production`,
> the OTP is printed in the backend console (`[DEV EMAIL] ... OTP: 123456`) instead of being emailed.

### Frontend (`internarea/`)

1. Create `internarea/.env.local` with the backend URL:
   ```
   NEXT_PUBLIC_API_URL=http://localhost:5000
   ```
   If you leave it out, the app uses `http://localhost:5000`.
2. Run `npm install`, then `npm run dev`.

## How it works

| Requirement | Where |
|---|---|
| Six languages across all pages, menus, forms, toasts and validation | `internarea/src/i18n/locales/*.json`, used through `useLanguage().t(...)` |
| Switching with no page refresh (current page, form input and session are kept) | `internarea/src/i18n/LanguageProvider.tsx` |
| Saved in the user's profile (across devices and future logins) | `backend/Model/User.js`, `GET/PUT /api/language/preference` |
| Saved in browser preferences | `localStorage` plus a `NEXT_LOCALE` cookie. On a first visit, the browser's own language is used if supported. |
| French needs an email OTP | `POST /api/language/otp` and `POST /api/language/otp/verify`, `internarea/src/Components/LanguageOtpModal.tsx` |
| Localized emails and server messages | `backend/i18n/messages.js` |
| Audit history (language, time, IP, browser, device) | `backend/Model/LanguageChangeLog.js`, `GET /api/language/history`, shown on the **Profile** page |
| Blocking unauthorized changes | Every language endpoint checks the user's Firebase ID token (`backend/middleware/auth.js`). French cannot be set through the normal update endpoint. |

### Edge cases handled

- **Expired OTP:** the code is valid for 5 minutes. The dialog shows a countdown and asks for a new code once it expires.
- **Invalid OTP:** each code allows 5 attempts, then it locks. Codes are compared with a constant-time check and stored only as a keyed hash.
- **Repeated OTP requests:** there is a 60-second gap between requests and a limit of 5 per hour. Sending a new code cancels the previous one.
- **Reusing a code:** each code works only once, enforced with an atomic database update.
- **Network loss while switching:**
  - Translations retry automatically.
  - If saving to the profile fails while offline, the language still applies on the device and syncs when the connection returns.
  - If the connection drops just after an OTP is accepted, the app checks the profile so the user isn't told it failed.
- **Translation failures:** if a language can't be downloaded, the current language stays and an error is shown. A missing translation falls back to English, never a blank.
- **Unsupported content:** text that users enter (job titles, descriptions) and city names are shown as they were written. Dates are formatted for the selected language.
- **Other cases:** signing out while the OTP dialog is open closes it, and changes made in one browser tab are applied in your other open tabs.

All settings (expiry, cooldown, limits) can be changed with the `OTP_*` variables in `backend/.env.example`.
