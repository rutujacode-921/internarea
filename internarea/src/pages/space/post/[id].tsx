import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import SpaceLayout from "@/space/SpaceLayout";
import PostCard from "@/space/PostCard";
import { errorText, SpacePost } from "@/space/types";
import { useLanguage } from "@/i18n/LanguageProvider";

// A single post, e.g. opened from a shared link or a notification.
function PostView({ id }: { id: string }) {
  const { t } = useLanguage();
  const [post, setPost] = useState<SpacePost | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setPost(null);
    setError(null);
    api.get(`/api/space/posts/${id}`).then(({ data }) => setPost(data.post)).catch((e) => setError(errorText(e, t)));
  }, [id, t]);
  if (error)
    return (
      <div className="rounded-xl bg-white p-8 text-center shadow-sm">
        <p className="text-gray-700">{error}</p>
        <Link href="/space" className="mt-3 inline-block font-medium text-blue-600">
          {t("space.backToFeed")}
        </Link>
      </div>
    );
  if (!post) return <Loader2 className="mx-auto h-6 w-6 animate-spin text-blue-600" />;
  return <PostCard post={post} defaultShowComments onRemove={() => setError(t("space.post.deleted"))} />;
}

export default function PostPage() {
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : null;
  return <SpaceLayout>{id && <PostView id={id} />}</SpaceLayout>;
}
