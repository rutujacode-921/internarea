import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { api } from "@/lib/api";
import { useLanguage } from "@/i18n/LanguageProvider";

export const NOTIFICATIONS_CHANGED = "internarea:notifications-changed";

// Navbar bell with the unread count. Checks every minute and when the tab regains focus.
export default function NotificationBell() {
  const { t } = useLanguage();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      api
        .get("/api/space/notifications/unread-count")
        .then(({ data }) => !cancelled && setUnread(data.unread))
        .catch(() => {});
    check();
    const timer = setInterval(check, 60000);
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(NOTIFICATIONS_CHANGED, check);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(NOTIFICATIONS_CHANGED, check);
    };
  }, []);

  const label = unread ? t("space.notifications.bellUnread", { count: unread }) : t("space.nav.notifications");
  return (
    <Link href="/space/notifications" aria-label={label} title={label} className="relative rounded-full p-2 text-gray-600 hover:bg-gray-100">
      <Bell className="h-5 w-5" />
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-red-500 px-1 text-center text-[10px] font-semibold leading-[1.1rem] text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
