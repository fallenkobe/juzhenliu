'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, BarChart3, CalendarDays, CheckCircle2, Download, History, Loader2, LogOut, RefreshCw, Search, ShieldCheck, Users } from 'lucide-react';
import type { Count, SavedVideo, VideoDay, VideoReport, VideoStatus } from '../../../packages/video/types';
import './video-analytics.css';
import {logoutWorkspace,redirectToWorkspaceLogin} from './workspace-session';
import VideoSnapshots from './video-snapshots';
import VideoHeatBadge from './video-heat';

const fmt = (n: Count) => n === null ? '暂无数据' : BigInt(n).toLocaleString('zh-CN');
const stamp = (s: string) => new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch('/api/videos/'+path,{method,cache:'no-store',headers:{'X-Matrix-Request':'video-analytics-v1',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  let value; try { value = await res.json(); } catch { throw new Error('服务器未返回有效结果，请稍后重试'); }
  if(res.status===401)redirectToWorkspaceLogin();
  if (!res.ok) throw new Error(value.error || '操作未完成，请稍后重试');
  return value as T;
}
const metrics={plays:'播放',likes:'点赞',comments:'评论',shares:'分享',collects:'收藏'};
type Metric=keyof typeof metrics;
function PlayChart({rows,metric}: {rows: VideoDay[];metric:Metric}) {
  const values = rows.map(r=>r[metric]===null?null:Number(r[metric]));
  const finite = values.filter((v):v is number=>v!==null);
  if (!finite.length) return <p className="va-empty">暂无可绘制的{metrics[metric]}数据</p>;
  const high = Math.max(...finite,1), low = Math.min(...finite,0), range = high-low;
  const x = (i:number) => 50 + i * 900 / Math.max(rows.length-1,1);
  const y = (v:number) => 210 - (v-low) / range * 180;
  return <div className="va-chart"><svg viewBox="0 0 1000 260" role="img" aria-label={`${rows[0].date} 至 ${rows.at(-1)!.date} 逐日${metrics[metric]}趋势，精确数值见下方表格`}>
    {[0,.5,1].map(t=><g key={t}><line x1="50" x2="950" y1={30+t*180} y2={30+t*180} stroke="currentColor" opacity=".12"/><text x="45" y={35+t*180} textAnchor="end">{new Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:1}).format(high-t*range)}</text></g>)}
    {values.map((v,i)=>v===null?null:<g key={rows[i].date}>{i>0&&values[i-1]!==null&&new Date(rows[i].date+'T00:00:00Z').getTime()-new Date(rows[i-1].date+'T00:00:00Z').getTime()===86400000&&<line x1={x(i-1)} y1={y(values[i-1]!)} x2={x(i)} y2={y(v)} stroke="#24dbce" strokeWidth="3"/>}<circle cx={x(i)} cy={y(v)} r="4" fill="#24dbce"><title>{rows[i].date}：{fmt(rows[i][metric])}</title></circle></g>)}
    <text x="50" y="244">{rows[0].date}</text><text x="950" y="244" textAnchor="end">{rows.at(-1)!.date}</text>
  </svg></div>;
}
export default function VideoAnalytics({standalone=false,initialVideoId='',accountUid=''}: {standalone?:boolean;initialVideoId?:string;accountUid?:string}) {
  const [status,setStatus] = useState<VideoStatus|null>(null), [input,setInput] = useState(initialVideoId);
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState(''), [report,setReport] = useState<VideoReport|null>(null), [recent,setRecent] = useState<SavedVideo[]>([]);
  const [recentSearch,setRecentSearch]=useState(''),[partialOnly,setPartialOnly]=useState(false),[metric,setMetric]=useState<Metric>('plays');
  const openedInitial=useRef(false);
  function showReport(value:VideoReport){
    setReport(value);setInput(value.videoId);
    window.history.replaceState(null,'','/videos?videoId='+value.videoId+(accountUid?'&accountUid='+accountUid:''));
  }
  async function refreshStatus() {
    const s = await api<VideoStatus>('status'); setStatus(s);
    if(s.signedIn) {
      setRecent((await api<{videos:SavedVideo[]}>('recent')).videos);
      // Navigation/reload only reads an existing report; it must never trigger paid queries.
      if(initialVideoId&&!openedInitial.current){openedInitial.current=true;try{setReport((await api<{report:VideoReport}>('reports/'+initialVideoId)).report);}catch{setNotice('已填入作品 ID，点击“查询作品”获取数据。');}}
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
      showReport(value.report);
      setNotice(value.cached?'已打开保存的结果，本次未请求数据服务。':'数据已更新并保存。');
      await refreshStatus();
    });
  }
  const needle=recentSearch.trim().toLocaleLowerCase('zh-CN');
  const visibleRecent=recent.filter(v=>(!partialOnly||v.partial)&&[v.title,v.videoId].some(s=>s.toLocaleLowerCase('zh-CN').includes(needle)));
  const totals = report?.totals.data, history = report?.history.data;
  const isImage=report?.kind==='image';
  const ready = !!status?.providerConfigured && !!status?.originConfigured;
  return <div className="va-page"><header className="va-top"><a className="va-brand" href="/videos"><span className="va-mark">矩</span>矩阵流<span className="va-product">视频分析</span></a><nav><a href="/accounts"><Users size={15}/>账号管理</a>{!standalone&&<a href="/"><ArrowLeft size={14}/>工作台</a>}{status?.signedIn&&<button disabled={busy} onClick={()=>void act(async()=>{await logoutWorkspace();})}><LogOut size={15}/>退出</button>}</nav></header>
    <main className="va-main">{accountUid&&<a className="secondary va-back-works" href={'/accounts?accountUid='+accountUid}><ArrowLeft size={15}/>返回账号作品</a>}<section className="va-intro"><div className="va-eyebrow"><span/>DOUYIN / VIDEO INSIGHTS</div><h1>每条作品，<br className="va-mobile-break"/>看见真实表现<span>。</span></h1><p>查看视频播放趋势与图文互动数据，让内容的表现有据可查。</p><div className="va-tags"><span><ShieldCheck size={14}/>服务端安全查询</span><span><CalendarDays size={14}/>按实际日期展示</span><span><Download size={14}/>明细可导出</span></div></section>
    {error&&<div className="va-message va-error" role="alert">{error}</div>}{notice&&<div className="va-message" role="status"><CheckCircle2 size={16}/>{notice}</div>}
    {!status?<section className="va-panel va-loading"><Loader2 className="spin" size={20}/><p>正在检查查询服务…</p><button className="secondary" disabled={busy} onClick={()=>void act(async()=>{await refreshStatus();})}>重新检查</button></section>:!status.signedIn?null:<>
    <section className="va-panel va-search-panel"><div className="va-panel-heading"><div><h2><Search size={20}/>查询作品</h2><p>支持视频 /video/ 和图文 /note/ 完整链接；从账号作品进入可自动选择分析类型。</p></div><span className="va-badge">TikHub · 作品数据</span></div><form className="va-search" onSubmit={e=>{e.preventDefault();void query();}}><label className="va-sr-only" htmlFor="video-query">抖音作品链接或 ID</label><input id="video-query" value={input} onChange={e=>setInput(e.target.value)} placeholder="https://www.douyin.com/video/…" maxLength={2048} disabled={busy} required/><button className="primary" disabled={busy||!input.trim()||!ready}>{busy?<Loader2 size={17} className="spin"/>:<Search size={17}/>} {busy?'正在查询…':'查询作品'}</button></form><div className="va-search-meta"><span>成功结果缓存 {status.cacheMinutes} 分钟 · 今日数据查询 {status.dailyUsed} / {status.dailyLimit}</span><span>新查询及强制更新会使用服务商付费额度</span></div>{!ready&&<p className="va-message va-error">查询配置尚未完成，已保存的结果仍可查看。</p>}</section>
    <div className="va-workspace"><div className="va-content">{report?<>
      <section className="va-panel va-video"><div className="va-panel-heading"><span className="va-badge">{isImage?'图文累计表现':'视频累计表现'}</span><a href={'https://www.douyin.com/'+(isImage?'note/':'video/')+report.videoId} target="_blank" rel="noreferrer">在抖音打开<ArrowUpRight size={14}/></a></div><div className="va-title-row"><h2>{totals?.title||'作品 '+report.videoId}</h2><VideoHeatBadge heat={report.heat}/></div><div className="va-video-meta"><span>ID {report.videoId}</span>{isImage&&<span>图文{report.imageCount?` · ${report.imageCount} 张图片`:""}</span>}{totals?.publishedAt&&<span>发布于 {stamp(totals.publishedAt)}</span>}{totals?.durationSeconds!==null&&totals?.durationSeconds!==undefined&&<span>{totals.durationSeconds} 秒</span>}</div><div className="va-update"><span>查询于 {stamp(report.fetchedAt)}</span><button className="text-button" disabled={busy||!ready} onClick={()=>void query(true)}><RefreshCw size={14}/>更新数据</button></div>{report.totals.error&&<p className="va-message va-error">累计指标：{report.totals.error}</p>}<div className="va-metrics">{[['累计播放',totals?.plays],['累计点赞',totals?.likes],['累计评论',totals?.comments],['累计分享',totals?.shares],['累计收藏',totals?.collects]].map(([label,value])=><div key={label}><span>{label}</span><strong>{fmt(value??null)}</strong></div>)}</div><p className="va-footnote">{isImage?'来源：抖音公开作品详情（TikHub App V3）。播放量未提供可核实口径，保留为暂无数据；点赞、评论、分享、收藏按接口返回值展示。':'累计播放采用服务商星图含投流口径。数据尚未与官方后台逐项核对。'}</p></section>
      <VideoSnapshots key={report.videoId} rows={report.snapshots??[]} total={report.snapshotCount??0} image={isImage}/>
      <section className="va-panel"><div className="va-panel-heading"><div><h2><BarChart3 size={20}/>历史指标趋势</h2><p>{history?`${history.start} 至 ${history.end} · ${history.rows.length} 个记录日`:isImage?'图文历史趋势暂未接入':'该视频暂未返回历史数据'}</p></div>{history&&<div className="va-period-total"><span>返回区间播放合计</span><strong>{fmt(history.plays)}</strong></div>}</div><div className="va-period-note">{isImage?'当前图文接口仅提供累计互动指标，没有逐日数据，暂不展示趋势或导出历史明细。':'日期由数据服务返回，可能为发布后的历史区间；不保证是最近 30 天，也不支持自选日期查询。'}</div>{report.history.error&&<p className="va-message va-error">{report.history.error}。累计指标可独立查看。</p>}{history&&<>{!history.continuous&&<p className="va-message va-error">日期不连续，区间合计保留为空。</p>}<div className="va-list-controls va-chart-controls"><label>趋势指标<select aria-label="趋势指标" value={metric} onChange={e=>setMetric(e.target.value as Metric)}>{Object.entries(metrics).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><span>切换指标使用已保存数据，精确数值见每日明细。</span></div><PlayChart rows={history.rows} metric={metric}/><div className="va-detail-heading"><h3>每日明细</h3><a className="secondary" href={'/api/videos/export/'+report.videoId}><Download size={15}/>导出 CSV</a></div><div className="va-table-scroll"><table><caption className="va-sr-only">服务商返回的逐日指标，缺失值显示暂无数据</caption><thead><tr><th>日期</th><th>播放量</th><th>点赞</th><th>评论</th><th>分享</th><th>收藏</th></tr></thead><tbody>{history.rows.map(r=><tr key={r.date}><th scope="row">{r.date}</th><td>{fmt(r.plays)}</td><td>{fmt(r.likes)}</td><td>{fmt(r.comments)}</td><td>{fmt(r.shares)}</td><td>{fmt(r.collects)}</td></tr>)}</tbody></table></div><p className="va-footnote">缺失值保留为空，负值按源数据展示。CSV 另保留 valid_vv 字段，其定义仍待核实；历史合计与累计播放的日期、更新时点和统计范围可能不同。</p></>}</section>
    </>:<section className="va-panel va-empty"><div className="va-empty-icon"><BarChart3 size={34}/></div><h2>从一条作品开始</h2><p>视频可查看累计指标与历史趋势，图文可查看累计互动指标。</p><p>不需要打开本机助手或登录抖音创作者后台。</p></section>}</div>
    <aside className="va-panel va-recent"><h2><History size={18}/>最近查询</h2><p>最近 30 条记录；打开结果不产生新的接口调用。</p>{!!recent.length&&<div className="va-recent-filters"><label className="va-sr-only" htmlFor="saved-report-search">查找已保存报告</label><input id="saved-report-search" placeholder="标题或视频 ID" value={recentSearch} onChange={e=>setRecentSearch(e.target.value)} maxLength={100}/><label className="va-check"><input type="checkbox" checked={partialOnly} onChange={e=>setPartialOnly(e.target.checked)}/>仅部分数据</label><span role="status">显示 {visibleRecent.length} / {recent.length} 条</span></div>}{!recent.length?<div className="va-empty va-small">还没有查询记录</div>:!visibleRecent.length?<div className="va-empty va-small">没有匹配的报告<button className="text-button" onClick={()=>{setRecentSearch('');setPartialOnly(false);}}>清空报告筛选</button></div>:<ul>{visibleRecent.map(v=><li key={v.videoId}><button disabled={busy} className={report?.videoId===v.videoId?'selected':''} onClick={()=>void act(async()=>{const value=await api<{report:VideoReport}>('reports/'+v.videoId);showReport(value.report);})}><b>{v.title||v.videoId}</b><span>ID {v.videoId}</span><span>{stamp(v.fetchedAt)}{v.partial?' · 部分数据':''}</span></button></li>)}</ul>}</aside></div>
    </>}
    <footer className="va-footer"><span>矩阵流 / 视频分析</span><span>数据来源 TikHub · 返回范围以实际结果为准</span></footer></main></div>;
}
