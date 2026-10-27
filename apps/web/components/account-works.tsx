'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,BarChart3,ChevronDown,Clapperboard,Loader2,RefreshCw,X} from 'lucide-react';
import type {ManagedAccount} from '../../../packages/accounts/types';
import type {AccountWork,AccountWorkPage} from '../../../packages/accounts/works-types';
import type {VideoReport} from '../../../packages/video/types';
import {redirectToWorkspaceLogin} from './workspace-session';
import AccountImage from './account-image';

async function api<T>(path:string,body?:unknown):Promise<T>{
  const r=await fetch('/api/videos/'+path,{method:body===undefined?'GET':'POST',cache:'no-store',headers:{'Content-Type':'application/json','X-Matrix-Request':'video-analytics-v1'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  let data;try{data=await r.json();}catch{throw new Error('服务器响应异常，请稍后重试');}
  if(r.status===401)redirectToWorkspaceLogin();
  if(!r.ok)throw new Error(data.error||'作品查询失败');return data as T;
}
const stamp=(s:string)=>new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
export default function AccountWorks({account,ready,savedOnly=false,onClose,onQuery}:{account:ManagedAccount;ready:boolean;savedOnly?:boolean;onClose:()=>void;onQuery:()=>Promise<unknown>}){
  const[pages,setPages]=useState<AccountWorkPage[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[analysing,setAnalysing]=useState<string|null>(null);
  const [search,setSearch]=useState(''),[kind,setKind]=useState('all'),[sort,setSort]=useState('source');
  const started=useRef(false);
  const panel=useRef<HTMLElement>(null);
  async function load(cursor='0',refresh=false){
    setBusy(true);setError('');setNotice('');
    try{
      const value=await api<{page:AccountWorkPage;cached:boolean}>('accounts/'+account.uid+'/works',{cursor,refresh});
      setPages(previous=>cursor==='0'?[value.page]:[...previous.filter(p=>p.cursor!==cursor),value.page]);
      setNotice(value.cached?'已读取保存的作品列表，本次未调用数据服务。':'作品列表已更新。');
    }catch(e){setError(e instanceof Error?e.message:'作品加载失败');}
    finally{setBusy(false);await onQuery().catch(()=>{});}
  }
  async function restore(){
    setBusy(true);setError('');
    try{const value=await api<{pages:AccountWorkPage[]}>('accounts/'+account.uid+'/works');setPages(value.pages);setNotice(value.pages.length?'已恢复保存的作品列表；数据可能已过期，点击刷新作品可更新。':'尚无保存的作品列表，点击获取作品加载。');}
    catch(e){setError(e instanceof Error?e.message:'读取作品失败');}finally{setBusy(false);}
  }
  useEffect(()=>{if(!started.current){started.current=true;panel.current?.scrollIntoView({behavior:'smooth',block:'start'});if(savedOnly)void restore();else void load();}},[]);
  async function analyse(work:AccountWork){
    setBusy(true);setAnalysing(work.id);setError('');
    try{
      const value=await api<{report:VideoReport}>('query',{input:work.id});
      if(value.report.videoId!==work.id)throw new Error('分析结果与作品不一致，请重试');
      window.location.assign('/videos?videoId='+work.id+'&accountUid='+account.uid);
    }catch(e){setError(e instanceof Error?e.message:'分析查询失败');setBusy(false);setAnalysing(null);await onQuery().catch(()=>{});}
  }
  const items=[...new Map(pages.flatMap(p=>p.items).map(w=>[w.id,w])).values()],last=pages.at(-1);
  const needle=search.trim().toLocaleLowerCase('zh-CN');
  const visibleItems=items.filter(w=>(kind==='all'||w.kind===kind)&&[w.title,w.id].some(v=>v.toLocaleLowerCase('zh-CN').includes(needle))).sort((a,b)=>sort==='source'?0:a.publishedAt===null?(b.publishedAt===null?0:1):b.publishedAt===null?-1:sort==='oldest'?a.publishedAt.localeCompare(b.publishedAt):b.publishedAt.localeCompare(a.publishedAt));
  return <section ref={panel} className="va-panel am-works" aria-labelledby="account-works-heading"><div className="va-panel-heading"><div><h2 id="account-works-heading"><Clapperboard size={20}/>{account.nickname}的作品</h2><p>抖音号：{account.douyinId} · 已加载 {items.length} 条</p></div><div className="am-works-actions"><button className="secondary" disabled={busy||!ready} onClick={()=>void load('0',true)}><RefreshCw size={14}/>刷新作品</button><button className="text-button" aria-label="关闭作品列表" disabled={busy} onClick={onClose}><X size={18}/></button></div></div>
    <p className="am-works-note">每次获取一页，查询与刷新使用数据服务额度；点击视频“查看分析”查询其指标，不会自动批量分析。</p>
    {!!items.length&&<div className="va-list-controls"><label>查找作品<input aria-label="查找已加载作品" placeholder="标题或作品 ID" value={search} onChange={e=>setSearch(e.target.value)} maxLength={100}/></label><label>作品类型<select aria-label="作品类型" value={kind} onChange={e=>setKind(e.target.value)}><option value="all">全部类型</option><option value="video">视频</option><option value="image">图文</option><option value="other">其他</option></select></label><label>排序<select aria-label="作品排序" value={sort} onChange={e=>setSort(e.target.value)}><option value="source">接口返回顺序</option><option value="newest">发布时间从新到旧</option><option value="oldest">发布时间从旧到新</option></select></label><span role="status">显示 {visibleItems.length} / {items.length} 条 · 仅筛选已加载作品</span></div>}
    {error&&<div className="va-message va-error" role="alert">{error}</div>}{notice&&<div className="va-message" role="status">{notice}</div>}
    {!pages.length&&busy?<div className="am-works-empty"><Loader2 size={20} className="spin"/>正在获取作品…</div>:!pages.length?<button className="secondary" disabled={busy||!ready} onClick={()=>void load()}>获取作品</button>:!items.length?<p className="am-works-empty">本次没有返回可见作品，结果可能受公开范围或数据延迟影响。</p>:!visibleItems.length?<div className="am-works-empty"><p>已加载作品中没有匹配结果。</p><button className="secondary" onClick={()=>{setSearch('');setKind('all');}}>清空作品筛选</button></div>:<div className="am-work-list">{visibleItems.map(w=><article className="am-work" key={w.id}><div className="am-work-cover"><AccountImage src={w.coverUrl||w.coverUrls?.length?'/api/videos/images/cover/'+account.uid+'/'+w.id+'?v='+encodeURIComponent(pages.map(p=>p.fetchedAt).join(',')):null} alt={(w.title||'作品')+'的封面'} variant="cover"/></div><div className="am-work-body"><div className="am-work-title"><span className={'am-work-kind '+w.kind}>{w.kind==='image'?'图文':w.kind==='video'?'视频':'其他'}</span><h3>{w.title||'未填写标题'}</h3></div><p>{w.publishedAt?stamp(w.publishedAt):'发布时间暂无数据'} · ID {w.id}</p><a className="am-work-url" href={w.url} target="_blank" rel="noreferrer">{w.url}<ArrowUpRight size={12}/></a></div><div className="am-work-buttons"><a className="secondary" href={w.url} target="_blank" rel="noreferrer">打开作品<ArrowUpRight size={13}/></a>{w.kind==='video'?<button className="primary" disabled={busy||!ready} onClick={()=>void analyse(w)}>{analysing===w.id?<Loader2 size={14} className="spin"/>:<BarChart3 size={14}/>}查看分析</button>:<span>此类型分析待接入</span>}</div></article>)}</div>}
    {last&&<div className="am-works-bottom"><span>本页获取于 {stamp(last.fetchedAt)} · 仅展示接口返回的可见作品</span>{last.hasMore&&last.nextCursor?<button className="secondary" disabled={busy||!ready} onClick={()=>void load(last.nextCursor!)}>{busy?<Loader2 size={14} className="spin"/>:<ChevronDown size={14}/>}加载更多</button>:<span>本次返回完毕</span>}</div>}
  </section>;
}
