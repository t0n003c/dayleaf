export interface Me {
  needsSetup: boolean;
  authed: boolean;
  username?: string;
  totpEnabled?: boolean;
  hasPasskeys?: boolean;
}

export interface Tab {
  id: number;
  name: string;
  emoji: string;
  color: string;
  position: number;
  entry_count?: number;
}

export interface Attachment {
  id: number;
  filename: string;
  mime: string;
}

export interface Entry {
  id: number;
  tab_id: number;
  content: string;
  mood: string | null;
  entry_date: string;
  created_at: string;
  updated_at: string;
  tab_name: string;
  tab_emoji: string;
  tab_color: string;
  attachments: Attachment[];
}

export interface GalleryItem {
  id: number;
  filename: string;
  mime: string;
  size: number;
  created_at: string;
  entry_id: number;
  entry_date: string;
  mood: string | null;
  snippet: string;
  tab_name: string;
  tab_emoji: string;
  tab_color: string;
}

export interface Stats {
  streak: number;
  daysJournaled: number;
  totalEntries: number;
}

export interface FlashbackGroup {
  label: string;
  date: string;
  entries: Entry[];
}

export interface ReminderSettings {
  enabled: boolean;
  time: string;
  tz: string;
  memories: boolean;
  subscriptions: number;
}

export interface AiSettings {
  baseUrl: string;
  model: string;
  hasKey: boolean;
}

export interface Credential {
  id: string;
  nickname: string;
  created_at: string;
}
