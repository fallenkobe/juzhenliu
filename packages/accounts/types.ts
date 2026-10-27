import type { Count } from '../video/types';

export interface AccountProfile {
  uid: string;
  secUid: string;
  douyinId: string;
  nickname: string;
  avatarUrl: string | null;
  signature: string;
  followers: Count;
  following: Count;
  posts: Count;
  likes: Count;
  favorites: Count;
  fetchedAt: string;
}
export interface AccountPreview { lookupId: string; expiresAt: string; profile: AccountProfile; cached: boolean }
export interface ManagedAccount extends AccountProfile { addedAt: string }
