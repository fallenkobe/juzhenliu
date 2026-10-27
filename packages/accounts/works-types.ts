export interface AccountWork {
  id: string;
  title: string;
  kind: 'video' | 'image' | 'other';
  url: string;
  coverUrl: string | null;
  publishedAt: string | null;
}
export interface AccountWorkPage {
  accountUid: string;
  cursor: string;
  nextCursor: string | null;
  hasMore: boolean;
  fetchedAt: string;
  items: AccountWork[];
}
