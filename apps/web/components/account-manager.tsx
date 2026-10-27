'use client';
import { useEffect, useState } from 'react';
import { ArrowUpRight, BarChart3, CheckCircle2, Loader2, LogOut, Plus, Search, Trash2, Users, X } from 'lucide-react';
import type { AccountPreview, AccountProfile, ManagedAccount } from '../../../packages/accounts/types';
import type { VideoStatus } from '../../../packages/video/types';
import './video-analytics.css';
import './account-manager.css';
import AccountWorks from './account-works';
import {logoutWorkspace,redirectToWorkspaceLogin} from './workspace-session';

const fmt = (v:string|null) => v===null?'暂无数据':BigInt(v).toLocaleString('zh-CN');
const stamp = (v:string) => new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
async function api<T>(path:string,method='GET',body?:unknown):Promise<T> {
  const response=await fetch('/api/videos/'+path,{method,cache:'no-store',headers:{'X-Matrix-Request':'video-analytics-v1',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  let data;try{data=await response.json();}catch{throw new Error('服务器响应异常，请稍后重试');}
  if(response.status===401)redirectToWorkspaceLogin();
  if(!response.ok)throw new Error(data.error||'操作失败，请重试');return data as T;
}
function Profile({profile}:{profile:AccountProfile}) {
  return <><div className="am-profile"><span className="am-avatar">{profile.avatarUrl?<img src={profile.avatarUrl} alt="" referrerPolicy="no-referrer" onError={e=>{e.currentTarget.style.display='none';}}/>:profile.nickname.slice(0,1)}</span><div><h3>{profile.nickname}</h3><p>抖音号：{profile.douyinId}</p></div></div>{profile.signature&&<p className="am-signature">{profile.signature}</p>}<dl className="am-numbers">{[['粉丝',profile.followers],['关注',profile.following],['作品',profile.posts],['获赞',profile.likes]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{fmt(value)}</dd></div>)}</dl></>;
}
export default function AccountManager({embedded=false}:{embedded?:boolean}) {
  const [status,setStatus]=useState<VideoStatus|null>(null),[accounts,setAccounts]=useState<ManagedAccount[]>([]);
  const [adding,setAdding]=useState(false),[douyinId,setDouyinId]=useState(''),[preview,setPreview]=useState<AccountPreview|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[removeUid,setRemoveUid]=useState<string|null>(null);
  const [worksUid,setWorksUid]=useState<string|null>(null);
  async function refresh(){const s=await api<VideoStatus>('status');setStatus(s);if(s.signedIn)setAccounts((await api<{accounts:ManagedAccount[]}>('accounts')).accounts);else{setAccounts([]);setPreview(null);setAdding(false);setWorksUid(null);redirectToWorkspaceLogin();}return s;}
  useEffect(()=>{void refresh().catch(e=>setError(e.message));},[]);
  async function act(fn:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'操作失败');await refresh().catch(()=>{});}finally{setBusy(false);}}
  const ready=!!status?.providerConfigured&&!!status?.originConfigured;
  const worksAccount=accounts.find(a=>a.uid===worksUid);
  const Content=embedded?'div':'main';
  return <div className={'va-page'+(embedded?' am-embedded':'')}><header className={embedded?'am-workspace-heading':'va-top'}>{embedded?<div><h1>账号管理</h1><p>填写抖音号，核对资料后添加账号。</p></div>:<a className="va-brand" href="/accounts"><span className="va-mark">矩</span>矩阵流<span className="va-product">账号管理</span></a>}<nav><a href="/videos"><BarChart3 size={15}/>视频分析</a>{status?.signedIn&&<button disabled={busy} onClick={()=>void act(async()=>{await logoutWorkspace();})}><LogOut size={15}/>退出</button>}</nav></header>
  <Content className="va-main">{!embedded&&<section className="va-intro"><div className="va-eyebrow"><span/>DOUYIN / ACCOUNTS</div><h1>从一个抖音号，<br/>连接你的内容数据<span>。</span></h1><p>填写抖音号，获取账号资料，核对后加入管理列表。</p></section>}
  <div className="am-notices" aria-live="polite">{error&&<div className="va-message va-error" role="alert">{error}</div>}{notice&&<div className="va-message" role="status"><CheckCircle2 size={16}/>{notice}</div>}</div>
  {!status?<section className="va-panel va-loading"><Loader2 size={20} className="spin"/><p>正在检查账号服务…</p><button className="secondary" disabled={busy} onClick={()=>void act(async()=>{await refresh();})}>重新检查</button></section>:!status.signedIn?null:<>
  <section className="va-panel am-toolbar"><div><h2><Users size={20}/>已添加账号 <span className="am-count">{accounts.length}</span></h2><p>账号公开资料由 TikHub 返回，添加记录不代表抖音授权或账号所有权验证。</p></div><button className="primary" disabled={busy||!ready} onClick={()=>{setAdding(true);setPreview(null);setDouyinId('');setError('');setNotice('');}}><Plus size={16}/>添加账号</button></section>
  {!ready&&<p className="va-message va-error">账号查询暂不可用，请管理员检查服务端密钥及部署配置。已保存记录仍可查看。</p>}
  {adding&&<section className="va-panel am-add" aria-labelledby="add-account-title"><div className="va-panel-heading"><h2 id="add-account-title">添加抖音账号</h2><button className="text-button" aria-label="关闭添加账号" disabled={busy} onClick={()=>{setAdding(false);setPreview(null);setError('');}}><X size={18}/></button></div><form className="va-search" onSubmit={e=>{e.preventDefault();void act(async()=>{setPreview(null);const result=await api<AccountPreview>('accounts/lookup','POST',{douyinId});setPreview(result);await refresh();});}}><label className="va-sr-only" htmlFor="account-douyin-id">抖音号</label><input id="account-douyin-id" placeholder="填写抖音号，例如：纯数字或字母账号" autoComplete="off" maxLength={40} value={douyinId} onChange={e=>{setDouyinId(e.target.value);setPreview(null);}} disabled={busy} required/><button className="primary" disabled={busy||!douyinId.trim()||!ready}>{busy?<Loader2 size={16} className="spin"/>:<Search size={16}/>}获取账号信息</button></form><div className="va-search-meta"><span>今日数据查询 {status.dailyUsed} / {status.dailyLimit} · 与视频查询共享额度</span><span>获取信息会使用服务商额度；预览有效期内重复获取不再次调用</span></div>{preview&&<div className="am-preview"><span className="va-badge">请核对账号</span><Profile profile={preview.profile}/><div className="am-preview-bottom"><span>资料获取于 {stamp(preview.profile.fetchedAt)}，请在 10 分钟内确认。</span><button className="primary" disabled={busy} onClick={()=>void act(async()=>{await api('accounts','POST',{lookupId:preview.lookupId});setPreview(null);setAdding(false);setDouyinId('');await refresh();setNotice('账号已添加到管理列表。');})}><CheckCircle2 size={16}/>确认添加</button></div></div>}</section>}
  {!accounts.length?<section className="va-panel va-empty"><div className="va-empty-icon"><Users size={32}/></div><h2>还没有添加账号</h2><p>点击“添加账号”，填写抖音号即可获取资料。</p></section>:<div className="am-grid">{accounts.map(a=><article className="va-panel am-card" key={a.uid}><Profile profile={a}/><div className="am-card-meta"><span>资料获取于 {stamp(a.fetchedAt)}</span><a href={'https://www.douyin.com/user/'+a.secUid} target="_blank" rel="noreferrer">查看主页<ArrowUpRight size={13}/></a></div><button className="secondary am-view-works" disabled={busy} onClick={()=>setWorksUid(a.uid)}><BarChart3 size={14}/>查看作品</button>{removeUid===a.uid?<div className="am-remove"><p>移除本系统中的账号记录？</p><div><button className="secondary" disabled={busy} onClick={()=>setRemoveUid(null)}>取消</button><button className="secondary" disabled={busy} onClick={()=>void act(async()=>{await api('accounts/'+a.uid,'DELETE');setRemoveUid(null);await refresh();setNotice('账号记录已移除。');})}>确认移除</button></div></div>:<button className="text-button am-remove-button" disabled={busy} onClick={()=>setRemoveUid(a.uid)}><Trash2 size={13}/>移除记录</button>}</article>)}</div>}
  {worksAccount&&<AccountWorks key={worksAccount.uid} account={worksAccount} ready={ready} onClose={()=>setWorksUid(null)} onQuery={refresh}/>}
  </>}
  {!embedded&&<footer className="va-footer"><span>矩阵流 / 账号管理</span><span>仅保存已核对的公开资料 · 不保存抖音登录态</span></footer>}</Content></div>;
}
