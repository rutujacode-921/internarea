import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import SpaceLayout, { useSpace } from "@/space/SpaceLayout";
import Avatar from "@/space/Avatar";
import { errorText, SpaceNotification, timeAgo } from "@/space/types";
import { useLanguage } from "@/i18n/LanguageProvider";
import { NOTIFICATIONS_CHANGED } from "@/space/NotificationBell";

function NotificationsView() {
  const { t, locale } = useLanguage();
  const { refreshMe } = useSpace();
  const [items, setItems] = useState<SpaceNotification[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (next?: string) => {
      try {
        const { data } = await api.get("/api/space/notifications", { params: next ? { cursor: next } : {} });
        setItems((list) => (next && list ? [...list, ...data.notifications] : data.notifications));
        setCursor(data.nextCursor);
      } catch (e) {
        setError(errorText(e, t));
      }
    },
    [t]
  );

  useEffect(() => {
    load();
  }, [load]);

  const markRead = async (ids?: string[]) => {
    await api.post("/api/space/notifications/read", ids ? { ids } : { all: true }).catch(() => {});
    setItems((list) => (list || []).map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)));
    window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
    refreshMe();
  };

  const link = (n: SpaceNotification) =>
    n.type === "friend_request" ? "/space/friends?tab=requests" : n.type === "friend_accept" ? `/space/u/${n.actor.username}` : n.postId ? `/space/post/${n.postId}` : "/space";

  if (error) return <p className="rounded-xl bg-white p-8 text-center text-red-700 shadow-sm">{error}</p>;
  if (!items) return <Loader2 className="mx-auto h-6 w-6 animate-spin text-blue-600" />;

  return (
    <div className="rounded-xl bg-white shadow-sm">
      <div className="flex justify-end border-b border-gray-100 p-3">
        <button type="button" onClick={() => markRead()} disabled={!items.some((n) => !n.read)} className="text-sm font-medium text-blue-600 hover:text-blue-700 disabled:text-gray-400">
          {t("space.notifications.markAll")}
        </button>
      </div>
      {items.length === 0 ? (
        <p className="p-8 text-center text-gray-500">{t("space.notifications.empty")}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.map((n) => (
            <li key={n.id} className={n.read ? "" : "bg-blue-50/60"}>
              <Link href={link(n)} onClick={() => !n.read && markRead([n.id])} className="flex items-start gap-3 p-4 hover:bg-gray-50">
                <Avatar name={n.actor.name} photo={n.actor.photo} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-800">
                    <span className="font-semibold">{n.actor.name}</span> {t(`space.notifications.types.${n.type}`)}
                  </p>
                  {n.preview && <p className="truncate text-sm text-gray-500">&ldquo;{n.preview}&rdquo;</p>}
                  <p className="mt-0.5 text-xs text-gray-400">{timeAgo(n.at, locale)}</p>
                </div>
                {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-blue-600" aria-label={t("space.notifications.unread")} />}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {cursor && (
        <button type="button" onClick={() => load(cursor)} className="w-full border-t border-gray-100 py-3 text-sm font-medium text-blue-600 hover:bg-gray-50">
          {t("space.notifications.more")}
        </button>
      )}
    </div>
  );
}

export default function NotificationsPage() {
  const { t } = useLanguage();
  return (
    <SpaceLayout title={t("space.nav.notifications")}>
      <NotificationsView />
    </SpaceLayout>
  );
}
