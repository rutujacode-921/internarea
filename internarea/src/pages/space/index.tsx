import React, { useState } from "react";
import SpaceLayout, { useSpace } from "@/space/SpaceLayout";
import Composer from "@/space/Composer";
import { Feed } from "@/space/PostLists";
import { SpacePost } from "@/space/types";
import { useLanguage } from "@/i18n/LanguageProvider";

function FeedPage() {
  const { me, setAllowance } = useSpace();
  const [mine, setMine] = useState<SpacePost[]>([]);
  return (
    <>
      <Composer
        profile={me.profile}
        allowance={me.allowance}
        limits={me.settings}
        onPosted={(post, allowance) => {
          if (post) setMine((list) => [post, ...list]);
          setAllowance(allowance);
        }}
      />
      <Feed newPosts={mine} />
    </>
  );
}

export default function SpaceHome() {
  const { t } = useLanguage();
  return (
    <SpaceLayout title={t("space.title")}>
      <FeedPage />
    </SpaceLayout>
  );
}
