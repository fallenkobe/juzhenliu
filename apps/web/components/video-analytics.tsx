'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, BarChart3, CalendarDays, CheckCircle2, Download, History, Loader2, LogOut, RefreshCw, Search, ShieldCheck, Users } from 'lucide-react';
import type { Count, SavedVideo, VideoDay, VideoReport, VideoStatus } from '../../../packages/video/types';
import './video-analytics.css';
import {logoutWorkspace,redirectToWorkspaceLogin} from './workspace-session';

const fmt = (n: Count) => n === null ? '暂无数据' : BigInt(n).toLocaleString('zh-CN');
const stamp = (s: string) => new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch('/api/videos/'+path,{method,cache:'no-store',headers:{'X-Matrix-Request':'video-analytics-v1',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  let value; try { value = await res.json(); } catch { throw new Error('服务器未返回有效结果，请稍后重试'); }
  if(res.status===401)redirectToWorkspaceLogin();
  if (!res.ok) throw new Error(value.error || '操作未完成，请稍后重试');
  return value as T;
}
function PlayChart({rows}: {rows: VideoDay[]}) {
  const values = rows.map(r=>r.plays===null?null:Number(r.plays));
  const finite = values.filter((v):v is number=>v!==null);
  if (!finite.length) return <p className="va-empty">暂无可绘制的播放数据</p>;
  const high = Math.max(...finite,1), low = Math.min(...finite,0), range = high-low;
  const x = (i:number) => 50 + i * 900 / Math.max(rows.length-1,1);
  const y = (v:number) => 210 - (v-low) / range * 180;
  return <div className="va-chart"><svg viewBox="0 0 1000 260" role="img" aria-label={`${rows[0].date} 至 ${rows.at(-1)!.date} 逐日播放趋势，精确数值见下方表格`}>
    {[0,.5,1].map(t=><g key={t}><line x1="50" x2="950" y1={30+t*180} y2={30+t*180} stroke="currentColor" opacity=".12"/><text x="45" y={35+t*180} textAnchor="end">{new Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:1}).format(high-t*range)}</text></g>)}
    {values.map((v,i)=>v===null?null:<g key={rows[i].date}>{i>0&&values[i-1]!==null&&new Date(rows[i].date+'T00:00:00Z').getTime()-new Date(rows[i-1].date+'T00:00:00Z').getTime()===86400000&&<line x1={x(i-1)} y1={y(values[i-1]!)} x2={x(i)} y2={y(v)} stroke="#24dbce" strokeWidth="3"/>}<circle cx={x(i)} cy={y(v)} r="4" fill="#24dbce"><title>{rows[i].date}：{fmt(rows[i].plays)}</title></circle></g>)}
    <text x="50" y="244">{rows[0].date}</text><text x="950" y="244" textAnchor="end">{rows.at(-1)!.date}</text>
  </svg></div>;
}
export default function VideoAnalytics({standalone=false,initialVideoId=''}: {standalone?:boolean;initialVideoId?:string}) {
  const [status,setStatus] = useState<VideoStatus|null>(null), [input,setInput] = useState(initialVideoId);
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState(''), [report,setReport] = useState<VideoReport|null>(null), [recent,setRecent] = useState<SavedVideo[]>([]);
  const openedInitial=useRef(false);
  async function refreshStatus() {
    const s = await api<VideoStatus>('status'); setStatus(s);
    if(s.signedIn) {
      setRecent((await api<{videos:SavedVideo[]}>('recent')).videos);
      // Navigation/reload only reads an existing report; it must never trigger paid queries.
      if(initialVideoId&&!openedInitial.current){openedInitial.current=true;try{setReport((await api<{report:VideoReport}>('reports/'+initialVideoId)).report);}catch{setNotice('已填入作品 ID，点击“查询视频”获取数据。');}}
    }
    else {setRecent([]);setReport(null);openedInitial.current=false;redirectToWorkspaceLogin();}
    return s;
  }
  useEffect(()=>{void refreshStatus().catch(e=>setError(e.message));},[]);
  async function act(fn:()=>Promise<void>) {
    setBusy(true);setError('');setNotice('');
    try {await fn();} catch(e) {setError(e instanceof Error?e.message:'操作失败');await refreshStatus().catch(()=>{});}
    finally {setBusy(false);}
  }
  async function query(refresh=false) {
    await act(async()=>{
      const value = await api<{report:VideoReport;cached:boolean}>('query','POST',{input:refresh&&report?report.videoId:input,refresh});
      setReport(value.report);setInput(value.report.videoId);
      setNotice(value.cached?'已打开保存的结果，本次未请求数据服务。':'数据已更新并保存。');
      await refreshStatus();
    });
  }
  const totals = report?.totals.data, history = report?.history.data;
  const ready = !!status?.providerConfigured && !!status?.originConfigured;
  return <div className="va-page"><header className="va-top"><a className="va-brand" href="/videos"><span className="va-mark">矩</span>矩阵流<span className="va-product">视频分析</span></a><nav><a href="/accounts"><Users size={15}/>账号管理</a>{!standalone&&<a href="/"><ArrowLeft size={14}/>工作台</a>}{status?.signedIn&&<button disabled={busy} onClick={()=>void act(async()=>{await logoutWorkspace();})}><LogOut size={15}/>退出</button>}</nav></header>
    <main className="va-main"><section className="va-intro"><div className="va-eyebrow"><span/>DOUYIN / VIDEO INSIGHTS</div><h1>每条视频，<br className="va-mobile-break"/>看见真实表现<span>。</span></h1><p>从累计播放到每日变化，让内容的表现有据可查。</p><div className="va-tags"><span><ShieldCheck size={14}/>服务端安全查询</span><span><CalendarDays size={14}/>按实际日期展示</span><span><Download size={14}/>明细可导出</span></div></section>
    {error&&<div className="va-message va-error" role="alert">{error}</div>}{notice&&<div className="va-message" role="status"><CheckCircle2 size={16}/>{notice}</div>}
    {!status?<section className="va-panel va-loading"><Loader2 className="spin" size={20}/><p>正在检查查询服务…</p><button className="secondary" disabled={busy} onClick={()=>void act(async()=>{await refreshStatus();})}>重新检查</button></section>:!status.signedIn?null:<>
    <section className="va-panel va-search-panel"><div className="va-panel-heading"><div><h2><Search size={20}/>查询视频</h2><p>粘贴完整视频链接、含 modal_id 的页面链接，或输入视频 ID。</p></div><span className="va-badge">TikHub · 星图数据</span></div><form className="va-search" onSubmit={e=>{e.preventDefault();void query();}}><label className="va-sr-only" htmlFor="video-query">抖音视频链接或 ID</label><input id="video-query" value={input} onChange={e=>setInput(e.target.value)} placeholder="https://www.douyin.com/video/…" maxLength={2048} disabled={busy} required/><button className="primary" disabled={busy||!input.trim()||!ready}>{busy?<Loader2 size={17} className="spin"/>:<Search size={17}/>} {busy?'正在查询…':'查询视频'}</button></form><div className="va-search-meta"><span>成功结果缓存 {status.cacheMinutes} 分钟 · 今日数据查询 {status.dailyUsed} / {status.dailyLimit}</span><span>新查询及强制更新会使用服务商付费额度</span></div>{!ready&&<p className="va-message va-error">查询配置尚未完成，已保存的结果仍可查看。</p>}</section>
    <div className="va-workspace"><div className="va-content">{report?<>
      <section className="va-panel va-video"><div className="va-panel-heading"><span className="va-badge">视频累计表现</span><a href={'https://www.douyin.com/video/'+report.videoId} target="_blank" rel="noreferrer">在抖音打开<ArrowUpRight size={14}/></a></div><h2>{totals?.title||'视频 '+report.videoId}</h2><div className="va-video-meta"><span>ID {report.videoId}</span>{totals?.publishedAt&&<span>发布于 {stamp(totals.publishedAt)}</span>}{totals?.durationSeconds!==null&&totals?.durationSeconds!==undefined&&<span>{totals.durationSeconds} 秒</span>}</div><div className="va-update"><span>查询于 {stamp(report.fetchedAt)}</span><button className="text-button" disabled={busy||!ready} onClick={()=>void query(true)}><RefreshCw size={14}/>更新数据</button></div>{report.totals.error&&<p className="va-message va-error">累计指标：{report.totals.error}</p>}<div className="va-metrics">{[['累计播放',totals?.plays],['累计点赞',totals?.likes],['累计评论',totals?.comments],['累计分享',totals?.shares],['累计收藏',totals?.collects]].map(([label,value])=><div key={label}><span>{label}</span><strong>{fmt(value??null)}</strong></div>)}</div><p className="va-footnote">累计播放采用服务商星图含投流口径。数据尚未与官方后台逐项核对。</p></section>
      <section className="va-panel"><div className="va-panel-heading"><div><h2><BarChart3 size={20}/>历史播放趋势</h2><p>{history?`${history.start} 至 ${history.end} · ${history.rows.length} 个记录日`:'该视频暂未返回历史数据'}</p></div>{history&&<div className="va-period-total"><span>返回区间播放合计</span><strong>{fmt(history.plays)}</strong></div>}</div><div className="va-period-note">日期由数据服务返回，可能为发布后的历史区间；不保证是最近 30 天，也不支持自选日期查询。</div>{report.history.error&&<p className="va-message va-error">{report.history.error}。累计指标可独立查看。</p>}{history&&<>{!history.continuous&&<p className="va-message va-error">日期不连续，区间合计保留为空。</p>}<PlayChart rows={history.rows}/><div className="va-detail-heading"><h3>每日明细</h3><a className="secondary" href={'/api/videos/export/'+report.videoId}><Download size={15}/>导出 CSV</a></div><div className="va-table-scroll"><table><caption className="va-sr-only">服务商返回的逐日指标，缺失值显示暂无数据</caption><thead><tr><th>日期</th><th>播放量</th><th>点赞</th><th>评论</th><th>分享</th><th>收藏</th></tr></thead><tbody>{history.rows.map(r=><tr key={r.date}><th scope="row">{r.date}</th><td>{fmt(r.plays)}</td><td>{fmt(r.likes)}</td><td>{fmt(r.comments)}</td><td>{fmt(r.shares)}</td><td>{fmt(r.collects)}</td></tr>)}</tbody></table></div><p className="va-footnote">缺失值保留为空，负值按源数据展示。CSV 另保留 valid_vv 字段，其定义仍待核实；历史合计与累计播放的日期、更新时点和统计范围可能不同。</p></>}</section>
    </>:<section className="va-panel va-empty"><div className="va-empty-icon"><BarChart3 size={34}/></div><h2>从一条视频开始</h2><p>查询后查看累计指标、历史播放曲线和逐日明细。</p><p>不需要打开本机助手或登录抖音创作者后台。</p></section>}</div>
    <aside className="va-panel va-recent"><h2><History size={18}/>最近查询</h2><p>打开已保存的结果，不产生新的接口调用。</p>{!recent.length?<div className="va-empty va-small">还没有查询记录</div>:<ul>{recent.map(v=><li key={v.videoId}><button disabled={busy} className={report?.videoId===v.videoId?'selected':''} onClick={()=>void act(async()=>{const value=await api<{report:VideoReport}>('reports/'+v.videoId);setReport(value.report);setInput(v.videoId);})}><b>{v.title}</b><span>{stamp(v.fetchedAt)}{v.partial?' · 部分数据':''}</span></button></li>)}</ul>}</aside></div>
    </>}
    <footer className="va-footer"><span>矩阵流 / 视频分析</span><span>数据来源 TikHub · 返回范围以实际结果为准</span></footer></main></div>;
}
