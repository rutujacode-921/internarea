// Resume Builder options and data shapes.
// Keep in sync with backend/utils/resumeData.js.

export const TEMPLATES = ["classic", "modern", "minimal", "executive"] as const;
export const FONTS = ["sans", "serif", "mono"] as const;
export const FONT_SIZES = ["small", "medium", "large"] as const;

export type TemplateId = (typeof TEMPLATES)[number];
export type FontId = (typeof FONTS)[number];
export type FontSizeId = (typeof FONT_SIZES)[number];

export const COLOR_PRESETS = [
  "#1d4ed8",
  "#0f766e",
  "#047857",
  "#7c3aed",
  "#b91c1c",
  "#c2410c",
  "#be185d",
  "#111827",
];

// CSS stacks that match the PDF's built-in fonts.
export const FONT_STACKS: Record<FontId, string> = {
  sans: "Helvetica, Arial, sans-serif",
  serif: "'Times New Roman', Times, serif",
  mono: "'Courier New', Courier, monospace",
};
export const BASE_SIZES: Record<FontSizeId, number> = { small: 9.5, medium: 10.5, large: 11.5 };

export interface ResumeDesign {
  template: TemplateId;
  color: string;
  font: FontId;
  fontSize: FontSizeId;
}

export interface RoleEntry {
  organization: string;
  role: string;
  location: string;
  startDate: string;
  endDate: string;
  current: boolean;
  description: string;
}

export interface ResumeData {
  personal: { fullName: string; headline: string; email: string; phone: string; location: string };
  objective: string;
  education: { institution: string; degree: string; field: string; startDate: string; endDate: string; score: string; description: string }[];
  experience: RoleEntry[];
  internships: RoleEntry[];
  projects: { name: string; link: string; technologies: string; startDate: string; endDate: string; description: string }[];
  skills: string[];
  certifications: { name: string; issuer: string; date: string; url: string }[];
  achievements: string[];
  languages: { name: string; proficiency: string }[];
  links: { label: string; url: string }[];
  references: { name: string; designation: string; organization: string; email: string; phone: string; relationship: string }[];
}

export type ListSection =
  | "education"
  | "experience"
  | "internships"
  | "projects"
  | "certifications"
  | "languages"
  | "links"
  | "references";

export type FieldType = "text" | "textarea" | "month" | "checkbox" | "url" | "email" | "tel";

export interface FieldSpec {
  key: string;
  type: FieldType;
  max?: number;
  wide?: boolean;
  required?: boolean;
}

// Fields of each list section, in display order.
export const SECTION_FIELDS: Record<ListSection, { max: number; fields: FieldSpec[] }> = {
  education: {
    max: 10,
    fields: [
      { key: "institution", type: "text", max: 150, required: true },
      { key: "degree", type: "text", max: 150, required: true },
      { key: "field", type: "text", max: 150 },
      { key: "score", type: "text", max: 40 },
      { key: "startDate", type: "month" },
      { key: "endDate", type: "month" },
      { key: "description", type: "textarea", max: 600, wide: true },
    ],
  },
  experience: {
    max: 15,
    fields: [
      { key: "role", type: "text", max: 150, required: true },
      { key: "organization", type: "text", max: 150, required: true },
      { key: "location", type: "text", max: 100 },
      { key: "current", type: "checkbox" },
      { key: "startDate", type: "month", required: true },
      { key: "endDate", type: "month" },
      { key: "description", type: "textarea", max: 1500, wide: true },
    ],
  },
  internships: {
    max: 15,
    fields: [
      { key: "role", type: "text", max: 150, required: true },
      { key: "organization", type: "text", max: 150, required: true },
      { key: "location", type: "text", max: 100 },
      { key: "current", type: "checkbox" },
      { key: "startDate", type: "month", required: true },
      { key: "endDate", type: "month" },
      { key: "description", type: "textarea", max: 1500, wide: true },
    ],
  },
  projects: {
    max: 15,
    fields: [
      { key: "name", type: "text", max: 150, required: true },
      { key: "technologies", type: "text", max: 300 },
      { key: "link", type: "url", max: 300, wide: true },
      { key: "startDate", type: "month" },
      { key: "endDate", type: "month" },
      { key: "description", type: "textarea", max: 1500, wide: true, required: true },
    ],
  },
  certifications: {
    max: 20,
    fields: [
      { key: "name", type: "text", max: 150, required: true },
      { key: "issuer", type: "text", max: 150 },
      { key: "date", type: "month" },
      { key: "url", type: "url", max: 300 },
    ],
  },
  languages: {
    max: 15,
    fields: [
      { key: "name", type: "text", max: 60, required: true },
      { key: "proficiency", type: "text", max: 40 },
    ],
  },
  links: {
    max: 10,
    fields: [
      { key: "label", type: "text", max: 60, required: true },
      { key: "url", type: "url", max: 300, required: true },
    ],
  },
  references: {
    max: 5,
    fields: [
      { key: "name", type: "text", max: 100, required: true },
      { key: "designation", type: "text", max: 120 },
      { key: "organization", type: "text", max: 150 },
      { key: "relationship", type: "text", max: 100 },
      { key: "email", type: "email", max: 120 },
      { key: "phone", type: "tel", max: 30 },
    ],
  },
};

export const emptyEntry = (section: ListSection): Record<string, string | boolean> =>
  Object.fromEntries(
    SECTION_FIELDS[section].fields.map((f) => [f.key, f.type === "checkbox" ? false : ""])
  );

export const emptyResumeData = (): ResumeData => ({
  personal: { fullName: "", headline: "", email: "", phone: "", location: "" },
  objective: "",
  education: [],
  experience: [],
  internships: [],
  projects: [],
  skills: [],
  certifications: [],
  achievements: [],
  languages: [],
  links: [],
  references: [],
});

export interface ResumeIssue {
  field: string;
  code: "required" | "invalid" | "tooShort" | "beforeStart" | "unsupportedCharacters";
}

export interface ResumeDraft {
  id: string;
  title: string;
  design: ResumeDesign;
  data: ResumeData;
  photo: string | null;
  version: number;
  updatedAt: string;
  issues: ResumeIssue[];
}

export const MAX_PHOTO_BYTES = 300 * 1024;
export const formatPaise = (paise: number, locale = "en-IN") =>
  new Intl.NumberFormat(locale, { style: "currency", currency: "INR", maximumFractionDigits: paise % 100 ? 2 : 0 }).format(paise / 100);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Resume content is in English, so dates use English month names like the PDF.
export const formatMonth = (value: string) => {
  if (!value) return "";
  const [year, month] = value.split("-");
  return `${MONTHS[Number(month) - 1]} ${year}`;
};
export const formatRange = (start: string, end: string, current?: boolean) => {
  const from = formatMonth(start);
  const to = current ? "Present" : formatMonth(end);
  if (from && to) return `${from} - ${to}`;
  return from || to || "";
};
