import { randomUUID } from 'node:crypto';
import { db, type Client } from '../db/index';
import { AppError } from '../domain/types';
import { requireOwner } from '../domain/douyin-auth';
import { fetchVideo, type TikHubTransport } from '../providers/tikhub';
import { parseVideoId } from './input';
import type { SavedVideo, VideoReport } from './types';

const now = () => new Date().toISOString();
const day = () => new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
export const CACHE_MINUTES = 30;
export function dailyLimit() {
  const n = Number(process.env.MATRIX_VIDEO_DAILY_LIMIT || 100);
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 100;
}
export function providerConfigured() { return !!process.env.TIKHUB_API_KEY?.trim(); }
export async function dailyUsed() { const [row] = await db.query('SELECT queries FROM video_daily_usage WHERE day=$1',[day()]); return Number(row?.queries || 0); }
export async function reserveDailyQuery(tx: Client) {
  const used = await tx.query(`INSERT INTO video_daily_usage VALUES($1,1)
    ON CONFLICT(day) DO UPDATE SET queries=video_daily_usage.queries+1
    WHERE video_daily_usage.queries<$2 RETURNING queries`,[day(),dailyLimit()]);
  if (!used.length) throw new AppError(429, '今日数据查询额度已用完，已保存的结果仍可查看', 'DAILY_LIMIT');
}
async function saved(id: string): Promise<VideoReport | null> {
  const [row] = await db.query('SELECT report_json FROM video_reports WHERE video_id=$1',[id]);
  return row ? JSON.parse(row.report_json) as VideoReport : null;
}
export async function listVideos(token: string | undefined): Promise<SavedVideo[]> {
  await requireOwner(token);
  const rows = await db.query('SELECT video_id,report_json,fetched_at FROM video_reports ORDER BY fetched_at DESC LIMIT 30');
  return rows.map(r => { const report = JSON.parse(r.report_json) as VideoReport; return {videoId:r.video_id,title:report.totals.data?.title || '视频 '+r.video_id,fetchedAt:r.fetched_at,partial:!report.totals.data || !report.history.data}; });
}
export async function getVideo(token: string | undefined, input: unknown): Promise<VideoReport> {
  await requireOwner(token);
  const report = await saved(parseVideoId(input));
  if (!report) throw new AppError(404, '还没有保存该视频的查询结果', 'NOT_FOUND');
  return report;
}
export async function queryVideo(token: string | undefined, input: unknown, refresh = false, transport?: TikHubTransport) {
  await requireOwner(token);
  const id = parseVideoId(input), key = process.env.TIKHUB_API_KEY?.trim();
  if (!key) throw new AppError(503, '请管理员在服务端配置 TIKHUB_API_KEY', 'PROVIDER_NOT_CONFIGURED');
  const lease = randomUUID();
  const cached = await db.transaction(null, async tx => {
    const at = now();
    // A persisted per-video lease protects multiple Node processes as well as double clicks.
    const got = await tx.query(`INSERT INTO video_query_leases VALUES($1,$2,$3)
      ON CONFLICT(video_id) DO UPDATE SET lease_token=excluded.lease_token,expires_at=excluded.expires_at
      WHERE video_query_leases.expires_at<=$4 RETURNING video_id`,[id,lease,new Date(Date.now()+60000).toISOString(),at]);
    if (!got.length) throw new AppError(409, '这个视频正在查询中，请稍后从最近查询中打开', 'QUERY_RUNNING');
    const [row] = await tx.query('SELECT report_json,fetched_at FROM video_reports WHERE video_id=$1',[id]);
    if (row) {
      const report = JSON.parse(row.report_json) as VideoReport, age = Date.now() - new Date(row.fetched_at).getTime();
      const partial = !report.totals.data || !report.history.data;
      if (age < 60000 || (!refresh && !partial && age < CACHE_MINUTES*60000)) {
        await tx.query('DELETE FROM video_query_leases WHERE video_id=$1 AND lease_token=$2',[id,lease]);
        return report;
      }
    }
    await reserveDailyQuery(tx);
    // Budget is reserved before network calls; failures conservatively consume one query.
    return null;
  });
  if (cached) return {report:cached,cached:true};
  try {
    const sections = await fetchVideo(id,key,transport);
    if (!sections.totals.data && !sections.history.data) throw new AppError(502, sections.totals.error || '没有取得视频数据', 'QUERY_FAILED');
    await requireOwner(token); // Password rotation/logout during the request must revoke access too.
    const report: VideoReport = {videoId:id,fetchedAt:now(),...sections};
    await db.transaction(null, async tx => {
      const current = await tx.query('SELECT video_id FROM video_query_leases WHERE video_id=$1 AND lease_token=$2 AND expires_at>$3',[id,lease,now()]);
      if (!current.length) throw new AppError(409, '查询已超时，请重新查询', 'QUERY_EXPIRED');
      await tx.query('INSERT INTO video_reports VALUES($1,$2,$3) ON CONFLICT(video_id) DO UPDATE SET report_json=excluded.report_json,fetched_at=excluded.fetched_at',[id,JSON.stringify(report),report.fetchedAt]);
    });
    return {report,cached:false};
  } finally { await db.query('DELETE FROM video_query_leases WHERE video_id=$1 AND lease_token=$2',[id,lease]); }
}
export function historyCsv(report: VideoReport): string {
  const history = report.history.data;
  if (!history) throw new AppError(404, '暂无可导出的历史明细', 'HISTORY_UNAVAILABLE');
  // Fields are validated ISO dates and integer strings only; no spreadsheet formulas or titles.
  return '\uFEFF' + ['日期,播放量,vv有效播放字段,点赞量,评论量,分享量,收藏量',...history.rows.map(r=>[r.date,r.plays,r.validPlays,r.likes,r.comments,r.shares,r.collects].map(v=>v??'').join(','))].join('\r\n')+'\r\n';
}
