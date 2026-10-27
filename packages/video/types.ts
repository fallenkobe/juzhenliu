export type Count = string | null;
export interface VideoTotals {
  title: string;
  publishedAt: string | null;
  durationSeconds: number | null;
  plays: Count;
  likes: Count;
  comments: Count;
  shares: Count;
  collects: Count;
}
export interface VideoDay {
  date: string;
  plays: Count;
  validPlays: Count;
  likes: Count;
  comments: Count;
  shares: Count;
  collects: Count;
}
export interface VideoHistory {
  rows: VideoDay[];
  start: string;
  end: string;
  continuous: boolean;
  plays: Count;
}
export interface VideoSection<T> { data: T | null; error: string | null }
export interface VideoReport {
  videoId: string;
  fetchedAt: string;
  totals: VideoSection<VideoTotals>;
  history: VideoSection<VideoHistory>;
}
export interface SavedVideo { videoId: string; title: string; fetchedAt: string; partial: boolean }
export interface VideoStatus {
  signedIn: boolean;
  ownerConfigured: boolean;
  providerConfigured: boolean;
  originConfigured: boolean;
  dailyLimit: number;
  dailyUsed: number;
  cacheMinutes: number;
}
