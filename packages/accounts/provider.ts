import { AppError } from '../domain/types';
import { count, requestTikHub, type TikHubTransport } from '../providers/tikhub';
import type { AccountProfile } from './types';
import {imageCandidates} from './image-urls';

const object = (v: unknown): Record<string,unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string,unknown> : {};
const secId = (v:unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{20,256}$/.test(v);
export function parseDouyinId(input: unknown): string {
  if (typeof input !== 'string' || !/^[A-Za-z0-9_.-]{1,40}$/.test(input.trim())) throw new AppError(400,'请输入抖音号，不是昵称、UID或整段分享文案', 'INVALID_DOUYIN_ID');
  return input.trim();
}
function available(value: unknown) {
  const d = object(value);
  if (d.status_code !== 0) throw new AppError(502,'没有取得账号资料，请核对抖音号或稍后重试', 'ACCOUNT_UNAVAILABLE');
  return d;
}
export function parseAccountProfile(value: unknown, input: string, sec: string, expectedUid?: string, allowIdMismatch=false): AccountProfile {
  const u = object(available(value).user);
  if (typeof u.uid !== 'string' || !/^\d{1,25}$/.test(u.uid) || !secId(u.sec_uid) || u.sec_uid !== sec || (expectedUid && u.uid !== expectedUid)) throw new AppError(502,'返回账号与输入抖音号不一致，未添加账号；请核对最新抖音号', 'ACCOUNT_MISMATCH');
  const actualId=typeof u.unique_id==='string'&&u.unique_id?u.unique_id:u.short_id;
  if(typeof actualId!=='string'||! /^[A-Za-z0-9_.-]{1,40}$/.test(actualId))throw new AppError(502,'返回账号缺少有效抖音号，请稍后重试','PROVIDER_RESPONSE');
  if(!allowIdMismatch&&actualId!==input)throw new AppError(502,'返回账号与保存的抖音号不一致，请重新核对账号资料','ACCOUNT_MISMATCH');
  if (typeof u.nickname !== 'string' || !u.nickname.trim()) throw new AppError(502,'账号资料不完整，请稍后重试', 'PROVIDER_RESPONSE');
  const avatarUrls=imageCandidates(u.avatar_larger,u.avatar_medium,u.avatar_thumb);
  return {uid:u.uid,secUid:u.sec_uid,douyinId:actualId,nickname:u.nickname.slice(0,100),signature:typeof u.signature==='string'?u.signature.slice(0,500):'',avatarUrl:avatarUrls[0]??null,avatarUrls,followers:count(u.follower_count),following:count(u.following_count),posts:count(u.aweme_count),likes:count(u.total_favorited),favorites:count(u.favoriting_count),fetchedAt:new Date().toISOString()};
}
export async function fetchAccount(input: string, key: string, transport?: TikHubTransport): Promise<AccountProfile> {
  let sec: string | undefined, uid: string | undefined;
  if (/^\d+$/.test(input)) {
    try {
      const data = available(await requestTikHub('/api/v1/douyin/web/fetch_user_profile_by_short_id',key,{short_id:input},transport));
      const u = object(object(data.data).user);
      if (!secId(u.sec_uid) || typeof u.id_str !== 'string' || !/^\d{1,25}$/.test(u.id_str)) throw new AppError(502,'账号标识解析失败', 'PROVIDER_RESPONSE');
      sec=u.sec_uid;uid=u.id_str;
    } catch (e) {
      // One documented alternative for numeric Douyin IDs that are not legacy Short IDs.
      if (!(e instanceof AppError) || ['PROVIDER_AUTH','PROVIDER_BALANCE','PROVIDER_LIMIT'].includes(e.code)) throw e;
    }
  }
  if (!sec) {
    const data = available(await requestTikHub('/api/v1/douyin/web/handler_user_profile_v2',key,{unique_id:input},transport));
    const u = object(data.user_info);
    if (!secId(u.sec_uid)) throw new AppError(502,'未能准确定位这个抖音号，请核对后重试', 'ACCOUNT_UNAVAILABLE');
    sec=u.sec_uid;
  }
  return parseAccountProfile(await requestTikHub('/api/v1/douyin/app/v3/handler_user_profile',key,{sec_user_id:sec},transport),input,sec,uid,true);
}

export async function fetchSavedAccount(profile:AccountProfile,key:string,transport?:TikHubTransport):Promise<AccountProfile> {
  return parseAccountProfile(await requestTikHub('/api/v1/douyin/app/v3/handler_user_profile',key,{sec_user_id:profile.secUid},transport),profile.douyinId,profile.secUid,profile.uid);
}
