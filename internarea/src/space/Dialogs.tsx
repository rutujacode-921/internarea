import React, { useEffect, useState } from "react";
import { Check, Copy, Loader2, Send, Share2, X } from "lucide-react";
import { toast } from "react-toastify";
import { api } from "@/lib/api";
import { useLanguage } from "@/i18n/LanguageProvider";
import Avatar from "./Avatar";
import { errorText, Profile, SpacePost } from "./types";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { t } = useLanguage();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// Copy link, device share sheet, or send to a friend. Every share is counted.
export function ShareDialog({ post, onClose, onShared }: { post: SpacePost; onClose: () => void; onShared: (p: SpacePost) => void }) {
  const { t } = useLanguage();
  const [friends, setFriends] = useState<Profile[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const link = typeof window !== "undefined" ? `${window.location.origin}/space/post/${post.id}` : "";

  useEffect(() => {
    api.get("/api/space/friends").then(({ data }) => setFriends(data.friends)).catch(() => setFriends([]));
  }, []);

  const record = async (channel: string, toUid?: string) => {
    const { data } = await api.post(`/api/space/posts/${post.id}/share`, { channel, toUid });
    onShared(data.post);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      await record("link");
    } catch (e) {
      toast.error(errorText(e, t));
    }
  };

  const native = async () => {
    try {
      await navigator.share({ title: "InternArea", text: post.text.slice(0, 100), url: link });
      await record("native");
    } catch {
      // Cancelled by the user.
    }
  };

  const sendTo = async (friend: Profile) => {
    setSentTo(friend.uid);
    try {
      await record("friend", friend.uid);
      toast.success(t("space.share.sent", { name: friend.name }));
    } catch (e) {
      toast.error(errorText(e, t));
      setSentTo(null);
    }
  };

  return (
    <Modal title={t("space.share.title")} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <input readOnly value={link} aria-label={t("space.share.link")} className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700" />
          <button type="button" onClick={copy} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? t("space.share.copied") : t("space.share.copy")}
          </button>
        </div>
        {typeof navigator !== "undefined" && "share" in navigator && (
          <button type="button" onClick={native} className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <Share2 className="h-4 w-4" />
            {t("space.share.more")}
          </button>
        )}
        <div>
          <p className="mb-2 text-sm font-medium text-gray-700">{t("space.share.toFriend")}</p>
          {friends === null ? (
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-blue-600" />
          ) : friends.length === 0 ? (
            <p className="text-sm text-gray-500">{t("space.share.noFriends")}</p>
          ) : (
            <ul className="max-h-60 space-y-1 overflow-y-auto">
              {friends.map((f) => (
                <li key={f.uid} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50">
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar name={f.name} photo={f.photo} size={32} />
                    <span className="truncate text-sm text-gray-900">{f.name}</span>
                  </span>
                  <button type="button" onClick={() => sendTo(f)} disabled={sentTo === f.uid} className="inline-flex items-center gap-1 rounded-lg border border-blue-600 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:border-gray-300 disabled:text-gray-400">
                    {sentTo === f.uid ? <Check className="h-3 w-3" /> : <Send className="h-3 w-3" />}
                    {sentTo === f.uid ? t("space.share.sentShort") : t("space.share.send")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}

const REASONS = ["spam", "inappropriate", "harassment", "violence", "misinformation", "other"] as const;

export function ReportDialog({ post, onClose, onReported }: { post: SpacePost; onClose: () => void; onReported: () => void }) {
  const { t } = useLanguage();
  const [reason, setReason] = useState<string>("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) return toast.error(t("space.report.chooseReason"));
    setBusy(true);
    try {
      await api.post(`/api/space/posts/${post.id}/report`, { reason, details });
      toast.success(t("space.report.thanks"));
      onReported();
      onClose();
    } catch (err) {
      toast.error(errorText(err, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t("space.report.title")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm text-gray-600">{t("space.report.why")}</legend>
          {REASONS.map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm text-gray-800">
              <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="h-4 w-4" />
              {t(`space.report.reasons.${r}`)}
            </label>
          ))}
        </fieldset>
        <label className="block text-sm text-gray-600">
          {t("space.report.details")}
          <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={300} rows={3} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900" />
        </label>
        <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("space.report.submit")}
        </button>
      </form>
    </Modal>
  );
}

export function EditPostDialog({ post, onClose, onSaved }: { post: SpacePost; onClose: () => void; onSaved: (p: SpacePost) => void }) {
  const { t, formatDate } = useLanguage();
  const [text, setText] = useState(post.text);
  const [privacy, setPrivacy] = useState(post.privacy);
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.patch(`/api/space/posts/${post.id}`, { text, privacy });
      onSaved(data.post);
      toast.success(t("space.post.edited"));
      onClose();
    } catch (err) {
      toast.error(errorText(err, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t("space.post.edit")} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={6} aria-label={t("space.composer.placeholder")} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" />
        <PrivacySelect value={privacy} onChange={setPrivacy} />
        <p className="text-xs text-gray-500">{t("space.post.editableUntil", { time: formatDate(post.viewer.editableUntil, { hour: "2-digit", minute: "2-digit" }) })}</p>
        <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("space.post.saveChanges")}
        </button>
      </form>
    </Modal>
  );
}

export function PrivacySelect({ value, onChange }: { value: "public" | "friends"; onChange: (v: "public" | "friends") => void }) {
  const { t } = useLanguage();
  return (
    <label className="flex items-center gap-2 text-sm text-gray-600">
      {t("space.privacy.label")}
      <select value={value} onChange={(e) => onChange(e.target.value as "public" | "friends")} className="rounded-lg border border-gray-300 px-2 py-1 text-sm text-gray-900">
        <option value="public">{t("space.privacy.public")}</option>
        <option value="friends">{t("space.privacy.friends")}</option>
      </select>
    </label>
  );
}
