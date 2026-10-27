'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,BarChart3,ChevronDown,Clapperboard,ImageIcon,Loader2,RefreshCw,X} from 'lucide-react';
import type {ManagedAccount} from '../../../packages/accounts/types';
import type {AccountWork,AccountWorkPage} from '../../../packages/accounts/works-types';
import type {VideoReport} from '../../../packages/video/types';
import {redirectToWorkspaceLogin} from './workspace-session';

async function api<T>(path:string,body:unknown):Promise<T>{
  const r=await fetch('/api/videos/'+path,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','X-Matrix-Request':'video-analytics-v1'},body:JSON.stringify(body)});
  let data;try{data=await r.json();}catch{throw new Error('服务器响应异常，请稍后重试');}
  if(r.status===401)redirectToWorkspaceLogin();
  if(!r.ok)throw new Error(data.error||'作品查询失败');return data as T;
}
const stamp=(s:string)=>new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
export default function AccountWorks({account,ready,onClose,onQuery}:{account:ManagedAccount;ready:boolean;onClose:()=>void;onQuery:()=>Promise<unknown>}){
  const[pages,setPages]=useState<AccountWorkPage[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[analysing,setAnalysing]=useState<string|null>(null);
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
  useEffect(()=>{if(!started.current){started.current=true;panel.current?.scrollIntoView({behavior:'smooth',block:'start'});void load();}},[]);
  async function analyse(work:AccountWork){
    setBusy(true);setAnalysing(work.id);setError('');
    try{
      const value=await api<{report:VideoReport}>('query',{input:work.id});
      if(value.report.videoId!==work.id)throw new Error('分析结果与作品不一致，请重试');
      window.location.assign('/videos?videoId='+work.id);
    }catch(e){setError(e instanceof Error?e.message:'分析查询失败');setBusy(false);setAnalysing(null);await onQuery().catch(()=>{});}
  }
  const items=[...new Map(pages.flatMap(p=>p.items).map(w=>[w.id,w])).values()],last=pages.at(-1);
  return <section ref={panel} className="va-panel am-works" aria-labelledby="account-works-heading"><div className="va-panel-heading"><div><h2 id="account-works-heading"><Clapperboard size={20}/>{account.nickname}的作品</h2><p>抖音号：{account.douyinId} · 已加载 {items.length} 条</p></div><div className="am-works-actions"><button className="secondary" disabled={busy||!ready} onClick={()=>void load('0',true)}><RefreshCw size={14}/>刷新作品</button><button className="text-button" aria-label="关闭作品列表" disabled={busy} onClick={onClose}><X size={18}/></button></div></div>
    <p className="am-works-note">每次获取一页，查询与刷新使用数据服务额度；点击视频“查看分析”查询其指标，不会自动批量分析。</p>
    {error&&<div className="va-message va-error" role="alert">{error}</div>}{notice&&<div className="va-message" role="status">{notice}</div>}
    {!pages.length&&busy?<div className="am-works-empty"><Loader2 size={20} className="spin"/>正在获取作品…</div>:!pages.length?<button className="secondary" disabled={busy} onClick={()=>void load()}>重新获取作品</button>:!items.length?<p className="am-works-empty">本次没有返回可见作品，结果可能受公开范围或数据延迟影响。</p>:<div className="am-work-list">{items.map(w=><article className="am-work" key={w.id}><div className="am-work-cover">{w.coverUrl?<img src={w.coverUrl} alt="" referrerPolicy="no-referrer" onError={e=>{e.currentTarget.style.display='none';}}/>:w.kind==='image'?<ImageIcon size={25}/>:<Clapperboard size={25}/>}</div><div className="am-work-body"><div className="am-work-title"><span className={'am-work-kind '+w.kind}>{w.kind==='image'?'图文':w.kind==='video'?'视频':'其他'}</span><h3>{w.title||'未填写标题'}</h3></div><p>{w.publishedAt?stamp(w.publishedAt):'发布时间暂无数据'} · ID {w.id}</p><a className="am-work-url" href={w.url} target="_blank" rel="noreferrer">{w.url}<ArrowUpRight size={12}/></a></div><div className="am-work-buttons"><a className="secondary" href={w.url} target="_blank" rel="noreferrer">打开作品<ArrowUpRight size={13}/></a>{w.kind==='video'?<button className="primary" disabled={busy||!ready} onClick={()=>void analyse(w)}>{analysing===w.id?<Loader2 size={14} className="spin"/>:<BarChart3 size={14}/>}查看分析</button>:<span>此类型分析待接入</span>}</div></article>)}</div>}
    {last&&<div className="am-works-bottom"><span>本页获取于 {stamp(last.fetchedAt)} · 仅展示接口返回的可见作品</span>{last.hasMore&&last.nextCursor?<button className="secondary" disabled={busy||!ready} onClick={()=>void load(last.nextCursor!)}>{busy?<Loader2 size={14} className="spin"/>:<ChevronDown size={14}/>}加载更多</button>:<span>本次返回完毕</span>}</div>}
  </section>;
}
