export function isCustomEmoji(value?: string | null): boolean {
  return !!value?.startsWith('emoji:');
}

export function customEmojiName(value?: string | null): string {
  return isCustomEmoji(value) ? String(value).slice('emoji:'.length) : '';
}

export function tabIconText(value?: string | null): string {
  return isCustomEmoji(value) ? '◉' : value || '📓';
}

export default function TabIcon({ emoji, className = '' }: { emoji?: string | null; className?: string }) {
  if (isCustomEmoji(emoji)) {
    const name = customEmojiName(emoji);
    return (
      <img
        className={`tab-icon-img ${className}`}
        src={`/api/emojis/${encodeURIComponent(name)}`}
        alt=""
      />
    );
  }
  return <span className={className}>{emoji || '📓'}</span>;
}
