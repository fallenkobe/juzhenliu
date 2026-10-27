'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {Loader2,LockKeyhole} from 'lucide-react';
import type {VideoStatus} from '../../../packages/video/types';
import {workspaceReturnPath} from '../../../packages/domain/workspace-path';
import './video-analytics.css';

async function sessionApi<T>(path:string,method='GET',body?:unknown):Promise<T>{
  const res=await fetch('/api/videos/'+path,{method,cache:'no-store',headers:{'X-Matrix-Request':'video-analytics-v1',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const value=await res.json();if(!res.ok)throw new Error(value.error||'矩阵流登录暂不可用');return value as T;
}
export function redirectToWorkspaceLogin(){
  const next=workspaceReturnPath(window.location.pathname+window.location.search);
  window.location.replace('/login?next='+encodeURIComponent(next));
}
export async function logoutWorkspace(){
  await sessionApi('session','DELETE');
  await fetch('/api/session',{method:'DELETE',headers:{'X-Matrix-Request':'alpha-0.01'}}).catch(()=>{});
  window.location.assign('/login');
}
export function WorkspaceGate({children}:{children:ReactNode}){
  const [ready,setReady]=useState(false),[error,setError]=useState('');
  useEffect(()=>{let active=true;sessionApi<VideoStatus>('status').then(s=>{if(!active)return;if(s.signedIn)setReady(true);else redirectToWorkspaceLogin();}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
  if(ready)return children;
  return <div className="loading-screen">{error?<><span role="alert">{error}</span><button className="secondary" onClick={()=>window.location.reload()}>重新检查</button></>:<span><Loader2 className="spin" size={18}/>正在检查矩阵流登录状态…</span>}</div>;
}
export function WorkspaceLogin({returnTo}:{returnTo:string}){
  const [status,setStatus]=useState<VideoStatus|null>(null),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{let active=true;sessionApi<VideoStatus>('status').then(s=>{if(!active)return;setStatus(s);if(s.signedIn)window.location.replace(workspaceReturnPath(returnTo));}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[returnTo]);
  return <div className="va-page"><header className="va-top"><span className="va-brand"><span className="va-mark">矩</span>矩阵流</span></header><main className="va-main"><section className="va-panel va-login"><div className="va-login-icon"><LockKeyhole size={26}/></div><h1>登录矩阵流</h1><p>登录后即可管理账号、查看作品和分析视频。</p>{error&&<p className="va-message va-error" role="alert">{error}</p>}{status&&!status.ownerConfigured&&<p className="va-message va-error">矩阵流登录尚未配置，请联系管理员。</p>}{status&&!status.originConfigured&&<p className="va-message va-error">本站登录地址尚未配置，请联系管理员。</p>}<form onSubmit={e=>{e.preventDefault();setBusy(true);setError('');void sessionApi('session','POST',{password}).then(()=>{setPassword('');window.location.replace(workspaceReturnPath(returnTo));}).catch(e=>{setError(e.message);setBusy(false);});}}><label htmlFor="workspace-password">矩阵流登录密码</label><input id="workspace-password" type="password" autoComplete="current-password" maxLength={1024} value={password} onChange={e=>setPassword(e.target.value)} disabled={busy||!status?.ownerConfigured||!status?.originConfigured} required/><button className="primary" disabled={busy||!password||!status?.ownerConfigured||!status?.originConfigured}>{busy?<Loader2 className="spin" size={16}/>:<LockKeyhole size={16}/>}登录矩阵流</button></form></section></main></div>;
}
