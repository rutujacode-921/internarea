const crypto = require("crypto");

// Design options. Keep in sync with internarea/src/resume/config.ts.
const TEMPLATES = ["classic", "modern", "minimal", "executive"];
const FONTS = ["sans", "serif", "mono"];
const FONT_SIZES = ["small", "medium", "large"];
const DEFAULT_DESIGN = { template: "classic", color: "#1d4ed8", font: "sans", fontSize: "medium" };

const MAX_PHOTO_BYTES = 300 * 1024;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// Each list section: the most entries allowed, and its fields with max lengths.
// "date" fields hold YYYY-MM, "bool" fields are checkboxes, "url" fields are links.
const SECTIONS = {
  education: {
    max: 10,
    fields: { institution: 150, degree: 150, field: 150, startDate: "date", endDate: "date", score: 40, description: 600 },
    required: ["institution", "degree"],
  },
  experience: {
    max: 15,
    fields: { organization: 150, role: 150, location: 100, startDate: "date", endDate: "date", current: "bool", description: 1500 },
    required: ["organization", "role", "startDate"],
  },
  internships: {
    max: 15,
    fields: { organization: 150, role: 150, location: 100, startDate: "date", endDate: "date", current: "bool", description: 1500 },
    required: ["organization", "role", "startDate"],
  },
  projects: {
    max: 15,
    fields: { name: 150, link: "url", technologies: 300, startDate: "date", endDate: "date", description: 1500 },
    required: ["name", "description"],
  },
  certifications: {
    max: 20,
    fields: { name: 150, issuer: 150, date: "date", url: "url" },
    required: ["name"],
  },
  languages: {
    max: 15,
    fields: { name: 60, proficiency: 40 },
    required: ["name"],
  },
  links: {
    max: 10,
    fields: { label: 60, url: "url" },
    required: ["label", "url"],
  },
  references: {
    max: 5,
    fields: { name: 100, designation: 120, organization: 150, email: 120, phone: 30, relationship: 100 },
    required: ["name"],
  },
};

const PERSONAL_FIELDS = { fullName: 100, headline: 120, email: 120, phone: 30, location: 120 };

const cleanText = (value, max) => {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .replace(/₹/g, "Rs.") // The PDF fonts have no rupee sign.
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
};

const cleanUrl = (value) => {
  let url = cleanText(value, 300);
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
};

const isValidUrl = (value) => {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes(".");
  } catch {
    return false;
  }
};

function cleanEntry(entry, fields) {
  const out = {};
  for (const [key, rule] of Object.entries(fields)) {
    const value = entry && typeof entry === "object" ? entry[key] : undefined;
    if (rule === "bool") out[key] = value === true;
    else if (rule === "date") out[key] = typeof value === "string" && DATE_RE.test(value) ? value : "";
    else if (rule === "url") out[key] = cleanUrl(value);
    else out[key] = cleanText(value, rule);
  }
  return out;
}

const isBlankEntry = (entry) =>
  Object.values(entry).every((value) => value === "" || value === false);

// Cleans resume content from the client: unknown keys are dropped, text is
// trimmed and capped, and entirely empty list entries are removed.
function normalizeResumeData(input) {
  const src = input && typeof input === "object" ? input : {};
  const personalSrc = src.personal && typeof src.personal === "object" ? src.personal : {};

  const data = {
    personal: Object.fromEntries(
      Object.entries(PERSONAL_FIELDS).map(([key, max]) => [key, cleanText(personalSrc[key], max)])
    ),
    objective: cleanText(src.objective, 1000),
    skills: (Array.isArray(src.skills) ? src.skills : [])
      .map((skill) => cleanText(skill, 60))
      .filter(Boolean)
      .filter((skill, i, all) => all.findIndex((s) => s.toLowerCase() === skill.toLowerCase()) === i)
      .slice(0, 50),
    achievements: (Array.isArray(src.achievements) ? src.achievements : [])
      .map((item) => cleanText(item, 300))
      .filter(Boolean)
      .slice(0, 20),
  };

  for (const [section, spec] of Object.entries(SECTIONS)) {
    const list = Array.isArray(src[section]) ? src[section] : [];
    data[section] = list
      .slice(0, spec.max)
      .map((entry) => cleanEntry(entry, spec.fields))
      .filter((entry) => !isBlankEntry(entry));
    // "Current" roles have no end date.
    if (spec.fields.current) {
      data[section].forEach((entry) => {
        if (entry.current) entry.endDate = "";
      });
    }
  }
  return data;
}

function normalizeDesign(input = {}) {
  return {
    template: TEMPLATES.includes(input.template) ? input.template : DEFAULT_DESIGN.template,
    color: HEX_RE.test(input.color || "") ? input.color.toLowerCase() : DEFAULT_DESIGN.color,
    font: FONTS.includes(input.font) ? input.font : DEFAULT_DESIGN.font,
    fontSize: FONT_SIZES.includes(input.fontSize) ? input.fontSize : DEFAULT_DESIGN.fontSize,
  };
}

// Returns { ok, photo } where photo is a checked data URL or null.
function normalizePhoto(value) {
  if (value === null || value === undefined || value === "") return { ok: true, photo: null };
  if (typeof value !== "string") return { ok: false, code: "PHOTO_INVALID" };
  const match = value.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return { ok: false, code: "PHOTO_INVALID" };
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > MAX_PHOTO_BYTES) return { ok: false, code: "PHOTO_TOO_LARGE" };
  const isPng = bytes.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if ((match[1] === "png" && !isPng) || (match[1] === "jpeg" && !isJpeg)) {
    return { ok: false, code: "PHOTO_INVALID" };
  }
  return { ok: true, photo: value };
}

// Characters the built-in PDF fonts (Windows-1252) can draw.
const WIN_ANSI_EXTRA = new Set(
  "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".split("").map((c) => c.codePointAt(0))
);
const isPrintable = (text) =>
  [...text].every((char) => {
    const code = char.codePointAt(0);
    return code === 10 || (code >= 32 && code <= 126) || (code >= 160 && code <= 255) || WIN_ANSI_EXTRA.has(code);
  });

// Lists everything that stops a resume from being generated. Each issue is
// { field, code } where field looks like "education.0.degree".
function findResumeIssues(data) {
  const issues = [];
  const add = (field, code) => issues.push({ field, code });
  const p = data.personal || {};

  if (!p.fullName) add("personal.fullName", "required");
  if (!p.email) add("personal.email", "required");
  else if (!EMAIL_RE.test(p.email)) add("personal.email", "invalid");
  const phoneDigits = (p.phone || "").replace(/\D/g, "");
  if (!p.phone) add("personal.phone", "required");
  else if (phoneDigits.length < 7 || phoneDigits.length > 15) add("personal.phone", "invalid");
  if (!data.objective) add("objective", "required");
  else if (data.objective.length < 30) add("objective", "tooShort");
  if (!data.education?.length) add("education", "required");
  if (!data.skills?.length) add("skills", "required");

  for (const [section, spec] of Object.entries(SECTIONS)) {
    (data[section] || []).forEach((entry, index) => {
      for (const key of spec.required) {
        if (!entry[key]) add(`${section}.${index}.${key}`, "required");
      }
      for (const [key, rule] of Object.entries(spec.fields)) {
        if (rule === "url" && entry[key] && !isValidUrl(entry[key])) add(`${section}.${index}.${key}`, "invalid");
      }
      if (entry.email && !EMAIL_RE.test(entry.email)) add(`${section}.${index}.email`, "invalid");
      if (entry.startDate && entry.endDate && entry.endDate < entry.startDate) {
        add(`${section}.${index}.endDate`, "beforeStart");
      }
    });
  }

  // Walk every text value and flag ones the PDF can't render (e.g. Devanagari).
  const walk = (value, path) => {
    if (typeof value === "string") {
      if (value && !isPrintable(value)) add(path, "unsupportedCharacters");
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}.${i}`));
    } else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) walk(item, path ? `${path}.${key}` : key);
    }
  };
  walk(data, "");

  return issues;
}

// Identifies identical resume content, to catch paying twice for the same PDF.
function contentHash({ data, design, photo }) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ data, design, photo: photo || null }))
    .digest("hex");
}

function emptyResumeData(seed = {}) {
  return normalizeResumeData({ personal: { fullName: seed.name || "", email: seed.email || "" } });
}

module.exports = {
  TEMPLATES,
  FONTS,
  FONT_SIZES,
  DEFAULT_DESIGN,
  normalizeResumeData,
  normalizeDesign,
  normalizePhoto,
  findResumeIssues,
  contentHash,
  emptyResumeData,
  cleanText,
};
