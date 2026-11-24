import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useSelector } from "react-redux";
import { Bell, Bookmark, Hash, Home, Loader2, User, Users } from "lucide-react";
import { selectuser } from "@/Feature/Userslice";
import { api } from "@/lib/api";
import { useLanguage } from "@/i18n/LanguageProvider";
import { Allowance, errorText, Profile } from "./types";

interface SpaceMe {
  profile: Profile;
  allowance: Allowance;
  unreadNotifications: number;
  settings: { editWindowMinutes: number; deleteWindowMinutes: number; maxTextLength: number; maxImages: number; maxImageMb: number; maxVideoMb: number };
}

interface SpaceContextValue {
  me: SpaceMe;
  refreshMe: () => Promise<void>;
  setAllowance: (a: Allowance) => void;
}

const SpaceContext = createContext<SpaceContextValue | null>(null);
export const useSpace = () => {
  const ctx = useContext(SpaceContext);
  if (!ctx) throw new Error("useSpace must be used inside <SpaceLayout>");
  return ctx;
};

// Frame for every Public Space page: sign-in check, left menu, right sidebar.
export default function SpaceLayout({ children, title }: { children: React.ReactNode; title?: string }) {
  const user = useSelector(selectuser);
  const { t } = useLanguage();
  const [me, setMe] = useState<SpaceMe | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshMe = useCallback(async () => {
    try {
      const { data } = await api.get("/api/space/me");
      setMe(data);
      setError(null);
    } catch (e) {
      setError(errorText(e, t));
    }
  }, [t]);

  useEffect(() => {
    if (user) refreshMe();
  }, [user, refreshMe]);

  // Stable function and context value, so pages that depend on them don't re-run.
  const setAllowance = useCallback((a: Allowance) => setMe((m) => (m ? { ...m, allowance: a } : m)), []);
  const value = useMemo(() => (me ? { me, refreshMe, setAllowance } : null), [me, refreshMe, setAllowance]);

  if (!user) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 bg-gray-50 px-4 text-center">
        <h1 className="text-2xl font-bold text-gray-900">{t("space.title")}</h1>
        <p className="max-w-md text-gray-600">{t("space.signIn")}</p>
        <Link href="/login?next=/space" className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700">
          {t("account.nav.login")}
        </Link>
      </div>
    );
  }
  if (!me) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        {error ? (
          <>
            <p className="text-gray-700">{error}</p>
            <button onClick={refreshMe} className="rounded-lg bg-blue-600 px-4 py-2 text-white">
              {t("common.retry")}
            </button>
          </>
        ) : (
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        )}
      </div>
    );
  }

  return (
    <SpaceContext.Provider value={value}>
      <div className="min-h-screen bg-gray-50">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[200px_minmax(0,1fr)_260px]">
          <SpaceNav me={me} />
          <main className="min-w-0 space-y-4">
            {title && <h1 className="text-xl font-bold text-gray-900">{title}</h1>}
            {children}
          </main>
          <Sidebar me={me} />
        </div>
      </div>
    </SpaceContext.Provider>
  );
}

function SpaceNav({ me }: { me: SpaceMe }) {
  const { t } = useLanguage();
  const router = useRouter();
  const items = [
    { href: "/space", label: t("space.nav.feed"), icon: Home },
    { href: "/space/friends", label: t("space.nav.friends"), icon: Users },
    { href: "/space/notifications", label: t("space.nav.notifications"), icon: Bell, badge: me.unreadNotifications },
    { href: "/space/saved", label: t("space.nav.saved"), icon: Bookmark },
    { href: `/space/u/${me.profile.username}`, label: t("space.nav.profile"), icon: User },
  ];
  return (
    <nav aria-label={t("space.title")} className="lg:sticky lg:top-4 lg:self-start">
      <ul className="flex gap-1 overflow-x-auto rounded-xl bg-white p-2 shadow-sm lg:flex-col">
        {items.map(({ href, label, icon: Icon, badge }) => {
          const active = href === "/space" ? router.pathname === "/space" : router.asPath.startsWith(href);
          return (
            <li key={href}>
              <Link href={href} aria-current={active ? "page" : undefined} className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${active ? "bg-blue-50 text-blue-700" : "text-gray-700 hover:bg-gray-50"}`}>
                <Icon className="h-4 w-4" />
                {label}
                {badge ? <span className="ml-auto rounded-full bg-red-500 px-1.5 text-xs text-white">{badge > 99 ? "99+" : badge}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Sidebar({ me }: { me: SpaceMe }) {
  const { t } = useLanguage();
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  useEffect(() => {
    api.get("/api/space/hashtags/trending").then(({ data }) => setTags(data.tags)).catch(() => {});
  }, []);
  const a = me.allowance;
  const tiers = [
    { label: t("space.rules.none"), active: a.tier === "none" },
    { label: t("space.rules.one"), active: a.tier === "one" },
    { label: t("space.rules.few"), active: a.tier === "few" },
    { label: t("space.rules.many"), active: a.tier === "many" },
    { label: t("space.rules.unlimited"), active: a.tier === "unlimited" },
  ];
  return (
    <aside className="hidden space-y-4 lg:block">
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">{t("space.rules.title")}</h2>
        <p className="mt-1 text-xs text-gray-500">{t("space.rules.yourFriends", { count: a.friends })}</p>
        <ul className="mt-2 space-y-1 text-xs">
          {tiers.map((tier) => (
            <li key={tier.label} className={`rounded px-2 py-1 ${tier.active ? "bg-blue-50 font-semibold text-blue-800" : "text-gray-600"}`}>
              {tier.label}
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="flex items-center gap-1 text-sm font-semibold text-gray-900">
          <Hash className="h-4 w-4" />
          {t("space.trendingTags")}
        </h2>
        {tags.length === 0 ? (
          <p className="mt-2 text-xs text-gray-500">{t("space.noTags")}</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {tags.map((x) => (
              <li key={x.tag}>
                <Link href={`/space/tag/${encodeURIComponent(x.tag)}`} className="flex justify-between text-sm text-blue-700 hover:underline">
                  <span className="truncate">#{x.tag}</span>
                  <span className="text-xs text-gray-500">{x.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
