import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useLanguage } from "@/i18n/LanguageProvider";
import PostCard from "./PostCard";
import { errorText, SpacePost } from "./types";

// Calls onVisible when the sentinel scrolls into view (infinite scrolling).
function useSentinel(onVisible: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const observer = new IntersectionObserver(([e]) => e.isIntersecting && onVisible(), { rootMargin: "400px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onVisible, enabled]);
  return ref;
}

// A simple paged list of posts from one endpoint (profile, hashtag, saved).
export function PostList({ url, empty, prepend = [] }: { url: string; empty: string; prepend?: SpacePost[] }) {
  const { t } = useLanguage();
  const [posts, setPosts] = useState<SpacePost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(
    async (reset = false) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      try {
        const { data } = await api.get(url, { params: !reset && cursor ? { cursor } : {} });
        setPosts((prev) => (reset ? data.posts : [...prev, ...data.posts.filter((p: SpacePost) => !prev.some((x) => x.id === p.id))]));
        setCursor(data.nextCursor);
        setDone(!data.nextCursor);
      } catch (e) {
        setError(errorText(e, t));
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [url, cursor, t]
  );

  useEffect(() => {
    setPosts([]);
    setCursor(null);
    setDone(false);
    loadingRef.current = false;
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const sentinel = useSentinel(useCallback(() => load(), [load]), !done && !loading && !error);
  const all = [...prepend.filter((p) => !posts.some((x) => x.id === p.id)), ...posts];

  return (
    <div className="space-y-4">
      {all.map((p) => (
        <PostCard key={p.id} post={p} onRemove={(id) => setPosts((list) => list.filter((x) => x.id !== id))} />
      ))}
      {!loading && done && all.length === 0 && <p className="rounded-xl bg-white p-8 text-center text-gray-500 shadow-sm">{empty}</p>}
      <ListFooter loading={loading} error={error} onRetry={() => load()} />
      <div ref={sentinel} />
    </div>
  );
}

const SECTIONS = ["friends", "trending", "recent"] as const;
type Section = (typeof SECTIONS)[number];

// The personalised feed: friends' posts first, then trending, then recent public posts.
export function Feed({ newPosts }: { newPosts: SpacePost[] }) {
  const { t } = useLanguage();
  const [items, setItems] = useState<{ section: Section; post: SpacePost }[]>([]);
  const [section, setSection] = useState<Section>("friends");
  const [cursor, setCursor] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || finished) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      let current = section;
      let currentCursor = cursor;
      // Move on to the next section when one runs out, in the same request cycle.
      for (;;) {
        const { data } = await api.get("/api/space/feed", { params: { section: current, ...(currentCursor ? { cursor: currentCursor } : {}) } });
        const fresh = (data.posts as SpacePost[]).map((post) => ({ section: current, post }));
        setItems((prev) => [...prev, ...fresh.filter((f) => !prev.some((x) => x.post.id === f.post.id))]);
        if (data.nextCursor) {
          setSection(current);
          setCursor(data.nextCursor);
          break;
        }
        const next = SECTIONS[SECTIONS.indexOf(current) + 1];
        if (!next) {
          setFinished(true);
          break;
        }
        current = next;
        currentCursor = null;
        setSection(next);
        setCursor(null);
        if (fresh.length) break; // show what we have; continue on the next scroll
      }
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [section, cursor, finished, t]);

  useEffect(() => {
    loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sentinel = useSentinel(loadMore, !finished && !loading && !error);
  const shown = [...newPosts.filter((p) => !items.some((i) => i.post.id === p.id)).map((post) => ({ section: "friends" as Section, post })), ...items];
  const remove = (id: string) => setItems((list) => list.filter((i) => i.post.id !== id));

  return (
    <div className="space-y-4">
      {shown.map((item, i) => (
        <React.Fragment key={item.post.id}>
          {(i === 0 || shown[i - 1].section !== item.section) && (
            <h2 className="pt-2 text-sm font-semibold uppercase tracking-wide text-gray-500">{t(`space.feed.${item.section}`)}</h2>
          )}
          <PostCard post={item.post} onRemove={remove} />
        </React.Fragment>
      ))}
      {finished && shown.length === 0 && <p className="rounded-xl bg-white p-8 text-center text-gray-500 shadow-sm">{t("space.feed.empty")}</p>}
      {finished && shown.length > 0 && <p className="py-4 text-center text-sm text-gray-400">{t("space.feed.end")}</p>}
      <ListFooter loading={loading} error={error} onRetry={loadMore} />
      <div ref={sentinel} />
    </div>
  );
}

function ListFooter({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry: () => void }) {
  const { t } = useLanguage();
  if (loading) return <Loader2 className="mx-auto h-6 w-6 animate-spin text-blue-600" />;
  if (error)
    return (
      <div className="text-center text-sm text-red-700">
        {error}{" "}
        <button type="button" onClick={onRetry} className="font-medium underline">
          {t("common.retry")}
        </button>
      </div>
    );
  return null;
}
