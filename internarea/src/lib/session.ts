import { signOut } from "firebase/auth";
import { auth } from "@/firebase/firebase";
import { store } from "@/store/store";
import { login, logout } from "@/Feature/Userslice";

// Server sessions for every account. Password accounts log in with
// /api/auth/login; Google accounts exchange their Firebase ID token at
// /api/auth/google. Either way the API is called with this session token, so
// the server can apply the login rules and sign out other devices.

const TOKEN_KEY = "internarea.session";
let memoryToken: string | null = null;

export interface SessionUser {
  uid: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  photo: string | null;
  provider: "password" | "google";
  mustChangePassword: boolean;
}
/** @deprecated use SessionUser */
export type PasswordUser = SessionUser;

export function getSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY) || memoryToken;
  } catch {
    return memoryToken;
  }
}

function setSessionToken(token: string | null) {
  memoryToken = token;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable (private mode): the session lasts until the tab closes.
  }
}

export const hasActiveSession = () => Boolean(getSessionToken());

const toReduxUser = (user: SessionUser) => ({
  uid: user.uid,
  name: user.name,
  email: user.email,
  phoneNumber: user.phone,
  photo: user.photo,
  provider: user.provider,
  mustChangePassword: user.mustChangePassword,
});

// Firebase is only used for the Google popup; the server session takes over.
async function leaveFirebase() {
  try {
    if (auth.currentUser) await signOut(auth);
  } catch {
    // Already signed out.
  }
}

// Called after logging in, signing up, verifying the login code or changing the password.
export function startSession(token: string, user: SessionUser) {
  setSessionToken(token);
  store.dispatch(login(toReduxUser(user)));
  leaveFirebase();
}
export const startPasswordSession = startSession;

// Refreshes the signed-in user (e.g. on page load).
export function applySessionUser(user: SessionUser) {
  store.dispatch(login(toReduxUser(user)));
}
export const applyPasswordUser = applySessionUser;

// "Log out": ends the session on the server too, so it disappears from Active sessions.
export async function endSession() {
  const token = getSessionToken();
  if (token) {
    try {
      // Imported lazily to avoid a circular import with the API client.
      const { api } = await import("@/lib/api");
      await api.post("/api/auth/logout", null, { timeout: 5000 });
    } catch {
      // Offline or already signed out: the session still ends locally.
    }
  }
  setSessionToken(null);
  await leaveFirebase();
  store.dispatch(logout());
}

// Signs out locally without calling the server (e.g. the session was revoked).
export function dropSession() {
  if (!getSessionToken()) return;
  setSessionToken(null);
  store.dispatch(logout());
}
export const dropPasswordSession = dropSession;
