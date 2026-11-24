import axios from "axios";
import { dropSession, getSessionToken } from "@/lib/session";
import { getDeviceId } from "@/lib/device";

// Backend base URL. Set NEXT_PUBLIC_API_URL in .env.local to point elsewhere.
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000").replace(/\/$/, "");

let uiLanguage = "en";
export const setApiUiLanguage = (language: string) => {
  uiLanguage = language;
};

// Axios client that sends the session token, this browser's device id (a
// session only works in the browser it was started in) and the UI language,
// so the server can authorize requests and localize replies.
export const api = axios.create({ baseURL: API_BASE_URL, timeout: 15000 });

api.interceptors.request.use((config) => {
  config.headers.set("X-UI-Language", uiLanguage);
  const deviceId = getDeviceId();
  if (deviceId) config.headers.set("X-Device-Id", deviceId);
  const token = getSessionToken();
  if (token) config.headers.set("Authorization", `Bearer ${token}`);
  return config;
});

// Replies that mean this browser's session is over.
const SESSION_ENDED_CODES = ["INVALID_TOKEN", "SESSION_REVOKED", "SESSION_DEVICE_MISMATCH", "MOBILE_SESSION_ENDED"];

// A session that ended on the server (signed out from another device, password
// changed, mobile hours over, ...) signs the user out here too; a pending forced
// password change sends them to change it.
api.interceptors.response.use(undefined, (error) => {
  const status = error?.response?.status;
  const code = error?.response?.data?.code;
  const sentToken = String(error?.config?.headers?.Authorization || "").replace(/^Bearer /, "");
  if ((status === 401 || status === 403) && SESSION_ENDED_CODES.includes(code) && sentToken && sentToken === getSessionToken()) {
    dropSession();
    if (typeof window !== "undefined" && code !== "INVALID_TOKEN") {
      window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT, { detail: error.response.data?.message || "" }));
    }
  }
  if (status === 403 && code === "PASSWORD_CHANGE_REQUIRED" && typeof window !== "undefined") {
    window.dispatchEvent(new Event(PASSWORD_CHANGE_EVENT));
  }
  return Promise.reject(error);
});

export const SESSION_ENDED_EVENT = "internarea:session-ended";
export const PASSWORD_CHANGE_EVENT = "internarea:password-change-required";

export function isNetworkError(error: unknown): boolean {
  if ((error as { isNetworkError?: boolean })?.isNetworkError) return true;
  return axios.isAxiosError(error) && !error.response;
}

export interface ApiErrorInfo {
  code: string;
  message?: string;
  status?: number;
  data?: Record<string, unknown>;
}

export function getApiError(error: unknown): ApiErrorInfo {
  if (isNetworkError(error)) return { code: "NETWORK" };
  if (axios.isAxiosError(error) && error.response) {
    const data = (error.response.data || {}) as Record<string, unknown>;
    return {
      code: typeof data.code === "string" ? data.code : "SERVER_ERROR",
      message: typeof data.message === "string" ? data.message : undefined,
      status: error.response.status,
      data,
    };
  }
  return { code: "UNKNOWN" };
}
