import axios from "axios";
import { auth } from "@/firebase/firebase";
import { dropPasswordSession, getSessionToken } from "@/lib/session";

// Backend base URL. Set NEXT_PUBLIC_API_URL in .env.local to point elsewhere.
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000").replace(/\/$/, "");

let uiLanguage = "en";
export const setApiUiLanguage = (language: string) => {
  uiLanguage = language;
};

// Axios client that sends the signed-in user's Firebase ID token and current
// UI language, so the server can authorize requests and localize replies.
export const api = axios.create({ baseURL: API_BASE_URL, timeout: 15000 });

api.interceptors.request.use(async (config) => {
  config.headers.set("X-UI-Language", uiLanguage);
  const user = auth.currentUser;
  if (user) {
    try {
      const token = await user.getIdToken();
      config.headers.set("Authorization", `Bearer ${token}`);
    } catch (error) {
      // Refreshing the token failed, usually because the device is offline.
      throw Object.assign(new Error("Network error"), { isNetworkError: true, cause: error });
    }
  } else {
    // Email/mobile + password accounts.
    const token = getSessionToken();
    if (token) config.headers.set("Authorization", `Bearer ${token}`);
  }
  return config;
});

// A revoked password session (e.g. the password was reset elsewhere) signs the
// user out; a pending forced password change sends them to change it.
api.interceptors.response.use(undefined, (error) => {
  const status = error?.response?.status;
  const code = error?.response?.data?.code;
  const sentToken = String(error?.config?.headers?.Authorization || "").replace(/^Bearer /, "");
  if (status === 401 && code === "INVALID_TOKEN" && sentToken && sentToken === getSessionToken()) {
    dropPasswordSession();
  }
  if (status === 403 && code === "PASSWORD_CHANGE_REQUIRED" && typeof window !== "undefined") {
    window.dispatchEvent(new Event(PASSWORD_CHANGE_EVENT));
  }
  return Promise.reject(error);
});

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
