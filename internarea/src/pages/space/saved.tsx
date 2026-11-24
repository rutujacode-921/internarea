import React from "react";
import SpaceLayout from "@/space/SpaceLayout";
import { PostList } from "@/space/PostLists";
import { useLanguage } from "@/i18n/LanguageProvider";

export default function SavedPage() {
  const { t } = useLanguage();
  return (
    <SpaceLayout title={t("space.nav.saved")}>
      <PostList url="/api/space/saved" empty={t("space.savedEmpty")} />
    </SpaceLayout>
  );
}
