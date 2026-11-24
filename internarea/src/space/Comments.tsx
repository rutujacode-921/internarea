import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Send, Trash2 } from "lucide-react";
import { toast } from "react-toastify";
import { api } from "@/lib/api";
import { useLanguage } from "@/i18n/LanguageProvider";
import Avatar from "./Avatar";
import RichText from "./RichText";
import { Author, errorText, timeAgo } from "./types";

interface CommentItem {
  id: string;
  author: Author;
  text: string;
  createdAt: string;
  canDelete: boolean;
}

export default function Comments({ postId, onCountChange }: { postId: string; onCountChange: (delta: number) => void }) {
  const { t, locale } = useLanguage();
  const [comments, setComments] = useState<CommentItem[] | null>(null);
  const [nextAfter, setNextAfter] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (after?: string) => {
      try {
        const { data } = await api.get(`/api/space/posts/${postId}/comments`, { params: after ? { after } : {} });
        setComments((list) => (after && list ? [...list, ...data.comments] : data.comments));
        setNextAfter(data.nextAfter);
      } catch (e) {
        setComments((list) => list || []);
        toast.error(errorText(e, t));
      }
    },
    [postId, t]
  );

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/api/space/posts/${postId}/comments`, { text });
      setComments((list) => [...(list || []), data.comment]);
      setText("");
      onCountChange(1);
    } catch (err) {
      toast.error(errorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm(t("space.comments.confirmDelete"))) return;
    try {
      await api.delete(`/api/space/comments/${id}`);
      setComments((list) => (list || []).filter((c) => c.id !== id));
      onCountChange(-1);
    } catch (err) {
      toast.error(errorText(err, t));
    }
  };

  return (
    <div className="border-t border-gray-100 px-4 py-3">
      {comments === null ? (
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-blue-600" />
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-2">
              <Avatar name={c.author.name} photo={c.author.photo} size={32} />
              <div className="min-w-0 flex-1 rounded-lg bg-gray-50 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/space/u/${c.author.username}`} className="truncate text-sm font-semibold text-gray-900 hover:underline">
                    {c.author.name}
                  </Link>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-gray-500">
                    {timeAgo(c.createdAt, locale)}
                    {c.canDelete && (
                      <button type="button" onClick={() => remove(c.id)} aria-label={t("space.comments.delete")} className="text-gray-400 hover:text-red-600">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                </div>
                <RichText text={c.text} className="text-sm text-gray-800" />
              </div>
            </li>
          ))}
          {nextAfter && (
            <li>
              <button type="button" onClick={() => load(nextAfter)} className="text-sm font-medium text-blue-600 hover:text-blue-700">
                {t("space.comments.more")}
              </button>
            </li>
          )}
        </ul>
      )}
      <form onSubmit={submit} className="mt-3 flex gap-2">
        <label htmlFor={`comment-${postId}`} className="sr-only">
          {t("space.comments.placeholder")}
        </label>
        <input
          id={`comment-${postId}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          placeholder={t("space.comments.placeholder")}
          className="min-w-0 flex-1 rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button type="submit" disabled={busy || !text.trim()} aria-label={t("space.comments.send")} className="rounded-full bg-blue-600 p-2 text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
    </div>
  );
}
