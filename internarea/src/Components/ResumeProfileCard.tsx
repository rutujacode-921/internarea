import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Crown, FileText } from "lucide-react";
import { api } from "@/lib/api";
import { useLanguage } from "@/i18n/LanguageProvider";

interface Summary {
  premium: { active: boolean; until: string | null };
  defaultTitle: string | null;
  count: number;
}

// Premium status and default resume, shown on the profile page.
export default function ResumeProfileCard() {
  const { t, formatDate } = useLanguage();
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.get("/api/resumes/me"), api.get("/api/resumes/generated")])
      .then(([me, generated]) => {
        if (cancelled) return;
        const list: { title: string; isDefault: boolean }[] = generated.data.resumes || [];
        setSummary({
          premium: me.data.premium,
          defaultTitle: list.find((r) => r.isDefault)?.title || null,
          count: list.length,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-gray-900">
            <FileText className="h-4 w-4 text-blue-600" />
            {t("resume.profile.title")}
          </h2>
          {summary && (
            <div className="mt-1 space-y-1 text-sm text-gray-600">
              <p className="flex items-center gap-1">
                <Crown className={`h-3.5 w-3.5 ${summary.premium.active ? "text-amber-500" : "text-gray-400"}`} />
                {summary.premium.active
                  ? t("resume.premium.activeUntil", { date: formatDate(summary.premium.until) })
                  : t("resume.profile.free")}
              </p>
              <p>
                {summary.defaultTitle
                  ? t("resume.profile.defaultIs", { title: summary.defaultTitle })
                  : t("resume.profile.noDefault")}
              </p>
            </div>
          )}
        </div>
        <Link href="/resume" className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          {t("resume.profile.open")}
        </Link>
      </div>
    </div>
  );
}
