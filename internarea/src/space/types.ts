import { API_BASE_URL, getApiError } from "@/lib/api";

export interface Author {
  uid: string;
  name: string;
  username: string;
  photo: string | null;
}

export interface SpacePost {
  id: string;
  author: Author;
  text: string;
  hashtags: string[];
  media: { kind: "image" | "video"; mime: string; url: string }[];
  mediaType: "text" | "image" | "video";
  privacy: "public" | "friends";
  friendCountAtPost: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  saveCount: number;
  viewCount: number;
  status: "active" | "hidden";
  createdAt: string;
  editedAt: string | null;
  viewer: {
    isAuthor: boolean;
    liked: boolean;
    saved: boolean;
    reported: boolean;
    canEdit: boolean;
    canDelete: boolean;
    editableUntil: string;
    deletableUntil: string;
  };
}

export interface Profile extends Author {
  bio: string;
  friendCount?: number;
  followerCount?: number;
  followingCount?: number;
  postCount?: number;
}

export interface Relationship {
  self: boolean;
  friend?: "none" | "friends" | "request_sent" | "request_received";
  following?: boolean;
  followedBy?: boolean;
}

export interface Allowance {
  friends: number;
  tier: "none" | "one" | "few" | "many" | "unlimited";
  limit: number | null;
  usedToday: number;
  remaining: number | null;
  canPost: boolean;
  resetsAt: string;
}

export interface SpaceNotification {
  id: string;
  type: "like" | "comment" | "share" | "share_to_you" | "friend_request" | "friend_accept" | "mention";
  actor: Author;
  postId: string | null;
  preview: string;
  read: boolean;
  at: string;
}

export const mediaSrc = (url: string) => `${API_BASE_URL}${url}`;

// Friendly API error text, falling back to a generic message.
export const errorText = (error: unknown, t: (key: string) => string) => {
  const err = getApiError(error);
  if (err.code === "NETWORK") return t("errors.network");
  return err.message || t("errors.generic");
};

// "5 min ago", "2 days ago" in the UI language.
export function timeAgo(date: string, locale: string) {
  const seconds = Math.round((new Date(date).getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(seconds, "second");
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(seconds / 86400), "day");
  return new Date(date).toLocaleDateString(locale);
}

export const compact = (n: number, locale: string) =>
  new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(n);
