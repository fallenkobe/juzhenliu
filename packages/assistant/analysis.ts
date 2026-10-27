import {createHash} from 'node:crypto';
import {dateValue,parseMetric,workbookTables,type Dataset} from './metrics';
export const ranges=['yesterday','7d','30d'] as const;
export type AnalysisRange=typeof ranges[number];
export type AnalysisTopic='works'|'fans';
export const rangeLabels:Record<AnalysisRange,string>={yesterday:'昨天','7d':'近7天','30d':'近30天'};
export const fanColumns=[{key:'totalFollowers',label:'总粉丝量'},{key:'netFollowers',label:'粉丝净增'},{key:'gainedFollowers',label:'吸粉量'},{key:'lostFollowers',label:'脱粉量'},{key:'returningFollowers',label:'回访粉丝量'}] as const;
export type FanKey=typeof fanColumns[number]['key'];
export type FanRow={date:string}&Record<FanKey,number|null>;
export interface FanDataset {rows:FanRow[];start:string;end:string;fingerprint:string;warnings:string[];source:'native_export'}
export type AnalysisRecord=({topic:'works';dataset:Dataset}|{topic:'fans';dataset:FanDataset})&{id:string;accountLabel:string;range:AnalysisRange;capturedAt:string};
const clean=(v:unknown)=>String(v??'').replace(/[\s\ufeff]/g,'');
export async function parseFansWorkbook(buffer:Buffer):Promise<FanDataset>{
  const candidates=(await workbookTables(buffer)).filter(rows=>rows.some(row=>row.some(v=>clean(v)==='日期')&&row.some(v=>clean(v)==='总粉丝量')));
  if(candidates.length!==1)throw new Error('没有找到唯一的粉丝指标表，请确认导出「粉丝数据」');return parseFansRows(candidates[0]);
}
export function parseFansRows(values:unknown[][]):FanDataset{
  const headerIndex=values.findIndex(r=>r.some(v=>clean(v)==='日期')&&r.some(v=>clean(v)==='总粉丝量'));
  if(headerIndex<0)throw new Error('未找到粉丝数据表头');
  const headers=values[headerIndex].map(clean);if(new Set(headers.filter(Boolean)).size!==headers.filter(Boolean).length)throw new Error('粉丝表存在重复列名');
  for(const col of fanColumns.slice(0,4))if(!headers.includes(col.label))throw new Error('粉丝表缺少字段：'+col.label);
  const rows:FanRow[]=[],seen=new Set<string>();
  for(const record of values.slice(headerIndex+1)){
    if(!record.some(v=>v!==undefined&&v!==null&&v!==''))continue;
    const date=dateValue(record[headers.indexOf('日期')]);if(seen.has(date))throw new Error('粉丝表存在重复日期：'+date);seen.add(date);const row={date} as FanRow;
    for(const col of fanColumns){const i=headers.indexOf(col.label),n=i<0?null:parseMetric(record[i],'count');if(n!==null&&!Number.isInteger(n))throw new Error(col.label+'必须为整数');row[col.key]=n;}rows.push(row);
  }
  if(!rows.length||rows.length>5000)throw new Error('粉丝表须包含 1–5000 天记录');rows.sort((a,b)=>a.date.localeCompare(b.date));
  const warnings:string[]=[];if(rows.some(r=>fanColumns.some(c=>r[c.key]===null)))warnings.push('存在缺失粉丝指标，未当作 0 参与汇总。');
  if(rows.some(r=>r.netFollowers!==null&&r.gainedFollowers!==null&&r.lostFollowers!==null&&r.netFollowers!==r.gainedFollowers-r.lostFollowers))warnings.push('部分日期净增与吸粉减脱粉不一致，已保留平台原值。');
  return{rows,start:rows[0].date,end:rows.at(-1)!.date,fingerprint:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),warnings,source:'native_export'};
}
function completeSum<T>(rows:T[],key:keyof T):number|null{if(rows.some(r=>r[key]===null||r[key]===undefined))return null;return rows.reduce((s,r)=>s+Number(r[key]),0);}
export function summarizeWorks(data:Dataset){return{posts:completeSum(data.rows,'posts'),plays:completeSum(data.rows,'plays'),likes:completeSum(data.rows,'likes'),shares:completeSum(data.rows,'shares'),comments:completeSum(data.rows,'comments')};}
export function summarizeFans(data:FanDataset){
  return{endingFollowers:data.rows.at(-1)?.totalFollowers??null,netFollowers:completeSum(data.rows,'netFollowers'),gainedFollowers:completeSum(data.rows,'gainedFollowers'),lostFollowers:completeSum(data.rows,'lostFollowers'),latestReturning:data.rows.at(-1)?.returningFollowers??null};
}
export function validatePeriod(data:{rows:{date:string}[]},range:AnalysisRange){
  const expected=range==='yesterday'?1:range==='7d'?7:30;
  if(data.rows.length!==expected)throw new Error(`本次导出为 ${data.rows.length} 天，与所选${rangeLabels[range]}不符，未覆盖已有分析`);
  for(let i=1;i<data.rows.length;i++)if(Date.parse(data.rows[i].date+'T00:00:00Z')-Date.parse(data.rows[i-1].date+'T00:00:00Z')!==86400000)throw new Error('导出日期不连续，未覆盖已有分析');
}
