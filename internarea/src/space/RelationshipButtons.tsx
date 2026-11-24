import React, { useState } from "react";
import Link from "next/link";
import { Check, Loader2, UserMinus, UserPlus, X } from "lucide-react";
import { toast } from "react-toastify";
import { api } from "@/lib/api";
import { useLanguage } from "@/i18n/LanguageProvider";
import Avatar from "./Avatar";
import { Allowance, errorText, Profile, Relationship } from "./types";

// Friend / follow buttons for another user, depending on the current relationship.
export function RelationshipButtons({
  uid,
  relationship,
  onChange,
  showFollow = true,
}: {
  uid: string;
  relationship: Relationship;
  onChange: (r: Relationship, allowance?: Allowance) => void;
  showFollow?: boolean;
}) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  if (relationship.self) return null;

  const run = async (fn: () => Promise<{ data: { relationship: Relationship; allowance?: Allowance } }>, success?: string, confirm?: string) => {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true);
    try {
      const { data } = await fn();
      onChange(data.relationship, data.allowance);
      if (success) toast.success(success);
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const btn = "inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50";
  return (
    <div className="flex flex-wrap gap-2">
      {relationship.friend === "none" && (
        <button type="button" disabled={busy} onClick={() => run(() => api.post("/api/space/friends/requests", { uid }), t("space.friends.requestSent"))} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          {t("space.friends.add")}
        </button>
      )}
      {relationship.friend === "request_sent" && (
        <button type="button" disabled={busy} onClick={() => run(() => api.delete(`/api/space/friends/${encodeURIComponent(uid)}`))} className={`${btn} border border-gray-300 text-gray-700 hover:bg-gray-50`}>
          <X className="h-4 w-4" />
          {t("space.friends.cancelRequest")}
        </button>
      )}
      {relationship.friend === "request_received" && (
        <>
          <button type="button" disabled={busy} onClick={() => run(() => api.post(`/api/space/friends/requests/${encodeURIComponent(uid)}/accept`), t("space.friends.accepted"))} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
            <Check className="h-4 w-4" />
            {t("space.friends.accept")}
          </button>
          <button type="button" disabled={busy} onClick={() => run(() => api.delete(`/api/space/friends/${encodeURIComponent(uid)}`))} className={`${btn} border border-gray-300 text-gray-700 hover:bg-gray-50`}>
            {t("space.friends.decline")}
          </button>
        </>
      )}
      {relationship.friend === "friends" && (
        <button type="button" disabled={busy} onClick={() => run(() => api.delete(`/api/space/friends/${encodeURIComponent(uid)}`), undefined, t("space.friends.confirmUnfriend"))} className={`${btn} border border-gray-300 text-gray-700 hover:bg-gray-50`}>
          <UserMinus className="h-4 w-4" />
          {t("space.friends.unfriend")}
        </button>
      )}
      {showFollow &&
        (relationship.following ? (
          <button type="button" disabled={busy} onClick={() => run(() => api.delete(`/api/space/follow/${encodeURIComponent(uid)}`))} className={`${btn} border border-gray-300 text-gray-700 hover:bg-gray-50`}>
            {t("space.follow.following")}
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={() => run(() => api.put(`/api/space/follow/${encodeURIComponent(uid)}`))} className={`${btn} border border-blue-600 text-blue-600 hover:bg-blue-50`}>
            {t("space.follow.follow")}
          </button>
        ))}
    </div>
  );
}

export function UserRow({ user, relationship, onChange }: { user: Profile; relationship?: Relationship; onChange?: (r: Relationship, a?: Allowance) => void }) {
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <Link href={`/space/u/${user.username}`} className="flex min-w-0 items-center gap-3">
        <Avatar name={user.name} photo={user.photo} />
        <span className="min-w-0">
          <span className="block truncate font-semibold text-gray-900">{user.name}</span>
          <span className="block truncate text-sm text-gray-500">@{user.username}</span>
        </span>
      </Link>
      {relationship && onChange && <RelationshipButtons uid={user.uid} relationship={relationship} onChange={onChange} showFollow={false} />}
    </li>
  );
}
