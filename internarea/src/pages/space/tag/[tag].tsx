import React from "react";
import { useRouter } from "next/router";
import SpaceLayout from "@/space/SpaceLayout";
import { PostList } from "@/space/PostLists";
import { useLanguage } from "@/i18n/LanguageProvider";

export default function HashtagPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const tag = typeof router.query.tag === "string" ? router.query.tag.toLowerCase() : null;
  return (
    <SpaceLayout title={tag ? `#${tag}` : undefined}>
      {tag && <PostList url={`/api/space/hashtags/${encodeURIComponent(tag)}`} empty={t("space.tagEmpty", { tag })} />}
    </SpaceLayout>
  );
}
