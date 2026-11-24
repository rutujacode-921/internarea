import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ImagePlus, Loader2, Lock, Video, X } from "lucide-react";
import { toast } from "react-toastify";
import { api, getApiError } from "@/lib/api";
import { useLanguage } from "@/i18n/LanguageProvider";
import Avatar from "./Avatar";
import { PrivacySelect } from "./Dialogs";
import { Allowance, errorText, Profile, SpacePost } from "./types";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

interface Props {
  profile: Profile;
  allowance: Allowance;
  limits: { maxTextLength: number; maxImages: number; maxImageMb: number; maxVideoMb: number };
  onPosted: (post: SpacePost | null, allowance: Allowance) => void;
}

// Create a post: text, up to 4 photos or 1 video, and who can see it.
// Shows the daily allowance from the friends-based posting rules.
export default function Composer({ profile, allowance, limits, onPosted }: Props) {
  const { t, formatDate } = useLanguage();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<{ file: File; url: string }[]>([]);
  const [privacy, setPrivacy] = useState<"public" | "friends">("public");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => files.forEach((f) => URL.revokeObjectURL(f.url)), [files]);

  const pick = (list: FileList | null) => {
    setError(null);
    const chosen = Array.from(list || []);
    const all = [...files.map((f) => f.file), ...chosen];
    const videos = all.filter((f) => VIDEO_TYPES.includes(f.type));
    if (all.some((f) => !IMAGE_TYPES.includes(f.type) && !VIDEO_TYPES.includes(f.type))) return setError(t("space.composer.badType"));
    if (videos.length > 1 || (videos.length === 1 && all.length > 1)) return setError(t("space.composer.oneVideo"));
    if (all.length > limits.maxImages) return setError(t("space.composer.maxImages", { count: limits.maxImages }));
    for (const f of chosen) {
      const isVideo = VIDEO_TYPES.includes(f.type);
      if (f.size > (isVideo ? limits.maxVideoMb : limits.maxImageMb) * 1048576) {
        return setError(isVideo ? t("space.composer.videoTooBig", { mb: limits.maxVideoMb }) : t("space.composer.imageTooBig", { mb: limits.maxImageMb }));
      }
    }
    setFiles((prev) => [...prev, ...chosen.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  };

  const removeFile = (i: number) =>
    setFiles((prev) => {
      URL.revokeObjectURL(prev[i].url);
      return prev.filter((_, j) => j !== i);
    });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() && !files.length) return setError(t("space.composer.empty"));
    setError(null);
    setProgress(0);
    const form = new FormData();
    form.append("text", text);
    form.append("privacy", privacy);
    files.forEach((f) => form.append("media", f.file));
    try {
      const { data } = await api.post("/api/space/posts", form, {
        timeout: 5 * 60 * 1000,
        onUploadProgress: (p) => p.total && setProgress(Math.round((p.loaded / p.total) * 100)),
      });
      files.forEach((f) => URL.revokeObjectURL(f.url));
      setText("");
      setFiles([]);
      toast.success(t("space.composer.posted"));
      onPosted(data.post, data.allowance);
    } catch (err) {
      setError(errorText(err, t));
      const latest = getApiError(err).data?.allowance as Allowance | undefined;
      if (latest) onPosted(null, latest); // refresh the allowance shown
    } finally {
      setProgress(null);
    }
  };

  // No friends: explain the rule instead of showing the form.
  if (allowance.limit === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="flex items-center gap-2 font-semibold text-gray-900">
          <Lock className="h-4 w-4 text-gray-500" />
          {t("space.composer.lockedTitle")}
        </p>
        <p className="mt-1 text-sm text-gray-600">{t("space.composer.lockedBody")}</p>
        <Link href="/space/friends?tab=find" className="mt-3 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          {t("space.composer.findFriends")}
        </Link>
      </div>
    );
  }

  const resets = formatDate(allowance.resetsAt, { hour: "2-digit", minute: "2-digit" });
  const quota =
    allowance.limit === null
      ? t("space.composer.unlimited", { friends: allowance.friends })
      : allowance.canPost
      ? t("space.composer.remaining", { remaining: allowance.remaining ?? 0, limit: allowance.limit, friends: allowance.friends })
      : t("space.composer.limitReached", { limit: allowance.limit, time: resets });
  const busy = progress !== null;
  const disabled = busy || !allowance.canPost;

  return (
    <form onSubmit={submit} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex gap-3">
        <Avatar name={profile.name} photo={profile.photo} />
        <div className="min-w-0 flex-1">
          <label htmlFor="composer" className="sr-only">
            {t("space.composer.placeholder")}
          </label>
          <textarea
            id="composer"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={limits.maxTextLength}
            rows={3}
            disabled={disabled}
            placeholder={t("space.composer.placeholder")}
            className="w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
          />
          {files.length > 0 && (
            <div className="mt-2 grid grid-cols-4 gap-2">
              {files.map((f, i) => (
                <div key={f.url} className="relative aspect-square overflow-hidden rounded-lg bg-gray-100">
                  {f.file.type.startsWith("video/") ? (
                    <video src={f.url} className="h-full w-full object-cover" muted />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.url} alt="" className="h-full w-full object-cover" />
                  )}
                  <button type="button" onClick={() => removeFile(i)} disabled={busy} aria-label={t("space.composer.removeFile")} className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {error && (
            <p role="alert" className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <input ref={inputRef} type="file" accept={[...IMAGE_TYPES, ...VIDEO_TYPES].join(",")} multiple onChange={(e) => { pick(e.target.files); e.target.value = ""; }} className="hidden" />
              <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50">
                <ImagePlus className="h-4 w-4 text-green-600" />
                <Video className="h-4 w-4 text-purple-600" />
                {t("space.composer.addMedia")}
              </button>
              <PrivacySelect value={privacy} onChange={setPrivacy} />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400">
                {text.length}/{limits.maxTextLength}
              </span>
              <button type="submit" disabled={disabled} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy && progress !== null && progress < 100 ? t("space.composer.uploading", { percent: progress }) : t("space.composer.post")}
              </button>
            </div>
          </div>
          <p className={`mt-2 text-xs ${allowance.canPost ? "text-gray-500" : "text-amber-700"}`}>{quota}</p>
        </div>
      </div>
    </form>
  );
}
