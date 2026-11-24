import React from "react";
import { Laptop, Monitor, Smartphone, Tablet } from "lucide-react";
import type { TranslateFn } from "@/i18n/messages";

// Types and helpers shared by Login History, Active sessions and Trusted devices.

export interface LoginEvent {
  type: string;
  detail?: string;
  ip?: string;
  at: string;
}

export interface LoginEntry {
  _id: string;
  provider: "password" | "google";
  kind: "login" | "signup";
  status: string;
  active: boolean;
  current: boolean;
  revokedAt?: string | null;
  revokeReason?: string | null;
  lastSeenAt?: string | null;
  lastIp?: string | null;
  ip?: string;
  publicIp?: string;
  browserName?: string;
  browserVersion?: string;
  osName?: string;
  osVersion?: string;
  deviceType?: "desktop" | "laptop" | "tablet" | "mobile";
  deviceModel?: string | null;
  location?: { city?: string; region?: string; country?: string; countryCode?: string; isp?: string; lookedUp?: boolean };
  isNewDevice?: boolean;
  isNewBrowser?: boolean;
  isNewIp?: boolean;
  isNewCountry?: boolean;
  trustedDevice?: boolean;
  otpRequired?: boolean;
  otpChannel?: "email" | "sms" | null;
  attempts?: number;
  resendCount?: number;
  verifiedAt?: string | null;
  events?: LoginEvent[];
  createdAt: string;
}

export function DeviceIcon({ type, className = "h-5 w-5" }: { type?: string; className?: string }) {
  if (type === "mobile") return <Smartphone className={className} />;
  if (type === "tablet") return <Tablet className={className} />;
  if (type === "laptop") return <Laptop className={className} />;
  return <Monitor className={className} />;
}

const majorVersion = (v?: string) => (v ? v.split(".")[0] : "");

// "Chrome 131 · Windows 11"
export const browserLine = (e: Partial<LoginEntry>) =>
  [
    [e.browserName, majorVersion(e.browserVersion)].filter(Boolean).join(" "),
    [e.osName === "Mac OS" ? "macOS" : e.osName, e.osVersion].filter(Boolean).join(" "),
  ]
    .filter((part) => part && part !== "Unknown")
    .join(" · ");

// "Laptop" or "Mobile · Samsung SM-S918B"
export const deviceLine = (t: TranslateFn, e: Partial<LoginEntry>) =>
  [e.deviceType ? t(`security.deviceTypes.${e.deviceType}`) : null, e.deviceModel].filter(Boolean).join(" · ");

export const locationLine = (t: TranslateFn, e: Partial<LoginEntry>) => {
  const loc = e.location;
  const place = loc ? [loc.city, loc.region, loc.country].filter(Boolean).filter((v, i, all) => all.indexOf(v) === i).join(", ") : "";
  return place || t("security.locationUnknown");
};

export const DATE_TIME: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};
