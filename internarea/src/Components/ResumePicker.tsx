import React, { useEffect, useState } from "react";
import Link from "next/link";
import { FileText, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useLanguage } from "@/i18n/LanguageProvider";

interface GeneratedOption {
  id: string;
  title: string;
  createdAt: string;
  isDefault: boolean;
}

interface Props {
  value: string | null;
  onChange: (id: string | null) => void;
}

// Lets a student choose which generated resume goes with an application.
// The default resume is preselected.
export default function ResumePicker({ value, onChange }: Props) {
  const { t, formatDate } = useLanguage();
  const [options, setOptions] = useState<GeneratedOption[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/api/resumes/generated")
      .then(({ data }) => {
        if (cancelled) return;
        const list: GeneratedOption[] = data.resumes || [];
        setOptions(list);
        const preferred = list.find((r) => r.isDefault) || list[0];
        if (preferred) onChange(preferred.id);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          setOptions([]);
        }
      });
    return () => {
      cancelled = true;
    };
    // Only on mount: the parent owns the selection afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (options === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("common.loading")}
      </div>
    );
  }

  if (!options.length) {
    return (
      <div className="flex items-start gap-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
        <div>
          <p>{failed ? t("resume.apply.loadFailed") : t("resume.apply.noneYet")}</p>
          {!failed && (
            <Link href="/resume" className="font-medium text-blue-600 hover:text-blue-700">
              {t("resume.apply.build")}
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor="application-resume" className="mb-1 block text-sm text-gray-600">
        {t("resume.apply.choose")}
      </label>
      <select
        id="application-resume"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {options.map((r) => (
          <option key={r.id} value={r.id}>
            {r.title} · {formatDate(r.createdAt)}
            {r.isDefault ? ` (${t("resume.generated.default")})` : ""}
          </option>
        ))}
        <option value="">{t("resume.apply.none")}</option>
      </select>
      <p className="mt-1 text-xs text-gray-500">
        {t("resume.apply.changeDefault")}{" "}
        <Link href="/resume?tab=generated" className="text-blue-600 hover:text-blue-700">
          {t("resume.apply.manage")}
        </Link>
      </p>
    </div>
  );
}
