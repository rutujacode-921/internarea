import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Camera,
  FileDown,
  History,
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { selectuser } from "@/Feature/Userslice";
import { api, getApiError } from "@/lib/api";
import { useLanguage } from "@/i18n/LanguageProvider";
import PaymentFlowModal from "@/Components/PaymentFlowModal";
import ResumePreview from "@/resume/ResumePreview";
import {
  COLOR_PRESETS,
  emptyEntry,
  FieldSpec,
  FONT_SIZES,
  FONTS,
  formatPaise,
  ListSection,
  MAX_PHOTO_BYTES,
  ResumeData,
  ResumeDesign,
  ResumeDraft,
  ResumeIssue,
  SECTION_FIELDS,
  TEMPLATES,
} from "@/resume/config";
import { Plans } from "@/resume/payments";

interface EditorState {
  title: string;
  design: ResumeDesign;
  data: ResumeData;
  photo: string | null;
}
interface VersionSummary {
  version: number;
  title: string;
  template: string;
  note: string;
  createdAt: string;
}

const LIST_SECTIONS: ListSection[] = ["education", "experience", "internships", "projects", "certifications", "languages", "links", "references"];
const inputClass = (invalid?: boolean) =>
  `w-full rounded-lg border px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 ${invalid ? "border-red-400 bg-red-50" : "border-gray-300"}`;

const toEditorState = (draft: ResumeDraft): EditorState => ({
  title: draft.title,
  design: draft.design,
  data: draft.data,
  photo: draft.photo,
});

// Shrinks the photo in the browser so uploads stay small (max 400px, JPEG).
function resizePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode"));
      img.onload = () => {
        const scale = Math.min(1, 400 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("canvas"));
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export default function ResumeBuilder() {
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : null;
  const user = useSelector(selectuser);
  const { t, formatDate, locale } = useLanguage();

  const [state, setState] = useState<EditorState | null>(null);
  const [version, setVersion] = useState(0);
  const [savedJson, setSavedJson] = useState("");
  const [issues, setIssues] = useState<ResumeIssue[]>([]);
  const [plans, setPlans] = useState<Plans | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [paying, setPaying] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [previewVersion, setPreviewVersion] = useState<(EditorState & { version: number }) | null>(null);
  const [skillInput, setSkillInput] = useState("");
  const issuesRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const dirty = Boolean(state) && JSON.stringify(state) !== savedJson;
  const readOnly = plans ? !plans.status.active : true;
  const issueFields = useMemo(() => new Set(issues.map((i) => i.field)), [issues]);

  const applyDraft = useCallback((draft: ResumeDraft) => {
    const next = toEditorState(draft);
    setState(next);
    setSavedJson(JSON.stringify(next));
    setVersion(draft.version);
    setIssues(draft.issues);
    setConflict(false);
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    setLoadError(null);
    try {
      const [draftRes, plansRes] = await Promise.all([api.get(`/api/resumes/drafts/${id}`), api.get("/api/payments/plans")]);
      applyDraft(draftRes.data.resume);
      setPlans(plansRes.data);
    } catch (error) {
      const err = getApiError(error);
      setLoadError(err.code === "NETWORK" ? t("errors.network") : err.message || t("resume.builder.loadFailed"));
    }
  }, [id, applyDraft, t]);

  useEffect(() => {
    if (user && id) load();
  }, [user, id, load]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const onRouteChange = (url: string) => {
      if (url !== router.asPath && !window.confirm(t("resume.builder.leaveWarning"))) {
        router.events.emit("routeChangeError");
        throw "Route change aborted by user";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    router.events.on("routeChangeStart", onRouteChange);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      router.events.off("routeChangeStart", onRouteChange);
    };
  }, [dirty, router, t]);

  const save = useCallback(async (): Promise<ResumeDraft | null> => {
    if (!state || !id || readOnly) return null;
    setSaving(true);
    try {
      const { data } = await api.put(`/api/resumes/drafts/${id}`, { ...state, baseVersion: version });
      applyDraft(data.resume);
      return data.resume as ResumeDraft;
    } catch (error) {
      const err = getApiError(error);
      if (err.code === "VERSION_CONFLICT") setConflict(true);
      toast.error(err.code === "NETWORK" ? t("errors.network") : err.message || t("resume.builder.saveFailed"));
      return null;
    } finally {
      setSaving(false);
    }
  }, [state, id, readOnly, version, applyDraft, t]);

  // Ctrl/Cmd + S saves.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (dirty && !saving) save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, saving, save]);

  const generate = async () => {
    let current = { issues };
    if (dirty) {
      const saved = await save();
      if (!saved) return;
      current = saved;
    }
    if (current.issues.length) {
      toast.error(t("resume.builder.completeFirst"));
      issuesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setPaying(true);
  };

  // ---- Editing helpers --------------------------------------------------------
  const update = (fn: (s: EditorState) => EditorState) => setState((s) => (s ? fn(s) : s));
  const setData = (fn: (d: ResumeData) => ResumeData) => update((s) => ({ ...s, data: fn(s.data) }));
  const setDesign = (patch: Partial<ResumeDesign>) => update((s) => ({ ...s, design: { ...s.design, ...patch } }));

  const listOf = (d: ResumeData, section: ListSection) => d[section] as unknown as Record<string, string | boolean>[];
  const setList = (section: ListSection, fn: (list: Record<string, string | boolean>[]) => Record<string, string | boolean>[]) =>
    setData((d) => ({ ...d, [section]: fn([...listOf(d, section)]) }));

  const moveItem = <T,>(list: T[], from: number, to: number) => {
    if (to < 0 || to >= list.length) return list;
    const copy = [...list];
    const [item] = copy.splice(from, 1);
    copy.splice(to, 0, item);
    return copy;
  };

  const addSkill = () => {
    const parts = skillInput.split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    setData((d) => {
      const existing = new Set(d.skills.map((s) => s.toLowerCase()));
      const added = parts.filter((p) => !existing.has(p.toLowerCase()));
      return { ...d, skills: [...d.skills, ...added].slice(0, 50) };
    });
    setSkillInput("");
  };

  const onPhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type)) return toast.error(t("resume.builder.photo.invalidType"));
    if (file.size > 10 * 1024 * 1024) return toast.error(t("resume.builder.photo.tooLarge"));
    try {
      const dataUrl = await resizePhoto(file);
      if ((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75 > MAX_PHOTO_BYTES) return toast.error(t("resume.builder.photo.tooLarge"));
      update((s) => ({ ...s, photo: dataUrl }));
    } catch {
      toast.error(t("resume.builder.photo.failed"));
    }
  };

  // ---- Versions -----------------------------------------------------------------
  const openVersions = async () => {
    setVersionsOpen(true);
    setVersions(null);
    try {
      const { data } = await api.get(`/api/resumes/drafts/${id}/versions`);
      setVersions(data.versions);
    } catch {
      setVersions([]);
      toast.error(t("resume.versions.loadFailed"));
    }
  };

  const showVersion = async (v: number) => {
    try {
      const { data } = await api.get(`/api/resumes/drafts/${id}/versions/${v}`);
      setPreviewVersion({ ...data.version });
      setVersionsOpen(false);
    } catch {
      toast.error(t("resume.versions.loadFailed"));
    }
  };

  const restoreVersion = async (v: number) => {
    if (dirty && !window.confirm(t("resume.versions.discardChanges"))) return;
    try {
      const { data } = await api.post(`/api/resumes/drafts/${id}/versions/${v}/restore`);
      applyDraft(data.resume);
      setPreviewVersion(null);
      setVersionsOpen(false);
      toast.success(t("resume.versions.restored", { version: v }));
    } catch (error) {
      toast.error(getApiError(error).message || t("errors.generic"));
    }
  };

  // ---- Issue labels -------------------------------------------------------------
  const fieldLabel = (key: string) => t(`resume.builder.fields.${key}`);
  const sectionLabel = (key: string) => t(`resume.builder.sections.${key}`);
  const describeIssue = (issue: ResumeIssue) => {
    const [first, index, key] = issue.field.split(".");
    let label: string;
    if (first === "personal") label = fieldLabel(index);
    else if (index === undefined) label = sectionLabel(first);
    else if (key === undefined) label = `${sectionLabel(first)} #${Number(index) + 1}`;
    else label = `${sectionLabel(first)} #${Number(index) + 1}: ${fieldLabel(key)}`;
    return t(`resume.builder.issues.${issue.code}`, { field: label });
  };

  // ---- Render -------------------------------------------------------------------
  if (!user) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center bg-gray-50 px-4">
        <p className="text-gray-600">{t("resume.signIn")}</p>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 bg-gray-50 px-4">
        <p className="text-gray-700">{loadError}</p>
        <div className="flex gap-2">
          <button onClick={load} className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
            {t("common.retry")}
          </button>
          <Link href="/resume" className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50">
            {t("resume.builder.back")}
          </Link>
        </div>
      </div>
    );
  }
  if (!state || !plans) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const { data, design } = state;
  const price = formatPaise(plans.resume.price, locale);

  const renderField = (section: ListSection, index: number, entry: Record<string, string | boolean>, spec: FieldSpec) => {
    const path = `${section}.${index}.${spec.key}`;
    const inputId = `f-${path}`;
    const invalid = issueFields.has(path);
    const label = `${fieldLabel(spec.key)}${spec.required ? " *" : ""}`;
    const set = (value: string | boolean) =>
      setList(section, (list) => {
        list[index] = { ...list[index], [spec.key]: value, ...(spec.key === "current" && value ? { endDate: "" } : {}) };
        return list;
      });

    if (spec.type === "checkbox") {
      return (
        <label key={spec.key} className="flex items-center gap-2 self-end pb-2 text-sm text-gray-700">
          <input type="checkbox" checked={Boolean(entry[spec.key])} onChange={(e) => set(e.target.checked)} className="h-4 w-4" />
          {fieldLabel(spec.key)}
        </label>
      );
    }
    const disabled = spec.key === "endDate" && Boolean(entry.current);
    return (
      <div key={spec.key} className={spec.wide ? "sm:col-span-2" : ""}>
        <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-gray-600">
          {label}
        </label>
        {spec.type === "textarea" ? (
          <textarea
            id={inputId}
            rows={4}
            maxLength={spec.max}
            value={String(entry[spec.key] ?? "")}
            onChange={(e) => set(e.target.value)}
            placeholder={t("resume.builder.placeholders.description")}
            className={inputClass(invalid)}
            aria-invalid={invalid}
          />
        ) : (
          <input
            id={inputId}
            type={spec.type === "url" ? "url" : spec.type}
            maxLength={spec.max}
            disabled={disabled}
            value={String(entry[spec.key] ?? "")}
            onChange={(e) => set(e.target.value)}
            className={inputClass(invalid || issueFields.has(`${section}.${index}.endDate`) && spec.key === "endDate")}
            aria-invalid={invalid}
          />
        )}
      </div>
    );
  };

  const listSection = (section: ListSection) => {
    const list = listOf(data, section);
    const spec = SECTION_FIELDS[section];
    return (
      <Section key={section} title={sectionLabel(section)} count={list.length} invalid={issues.some((i) => i.field.startsWith(`${section}`))}>
        {list.map((entry, index) => (
          <div key={index} className="mb-3 rounded-lg border border-gray-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase text-gray-500">
                {sectionLabel(section)} #{index + 1}
              </span>
              <div className="flex gap-1">
                <IconButton label={t("resume.builder.moveUp")} onClick={() => setList(section, (l) => moveItem(l, index, index - 1))} disabled={index === 0}>
                  <ArrowUp className="h-4 w-4" />
                </IconButton>
                <IconButton label={t("resume.builder.moveDown")} onClick={() => setList(section, (l) => moveItem(l, index, index + 1))} disabled={index === list.length - 1}>
                  <ArrowDown className="h-4 w-4" />
                </IconButton>
                <IconButton label={t("resume.builder.remove")} onClick={() => setList(section, (l) => l.filter((_, i) => i !== index))} danger>
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">{spec.fields.map((f) => renderField(section, index, entry, f))}</div>
          </div>
        ))}
        {list.length < spec.max && (
          <button type="button" onClick={() => setList(section, (l) => [...l, emptyEntry(section)])} className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700">
            <Plus className="h-4 w-4" />
            {t("resume.builder.addEntry", { section: sectionLabel(section) })}
          </button>
        )}
      </Section>
    );
  };

  const shown = previewVersion || state;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Toolbar */}
      <div className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <Link href="/resume" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
            <ArrowLeft className="h-4 w-4" />
            {t("resume.builder.back")}
          </Link>
          <input
            aria-label={t("resume.builder.titleLabel")}
            value={state.title}
            maxLength={80}
            disabled={readOnly}
            onChange={(e) => update((s) => ({ ...s, title: e.target.value }))}
            placeholder={t("resume.builder.titlePlaceholder")}
            className="min-w-0 flex-1 rounded-lg border border-transparent px-2 py-1 text-lg font-semibold text-gray-900 hover:border-gray-200 focus:border-blue-500 focus:outline-none"
          />
          <span className="text-xs text-gray-500" role="status">
            {saving ? t("resume.builder.saving") : dirty ? t("resume.builder.unsaved") : t("resume.builder.saved", { version })}
          </span>
          <button onClick={openVersions} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <History className="h-4 w-4" />
            {t("resume.builder.versions")}
          </button>
          <button
            onClick={() => save()}
            disabled={readOnly || !dirty || saving}
            className="inline-flex items-center gap-1 rounded-lg border border-blue-600 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t("resume.builder.save")}
          </button>
          <button
            onClick={generate}
            disabled={readOnly || saving || !plans.configured}
            title={!plans.configured ? t("resume.premium.notConfigured") : undefined}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileDown className="h-4 w-4" />
            {t("resume.builder.generate", { price })}
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6">
        {readOnly && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
            <span>{t("resume.builder.premiumExpired")}</span>
            <Link href="/resume" className="font-medium underline">
              {t("resume.builder.renew")}
            </Link>
          </div>
        )}
        {conflict && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 p-4 text-sm text-red-800" role="alert">
            <span>{t("resume.builder.conflict")}</span>
            <button onClick={load} className="font-medium underline">
              {t("resume.builder.reload")}
            </button>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Form */}
          <fieldset disabled={readOnly} className="min-w-0 space-y-4">
            {issues.length > 0 && (
              <div ref={issuesRef} className="scroll-mt-24 rounded-lg border border-amber-200 bg-amber-50 p-4" role="alert">
                <p className="mb-2 flex items-center gap-2 font-medium text-amber-900">
                  <AlertTriangle className="h-4 w-4" />
                  {t("resume.builder.issuesTitle", { price })}
                </p>
                <ul className="list-disc space-y-1 pl-6 text-sm text-amber-900">
                  {issues.slice(0, 12).map((issue) => (
                    <li key={`${issue.field}-${issue.code}`}>{describeIssue(issue)}</li>
                  ))}
                  {issues.length > 12 && <li>{t("resume.builder.moreIssues", { count: issues.length - 12 })}</li>}
                </ul>
                {dirty && <p className="mt-2 text-xs text-amber-800">{t("resume.builder.issuesAfterSave")}</p>}
              </div>
            )}

            <Section title={t("resume.builder.design")} defaultOpen>
              <p className="mb-2 text-xs font-medium text-gray-600">{t("resume.builder.template")}</p>
              <div className="mb-4 grid grid-cols-2 gap-2">
                {TEMPLATES.map((tpl) => (
                  <button
                    key={tpl}
                    type="button"
                    onClick={() => setDesign({ template: tpl })}
                    aria-pressed={design.template === tpl}
                    className={`rounded-lg border p-3 text-left ${design.template === tpl ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600" : "border-gray-200 hover:border-gray-300"}`}
                  >
                    <div className="text-sm font-semibold text-gray-900">{t(`resume.builder.templates.${tpl}.name`)}</div>
                    <div className="text-xs text-gray-500">{t(`resume.builder.templates.${tpl}.desc`)}</div>
                  </button>
                ))}
              </div>
              <p className="mb-2 text-xs font-medium text-gray-600">{t("resume.builder.color")}</p>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {COLOR_PRESETS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setDesign({ color })}
                    aria-label={color}
                    aria-pressed={design.color === color}
                    className={`h-8 w-8 rounded-full border-2 ${design.color === color ? "border-gray-900 ring-2 ring-offset-1 ring-gray-400" : "border-white shadow"}`}
                    style={{ background: color }}
                  />
                ))}
                <label className="ml-2 flex items-center gap-2 text-xs text-gray-600">
                  {t("resume.builder.customColor")}
                  <input type="color" value={design.color} onChange={(e) => setDesign({ color: e.target.value.toLowerCase() })} className="h-8 w-10 cursor-pointer rounded border border-gray-300" />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="font" className="mb-1 block text-xs font-medium text-gray-600">
                    {t("resume.builder.font")}
                  </label>
                  <select id="font" value={design.font} onChange={(e) => setDesign({ font: e.target.value as ResumeDesign["font"] })} className={inputClass()}>
                    {FONTS.map((f) => (
                      <option key={f} value={f}>
                        {t(`resume.builder.fonts.${f}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="fontSize" className="mb-1 block text-xs font-medium text-gray-600">
                    {t("resume.builder.fontSize")}
                  </label>
                  <select id="fontSize" value={design.fontSize} onChange={(e) => setDesign({ fontSize: e.target.value as ResumeDesign["fontSize"] })} className={inputClass()}>
                    {FONT_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {t(`resume.builder.sizes.${s}`)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </Section>

            <Section title={sectionLabel("personal")} defaultOpen invalid={issues.some((i) => i.field.startsWith("personal"))}>
              <div className="mb-4 flex items-center gap-4">
                {state.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={state.photo} alt={t("resume.builder.photo.title")} className="h-16 w-16 rounded-full object-cover" />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-gray-400">
                    <Camera className="h-6 w-6" />
                  </div>
                )}
                <div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => photoInputRef.current?.click()} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                      {state.photo ? t("resume.builder.photo.change") : t("resume.builder.photo.upload")}
                    </button>
                    {state.photo && (
                      <button type="button" onClick={() => update((s) => ({ ...s, photo: null }))} className="rounded-lg px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">
                        {t("resume.builder.photo.remove")}
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{t("resume.builder.photo.help")}</p>
                  <input ref={photoInputRef} type="file" accept="image/jpeg,image/png" onChange={onPhoto} className="hidden" />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ["fullName", "text", true],
                    ["headline", "text", false],
                    ["email", "email", true],
                    ["phone", "tel", true],
                    ["location", "text", false],
                  ] as const
                ).map(([key, type, required]) => (
                  <div key={key} className={key === "headline" ? "sm:col-span-2" : ""}>
                    <label htmlFor={`f-${key}`} className="mb-1 block text-xs font-medium text-gray-600">
                      {fieldLabel(key)}
                      {required ? " *" : ""}
                    </label>
                    <input
                      id={`f-${key}`}
                      type={type}
                      value={data.personal[key]}
                      maxLength={key === "phone" ? 30 : 120}
                      onChange={(e) => setData((d) => ({ ...d, personal: { ...d.personal, [key]: e.target.value } }))}
                      placeholder={key === "headline" ? t("resume.builder.placeholders.headline") : undefined}
                      className={inputClass(issueFields.has(`personal.${key}`))}
                      aria-invalid={issueFields.has(`personal.${key}`)}
                    />
                  </div>
                ))}
              </div>
            </Section>

            <Section title={sectionLabel("objective")} defaultOpen invalid={issueFields.has("objective")}>
              <label htmlFor="f-objective" className="sr-only">
                {sectionLabel("objective")}
              </label>
              <textarea
                id="f-objective"
                rows={4}
                maxLength={1000}
                value={data.objective}
                onChange={(e) => setData((d) => ({ ...d, objective: e.target.value }))}
                placeholder={t("resume.builder.placeholders.objective")}
                className={inputClass(issueFields.has("objective"))}
              />
              <p className="mt-1 text-right text-xs text-gray-400">{data.objective.length}/1000</p>
            </Section>

            {listSection("education")}
            {listSection("experience")}
            {listSection("internships")}
            {listSection("projects")}

            <Section title={sectionLabel("skills")} count={data.skills.length} invalid={issueFields.has("skills") || issues.some((i) => i.field.startsWith("skills."))}>
              <div className="mb-2 flex flex-wrap gap-2">
                {data.skills.map((skill, i) => (
                  <span key={skill} className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm ${issueFields.has(`skills.${i}`) ? "bg-red-100 text-red-800" : "bg-blue-50 text-blue-800"}`}>
                    {skill}
                    <button type="button" onClick={() => setData((d) => ({ ...d, skills: d.skills.filter((_, j) => j !== i) }))} aria-label={`${t("resume.builder.remove")} ${skill}`}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <label htmlFor="f-skill" className="sr-only">
                  {fieldLabel("skill")}
                </label>
                <input
                  id="f-skill"
                  value={skillInput}
                  maxLength={200}
                  onChange={(e) => setSkillInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addSkill();
                    }
                  }}
                  placeholder={t("resume.builder.placeholders.skills")}
                  className={inputClass(issueFields.has("skills"))}
                />
                <button type="button" onClick={addSkill} className="rounded-lg border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-50">
                  {t("resume.builder.addSkill")}
                </button>
              </div>
            </Section>

            {listSection("certifications")}

            <Section title={sectionLabel("achievements")} count={data.achievements.length} invalid={issues.some((i) => i.field.startsWith("achievements"))}>
              {data.achievements.map((item, i) => (
                <div key={i} className="mb-2 flex gap-2">
                  <label htmlFor={`f-ach-${i}`} className="sr-only">
                    {fieldLabel("achievement")} {i + 1}
                  </label>
                  <input
                    id={`f-ach-${i}`}
                    value={item}
                    maxLength={300}
                    onChange={(e) => setData((d) => ({ ...d, achievements: d.achievements.map((a, j) => (j === i ? e.target.value : a)) }))}
                    className={inputClass(issueFields.has(`achievements.${i}`))}
                  />
                  <IconButton label={t("resume.builder.remove")} onClick={() => setData((d) => ({ ...d, achievements: d.achievements.filter((_, j) => j !== i) }))} danger>
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              ))}
              {data.achievements.length < 20 && (
                <button type="button" onClick={() => setData((d) => ({ ...d, achievements: [...d.achievements, ""] }))} className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700">
                  <Plus className="h-4 w-4" />
                  {t("resume.builder.addEntry", { section: sectionLabel("achievements") })}
                </button>
              )}
            </Section>

            {listSection("languages")}
            {listSection("links")}
            {listSection("references")}
          </fieldset>

          {/* Preview */}
          <div className="min-w-0">
            <div className="lg:sticky lg:top-20">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">{t("resume.builder.preview")}</h2>
                <span className="text-xs text-gray-500">{t("resume.builder.previewNote")}</span>
              </div>
              {previewVersion && (
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
                  <span>{t("resume.versions.previewing", { version: previewVersion.version })}</span>
                  <div className="flex gap-2">
                    {!readOnly && (
                      <button onClick={() => restoreVersion(previewVersion.version)} className="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-700">
                        {t("resume.versions.restore")}
                      </button>
                    )}
                    <button onClick={() => setPreviewVersion(null)} className="rounded border border-blue-300 px-3 py-1 hover:bg-blue-100">
                      {t("resume.versions.backToCurrent")}
                    </button>
                  </div>
                </div>
              )}
              <div className="max-h-[calc(100vh-8rem)] overflow-y-auto rounded-lg bg-gray-200 p-3">
                <ResumePreview design={shown.design} data={shown.data} photo={shown.photo} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Versions drawer */}
      {versionsOpen && (
        <div className="fixed inset-0 z-[90] flex justify-end bg-black/40" onClick={() => setVersionsOpen(false)}>
          <div className="h-full w-full max-w-sm overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="versions-title">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="versions-title" className="text-lg font-semibold text-gray-900">
                {t("resume.versions.title")}
              </h2>
              <button onClick={() => setVersionsOpen(false)} aria-label={t("common.close")} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-4 text-xs text-gray-500">{t("resume.versions.help")}</p>
            {versions === null ? (
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-blue-600" />
            ) : versions.length === 0 ? (
              <p className="text-sm text-gray-500">{t("resume.versions.empty")}</p>
            ) : (
              <ul className="space-y-2">
                {versions.map((v) => (
                  <li key={v.version} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-900">v{v.version}</span>
                      {v.version === version && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">{t("resume.versions.current")}</span>}
                    </div>
                    <p className="text-xs text-gray-500">
                      {formatDate(v.createdAt, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} ·{" "}
                      {v.note.startsWith("restored v") ? t("resume.versions.notes.restored", { version: v.note.slice(10) }) : t(`resume.versions.notes.${v.note}`)}
                    </p>
                    {v.version !== version && (
                      <div className="mt-2 flex gap-2">
                        <button onClick={() => showVersion(v.version)} className="text-sm text-blue-600 hover:text-blue-700">
                          {t("resume.versions.preview")}
                        </button>
                        {!readOnly && (
                          <button onClick={() => restoreVersion(v.version)} className="text-sm text-blue-600 hover:text-blue-700">
                            {t("resume.versions.restore")}
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {paying && id && (
        <PaymentFlowModal
          purpose="resume"
          resumeId={id}
          price={plans.resume.price}
          itemLabel={t("resume.pay.resumeItem", { title: state.title })}
          onClose={() => setPaying(false)}
          onCompleted={() => {}}
          onIncomplete={(list) => {
            setIssues(list);
            setTimeout(() => issuesRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
          }}
        />
      )}
    </div>
  );
}

function Section({ title, children, count, invalid, defaultOpen }: { title: string; children: React.ReactNode; count?: number; invalid?: boolean; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen || invalid} className="group rounded-xl border border-gray-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-semibold text-gray-900">
        <span className="flex items-center gap-2">
          {title}
          {typeof count === "number" && count > 0 && <span className="rounded-full bg-gray-100 px-2 text-xs font-medium text-gray-600">{count}</span>}
          {invalid && <AlertTriangle className="h-4 w-4 text-amber-600" />}
        </span>
        <span className="text-gray-400 transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="border-t border-gray-100 px-4 py-4">{children}</div>
    </details>
  );
}

function IconButton({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`rounded p-1.5 disabled:opacity-30 ${danger ? "text-red-600 hover:bg-red-50" : "text-gray-500 hover:bg-gray-100"}`}
    >
      {children}
    </button>
  );
}
