import { api, isNetworkError } from "@/lib/api";
import { collectClientHints, newRequestId } from "@/lib/device";
import type { SessionUser } from "@/lib/session";

// Shared by the log-in and sign-up pages and the Google button.

export interface ChallengeState {
  challengeId: string;
  status: "otp_pending" | "otp_expired" | "otp_locked" | "success" | string;
  channel: "email" | "sms";
  destination: string;
  otpExpiresInSeconds: number;
  challengeExpiresInSeconds: number;
  resendInSeconds: number;
  resendsLeft: number;
  attemptsLeft: number;
  browser?: string;
}

export interface PendingChallenge {
  challengeId: string;
  challengeToken: string;
  challenge: ChallengeState;
  next?: string;
}

export type SignInResult =
  | { status: "success"; token: string; user: SessionUser }
  | { status: "otp_required"; challenge: ChallengeState; challengeToken: string };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends a sign-in request with this browser's details. If the connection drops
 * before the reply arrives, the same request (same request id) is sent again:
 * the server recognises it and returns the original result, so a flaky network
 * never creates two sessions or sends two codes.
 */
export async function requestSignIn(path: string, body: Record<string, unknown>): Promise<SignInResult> {
  const client = await collectClientHints();
  const requestId = newRequestId();
  for (let attempt = 0; ; attempt++) {
    try {
      const { data } = await api.post(path, { ...body, client, requestId });
      return data as SignInResult;
    } catch (error) {
      if (!isNetworkError(error) || attempt >= 2) throw error;
      await wait(800 * (attempt + 1));
    }
  }
}

// The open OTP step survives a reload of this tab (but not other tabs).
const CHALLENGE_KEY = "internarea.loginChallenge";

export function savePendingChallenge(pending: PendingChallenge | null) {
  try {
    if (pending) window.sessionStorage.setItem(CHALLENGE_KEY, JSON.stringify(pending));
    else window.sessionStorage.removeItem(CHALLENGE_KEY);
  } catch {
    // Storage unavailable: a reload just means logging in again.
  }
}

export function readPendingChallenge(): PendingChallenge | null {
  try {
    const raw = window.sessionStorage.getItem(CHALLENGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed.challengeId === "string" && typeof parsed.challengeToken === "string" ? parsed : null;
  } catch {
    return null;
  }
}
