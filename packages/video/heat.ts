import type {VideoHeat, VideoReport, VideoSnapshot} from './types';

const HOUR = 3600000;
const fields = ['plays','likes','comments','shares'] as const;
const weights = [.55,.20,.10,.15];
const speedRefs = [10000,500,100,50], totalRefs = [100000,5000,1000,500];
const clip = (n:number, low=0, high=1) => Math.max(low,Math.min(high,n));
const norm = (n:number, ref:number) => clip(Math.log1p(Math.max(0,n))/Math.log1p(ref));
const weighted = (values:number[], factors:number[]) => values.reduce((sum,n,i)=>sum+n*factors[i],0);
const rounded = (n:number) => Math.round(n*10)/10;
type Counts = bigint[];
function counts(row:VideoSnapshot): Counts | null {
  const raw = fields.map(key=>row.totals[key]);
  if(raw.some(n=>typeof n!=='string'||!/^\d{1,30}$/.test(n))) return null;
  return raw.map(n=>BigInt(n!));
}
interface Block {start:number;end:number;hours:number;delta:Counts}
type BlockResult = {block:Block;error:null} | {block:null;error:string};

// Combine whole adjacent intervals, never interpolate counts into invented hourly points.
function blockEndingAt(rows:VideoSnapshot[], end:number):BlockResult {
  if(end<1) return {block:null,error:'至少需要两次实际查询，且观察区间达到30分钟。'};
  const last=rows[end], lastTime=Date.parse(last.fetchedAt), lastCounts=counts(last);
  if(!lastCounts) return {block:null,error:'播放、点赞、评论或分享数据缺失/异常，暂不计算热度。'};
  let start=end, error='观察区间不足30分钟，请稍后更新数据。';
  for(let i=end-1;i>=0;i--) {
    const a=rows[i], b=rows[i+1], ac=counts(a), bc=counts(b);
    if(a.source!==last.source || b.source!==last.source){error='数据来源发生变化，需要同来源的新查询记录。';break;}
    if(!ac||!bc){error='观察区间含缺失或异常指标，不能跨过缺失记录计算。';break;}
    if(ac[0]>bc[0]){error='播放计数发生回撤，等待新的完整观察区间。';break;}
    const hours=(lastTime-Date.parse(a.fetchedAt))/HOUR;
    if(hours>48){error='查询间隔超过48小时，无法判断近期热度。';break;}
    start=i;
    if(hours>=1) break;
  }
  const hours=(lastTime-Date.parse(rows[start].fetchedAt))/HOUR;
  if(start===end||hours<.5) return {block:null,error};
  const first=counts(rows[start])!;
  return {block:{start,end,hours,delta:lastCounts.map((n,i)=>n-first[i])},error:null};
}

function empty(asOf:string, reason:string, state:VideoHeat['state']='waiting'):VideoHeat {
  return {version:'matrix-heat-v1',score:null,state,reason,asOf,start:null,hours:null,expiresAt:null,delta:null,parts:null};
}

function scoreAt(rows:VideoSnapshot[], publishedAt:string|null, asOf:string):VideoHeat {
  const end=rows.length-1, last=rows[end], time=Date.parse(asOf);
  if(!last||last.fetchedAt!==asOf) return empty(asOf,'本次没有完整累计快照，暂不使用旧数据计算热度。','unavailable');
  if(!Number.isFinite(time)||rows.some((r,i)=>!Number.isFinite(Date.parse(r.fetchedAt))||(i>0&&Date.parse(r.fetchedAt)<=Date.parse(rows[i-1].fetchedAt))))
    return empty(asOf,'查询记录时间异常，暂不计算热度。','unavailable');
  const published=publishedAt ? Date.parse(publishedAt) : NaN;
  if(!Number.isFinite(published)||published>time) return empty(asOf,'发布时间缺失或异常，暂不计算完整热度。','unavailable');
  if(!counts(last)) return empty(asOf,'播放、点赞、评论或分享数据缺失/异常，暂不计算热度。','unavailable');
  const current=blockEndingAt(rows,end);
  if(!current.block) return empty(asOf,current.error);
  const block=current.block;
  if(Date.parse(rows[block.start].fetchedAt)<published) return empty(asOf,'查询记录早于发布时间，请核对数据。','unavailable');
  // BigInt subtraction above preserves tiny changes in very large counters.
  const positive=block.delta.map(n=>Number(n>0n?n:0n));
  if(positive[0]===0&&positive.slice(1).some(n=>n>0)) return empty(asOf,'播放未增长但互动有新增，可能存在更新延迟，暂不计算完整热度。','unavailable');
  const speeds=positive.map(n=>n/block.hours);
  const A=weighted(speeds.map((n,i)=>norm(n,speedRefs[i])),weights);
  const Q=positive[0]===0?0:weighted(positive.slice(1).map((n,i)=>norm(n/(positive[0]+200),[.05,.01,.005][i])),[.45,.20,.35]);
  const B=weighted(counts(last)!.map((n,i)=>norm(Number(n),totalRefs[i])),weights);
  const F=2**(-(time-published)/HOUR/72);
  let G:number|null=null;
  const previous=blockEndingAt(rows,block.start).block;
  if(previous&&Date.parse(rows[previous.start].fetchedAt)>=published&&block.hours<=6&&previous.hours<=6&&block.hours/previous.hours>=.5&&block.hours/previous.hours<=2&&previous.delta[0]>0n&&block.delta[0]>0n) {
    const old=previous.delta.map(n=>Number(n>0n?n:0n));
    const z=weighted(speeds,[1,5,10,15]), prior=weighted(old.map(n=>n/previous.hours),[1,5,10,15]);
    G=clip(Math.log2((z+200)/(prior+200))/2,-1,1)*Math.min(1,positive[0]/200,old[0]/200);
  }
  const parts={activity:60*A,efficiency:25*A*Q,momentum:G===null?null:5*A*G,ageBase:10*B*F};
  const state:VideoHeat['state']=block.hours<1||block.hours>6||positive[0]<200?'reference':'ready';
  const reason=block.hours>6?'长区间平均热度，仅供参考。':block.hours<1?'观察区间不足1小时，仅供参考。':positive[0]<200?'新增播放样本较少，仅供参考。':'按最近完整查询区间计算。';
  return {version:'matrix-heat-v1',score:rounded(clip(parts.activity+parts.efficiency+(parts.momentum??0)+parts.ageBase,0,100)),state,
    reason,asOf,start:rows[block.start].fetchedAt,hours:block.hours,
    expiresAt:new Date(time+Math.min(24,Math.max(2,2*block.hours))*HOUR).toISOString(),delta:null,parts};
}

export function calculateHeat(report:VideoReport, rows:VideoSnapshot[], truncated=false):VideoHeat {
  if(truncated) return empty(report.fetchedAt,'观察记录过多，暂不计算不完整区间的热度。','unavailable');
  if(!report.totals.data) return empty(report.fetchedAt,'本次累计数据未取得，暂不计算热度。','unavailable');
  const last=rows.at(-1), expected=report.source??(report.kind==='image'?'douyin-app-v3':'xingtu');
  if(last&&last.source!==expected) return empty(report.fetchedAt,'报告与快照来源不一致，请更新数据。','unavailable');
  const heat=scoreAt(rows,report.totals.data.publishedAt,report.fetchedAt);
  if(heat.score!==null&&rows.length>2) {
    const previous=rows[rows.length-2];
    const old=scoreAt(rows.slice(0,-1),report.totals.data.publishedAt,previous.fetchedAt);
    // Do not imply a trend across stale observations or different reference regimes.
    const sameWindowClass=old.hours!==null&&heat.hours!==null&&(old.hours<1)===(heat.hours<1)&&(old.hours>6)===(heat.hours>6);
    if(previous.source===last!.source&&old.score!==null&&old.state===heat.state&&sameWindowClass&&old.expiresAt&&Date.parse(old.expiresAt)>=Date.parse(heat.asOf)) heat.delta=rounded(heat.score-old.score);
  }
  return heat;
}
