import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import ExcelJS from 'exceljs';
import {chromium} from 'playwright-core';
import {parseRows,parseMetric,parseWorkbook,compareDatasets,metricColumns} from '../packages/assistant/metrics';
import {BrowserAssistant} from '../apps/assistant/browser';
const headers=['日期',...metricColumns.map(c=>c.label)];
const values=[headers,['2026-10-25',0,2,-1,0,-2,'25.00%','66.67%','0.00%','1.33s']];

test('daily import preserves negative counts, parses units, and keeps missing values distinct from zero',()=>{
  const data=parseRows(values,'reference');assert.equal(data.rows[0].likes,-1);assert.equal(data.rows[0].comments,-2);assert.ok(Math.abs(data.rows[0].twoSecondBounce!-0.6667)<1e-10);assert.equal(data.rows[0].averageSeconds,1.33);assert.equal(data.warnings.length,1);
  assert.equal(parseMetric('-','rate'),null);assert.equal(parseMetric('0','rate'),0);assert.equal(parseMetric('1.2万','count'),12000);
});
test('malformed dates, incomplete columns, duplicate dates and invalid rates are rejected',()=>{
  assert.throws(()=>parseRows([['日期','总播放量'],['2026-10-25',2]],'reference'),/表头/);
  assert.throws(()=>parseRows([...values,values[1]],'reference'),/重复日期/);
  assert.throws(()=>parseRows([headers,['not-a-date',...values[1].slice(1)]],'reference'),/日期/);
  const invalid=[...values[1]];invalid[6]='101%';assert.throws(()=>parseRows([headers,invalid],'reference'),/超出/);
});
test('comparison checks matching dates and every metric, and cannot treat no data as successful verification',()=>{
  const reference=parseRows(values,'reference'),copy=parseRows(values,'native_export');assert.equal(compareDatasets(reference,copy).status,'matched');assert.equal(compareDatasets(reference,copy).matches,9);
  copy.rows[0].plays=3;assert.equal(compareDatasets(reference,copy).status,'different');assert.equal(compareDatasets(reference,copy).differences[0].label,'总播放量');
  copy.rows[0].date='2026-10-26';assert.equal(compareDatasets(reference,copy).status,'no_overlap');assert.equal(compareDatasets(reference,null).status,'pending');
});
test('real browser helper scopes works export, reads exact card values, downloads XLSX and compares with reference',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'matrix-assistant-test-'));
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Sheet1');sheet.addRows(values);const buffer=Buffer.from(await workbook.xlsx.writeBuffer());
  assert.equal((await parseWorkbook(buffer,'reference')).rows.length,1);
  const cards=metricColumns.map((c,i)=>`<div class="card"><span>${c.label}</span><strong>${values[1][i+1]}</strong></div>`).join('');
  const html=`<html><head><meta charset="utf-8"></head><body><h1>数据中心</h1><section><h2>作品数据</h2><button onclick="this.dataset.selected='yes'">近30天</button><button aria-label="download 导出数据" onclick="location.href='/metrics.xlsx'">导出数据</button><div>${cards}</div></section><section><h2>粉丝数据</h2><button onclick="throw new Error('wrong export')">导出数据</button></section></body></html>`;
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  const helper=new BrowserAssistant({directory,contextFactory:async()=>{const context=await browser.newContext({acceptDownloads:true});await context.route('https://creator.douyin.com/**',async route=>{if(new URL(route.request().url()).pathname==='/metrics.xlsx')await route.fulfill({status:200,headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename=metrics.xlsx'},body:buffer});else await route.fulfill({contentType:'text/html',body:html});});return context;}});
  try{
    await helper.initialize();await helper.setReference(buffer);await helper.open('data');assert.equal((await helper.status()).browser.state,'creator_visible');
    await helper.last30Days();await helper.inspect('fixture account');const visible=(await helper.status()).snapshot!;assert.equal(visible.metrics.length,9);assert.equal(visible.metrics.find(m=>m.label==='封面点击率')?.value,0);assert.equal((await helper.status()).comparison.status,'pending');
    await helper.exportAndSync('fixture account');const status=await helper.status();assert.equal(status.snapshot?.source,'native_export');assert.equal(status.comparison.status,'matched');assert.equal(status.comparison.matches,9);
    const saved=await readFile(path.join(directory,'latest.json'),'utf8');assert.ok(!saved.includes('Cookie'));assert.equal(JSON.parse(saved).dataset.rows[0].likes,-1);
    await helper.close();assert.equal((await helper.status()).browser.state,'closed');
  }finally{await helper.close();await browser.close();if(path.dirname(directory)===os.tmpdir()&&path.basename(directory).startsWith('matrix-assistant-test-'))await rm(directory,{recursive:true,force:true});}
});
