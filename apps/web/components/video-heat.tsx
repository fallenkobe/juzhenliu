'use client';
import {useEffect,useState} from 'react';
import {Flame} from 'lucide-react';
import type {VideoHeat} from '../../../packages/video/types';
import './video-heat.css';

const stamp=(time:string)=>new Date(time).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
export default function VideoHeatBadge({heat}:{heat?:VideoHeat}) {
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(timer);},[heat?.asOf]);
  const scored=heat?.score!==null&&heat?.score!==undefined;
  const stale=!!heat?.expiresAt&&Date.parse(heat.expiresAt)<now;
  const label=scored?`热度 ${heat.score!.toFixed(1)}`:heat?.state==='unavailable'?'热度暂无数据':'热度待积累';
  const delta=!stale&&scored?heat?.delta:null;
  return <details className={'vh-badge'+(!scored||stale?' vh-muted':'')}>
    <summary aria-label={label+'，查看说明'}><Flame size={18} aria-hidden="true"/><span>{label}</span>{scored&&<small>{stale?'已过期':heat.state==='reference'?'参考':'/ 100'}</small>}{delta!==null&&delta!==undefined&&<span className={'vh-delta '+(delta>0?'vh-up':delta<0?'vh-down':'vh-flat')}>{delta>0?'↑ +':delta<0?'↓ ':'— '}{delta.toFixed(1)}</span>}</summary>
    <div className="vh-explanation"><strong>矩阵流热度 · 试验版</strong><p>{heat?.reason??'需要积累相邻查询记录后计算，首次不会填成0分。'}</p>
      {heat?.asOf&&<p>数据截至 {stamp(heat.asOf)}</p>}
      {heat?.start&&<p>观察区间：{stamp(heat.start)} → {stamp(heat.asOf)}<br/>跨度 {heat.hours?.toFixed(2)} 小时</p>}
      {stale&&<p className="vh-stale">这份评分已过期，点击“更新数据”获取新观测；未查询不代表热度已下降。</p>}
      {heat?.parts&&<dl>{[['增长速度',heat.parts.activity],['互动效率',heat.parts.efficiency],['加速 / 降速',heat.parts.momentum],['累计与时间',heat.parts.ageBase]].map(([name,value])=><div key={String(name)}><dt>{name}</dt><dd>{value===null?'待积累':`${Number(value).toFixed(1)} 分`}</dd></div>)}</dl>}
      <p className="vh-note">依据已保存的播放、点赞、评论、分享增量估算。非抖音官方分数，参数尚待校准，可能含投流影响。打开说明不调用数据接口。</p>
    </div>
  </details>;
}
