import { AppError } from '../domain/types';
import type { Count, VideoDay, VideoHistory, VideoTotals, VideoSection } from '../video/types';

type ObjectValue = Record<string, unknown>;
const object = (v: unknown): ObjectValue => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as ObjectValue : {};
export function count(v: unknown): Count {
  if (typeof v === 'number') return Number.isSafeInteger(v) ? String(v) : null;
  if (typeof v !== 'string' || !/^-?\d{1,30}$/.test(v)) return null;
  return BigInt(v).toString();
}
function day(v: unknown): string | null {
  const s = String(v ?? '');
  if (!/^\d{8}$/.test(s)) return null;
  const iso = `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  const d = new Date(iso + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === iso ? iso : null;
}
export function parseTotals(value: unknown, videoId: string): VideoTotals {
  const d = object(value), item = object(d.item), stats = object(d.stats);
  if (d.exist === false) throw new AppError(404, '视频不存在、已删除或当前不可访问', 'VIDEO_NOT_FOUND');
  if (d.exist !== true || String(d.item_id) !== videoId || String(item.id) !== videoId) throw new AppError(502, '视频详情响应不完整或身份不匹配', 'PROVIDER_RESPONSE');
  const stamp = typeof item.create_time === 'string' || typeof item.create_time === 'number' ? Number(item.create_time) * 1000 : NaN;
  const published = new Date(stamp);
  return {
    title: typeof item.title === 'string' ? item.title.slice(0,2000) : '',
    publishedAt: Number.isFinite(stamp) && Number.isFinite(published.getTime()) ? published.toISOString() : null,
    durationSeconds: typeof item.duration === 'number' && Number.isFinite(item.duration) && item.duration >= 0 ? item.duration : null,
    plays: count(d.watch_cnt), likes: count(stats.like_cnt), comments: count(stats.comment_cnt), shares: count(stats.share_cnt), collects: count(stats.favorite_cnt)
  };
}
export function parseHistory(value: unknown): VideoHistory {
  const d = object(value), base = object(d.base_resp), lists = object(d.date_values);
  if (base.status_code !== 0 || !Array.isArray(lists.vv_list) || !lists.vv_list.length) throw new AppError(502, '该视频暂未返回历史播放数据', 'HISTORY_UNAVAILABLE');
  const fields = { vv_list: 'plays', valid_vv_list: 'validPlays', like_cnt_list: 'likes', comment_cnt_list: 'comments', share_cnt_list: 'shares', collect_cnt_list: 'collects' } as const;
  const days = new Map<string, VideoDay>();
  for (const [field, name] of Object.entries(fields)) {
    const list = lists[field];
    if (list === undefined || list === null) continue;
    if (!Array.isArray(list) || list.length > 366) throw new AppError(502, '历史数据结构异常', 'PROVIDER_RESPONSE');
    const seen = new Set<string>();
    for (const raw of list) {
      const row = object(raw), date = day(row.visit_date);
      if (!date || seen.has(date)) throw new AppError(502, '历史数据包含无效或重复日期', 'PROVIDER_RESPONSE');
      seen.add(date);
      const target = days.get(date) || { date, plays: null, validPlays: null, likes: null, comments: null, shares: null, collects: null };
      target[name as keyof Omit<VideoDay,'date'>] = count(row.value);
      days.set(date, target);
    }
  }
  const rows = [...days.values()].sort((a,b) => a.date.localeCompare(b.date));
  const continuous = rows.every((r,i) => !i || new Date(r.date+'T00:00:00Z').getTime() - new Date(rows[i-1].date+'T00:00:00Z').getTime() === 86400000);
  return { rows, start: rows[0].date, end: rows.at(-1)!.date, continuous, plays: continuous && rows.every(r => r.plays !== null) ? rows.reduce((sum,r) => sum + BigInt(r.plays!),0n).toString() : null };
}

export type TikHubTransport = typeof fetch;
const paths = [
  '/api/v1/douyin/xingtu_v2/get_item_play_count',
  '/api/v1/douyin/xingtu_v2/get_item_report_trend',
  '/api/v1/douyin/web/fetch_user_profile_by_short_id',
  '/api/v1/douyin/web/handler_user_profile_v2',
  '/api/v1/douyin/app/v3/handler_user_profile',
  '/api/v1/douyin/app/v3/fetch_user_post_videos',
  '/api/v1/douyin/app/v3/fetch_one_video'
] as const;
export async function requestTikHub(path: typeof paths[number], key: string, params: Record<string,string>, transport: TikHubTransport = fetch, post = false): Promise<unknown> {
  if (!paths.includes(path)) throw new AppError(400,'不支持的数据接口');
  // Fixed origin and endpoint allowlist; input values are always encoded parameters.
  const url = 'https://api.tikhub.io' + path + (post ? '' : '?' + new URLSearchParams(params));
  try {
    const res = await transport(url, { method: post ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + key, ...(post ? { 'Content-Type': 'application/json' } : {}) }, ...(post ? { body: JSON.stringify(params) } : {}), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      await res.body?.cancel();
      if (res.status === 401 || res.status === 403) throw new AppError(502, '数据服务鉴权失败，请管理员检查服务端密钥或权限', 'PROVIDER_AUTH');
      if (res.status === 402) throw new AppError(502, '数据服务余额不足，请管理员检查余额', 'PROVIDER_BALANCE');
      if (res.status === 429) throw new AppError(503, '数据服务繁忙，请稍后再查询', 'PROVIDER_LIMIT');
      throw new AppError(502, '数据服务暂时无法完成查询，请稍后重试', 'PROVIDER_UNAVAILABLE');
    }
    const reader = res.body?.getReader();
    if (!reader) throw new AppError(502, '数据服务响应为空', 'PROVIDER_RESPONSE');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const {done,value} = await reader.read(); if (done) break;
        size += value.length;
        if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new AppError(502, '数据服务响应过大', 'PROVIDER_RESPONSE'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const body = object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (body.code !== 200 || !body.data) throw new AppError(502, '数据服务未返回可用结果，请检查余额、权限或稍后重试', 'PROVIDER_REJECTED');
    return body.data;
  } catch (e) {
    if (e instanceof AppError) throw e;
    // Never return or log upstream bodies, signed cache URLs, keys or network errors.
    throw new AppError(502, '数据服务连接失败或响应异常，请稍后重试', 'PROVIDER_UNAVAILABLE');
  }
}
async function section<T>(fn: () => Promise<T>): Promise<VideoSection<T>> {
  try { return {data:await fn(),error:null}; }
  catch (e) { return {data:null,error:e instanceof AppError ? e.message : '数据暂时不可用'}; }
}
export async function fetchVideo(videoId: string, key: string, transport: TikHubTransport = fetch) {
  const [totals, history] = await Promise.all([
    section(async () => parseTotals(await requestTikHub('/api/v1/douyin/xingtu_v2/get_item_play_count',key,{item_id:videoId},transport),videoId)),
    section(async () => parseHistory(await requestTikHub('/api/v1/douyin/xingtu_v2/get_item_report_trend',key,{item_id:videoId},transport,true)))
  ]);
  return {totals,history};
}

// Public App detail counters are not the Xingtu play-count/report-trend metrics.
export function parseImageTotals(value: unknown, workId: string) {
  const d=object(value), a=object(d.aweme_detail), stats=object(a.statistics);
  if ((d.status_code!==undefined&&d.status_code!==0)||a.aweme_id!==workId||(stats.aweme_id!==undefined&&stats.aweme_id!==workId)) throw new AppError(502,'图文详情不可用或作品身份不匹配','PROVIDER_RESPONSE');
  const images=Array.isArray(a.images)?a.images:[];
  if(a.aweme_type!==68&&!images.length)throw new AppError(502,'该作品未被确认为图文，请核对作品类型后重试','WORK_TYPE_MISMATCH');
  const seconds=typeof a.create_time==='number'||typeof a.create_time==='string'?Number(a.create_time):NaN;
  const published=new Date(seconds*1000);
  const totals:VideoTotals={
    title:typeof a.desc==='string'?a.desc.slice(0,2000):'',
    publishedAt:seconds>0&&Number.isFinite(published.getTime())?published.toISOString():null,
    durationSeconds:null,
    // App play_count/exposure_count commonly return placeholder zero; do not claim actual views.
    plays:null,likes:count(stats.digg_count),comments:count(stats.comment_count),shares:count(stats.share_count),collects:count(stats.collect_count)
  };
  return {totals,imageCount:images.length||undefined};
}
export async function fetchImageWork(workId:string,key:string,transport:TikHubTransport=fetch) {
  const {totals,imageCount}=parseImageTotals(await requestTikHub('/api/v1/douyin/app/v3/fetch_one_video',key,{aweme_id:workId},transport),workId);
  return {kind:'image' as const,source:'douyin-app-v3' as const,imageCount,historySupported:false,totals:{data:totals,error:null},history:{data:null,error:null}};
}
