import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Loader2, Search } from "lucide-react";
import { api } from "@/lib/api";
import SpaceLayout, { useSpace } from "@/space/SpaceLayout";
import { UserRow } from "@/space/RelationshipButtons";
import { Allowance, errorText, Profile, Relationship } from "@/space/types";
import { useLanguage } from "@/i18n/LanguageProvider";

const TABS = ["friends", "requests", "find"] as const;
type Tab = (typeof TABS)[number];

function FriendsView() {
  const { t } = useLanguage();
  const router = useRouter();
  const { setAllowance } = useSpace();
  const tab: Tab = TABS.includes(router.query.tab as Tab) ? (router.query.tab as Tab) : "friends";
  const [data, setData] = useState<{ friends: Profile[]; incoming: Profile[]; outgoing: Profile[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<(Profile & { relationship: Relationship })[] | null>(null);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/api/space/friends");
      setData(data);
      setAllowance(data.allowance);
    } catch (e) {
      setError(errorText(e, t));
    }
  }, [t, setAllowance]);

  useEffect(() => {
    load();
  }, [load]);

  // Search as you type (debounced).
  useEffect(() => {
    if (query.trim().length < 2) return setResults(null);
    setSearching(true);
    const timer = setTimeout(() => {
      api
        .get("/api/space/users", { params: { q: query.trim() } })
        .then(({ data }) => setResults(data.users))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const changed = (a?: Allowance) => {
    if (a) setAllowance(a);
    load();
  };
  const setTab = (next: Tab) => router.replace({ pathname: "/space/friends", query: { tab: next } }, undefined, { shallow: true });

  const list = (users: Profile[], relationship: Relationship, empty: string) =>
    users.length === 0 ? (
      <p className="p-6 text-center text-sm text-gray-500">{empty}</p>
    ) : (
      <ul className="divide-y divide-gray-100">
        {users.map((u) => (
          <UserRow key={u.uid} user={u} relationship={relationship} onChange={(_, a) => changed(a)} />
        ))}
      </ul>
    );

  return (
    <div className="rounded-xl bg-white shadow-sm">
      <div className="flex gap-1 border-b border-gray-200 px-2" role="tablist">
        {TABS.map((key) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`border-b-2 px-4 py-3 text-sm font-medium ${tab === key ? "border-blue-600 text-blue-600" : "border-transparent text-gray-600 hover:text-gray-900"}`}>
            {t(`space.friends.tabs.${key}`)}
            {key === "requests" && data?.incoming.length ? <span className="ml-1 rounded-full bg-red-500 px-1.5 text-xs text-white">{data.incoming.length}</span> : null}
          </button>
        ))}
      </div>
      {error ? (
        <p className="p-6 text-center text-red-700">{error}</p>
      ) : !data ? (
        <Loader2 className="mx-auto my-6 h-6 w-6 animate-spin text-blue-600" />
      ) : tab === "friends" ? (
        list(data.friends, { self: false, friend: "friends" }, t("space.friends.noFriends"))
      ) : tab === "requests" ? (
        <>
          <h2 className="px-4 pt-4 text-sm font-semibold text-gray-900">{t("space.friends.incoming")}</h2>
          {list(data.incoming, { self: false, friend: "request_received" }, t("space.friends.noIncoming"))}
          <h2 className="border-t border-gray-100 px-4 pt-4 text-sm font-semibold text-gray-900">{t("space.friends.outgoing")}</h2>
          {list(data.outgoing, { self: false, friend: "request_sent" }, t("space.friends.noOutgoing"))}
        </>
      ) : (
        <div>
          <div className="p-4">
            <label htmlFor="people-search" className="sr-only">
              {t("space.friends.searchLabel")}
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 focus-within:ring-2 focus-within:ring-blue-500">
              <Search className="h-4 w-4 text-gray-400" />
              <input id="people-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("space.friends.searchPlaceholder")} className="w-full py-2 text-gray-900 focus:outline-none" />
              {searching && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
            </div>
          </div>
          {results === null ? (
            <p className="px-4 pb-6 text-sm text-gray-500">{t("space.friends.searchHint")}</p>
          ) : results.length === 0 ? (
            <p className="px-4 pb-6 text-sm text-gray-500">{t("space.friends.noResults")}</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {results.map((u) => (
                <UserRow
                  key={u.uid}
                  user={u}
                  relationship={u.relationship}
                  onChange={(r, a) => {
                    setResults((list) => (list || []).map((x) => (x.uid === u.uid ? { ...x, relationship: r } : x)));
                    changed(a);
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function FriendsPage() {
  const { t } = useLanguage();
  return (
    <SpaceLayout title={t("space.nav.friends")}>
      <FriendsView />
    </SpaceLayout>
  );
}
