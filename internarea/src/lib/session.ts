import { signOut } from "firebase/auth";
import { auth } from "@/firebase/firebase";
import { store } from "@/store/store";
import { login, logout } from "@/Feature/Userslice";

// Sessions for email/mobile + password accounts. Google accounts keep using
// Firebase; this token is only set for password accounts.

const TOKEN_KEY = "internarea.session";

export interface PasswordUser {
  uid: string;
  name: string;
  email: string | null;
  phone: string | null;
  provider: "password";
  mustChangePassword: boolean;
}

export function getSessionToken(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setSessionToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable (private mode): the session lasts until the tab closes.
  }
}

// True when signed in either way.
export const hasActiveSession = () => Boolean(auth.currentUser || getSessionToken());

const toReduxUser = (user: PasswordUser) => ({
  uid: user.uid,
  name: user.name,
  email: user.email,
  phoneNumber: user.phone,
  photo: null,
  provider: "password",
  mustChangePassword: user.mustChangePassword,
});

// Called after logging in, signing up or changing the password.
export function startPasswordSession(token: string, user: PasswordUser) {
  setSessionToken(token);
  store.dispatch(login(toReduxUser(user)));
}

// Refreshes the signed-in user (e.g. on page load).
export function applyPasswordUser(user: PasswordUser) {
  store.dispatch(login(toReduxUser(user)));
}

export async function endSession() {
  setSessionToken(null);
  try {
    if (auth.currentUser) await signOut(auth);
  } catch {
    // Already signed out.
  }
  store.dispatch(logout());
}

// Signs out locally without calling the server (e.g. the token was revoked).
export function dropPasswordSession() {
  if (!getSessionToken()) return;
  setSessionToken(null);
  if (!auth.currentUser) store.dispatch(logout());
}
