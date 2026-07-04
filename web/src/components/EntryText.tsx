import type React from 'react';

const TOKEN_PATTERN = ':emoji:([a-z0-9._-]+):';

function tokenRegex() {
  return new RegExp(TOKEN_PATTERN, 'gi');
}

export function emojiToken(name: string): string {
  return `:emoji:${name}:`;
}

export function hasEmojiTokens(text: string): boolean {
  return new RegExp(TOKEN_PATTERN, 'i').test(text);
}

export default function EntryText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(tokenRegex())) {
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
