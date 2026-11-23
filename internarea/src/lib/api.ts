import axios from "axios";
import { auth } from "@/firebase/firebase";

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
  }
  return config;
});

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
