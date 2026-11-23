import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Globe, Loader2, ShieldCheck } from "lucide-react";
import { getLanguageInfo } from "@/i18n/config";
import { useLanguage } from "@/i18n/LanguageProvider";

interface Props {
  align?: "left" | "right";
  fullWidth?: boolean;
}

export default function LanguageSwitcher({ align = "right", fullWidth = false }: Props) {
  const { language, languages, changeLanguage, switchingTo, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = getLanguageInfo(language);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${fullWidth ? "w-full" : ""}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={Boolean(switchingTo)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("language.select")}
        title={switchingTo ? t("language.switching") : t("language.select")}
        className={`flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-70 ${
          fullWidth ? "w-full justify-between" : ""
        }`}
      >
        <span className="flex items-center gap-2">
          {switchingTo ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Globe className="h-4 w-4" />
          )}
          <span className={fullWidth ? "" : "hidden sm:inline"}>{current.nativeName}</span>
          <span className={fullWidth ? "hidden" : "sm:hidden uppercase"}>{current.code}</span>
        </span>
        <ChevronDown className="h-4 w-4" />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={t("language.select")}
          className={`absolute z-50 mt-2 w-56 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {languages.map((lang) => {
            const selected = lang.code === language;
            return (
              <li key={lang.code} role="option" aria-selected={selected}>
                <button
                  type="button"
                  lang={lang.code}
                  onClick={() => {
                    setOpen(false);
                    changeLanguage(lang.code);
                  }}
                  className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-gray-50 ${
                    selected ? "font-semibold text-blue-600" : "text-gray-700"
                  }`}
                >
                  <span>
                    {lang.nativeName}
                    <span className="ml-2 text-xs text-gray-400">{lang.englishName}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    {lang.requiresOtp && (
                      <span title={t("language.otpBadge")}>
                        <ShieldCheck className="h-4 w-4 text-amber-500" aria-hidden="true" />
                        <span className="sr-only">{t("language.otpBadge")}</span>
                      </span>
                    )}
                    {selected && <Check className="h-4 w-4" />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
