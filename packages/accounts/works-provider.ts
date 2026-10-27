import { AppError } from '../domain/types';
import { requestTikHub, type TikHubTransport } from '../providers/tikhub';
import type { AccountProfile } from './types';
import type { AccountWork, AccountWorkPage } from './works-types';
import {imageCandidates} from './image-urls';

const object = (v:unknown):Record<string,unknown> => v !== null && typeof v==='object' && !Array.isArray(v) ? v as Record<string,unknown> : {};
export function parseWorkCursor(value:unknown):string {
  if(value===undefined)return '0';
  if(typeof value!=='string'||!/^\d{1,20}$/.test(value))throw new AppError(400,'作品分页游标无效','INVALID_CURSOR');
  return BigInt(value).toString();
}
export function parseAccountWorks(value:unknown,account:AccountProfile,cursor:string):AccountWorkPage {
  const d=object(value);
  if(d.status_code!==0)throw new AppError(502,'作品列表暂不可用，请稍后重试','WORKS_UNAVAILABLE');
  if((d.uid!==undefined&&String(d.uid)!==account.uid)||(d.sec_uid!==undefined&&d.sec_uid!==account.secUid))throw new AppError(502,'作品列表账号身份不匹配，未保存结果','WORKS_MISMATCH');
  if(![0,1,false,true].includes(d.has_more as number|boolean))throw new AppError(502,'作品分页信息不完整','PROVIDER_RESPONSE');
  const hasMore=d.has_more===1||d.has_more===true;
  const list=d.aweme_list===null&&!hasMore?[]:d.aweme_list;
  if(!Array.isArray(list)||list.length>100)throw new AppError(502,'作品列表结构异常','PROVIDER_RESPONSE');
  let nextCursor:string|null=null;
  if(hasMore){
    const n=d.max_cursor;
    nextCursor=typeof n==='string'?n:typeof n==='number'&&Number.isSafeInteger(n)&&n>=0?String(n):null;
    if(!nextCursor||!/^\d{1,20}$/.test(nextCursor)||BigInt(nextCursor)===BigInt(cursor))throw new AppError(502,'作品分页游标没有有效前进，请稍后刷新','PROVIDER_RESPONSE');
  }
  const unique=new Map<string,AccountWork>();
  for(const value of list){
    const a=object(value),author=object(a.author);
    if(typeof a.aweme_id!=='string'||!/^\d{15,22}$/.test(a.aweme_id))throw new AppError(502,'作品ID无效，未保存结果','PROVIDER_RESPONSE');
    if(author.uid!==account.uid||(author.sec_uid!==undefined&&author.sec_uid!==account.secUid))throw new AppError(502,'作品作者与所选账号不一致，未保存结果','WORKS_MISMATCH');
    let shareKind:'video'|'note'|null=null;
    const share=typeof a.share_url==='string'?a.share_url:object(a.share_info).share_url;
    if(typeof share==='string')try{const u=new URL(share);const m=u.pathname.match(/^\/(?:share\/)?(video|note)\/(\d+)\/?$/);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['www.douyin.com','douyin.com','www.iesdouyin.com','iesdouyin.com'].includes(u.hostname)&&m&&m[2]===a.aweme_id)shareKind=m[1] as 'video'|'note';}catch{}
    const images=Array.isArray(a.images)&&a.images.length>0;
    const kind:AccountWork['kind']=images||a.aweme_type===68||shareKind==='note'?'image':a.aweme_type===0||shareKind==='video'?'video':'other';
    const seconds=typeof a.create_time==='number'?a.create_time:typeof a.create_time==='string'&&/^\d+$/.test(a.create_time)?Number(a.create_time):NaN;
    const date=new Date(seconds*1000);
    const video=object(a.video),firstImage=object(Array.isArray(a.images)?a.images[0]:null);
    const coverUrls=imageCandidates(video.cover,video.origin_cover,firstImage,video.dynamic_cover);
    unique.set(a.aweme_id,{id:a.aweme_id,title:typeof a.desc==='string'?a.desc.slice(0,2000):'',kind,url:`https://www.douyin.com/${kind==='image'?'note':'video'}/${a.aweme_id}`,coverUrl:coverUrls[0]??null,coverUrls,publishedAt:seconds>0&&Number.isFinite(date.getTime())?date.toISOString():null});
  }
  return {accountUid:account.uid,cursor,nextCursor,hasMore,fetchedAt:new Date().toISOString(),items:[...unique.values()]};
}
export async function fetchAccountWorks(account:AccountProfile,cursor:string,key:string,transport?:TikHubTransport) {
  const data=await requestTikHub('/api/v1/douyin/app/v3/fetch_user_post_videos',key,{sec_user_id:account.secUid,max_cursor:cursor,count:'20',sort_type:'0',channel:'normal'},transport);
  return parseAccountWorks(data,account,cursor);
}
