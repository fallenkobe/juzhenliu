import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';

export const metricColumns=[
  {key:'posts',label:'投稿量',kind:'count'}, {key:'plays',label:'总播放量',kind:'count'},
  {key:'likes',label:'总点赞量',kind:'count'}, {key:'shares',label:'总分享量',kind:'count'},
  {key:'comments',label:'总评论量',kind:'count'}, {key:'fiveSecondRate',label:'5秒完播率',kind:'rate'},
  {key:'twoSecondBounce',label:'2秒跳出率',kind:'rate'}, {key:'coverClickRate',label:'封面点击率',kind:'rate'},
  {key:'averageSeconds',label:'平均播放时长',kind:'seconds'}
] as const;
export type MetricKey=typeof metricColumns[number]['key'];
export type DailyRow={date:string}&Record<MetricKey,number|null>;
export interface Dataset {rows:DailyRow[];start:string;end:string;fingerprint:string;warnings:string[];source:'native_export'|'reference'|'visible_table'}
export interface VisibleMetric {label:string;raw:string;value:number|null;kind:string}
export interface AssistantSnapshot {id:string;capturedAt:string;accountLabel:string;source:'visible_page'|'native_export';pagePath:string;metrics:VisibleMetric[];dataset:Dataset|null;message:string}
const normalized=(v:unknown)=>String(v??'').replace(/[\s\u200b\ufeff]/g,'');
export function parseMetric(raw:unknown,kind:string):number|null{
  if(raw===null||raw===undefined||['','-','--','—','暂无数据'].includes(normalized(raw)))return null;
  if(typeof raw==='number')return Number.isFinite(raw)?raw:null;
  let value=normalized(raw).replace(/[,，]/g,'');
  if(kind==='rate'){
    if(value==='0')return 0;
    if(!/^-?\d+(\.\d+)?%$/.test(value))throw new Error('百分比格式无法识别：'+value.slice(0,30));
    return Number(value.slice(0,-1))/100;
  }
  if(kind==='seconds')value=value.replace(/(?:s|秒)$/i,'');
  const match=value.match(/^(-?\d+(?:\.\d+)?)(万|亿)?$/);if(!match)throw new Error('指标格式无法识别：'+value.slice(0,30));
  return Number(match[1])*(match[2]==='万'?10000:match[2]==='亿'?100000000:1);
}
export function dateValue(v:unknown){
  const value=v instanceof Date?v.toISOString().slice(0,10):String(v??'').trim().replaceAll('/','-');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw new Error('无法识别日期，请保留官方导出原始字段');
  return value;
}
export function parseRows(values:unknown[][],source:Dataset['source']):Dataset{
  if(values.length>5001)throw new Error('验证版最多读取 5000 条每日记录');
  const headerIndex=values.findIndex(r=>r.some(v=>normalized(v)==='日期')&&metricColumns.every(c=>r.some(v=>normalized(v)===c.label)));
  if(headerIndex<0)throw new Error('未找到日期及全量指标表头；请导出「数据表现·短视频全量指标」');
  const headers=values[headerIndex].map(normalized),dateIndex=headers.indexOf('日期');
  if(new Set(headers.filter(Boolean)).size!==headers.filter(Boolean).length)throw new Error('存在重复列名，无法可靠映射');
  const rows:DailyRow[]=[],seen=new Set<string>(),warnings:string[]=[];
  for(const record of values.slice(headerIndex+1)){
    if(!record.some(v=>v!==null&&v!==undefined&&v!==''))continue;
    const date=dateValue(record[dateIndex]);if(seen.has(date))throw new Error('文件内存在重复日期：'+date);seen.add(date);
    const row={date} as DailyRow;
    for(const col of metricColumns){const value=parseMetric(record[headers.indexOf(col.label)],col.kind);if(value!==null&&col.kind==='count'&&!Number.isInteger(value))throw new Error(col.label+'应为整数');if(value!==null&&col.kind==='rate'&&(value<0||value>1))throw new Error(col.label+'超出有效百分比范围');row[col.key]=value;}
    rows.push(row);
  }
  if(!rows.length)throw new Error('文件没有可用的每日数据');rows.sort((a,b)=>a.date.localeCompare(b.date));
  if(rows.some(r=>metricColumns.some(c=>c.kind==='count'&&r[c.key]!==null&&(r[c.key] as number)<0)))warnings.push('存在负数计数，已保留原值；需按抖音统计口径解释。');
  if(rows.some(r=>metricColumns.some(c=>r[c.key]===null)))warnings.push('存在缺失指标，已保留为空，不替换为 0。');
  return {rows,start:rows[0].date,end:rows.at(-1)!.date,fingerprint:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),warnings,source};
}
export async function workbookTables(buffer:Buffer){
  if(buffer.length>10*1024*1024)throw new Error('验证版只接受 10 MB 以内的 Excel');
  if(buffer[0]!==0x50||buffer[1]!==0x4b)throw new Error('文件不是有效的 XLSX');
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer as any);
  const candidates=workbook.worksheets.filter(s=>s.rowCount>1&&s.columnCount<=100&&s.rowCount<=5001);
  const tables:unknown[][][]=[];
  for(const sheet of candidates){
    const rows:unknown[][]=[];sheet.eachRow({includeEmpty:true},r=>{const row:unknown[]=[];for(let i=1;i<=sheet.columnCount;i++){const c=r.getCell(i);if(c.type===ExcelJS.ValueType.Formula)throw new Error('不接受含公式的指标表');row.push(c.value instanceof Date?c.value:c.text===''?null:typeof c.value==='number'?c.value:c.text);}rows.push(row);});
    tables.push(rows);
  }
  return tables;
}
export async function parseWorkbook(buffer:Buffer,source:Dataset['source']):Promise<Dataset>{
  const results:Dataset[]=[];
  for(const rows of await workbookTables(buffer))if(rows.some(r=>r.some(v=>normalized(v)==='日期')&&r.some(v=>normalized(v)==='总播放量')))results.push(parseRows(rows,source));
  if(results.length!==1)throw new Error(results.length?'文件含多份指标表，请单独导出一个账号的一份报表':'未找到受支持的每日全量指标表');return results[0];
}
export function compareDatasets(reference:Dataset|null,actual:Dataset|null){
  if(!reference||!actual)return{status:'pending',message:'需要参考 Excel 和助手采集的同口径每日数据才能对照',commonDays:0,matches:0,differences:[] as {date:string;label:string;expected:number|null;actual:number|null}[]};
  const byDate=new Map(actual.rows.map(r=>[r.date,r])),differences:{date:string;label:string;expected:number|null;actual:number|null}[]=[];let commonDays=0,matches=0;
  for(const expected of reference.rows){const got=byDate.get(expected.date);if(!got)continue;commonDays++;for(const column of metricColumns){const a=expected[column.key],b=got[column.key],tolerance=column.kind==='count'?0:column.kind==='rate'?0.0000001:0.0001;if(a===b||(a!==null&&b!==null&&Math.abs(a-b)<=tolerance))matches++;else differences.push({date:expected.date,label:column.label,expected:a,actual:b});}}
  const complete=reference.rows.length===actual.rows.length&&commonDays===reference.rows.length;
  return{status:!commonDays?'no_overlap':differences.length?'different':complete?'matched':'partial',message:!commonDays?'日期范围没有交集':differences.length?'检测到差异，请核对账号、日期范围及统计更新时间':complete?'日期与 9 项指标逐项一致':'重叠日期一致，日期覆盖范围不同',commonDays,matches,differences:differences.slice(0,100),differenceCount:differences.length};
}
