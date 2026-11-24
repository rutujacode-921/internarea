# Login Security (Task 5)

Task 5 tracks every sign-in, changes the authentication rules based on the login environment, and lets students see and control where they are signed in.

## Setup

No new packages are needed. All settings are optional (`LOGIN_*`, `MOBILE_LOGIN_*`, `GEOIP_DISABLED` in `backend/.env.example`).

- In development without SMTP, sign-in codes are printed in the backend console (`[DEV EMAIL] ... OTP: 123456`).
- **Everyone has to sign in again once** after this update. Sessions now live on the server, so older tokens (including Google sign-ins) no longer work.

## Where to see it

| Place | What's there |
|---|---|
| `/login`, `/signup` | The Chrome OTP step and the mobile-hours message |
| `/profile` → **Active sessions** | Every signed-in device, with **Sign out** for each and **Sign out all other devices**. Also lists **Trusted devices**. |
| `/profile` → **Login History** | Every sign-in attempt with its full verification log |

## How it works

### What is recorded (`LoginActivity` collection)

Each sign-in attempt is one record. If it succeeds, the same record becomes the session.

| Requirement | Field(s) |
|---|---|
| Browser name and version | `browserName`, `browserVersion`. Uses User-Agent Client Hints, so Chrome, Edge, Brave and Opera are told apart. |
| Operating system | `osName`, `osVersion`. Detects Windows 11 (the User-Agent still says "10"). |
| Device type | `deviceType`: desktop, laptop, tablet or mobile. Laptop vs desktop is a best guess from the Battery API (see limitations). |
| Device model | `deviceModel`, e.g. `Samsung SM-S918B` or `Apple iPhone`, when the browser reports it |
| Public IP address | `ip` (`publicIp` in local development, where the server only sees 127.0.0.1) |
| Date and time | `createdAt` |
| Login status | `status`: success, wrong password, waiting for code, too many wrong codes, expired, blocked (mobile hours), account locked, code not sent |
| Approximate location | `location`: city, region, country and ISP, from ipwho.is. Looked up in the background, so a slow lookup never delays signing in. |

**Stored securely:** codes and challenge tokens are stored only as keyed hashes, and session tokens are never stored. Each user can only read their own records.

### Rules that depend on the environment (`services/loginSecurity.js`)

| Rule | Behaviour |
|---|---|
| **Google Chrome** | After the password (or Google account) is accepted, a 6-digit code is emailed to the registered address, and access is granted only after it's entered. Accounts without an email get the code by SMS. Other browsers (Edge, Firefox, Safari, Brave…) sign in directly. |
| **Mobile phones** | Sign-in is allowed only from 10:00 AM to 1:00 PM IST, checked against the server's clock. Outside that window the attempt is rejected with a clear message and recorded in Login History. A mobile session still open at 1:00 PM is ended on its next request. Tablets aren't affected. |
| **Applies to Google too** | "Continue with Google" exchanges the Firebase token for a server session (`POST /api/auth/google`), so these rules and Login History cover Google accounts as well. |

### New devices, trusted devices, logs

- **First-time logins:** each sign-in is flagged as a **new device**, **new browser**, **new IP address** or **new country**, compared with the account's earlier successful sign-ins.
  - A device is identified by a random ID that the browser keeps in its storage.
- **Trusted devices:** a browser becomes trusted after a successful, fully verified sign-in (password, plus OTP on Chrome).
  - A sign-in from an untrusted device emails the owner a "new sign-in" alert.
  - Students can remove a trusted device. That also signs it out.
- **Logs:** each record keeps a timestamped event log, shown under **Verification log** in Login History:
  - code sent, resent, wrong, expired or locked
  - verified
  - session started or ended
  - IP changes
  - use from another browser

### Edge cases

| Case | Handling |
|---|---|
| **Expired OTP** | Each code lasts 5 minutes. **Resend** is limited to one every 60 seconds and 3 in total, and each new code replaces the old one. The whole verification step expires after 15 minutes. |
| **Repeated failed verification** | 5 wrong codes lock that verification. 3 locked verifications in an hour pause all sign-in for the account for 30 minutes. A code works only once, even if two requests arrive together. |
| **Browser changes** | A session only works in the browser it was started in (`X-Device-Id`). A token copied to another browser is refused and logged. A new browser counts as a new device. |
| **VPN or IP changes** | The session keeps working, so switching networks doesn't sign anyone out. The change is logged on the session (shown as "IP changed" in Login History) and Active sessions shows the latest IP. |
| **Simultaneous logins** | Each device gets its own session, and all of them appear in Active sessions. Beyond 10, the least recently used one is signed out. |
| **Network interruptions** | A sign-in request whose reply is lost is retried automatically with the same request ID, and the server returns the original result. The OTP step resumes after a page reload. If the connection drops while a code is being checked, the page asks the server what happened, and if the code was accepted the same session is returned. |
| **Duplicate login requests** | A double click or a retried request can't create two sessions or send two codes: request IDs are unique in the database, so only one copy goes through. A replayed request never skips the OTP. |
| **Signing out other devices** | Takes effect on that device's next request, which shows "You were signed out from another device". Changing or resetting the password also signs out the other sessions. |

### API

| Method | Path | |
|---|---|---|
| POST | `/api/auth/login`, `/api/auth/register`, `/api/auth/google` | Return `{status: "success", token, user}` or `{status: "otp_required", challenge, challengeToken}` |
| POST | `/api/auth/login/verify`, `/login/resend`, `/login/challenge` | The OTP step. Requires `challengeId` and `challengeToken`. |
| POST | `/api/auth/logout` | End this session |
| GET | `/api/auth/login-history?before=` | 25 per page |
| GET / DELETE | `/api/auth/sessions`, `/api/auth/sessions/:id` | List sessions, or sign one out |
| POST | `/api/auth/sessions/revoke-others` | Sign out every other device |
| GET / DELETE | `/api/auth/trusted-devices`, `/:id` | List trusted devices, or remove one |

## Testing tips

- **Chrome OTP:** log in from Chrome, and the code appears in the backend console. Log in from Edge or Firefox, and you get in directly.
- **Mobile hours:** open Chrome DevTools → device toolbar → pick a phone, then reload. To test outside 10–1 without waiting, set `MOBILE_LOGIN_START`/`MOBILE_LOGIN_END` in `.env` and restart.
- **Sign out other devices:** log in from two browsers, use **Sign out** in one, then click anything in the other.

## Known limitations

- **Browser-reported details can be faked.** Browser, OS and device type come from what the browser says about itself, and someone can change that (for example, to dodge the Chrome OTP or the mobile hours). The rules add friction for normal use. Passwords, OTPs and server sessions provide the real protection.
- **Laptop vs desktop is a guess.** The web doesn't expose it directly. A battery that discharges or isn't full means a laptop. Browsers without the Battery API (Firefox, Safari), and laptops that are plugged in and fully charged, show as "Desktop".
- **No VPN detection.** VPNs aren't specifically detected (that needs a paid IP-reputation service). Their effect, a new IP or country, is detected and shown.
- **Location is approximate** (city level) and depends on ipwho.is. Set `GEOIP_DISABLED=true` to never send IPs to it.
