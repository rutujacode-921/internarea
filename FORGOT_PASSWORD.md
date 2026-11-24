# Forgot Password (Task 3)

InternArea previously only had **Continue with Google**, which has no password to reset. Task 3 therefore adds **email or mobile number + password accounts**, alongside Google sign-in, and a secure **Forgot Password** flow for them.

## Setup

### Backend (`backend/`)

1. Run `npm install` (this adds `bcryptjs` and `jsonwebtoken`).
2. Add to `backend/.env`:
   - `JWT_SECRET`: a long random string. Without it, password users are signed out whenever the server restarts.
   - Email: the existing `SMTP_*` settings.
   - SMS (optional): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM`.
3. Without SMTP or Twilio in development, codes and new passwords are printed in the backend console (`[DEV EMAIL]` / `[DEV SMS]`). In production, sending fails instead.

All limits can be changed through the `RESET_*` and `LOGIN_*` variables in `.env.example`.

## Pages

| Route | Purpose |
|---|---|
| `/signup` | Create an account with name, email and/or mobile number, and a password |
| `/login` | Log in with email or mobile number + password (or Google). Has a "Forgot password?" link. |
| `/forgot-password` | The dedicated Forgot Password page |
| `/change-password` | Change password. Required right after logging in with a reset password. |
| `/profile` | "Password & security" section, plus the password reset history table |

## How it works

| Requirement | Implementation |
|---|---|
| Reset by registered email **or** mobile number | `/forgot-password` lets the student choose. The code is sent by email or by SMS (Twilio). |
| Only once every 24 hours | Each account's daily use is claimed atomically (`User.lastResetRequestAt`). Further requests get **"You can use this option only once per day."** and the page shows when the student can try again. |
| OTP before resetting | 6-digit code, valid for 5 minutes, stored only as a keyed hash |
| Resend limits | 60-second cooldown and at most 3 resends per request. Each new code replaces the old one. |
| Attempt limits | 5 wrong codes per request, then it locks |
| Random letters-only password | 12 characters of A–Z and a–z, mixing both cases, from a cryptographic random generator (`utils/passwords.js`) |
| Stored securely | Hashed with **bcrypt** (12 rounds). The password itself is never stored. |
| Delivered only by the verified channel | Sent by the same email or SMS that received the code. It never appears in the API response or the page. |
| Must change after next login | `mustChangePassword` is set. Until the student changes it, the server rejects every other request (`PASSWORD_CHANGE_REQUIRED`) and the app redirects to `/change-password`. |
| Full reset history | `PasswordReset` collection: request time, method, masked email/phone, verification status, wrong attempts, resends, IP, browser, OS and device. Shown on the profile page. |

### Edge cases

- **Expired OTP:** rejected, and a new code can be requested (within the resend limit). The whole request expires after 30 minutes.
- **Invalid user details:** wrong format, unknown account, or a Google-only account (which has no password) each get a clear message.
- **Multiple simultaneous requests:** two tabs or a double click can't both start a reset; the daily claim is atomic, so only one succeeds.
- **Repeated wrong codes:** the request locks after 5 attempts, and the current password stays unchanged.
- **Network interruptions:**
  - The page remembers the open request for the tab and resumes it after a reload.
  - If the connection drops while a code is being checked, the page asks the server what happened instead of assuming it failed.
  - If the reset code can't be sent, that attempt doesn't count toward the 24-hour limit.
  - The new password is sent before it's saved, so if delivery fails, the old password keeps working and the student can retry sending (up to 3 times).
- **Unauthorized resets:**
  - A code is accepted only once.
  - Each network is limited to 10 reset requests per hour, which stops bulk probing of accounts.
  - A successful reset or password change signs out every existing session.
  - Repeated failed logins lock the account for 15 minutes.
  - The email tells the account owner what to do if they didn't ask for the reset.

## Known limitations

- Sign-up doesn't verify the email or mobile number. Forgot Password always sends to the address or number on the account, so a reset can't be redirected elsewhere.
- The server says when no account matches the details entered, so someone could check whether an address is registered. The per-network limit slows this down. Showing a generic message instead is a one-line change if your mentor prefers it.
