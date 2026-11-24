import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bookmark, Eye, Flag, Globe, Heart, MessageCircle, MoreHorizontal, Pencil, Share2, Trash2, Users } from "lucide-react";
import { toast } from "react-toastify";
import { api } from "@/lib/api";
import { useLanguage } from "@/i18n/LanguageProvider";
import Avatar from "./Avatar";
import RichText from "./RichText";
import Comments from "./Comments";
import { EditPostDialog, ReportDialog, ShareDialog } from "./Dialogs";
import { compact, errorText, mediaSrc, SpacePost, timeAgo } from "./types";

// Views are recorded once per post per browser session, when the post is on screen.
const viewed = new Set<string>();

interface Props {
  post: SpacePost;
  onChange?: (post: SpacePost) => void;
  onRemove?: (id: string) => void;
  defaultShowComments?: boolean;
}

export default function PostCard({ post: initial, onChange, onRemove, defaultShowComments = false }: Props) {
  const { t, locale, formatDate } = useLanguage();
  const [post, setPost] = useState(initial);
  const [showComments, setShowComments] = useState(defaultShowComments);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<"share" | "report" | "edit" | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => setPost(initial), [initial]);

  const update = (next: SpacePost) => {
    setPost(next);
    onChange?.(next);
  };

  // Count a view after the post has been at least half visible for a second.
  useEffect(() => {
    const el = ref.current;
    if (!el || viewed.has(post.id) || post.viewer.isAuthor) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          timer = setTimeout(() => {
            viewed.add(post.id);
            api.post(`/api/space/posts/${post.id}/view`).catch(() => viewed.delete(post.id));
            observer.disconnect();
          }, 1000);
        } else if (timer) {
          clearTimeout(timer);
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    };
  }, [post.id, post.viewer.isAuthor]);

  // Like / save update instantly, then confirm with the server.
  const toggle = async (kind: "like" | "save") => {
    if (busy) return;
    const on = kind === "like" ? post.viewer.liked : post.viewer.saved;
    const counter = kind === "like" ? "likeCount" : "saveCount";
    const flag = kind === "like" ? "liked" : "saved";
    const optimistic = { ...post, [counter]: post[counter] + (on ? -1 : 1), viewer: { ...post.viewer, [flag]: !on } };
    setPost(optimistic);
    setBusy(true);
    try {
      const { data } = on ? await api.delete(`/api/space/posts/${post.id}/${kind}`) : await api.put(`/api/space/posts/${post.id}/${kind}`);
      update(data.post);
      if (kind === "save") toast.success(on ? t("space.post.unsaved") : t("space.post.saved"));
    } catch (e) {
      setPost(post);
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setMenuOpen(false);
    if (!window.confirm(t("space.post.confirmDelete"))) return;
    try {
      await api.delete(`/api/space/posts/${post.id}`);
      toast.success(t("space.post.deleted"));
      onRemove?.(post.id);
    } catch (e) {
      toast.error(errorText(e, t));
    }
  };

  const images = post.media.filter((m) => m.kind === "image");
  const video = post.media.find((m) => m.kind === "video");
  const timeLabel = formatDate(post.createdAt, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <article ref={ref} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {post.status === "hidden" && (
        <p className="bg-amber-50 px-4 py-2 text-xs text-amber-900">{t("space.post.hiddenNotice")}</p>
      )}
      <header className="flex items-start gap-3 p-4 pb-2">
        <Link href={`/space/u/${post.author.username}`}>
          <Avatar name={post.author.name} photo={post.author.photo} />
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={`/space/u/${post.author.username}`} className="font-semibold text-gray-900 hover:underline">
            {post.author.name}
          </Link>
          <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-gray-500">
            <span>@{post.author.username}</span>
            <span aria-hidden="true">·</span>
            <Link href={`/space/post/${post.id}`} title={timeLabel} className="hover:underline">
              <time dateTime={post.createdAt}>{timeAgo(post.createdAt, locale)}</time>
            </Link>
            {post.editedAt && <span>· {t("space.post.editedLabel")}</span>}
            <span aria-hidden="true">·</span>
            {post.privacy === "friends" ? (
              <span className="inline-flex items-center gap-0.5" title={t("space.privacy.friends")}>
                <Users className="h-3 w-3" aria-hidden="true" />
                <span className="sr-only">{t("space.privacy.friends")}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5" title={t("space.privacy.public")}>
                <Globe className="h-3 w-3" aria-hidden="true" />
                <span className="sr-only">{t("space.privacy.public")}</span>
              </span>
            )}
          </div>
        </div>
        <div className="relative">
          <button type="button" onClick={() => setMenuOpen((v) => !v)} aria-label={t("space.post.more")} aria-expanded={menuOpen} className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100">
            <MoreHorizontal className="h-5 w-5" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-10 mt-1 w-56 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg" role="menu">
              {post.viewer.isAuthor ? (
                <>
                  <MenuItem disabled={!post.viewer.canEdit} onClick={() => { setMenuOpen(false); setDialog("edit"); }} icon={<Pencil className="h-4 w-4" />}>
                    {t("space.post.edit")}
                  </MenuItem>
                  <MenuItem disabled={!post.viewer.canDelete} onClick={remove} icon={<Trash2 className="h-4 w-4" />} danger>
                    {t("space.post.delete")}
                  </MenuItem>
                  <p className="px-3 py-1.5 text-xs text-gray-500">
                    {post.viewer.canEdit || post.viewer.canDelete
                      ? t("space.post.changeUntil", { time: formatDate(post.viewer.editableUntil, { hour: "2-digit", minute: "2-digit" }) })
                      : t("space.post.windowPassed")}
                  </p>
                </>
              ) : (
                <MenuItem disabled={post.viewer.reported} onClick={() => { setMenuOpen(false); setDialog("report"); }} icon={<Flag className="h-4 w-4" />} danger>
                  {post.viewer.reported ? t("space.post.reported") : t("space.post.report")}
                </MenuItem>
              )}
            </div>
          )}
        </div>
      </header>

      {post.text && <RichText text={post.text} className="px-4 pb-3 text-gray-800" />}

      {video && (
        <video controls preload="metadata" playsInline className="max-h-[32rem] w-full bg-black" src={mediaSrc(video.url)}>
          {t("space.post.videoUnsupported")}
        </video>
      )}
      {images.length > 0 && (
        <div className={`grid gap-0.5 ${images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
          {images.map((img, i) => (
            <a key={img.url} href={mediaSrc(img.url)} target="_blank" rel="noopener noreferrer" className={images.length === 3 && i === 0 ? "col-span-2" : ""}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mediaSrc(img.url)} alt={t("space.post.photoAlt", { n: i + 1, name: post.author.name })} loading="lazy" className={`w-full bg-gray-100 object-cover ${images.length === 1 ? "max-h-[32rem]" : "aspect-square"}`} />
            </a>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 text-xs text-gray-500">
        <span>{t("space.post.likes", { count: compact(post.likeCount, locale) })}</span>
        <span className="flex flex-wrap gap-3">
          <button type="button" onClick={() => setShowComments((v) => !v)} className="hover:underline">
            {t("space.post.comments", { count: compact(post.commentCount, locale) })}
          </button>
          <span>{t("space.post.shares", { count: compact(post.shareCount, locale) })}</span>
          <span className="inline-flex items-center gap-1">
            <Eye className="h-3 w-3" aria-hidden="true" />
            {t("space.post.views", { count: compact(post.viewCount, locale) })}
          </span>
        </span>
      </div>

      <div className="mt-2 grid grid-cols-4 border-t border-gray-100 text-sm">
        <ActionButton active={post.viewer.liked} onClick={() => toggle("like")} icon={<Heart className={`h-4 w-4 ${post.viewer.liked ? "fill-current" : ""}`} />} label={post.viewer.liked ? t("space.post.liked") : t("space.post.like")} activeClass="text-red-600" />
        <ActionButton onClick={() => setShowComments((v) => !v)} icon={<MessageCircle className="h-4 w-4" />} label={t("space.post.comment")} />
        <ActionButton onClick={() => setDialog("share")} icon={<Share2 className="h-4 w-4" />} label={t("space.post.share")} />
        <ActionButton active={post.viewer.saved} onClick={() => toggle("save")} icon={<Bookmark className={`h-4 w-4 ${post.viewer.saved ? "fill-current" : ""}`} />} label={post.viewer.saved ? t("space.post.savedLabel") : t("space.post.save")} activeClass="text-blue-600" />
      </div>

      {showComments && <Comments postId={post.id} onCountChange={(d) => update({ ...post, commentCount: Math.max(0, post.commentCount + d) })} />}

      {dialog === "share" && <ShareDialog post={post} onClose={() => setDialog(null)} onShared={update} />}
      {dialog === "report" && <ReportDialog post={post} onClose={() => setDialog(null)} onReported={() => update({ ...post, viewer: { ...post.viewer, reported: true } })} />}
      {dialog === "edit" && <EditPostDialog post={post} onClose={() => setDialog(null)} onSaved={update} />}
    </article>
  );
}

function ActionButton({ icon, label, onClick, active, activeClass = "" }: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean; activeClass?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={`flex items-center justify-center gap-1.5 py-2.5 font-medium hover:bg-gray-50 ${active ? activeClass : "text-gray-600"}`}>
      {icon}
      <span className="hidden sm:inline">{label}</span>
      <span className="sr-only sm:hidden">{label}</span>
    </button>
  );
}

function MenuItem({ icon, children, onClick, disabled, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} disabled={disabled} className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 ${danger ? "text-red-600" : "text-gray-800"}`}>
      {icon}
      {children}
    </button>
  );
}
