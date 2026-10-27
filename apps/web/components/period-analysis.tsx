'use client';
import {useState} from 'react';
import {Download,RefreshCw} from 'lucide-react';
import type {AnalysisRecord,AnalysisRange,AnalysisTopic} from '../../../packages/assistant/analysis';

export type AnalysisView=AnalysisRecord&{summary:Record<string,number|null>};
const ranges:[AnalysisRange,string][]=[['yesterday','昨天'],['7d','近 7 天'],['30d','近 30 天']];
const workColumns=[['posts','投稿量'],['plays','总播放量'],['likes','总点赞量'],['shares','总分享量'],['comments','总评论量'],['fiveSecondRate','5秒完播率'],['twoSecondBounce','2秒跳出率'],['coverClickRate','封面点击率'],['averageSeconds','平均播放时长']] as const;
const fanColumns=[['totalFollowers','总粉丝量'],['netFollowers','粉丝净增'],['gainedFollowers','吸粉量'],['lostFollowers','脱粉量'],['returningFollowers','回访粉丝量']] as const;
const fmt=(n:number|null|undefined)=>n===null||n===undefined?'暂无数据':n.toLocaleString('zh-CN');
function cell(key:string,value:number|null){if(value===null)return'—';if(key.endsWith('Rate')||key==='twoSecondBounce')return(value*100).toFixed(2)+'%';if(key==='averageSeconds')return value.toFixed(2)+'s';return value.toLocaleString('zh-CN');}

function Trend({points,label,cyan}:{points:{date:string;value:number|null}[];label:string;cyan:boolean}){
  const width=660,height=220,left=52,right=20,top=20,bottom=42,values=points.flatMap(p=>p.value===null?[]:[p.value]);
  if(!values.length)return <div className="period-chart-empty">该指标暂无可用数据</div>;
  const min=Math.min(0,...values),max=Math.max(1,...values),span=max-min,y=(v:number)=>top+(max-v)/span*(height-top-bottom),zero=y(0),slot=(width-left-right)/points.length,bar=Math.min(24,slot*.6),color=cyan?'#25f4ee':'#fe2c55';
  const ticks=[max,(max+min)/2,min],dateIndexes=[...new Set([0,Math.floor((points.length-1)/2),points.length-1])];
  return <div className="period-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label+'每日趋势图'}>{ticks.map((v,i)=><g key={i}><line x1={left} x2={width-right} y1={y(v)} y2={y(v)} stroke="#30303a" strokeDasharray="4 5"/><text x={left-9} y={y(v)+4} textAnchor="end" fill="#8e8ea3" fontSize="12">{Number(v.toFixed(1)).toLocaleString('zh-CN')}</text></g>)}{min<0&&<line x1={left} x2={width-right} y1={zero} y2={zero} stroke="#66667b"/>}{points.map((p,i)=>p.value===null?null:<rect key={p.date} x={left+slot*(i+.5)-bar/2} y={Math.min(y(p.value),zero)} width={bar} height={Math.abs(zero-y(p.value))} rx={Math.min(3,bar/2)} fill={color} opacity={.85}><title>{p.date}：{p.value}</title></rect>)}{dateIndexes.map(i=><text key={i} x={left+slot*(i+.5)} y={height-15} fill="#9696a9" fontSize="13" textAnchor="middle">{points[i].date.slice(5)}</text>)}</svg></div>;
}

function AnalysisPanel({topic,records,accountLabel,disabled,canSync,syncHint,onSync}:{topic:AnalysisTopic;records:AnalysisView[];accountLabel:string;disabled:boolean;canSync:boolean;syncHint:string;onSync:(topic:AnalysisTopic,range:AnalysisRange)=>void}){
  const [range,setRange]=useState<AnalysisRange>('30d'),[trend,setTrend]=useState('');
  const record=records.find(r=>r.topic===topic&&r.range===range&&r.accountLabel===accountLabel),fans=topic==='fans',title=fans?'粉丝量分析':'作品数据分析';
  const trendKey=trend||(fans?'totalFollowers':'plays'),trendOptions=fans?[['totalFollowers','总粉丝量'],['netFollowers','粉丝净增'],['gainedFollowers','吸粉量'],['lostFollowers','脱粉量']]:[['plays','总播放量'],['likes','总点赞量'],['comments','总评论量'],['shares','总分享量']];
  const summaryFields=fans?[['endingFollowers','期末粉丝量','取最后一天，不累计'],['netFollowers','期间净增','每日净增之和'],['gainedFollowers','期间吸粉','每日吸粉之和'],['lostFollowers','期间脱粉','每日脱粉之和'],['latestReturning','最近一天回访','不跨日去重累计']]:[['posts','投稿量','期间合计'],['plays','总播放量','期间合计'],['likes','总点赞量','保留平台负值'],['comments','总评论量','期间合计'],['shares','总分享量','期间合计']];
  let points:{date:string;value:number|null}[]=[];
  if(record?.topic==='works'){const key=trendKey as 'plays'|'likes'|'comments'|'shares';points=record.dataset.rows.map(r=>({date:r.date,value:r[key]}));}
  if(record?.topic==='fans'){const key=trendKey as 'totalFollowers'|'netFollowers'|'gainedFollowers'|'lostFollowers';points=record.dataset.rows.map(r=>({date:r.date,value:r[key]}));}
  return <section className={'dy-panel period-panel'+(fans?' fans':'')} aria-label={title}>
    <div className="dy-section-title"><h2>{title}</h2><span className="period-source">官方导出数据</span></div>
    <div className="period-toolbar"><div className="period-tabs" role="group" aria-label={title+'时间范围'}>{ranges.map(([key,name])=><button key={key} aria-pressed={range===key} disabled={disabled} onClick={()=>setRange(key)}>{name}</button>)}</div><button className="secondary" disabled={disabled||!canSync} onClick={()=>onSync(topic,range)}><Download size={15}/>同步{fans?'粉丝':'作品'}数据</button></div>
    {!canSync&&syncHint?<p className="period-sync-hint">{syncHint}<a href="#account-label">前往连接设置</a></p>:<p className="period-note">切换时间范围后，点击「同步{fans?'粉丝':'作品'}数据」获取该周期的最新数据。</p>}
    {!record?<div className="period-empty"><RefreshCw size={23}/><h3>尚未同步{ranges.find(r=>r[0]===range)?.[1]}{fans?'粉丝':'作品'}数据</h3><p>确认账号后点击同步，助手会选择对应周期并读取官方报表。</p></div>:<>
      <div className="period-meta"><span>账号备注：{record.accountLabel}</span><span>导出日期：{record.dataset.start} 至 {record.dataset.end}</span><span>{record.dataset.rows.length} 天 · 同步于 {new Date(record.capturedAt).toLocaleString('zh-CN',{timeZone:'Asia/Hong_Kong',hour12:false})}</span></div>
      <div className="period-stats">{summaryFields.map(([key,label,note])=><article key={key}><span>{label}</span><b className={record.summary[key]!==null&&record.summary[key]<0?'negative':''}>{fmt(record.summary[key])}</b><small>{note}</small></article>)}</div>
      <div className="period-chart-heading"><h3>每日趋势</h3><label>指标<select aria-label={title+'趋势指标'} value={trendKey} onChange={e=>setTrend(e.target.value)}>{trendOptions.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
      <Trend points={points} label={trendOptions.find(o=>o[0]===trendKey)?.[1]||''} cyan={fans}/>
      <p className="period-note">{fans?'总粉丝量按日展示，期末取最后一天；净增、吸粉、脱粉按期间汇总。':'播放与互动按期间汇总；完播率、跳出率、点击率和平均时长保留每日口径，不直接求平均。'}实际日期以导出文件为准。</p>
      {record.dataset.warnings.map(w=><p className="assistant-warning" key={w}>{w}</p>)}
      <details className="period-detail"><summary>每日明细 · {record.dataset.rows.length} 天</summary><div className="table-scroll"><table><thead><tr><th>日期</th>{(fans?fanColumns:workColumns).map(([key,label])=><th key={key}>{label}</th>)}</tr></thead><tbody>{record.topic==='works'?record.dataset.rows.map(row=><tr key={row.date}><td>{row.date}</td>{workColumns.map(([key])=><td className="numeric" key={key}>{cell(key,row[key])}</td>)}</tr>):record.dataset.rows.map(row=><tr key={row.date}><td>{row.date}</td>{fanColumns.map(([key])=><td className="numeric" key={key}>{cell(key,row[key])}</td>)}</tr>)}</tbody></table></div></details>
    </>}
  </section>;
}

export default function PeriodAnalysis({records,accountLabel,disabled,canSync,syncHint,onSync,onSyncAll}:{records:AnalysisView[];accountLabel:string;disabled:boolean;canSync:boolean;syncHint:string;onSync:(topic:AnalysisTopic,range:AnalysisRange)=>void;onSyncAll:()=>void}){
  return <section className="period-analysis"><div className="period-overview"><div><span className="eyebrow">ACCOUNT PERFORMANCE</span><h2>按周期查看账号表现</h2><p>作品与粉丝分别保存昨天、近 7 天、近 30 天的数据。</p></div><button className="primary" disabled={disabled||!canSync} onClick={onSyncAll}><RefreshCw size={16}/>同步全部 6 个周期</button></div><AnalysisPanel topic="works" records={records} accountLabel={accountLabel} disabled={disabled} canSync={canSync} syncHint={syncHint} onSync={onSync}/><AnalysisPanel topic="fans" records={records} accountLabel={accountLabel} disabled={disabled} canSync={canSync} syncHint={syncHint} onSync={onSync}/></section>;
}
