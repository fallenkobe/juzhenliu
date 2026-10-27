'use client';
import type {ReactNode} from 'react';
import {ArrowUpRight,ChartNoAxesCombined,ChevronDown,Clapperboard,LayoutDashboard,ListTodo,Send,Settings,Target,Users} from 'lucide-react';

export const workspaceNavigation=[{id:'overview',label:'数据总览',icon:LayoutDashboard},{id:'accounts',label:'账号管理',icon:Users},{id:'analytics',label:'数据分析',icon:ChartNoAxesCombined},{id:'assets',label:'素材库',icon:Clapperboard},{id:'publish',label:'发布中心',icon:Send},{id:'promotion',label:'DOU+ 投流',icon:Target},{id:'tasks',label:'任务中心',icon:ListTodo},{id:'settings',label:'工作空间设置',icon:Settings}] as const;
export type WorkspacePage=typeof workspaceNavigation[number]['id'];

export default function WorkspaceSidebar({active,workspaceName='个人工作空间',mobile=false,activeOrders=0,onNavigate,onClose,onCapabilities,user}:{active:WorkspacePage;workspaceName?:string;mobile?:boolean;activeOrders?:number;onNavigate:(page:WorkspacePage)=>void;onClose:()=>void;onCapabilities?:()=>void;user?:ReactNode}){
  return <><aside className={'sidebar'+(mobile?' is-open':'')}>
    <button className="brand" onClick={()=>onNavigate('overview')}><span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span><span>矩阵流</span><b>ALPHA</b></button>
    <button className="workspace-switch" onClick={()=>onNavigate('settings')}><span className="workspace-icon">M</span><span><b>{workspaceName}</b><small>个人工作空间</small></span><ChevronDown size={15}/></button>
    <div className="nav-caption">工作台</div>
    <nav aria-label="工作台导航">{workspaceNavigation.slice(0,7).map(item=><button key={item.id} aria-label={item.label} aria-current={active===item.id?'page':undefined} className={'nav-item'+(active===item.id?' active':'')} onClick={()=>onNavigate(item.id)}><item.icon size={19}/><span>{item.label}</span>{item.id==='tasks'&&activeOrders>0&&<i className="nav-dot"/>}</button>)}</nav>
    <div className="sidebar-bottom"><div className="alpha-card"><span><span className="alpha-orbit"/>ALPHA 0.11</span><b>每一个好内容，值得被看见</b><p>当前为内部体验版本</p>{onCapabilities?<button onClick={onCapabilities}>了解当前能力<ArrowUpRight size={14}/></button>:<a href="/videos">视频分析<ArrowUpRight size={14}/></a>}</div>
      <button className={'nav-item'+(active==='settings'?' active':'')} onClick={()=>onNavigate('settings')}><Settings size={19}/><span>工作空间设置</span></button>
      {user??<div className="sidebar-user"><span className="user-avatar">M</span><span><b>个人工作空间</b><small>公开账号资料管理</small></span></div>}
    </div>
  </aside>{mobile&&<button className="sidebar-shade" aria-label="关闭导航" onClick={onClose}/>}</>;
}
