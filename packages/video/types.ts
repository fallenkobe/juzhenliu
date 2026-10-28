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
export interface VideoSnapshotChange {
  previousAt: string | null;
  elapsedMs: number | null;
  reason: 'first' | 'source-changed' | 'invalid-time' | null;
  values: Pick<VideoTotals, 'plays' | 'likes' | 'comments' | 'shares' | 'collects'>;
}
export interface VideoSnapshot {
  fetchedAt: string;
  source: 'xingtu' | 'douyin-app-v3';
  origin: 'query' | 'saved-report';
  totals: Pick<VideoTotals, 'plays' | 'likes' | 'comments' | 'shares' | 'collects'>;
  change?: VideoSnapshotChange;
}
export interface VideoHeat {
  version: 'matrix-heat-v1';
  score: number | null;
  state: 'ready' | 'reference' | 'waiting' | 'unavailable';
  reason: string;
  asOf: string;
  start: string | null;
  hours: number | null;
  expiresAt: string | null;
  delta: number | null;
  parts: {activity: number; efficiency: number; momentum: number | null; ageBase: number} | null;
}
export interface VideoReport {
  videoId: string;
  kind?: 'video' | 'image';
  imageCount?: number;
  source?: 'xingtu' | 'douyin-app-v3';
  historySupported?: boolean;
  fetchedAt: string;
  totals: VideoSection<VideoTotals>;
  history: VideoSection<VideoHistory>;
  snapshots?: VideoSnapshot[];
  snapshotCount?: number;
  heat?: VideoHeat;
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
