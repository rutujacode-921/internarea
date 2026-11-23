import en from "./locales/en.json";
import { LanguageCode } from "./config";

export type Messages = typeof en;
type Vars = Record<string, string | number>;

// English is bundled with the app and is the fallback for anything missing.
// Other languages are downloaded on demand when the user picks them.
const loaders: Record<LanguageCode, () => Promise<unknown>> = {
  en: async () => en,
  es: () => import("./locales/es.json").then((m) => m.default),
  hi: () => import("./locales/hi.json").then((m) => m.default),
  pt: () => import("./locales/pt.json").then((m) => m.default),
  zh: () => import("./locales/zh.json").then((m) => m.default),
  fr: () => import("./locales/fr.json").then((m) => m.default),
};

const cache = new Map<LanguageCode, Messages>([["en", en]]);

export class TranslationLoadError extends Error {
  constructor(public language: LanguageCode, public cause?: unknown) {
    super(`Could not load translations for "${language}"`);
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function getCachedMessages(language: LanguageCode): Messages | undefined {
  return cache.get(language);
}

// Loads a language bundle, retrying briefly to ride out flaky connections.
export async function loadMessages(language: LanguageCode, retries = 2): Promise<Messages> {
  const cached = cache.get(language);
  if (cached) return cached;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const bundle = await loaders[language]();
      if (!bundle || typeof bundle !== "object") throw new Error("Empty translation bundle");
      cache.set(language, bundle as Messages);
      return bundle as Messages;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await wait(400 * 2 ** attempt);
    }
  }
  throw new TranslationLoadError(language, lastError);
}

const lookup = (source: unknown, key: string): unknown =>
  key.split(".").reduce<unknown>(
    (node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined),
    source
  );

const interpolate = (text: string, vars?: Vars) =>
  text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) =>
    vars && vars[name] !== undefined ? String(vars[name]) : match
  );

const reported = new Set<string>();

// Translates a dotted key. Missing translations fall back to English, then to
// the key itself, so the UI never shows a blank or crashes.
export function translate(messages: Messages, language: LanguageCode, key: string, vars?: Vars): string {
  let value = lookup(messages, key);
  if (typeof value !== "string") {
    if (language !== "en" && process.env.NODE_ENV !== "production" && !reported.has(`${language}:${key}`)) {
      reported.add(`${language}:${key}`);
      console.warn(`[i18n] Missing "${language}" translation for "${key}"; using English.`);
    }
    value = lookup(en, key);
  }
  if (typeof value !== "string") return key;
  return interpolate(value, vars);
}

export type TranslateFn = (key: string, vars?: Vars) => string;
