import React from "react";
import Link from "next/link";

// Renders post/comment text with clickable @mentions, #hashtags and links.
// Built from React elements (never raw HTML), so user text can't inject markup.
const TOKEN = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?]|(?<![\w.])@[a-z0-9_.]{3,20}|#[\p{L}\p{N}_]{1,50})/giu;

export default function RichText({ text, className }: { text: string; className?: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    if (token.startsWith("@")) {
      parts.push(
        <Link key={start} href={`/space/u/${token.slice(1).toLowerCase()}`} className="font-medium text-blue-600 hover:underline">
          {token}
        </Link>
      );
    } else if (token.startsWith("#")) {
      parts.push(
        <Link key={start} href={`/space/tag/${encodeURIComponent(token.slice(1).toLowerCase())}`} className="text-blue-600 hover:underline">
          {token}
        </Link>
      );
    } else {
      parts.push(
        <a key={start} href={token} target="_blank" rel="noopener noreferrer nofollow ugc" className="break-all text-blue-600 hover:underline">
          {token}
        </a>
      );
    }
    last = start + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <p className={`whitespace-pre-wrap break-words ${className || ""}`}>{parts}</p>;
}
