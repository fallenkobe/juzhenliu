'use client';
import { useState } from 'react';
import { BarChart3 } from 'lucide-react';
import type { Count, VideoSnapshot, VideoSnapshotChange } from '../../../packages/video/types';
import { compareSnapshots } from '../../../packages/video/snapshots';
import './video-snapshots.css';

const metrics = {plays:'播放', likes:'点赞', comments:'评论', shares:'分享', collects:'收藏'};
type Metric = keyof typeof metrics;
type Observation = VideoSnapshot & {change: VideoSnapshotChange};
type Mode = 'change' | 'total';
const fmt = (value: Count) => value === null ? '暂无数据' : BigInt(value).toLocaleString('zh-CN');
const signed = (value: Count) => value === null ? '无法比较' : (BigInt(value) > 0n ? '+' : '') + fmt(value);
const direction = (value: Count) => value === null ? 'unknown' : BigInt(value) > 0n ? 'up' : BigInt(value) < 0n ? 'down' : 'flat';
const colors = {up:'#f23868',down:'#22c55e',flat:'#8c8c9b',unknown:'#8c8c9b'};
const stamp = (value: string) => new Date(value).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai', hour12:false});
const source = (row: VideoSnapshot) => row.source === 'xingtu' ? '星图累计' : '抖音作品详情';
function missing(change: VideoSnapshotChange) {
  return change.reason === 'first' ? '首次记录' : change.reason === 'source-changed' ? '来源不同' : change.reason === 'invalid-time' ? '时间异常' : '缺少数据';
}
function interval(ms: number | null) {
  if (ms === null) return '';
  const seconds = Math.floor(ms / 1000), days = Math.floor(seconds / 86400), hours = Math.floor(seconds / 3600) % 24, minutes = Math.floor(seconds / 60) % 60;
  return `${days ? days+'天' : ''}${hours ? hours+'小时' : ''}${minutes ? minutes+'分钟' : ''}${seconds%60 ? seconds%60+'秒' : ''}` || '不足1秒';
}
function period(row: Observation) {
  return row.change.previousAt ? `${stamp(row.change.previousAt)} → ${stamp(row.fetchedAt)}${row.change.elapsedMs ? `（间隔 ${interval(row.change.elapsedMs)}）` : ''}` : `${stamp(row.fetchedAt)} · 首次记录`;
}
function changeText(row: Observation, metric: Metric) {
  return row.change.values[metric] === null ? missing(row.change) : signed(row.change.values[metric]);
}

function SnapshotBars({rows, metric, mode}: {rows: Observation[]; metric: Metric; mode: Mode}) {
  const counts = rows.map(row => mode === 'change' ? row.change.values[metric] : row.totals[metric]);
  const values = counts.map(value => value === null ? null : Number(value));
  const available = values.filter((value): value is number => value !== null);
  const labelPrefix = mode === 'change' ? '较上次增量' : '累计';
  if (!available.length) return <p className="va-empty va-small">{mode === 'change' ? `暂无可比较的${metrics[metric]}增量；需要相邻两次同来源且该指标完整的记录。` : `查询记录暂未提供${metrics[metric]}数据，可切换其他指标。`}</p>;
  const high = Math.max(...available, 1), low = Math.min(...available, 0), range = high - low;
  const width = Math.max(680, rows.length * 100 + 100), plotWidth = width - 110;
  const y = (value: number) => 220 - (value - low) / range * 180;
  const x = (index: number) => 80 + (index + .5) * plotWidth / rows.length;
  const barWidth = Math.min(46, plotWidth / rows.length * .6), zero = y(0);
  return <div className="vs-chart-scroll" tabIndex={0} aria-label="查询记录柱状图，可横向滚动">
    <svg className="vs-chart" style={{width, minWidth:'100%'}} viewBox={`0 0 ${width} 290`} role="img" aria-label={`按查询时间记录的${labelPrefix}${metrics[metric]}柱状图，精确值见查询明细`}>
      {[0,.5,1].map(t => <g key={t}><line x1="80" x2={width-30} y1={40+t*180} y2={40+t*180} stroke="currentColor" opacity=".12"/><text x="70" y={44+t*180} textAnchor="end">{new Intl.NumberFormat('zh-CN', {notation:'compact',maximumFractionDigits:1}).format(high-t*range)}</text></g>)}
      <line x1="80" x2={width-30} y1={zero} y2={zero} stroke="currentColor" opacity=".4"/>
      {rows.map((row, index) => {
        const value = values[index];
        const label = `${mode === 'change' ? period(row) : stamp(row.fetchedAt)} · ${labelPrefix}${metrics[metric]}：${mode === 'change' ? changeText(row,metric) : fmt(counts[index])} · ${source(row)}`;
        const date = new Date(row.fetchedAt).toLocaleDateString('zh-CN', {timeZone:'Asia/Shanghai'});
        const time = new Date(row.fetchedAt).toLocaleTimeString('zh-CN', {timeZone:'Asia/Shanghai', hour12:false});
        return <g key={row.fetchedAt}>
          {value === null ? <text x={x(index)} y={zero-10} textAnchor="middle">{mode === 'change' ? missing(row.change) : '缺失'}<title>{label}</title></text> :
            <rect className="vs-bar" tabIndex={0} aria-label={label} x={x(index)-barWidth/2} y={value === 0 ? zero-1 : Math.min(y(value),zero)} width={barWidth} height={value === 0 ? 2 : Math.max(Math.abs(zero-y(value)),1)} rx="2" fill={colors[direction(row.change.values[metric])]}><title>{label}</title></rect>}
          <text x={x(index)} y="250" textAnchor="middle">{date}</text><text x={x(index)} y="270" textAnchor="middle">{time}</text>
        </g>;
      })}
    </svg>
  </div>;
}

export default function VideoSnapshots({rows, total, image=false}: {rows: VideoSnapshot[]; total: number; image?: boolean}) {
  const [metric,setMetric] = useState<Metric>(image ? 'likes' : 'plays');
  const [mode,setMode] = useState<Mode>('change');
  // API supplies the hidden predecessor at the display boundary through change.
  const observations: Observation[] = rows.map((row,index)=>({...row,change:row.change ?? compareSnapshots(row,rows[index-1])}));
  const latest = observations.at(-1);
  return <section className="va-panel vs-panel" aria-label="查询记录分析">
    <div className="va-panel-heading"><div><h2><BarChart3 size={20}/>查询记录柱状图</h2><p>已保存 {total} 次数据快照{total > rows.length ? ` · 展示最近 ${rows.length} 次` : ''}</p></div><span className="va-badge">按查询时间</span></div>
    <div className="va-period-note">增量 = 本次累计值 − 上次累计值，表示两次查询之间的净变化，不是当日新增。仅比较相邻、同来源且指标完整的记录；查询间隔可能不同，不折算为日均。读取缓存或刷新页面不新增记录。查询时间为北京时间。</div>
    {!rows.length ? <p className="va-empty va-small">还没有可用的累计数据快照，点击“更新数据”获取首条记录。</p> : <>
      <div className="vs-latest"><h3>最近一次增量</h3><p className="vs-interval">{period(latest!)}</p><div className="vs-deltas">{(Object.keys(metrics) as Metric[]).map(key=><div key={key}><span>{metrics[key]}增量</span><strong className={'vs-'+direction(latest!.change.values[key])}>{changeText(latest!,key)}</strong></div>)}</div></div>
      <div className="va-list-controls va-chart-controls"><label>统计方式<select aria-label="统计方式" value={mode} onChange={event=>setMode(event.target.value as Mode)}><option value="change">较上次增量</option><option value="total">累计数值</option></select></label><label>快照指标<select aria-label="快照指标" value={metric} onChange={event=>setMetric(event.target.value as Metric)}>{Object.entries(metrics).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><span>悬停柱子查看数值与区间；切换不调用接口。</span></div>
      <div className="vs-legend"><span className="vs-up">↑ 红色：增长</span><span className="vs-down">↓ 绿色：下降</span><span>— 灰色：持平 / 无法比较</span></div>
      {rows.length === 1 && !latest!.change.previousAt && <p className="vs-hint">已有第一条记录，后续更新数据后可对比变化。</p>}
      <SnapshotBars rows={observations} metric={metric} mode={mode}/>
      <details className="vs-details"><summary>查看查询明细（{rows.length} 条）</summary><div className="va-table-scroll"><table><caption className="va-sr-only">每次查询的累计值及较上次增量，缺失不补零</caption><thead><tr><th>查询时间 / 比较起点</th>{Object.values(metrics).map(label=><th key={label}>{label}累计 / 增量</th>)}<th>数据来源</th></tr></thead><tbody>{observations.map(row=><tr key={row.fetchedAt}><th scope="row">{stamp(row.fetchedAt)}<span className="vs-retained">{row.change.previousAt ? `自 ${stamp(row.change.previousAt)} · ${interval(row.change.elapsedMs)}` : '首次记录，无增量基线'}</span>{row.origin === 'saved-report' && <span className="vs-retained">原已保存报告</span>}</th>{(Object.keys(metrics) as Metric[]).map(key=><td key={key}><span>{fmt(row.totals[key])}</span><span className={'vs-cell-change vs-'+direction(row.change.values[key])}>增量 {changeText(row,key)}</span></td>)}<td>{source(row)}</td></tr>)}</tbody></table></div></details>
      <p className="va-footnote">累计视图也按较上次变化着色；首次或不可比为灰色。负增量可能来自取消互动或数据修正，按实际差值保留。记录从已保存报告及后续查询开始，无法补回此前历史。</p>
    </>}
  </section>;
}
