import { db } from '../db/index';
import * as auth from '../domain/douyin-auth';
import { AppError } from '../domain/types';
import { CACHE_MINUTES, dailyLimit, dailyUsed, getVideo, historyCsv, listVideos, providerConfigured, queryVideo } from './service';
import { addManagedAccount, listManagedAccounts, lookupAccount, removeManagedAccount } from '../accounts/service';
import { queryAccountWorks } from '../accounts/works-service';

const shared = globalThis as typeof globalThis & { matrixVideoReady?: Promise<void> };
function json(body: unknown, status = 200) { return Response.json(body,{status,headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}}); }
export function publicOrigin(): string | null {
  try {
    const u = new URL(process.env.MATRIX_PUBLIC_ORIGIN || '');
    if (u.protocol === 'https:' && u.origin === process.env.MATRIX_PUBLIC_ORIGIN && !u.username && !u.password) return u.origin;
  } catch { /* Production requires one explicit HTTPS origin. */ }
  return null;
}
export function requestOrigin(req: Request): string {
  let expected = publicOrigin();
  if (!expected) {
    if (process.env.NODE_ENV === 'production') throw new AppError(503, '请管理员配置 MATRIX_PUBLIC_ORIGIN 为本站 HTTPS 地址', 'ORIGIN_NOT_CONFIGURED');
    const host = req.headers.get('host') || '';
    if (!/^(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(host)) throw new AppError(403, '开发环境仅允许本机访问', 'ORIGIN_REJECTED');
    expected = 'http://' + host;
  }
  if (req.headers.get('origin') !== expected || req.headers.get('x-matrix-request') !== 'video-analytics-v1' || req.headers.get('sec-fetch-site') === 'cross-site') throw new AppError(403, '请求来源验证失败，请从本站页面操作', 'ORIGIN_REJECTED');
  return expected;
}
async function smallJson(req: Request): Promise<Record<string,unknown>> {
  if (req.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new AppError(415, '需要 JSON 请求');
  const reader = req.body?.getReader();
  if (!reader) throw new AppError(400, '请求内容为空');
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const {done,value} = await reader.read(); if(done) break; size += value.length; if(size > 4096) { await reader.cancel(); throw new AppError(413, '请求内容过大'); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if(!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new AppError(400, 'JSON 格式不正确'); }
}
export async function handleVideoRequest(req: Request, action: string[], token?: string) {
  const resource = action.join('/');
  try {
    await (shared.matrixVideoReady ??= db.migrate().catch(e=>{shared.matrixVideoReady=undefined;throw e;}));
    if (resource === 'status' && req.method === 'GET') {
      const ownerConfigured = auth.ownerPasswordConfigured();
      let signedIn = false;
      if (ownerConfigured && token) try { await auth.requireOwner(token); signedIn = true; } catch(e) { if (!(e instanceof AppError) || e.status !== 401) throw e; }
      return json({signedIn,ownerConfigured,providerConfigured:providerConfigured(),originConfigured:process.env.NODE_ENV !== 'production' || !!publicOrigin(),dailyLimit:dailyLimit(),dailyUsed:signedIn?await dailyUsed():0,cacheMinutes:CACHE_MINUTES});
    }
    if (process.env.NODE_ENV === 'production' && !publicOrigin()) throw new AppError(503, '服务部署配置尚未完成', 'ORIGIN_NOT_CONFIGURED');
    const origin = req.method !== 'GET' ? requestOrigin(req) : null;
    if (resource === 'session' && req.method === 'POST') {
      const body = await smallJson(req), value = await auth.loginOwner(body.password);
      const res = json({ok:true});
      res.headers.set('Set-Cookie',`${auth.OWNER_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${origin!.startsWith('https:')?'; Secure':''}`);
      return res;
    }
    if (resource === 'session' && req.method === 'DELETE') {
      if (token) await auth.logoutOwner(token);
      const res = json({ok:true}); res.headers.set('Set-Cookie',`${auth.OWNER_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${origin!.startsWith('https:')?'; Secure':''}`); return res;
    }
    await auth.requireOwner(token);
    if (action.length === 3 && action[0] === 'accounts' && action[2] === 'works' && req.method === 'POST') {
      const body=await smallJson(req);
      if(body.refresh!==undefined&&typeof body.refresh!=='boolean')throw new AppError(400,'刷新参数无效');
      return json(await queryAccountWorks(token,action[1],body.cursor,body.refresh===true));
    }
    if (resource === 'accounts' && req.method === 'GET') return json({accounts:await listManagedAccounts(token)});
    if (resource === 'accounts/lookup' && req.method === 'POST') return json(await lookupAccount(token,(await smallJson(req)).douyinId));
    if (resource === 'accounts' && req.method === 'POST') return json({account:await addManagedAccount(token,(await smallJson(req)).lookupId)});
    if (action.length === 2 && action[0] === 'accounts' && req.method === 'DELETE') return json(await removeManagedAccount(token,action[1]));
    if (resource === 'recent' && req.method === 'GET') return json({videos:await listVideos(token)});
    if (resource === 'query' && req.method === 'POST') {
      const body = await smallJson(req);
      if (body.refresh !== undefined && typeof body.refresh !== 'boolean') throw new AppError(400,'刷新参数无效');
      return json(await queryVideo(token,body.input,body.refresh === true));
    }
    if (action.length === 2 && action[0] === 'reports' && req.method === 'GET') return json({report:await getVideo(token,action[1])});
    if (action.length === 2 && action[0] === 'export' && req.method === 'GET') {
      const report = await getVideo(token,action[1]);
      return new Response(historyCsv(report),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="video-${report.videoId}-history.csv"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
    }
    return json({error:'接口不存在'},404);
  } catch (e) {
    if (e instanceof AppError) return json({error:e.message,code:e.code},e.status);
    console.error('[video-analytics] Internal error');
    return json({error:'视频查询服务暂时不可用，请稍后重试',code:'INTERNAL_ERROR'},500);
  }
}
