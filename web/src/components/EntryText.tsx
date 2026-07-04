import type React from 'react';

const TOKEN = /:emoji:([a-z0-9._-]+):/gi;

export function emojiToken(name: string): string {
  return `:emoji:${name}:`;
}

export function hasEmojiTokens(text: string): boolean {
  TOKEN.lastIndex = 0;
  return TOKEN.test(text);
}

export default function EntryText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    const name = match[1];
    parts.push(
      <img
        key={`${name}-${index}`}
        className="entry-inline-emoji"
        src={`/api/emojis/${encodeURIComponent(name)}`}
        alt=""
      />
    );
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
