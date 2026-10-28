import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculateHeat} from '../packages/video/heat';
import type {VideoReport,VideoSnapshot} from '../packages/video/types';
const epoch=Date.parse('2026-01-01T00:00:00Z'), hour=3600000;
const date=(h:number)=>new Date(epoch+h*hour).toISOString();
const row=(h:number,values:(number|string|null)[],source:VideoSnapshot['source']='xingtu'):VideoSnapshot=>({fetchedAt:date(h),source,origin:'query',totals:{plays:values[0]===null?null:String(values[0]),likes:values[1]===null?null:String(values[1]),comments:values[2]===null?null:String(values[2]),shares:values[3]===null?null:String(values[3]),collects:null}});
const report=(rows:VideoSnapshot[],publishedAt:string|null=date(0)):VideoReport=>({videoId:'7000000000000000040',fetchedAt:rows.at(-1)!.fetchedAt,source:rows.at(-1)!.source,totals:{data:{...rows.at(-1)!.totals,title:'合成热度',durationSeconds:null,publishedAt},error:null},history:{data:null,error:null}});
const rising=[row(1,[4000,240,40,32]),row(2,[6000,360,60,48]),row(3,[10000,600,100,80])];

test('draft formula matches rising example and age only affects the small base component',()=>{
  const heat=calculateHeat(report(rising),rising);
  assert.equal(heat.score,84.6);assert.equal(heat.state,'ready');assert.equal(heat.version,'matrix-heat-v1');assert.equal(heat.start,date(2));
  assert.ok(heat.parts!.momentum!>0);assert.ok(heat.delta!>0);
  const old=calculateHeat(report(rising,date(-180*24)),rising);
  assert.ok(old.score!>70);assert.ok(heat.score!-old.score!<10);
  assert.equal(heat.parts!.activity,old.parts!.activity);
});

test('old resurgence outranks old stagnant totals and tiny high engagement samples',()=>{
  const viral=[row(1,[1979800,98990,9798,4899]),row(2,[1980000,99000,9800,4900]),row(3,[2000000,100000,10000,5000])];
  const stopped=[row(1,[2000000,100000,10000,5000]),row(2,[2000000,100000,10000,5000])];
  const tiny=[row(0,[0,0,0,0]),row(1,[10,5,0,0])];
  assert.ok(calculateHeat(report(viral,date(-180*24)),viral).score!>85);
  assert.equal(calculateHeat(report(stopped,date(-180*24)),stopped).score,0);
  const small=calculateHeat(report(tiny),tiny);assert.equal(small.state,'reference');assert.ok(small.score!<20);
});

test('first, short, missing, source change and playback rollback never become zero heat',()=>{
  const scenarios=[
    [row(1,[100,5,1,1])],
    [row(1,[100,5,1,1]),row(1.1,[200,10,2,2])],
    [row(1,[100,5,null,1]),row(2,[200,10,2,2])],
    [row(1,[100,5,1,1]),row(2,[200,10,2,2],'douyin-app-v3')],
    [row(1,[100,5,1,1]),row(2,[90,10,2,2])],
    [row(1,[100,5,1,1]),row(2,[100,10,2,2])],
    [row(1,[100,5,1,1]),row(2,[200,-1,2,2])]
  ];
  for(const rows of scenarios){const h=calculateHeat(report(rows),rows);assert.equal(h.score,null);assert.ok(h.reason);}
  assert.equal(calculateHeat(report(rising,null),rising).score,null);
  assert.equal(calculateHeat(report(rising,date(4)),rising).score,null);
  assert.equal(calculateHeat(report(rising),rising,true).score,null);
});

test('whole short intervals aggregate to one hour with same result as sparse equal observations',()=>{
  const dense=Array.from({length:121},(_,i)=>row(i/120,[i*10,i,0,0]));
  const sparse=[dense[0],dense.at(-1)!];
  const a=calculateHeat(report(dense),dense), b=calculateHeat(report(sparse),sparse);
  assert.equal(a.hours,1);assert.equal(a.score,b.score);assert.equal(a.parts!.activity,b.parts!.activity);
  const broken=dense.map(r=>({...r,totals:{...r.totals}}));broken[100].totals.comments=null;
  assert.equal(calculateHeat(report(broken),broken).score,null);
});

test('large counters subtract exactly and interaction decreases are not counted as new activity',()=>{
  const big=100000000000000000001n;
  const rows=[row(1,[String(big),100,10,5]),row(2,[String(big+1000n),90,10,5])];
  const h=calculateHeat(report(rows),rows);
  assert.equal(h.parts!.activity,60*.55*Math.log1p(1000)/Math.log1p(10000));
  assert.equal(h.parts!.efficiency,0);assert.ok(h.score!==null);
});

test('time failures and long gaps are handled, coarse scores expire without modifying the number',()=>{
  const duplicate=[rising[0],rising[0]];
  assert.equal(calculateHeat(report(duplicate),duplicate).score,null);
  assert.equal(calculateHeat(report([rising[1],rising[0]]),[rising[1],rising[0]]).score,null);
  const coarse=[row(0,[1000,100,10,5]),row(24,[25000,1300,250,125])];
  const heat=calculateHeat(report(coarse),coarse);
  assert.equal(heat.state,'reference');assert.equal(heat.hours,24);assert.equal(heat.expiresAt,date(48));assert.equal(heat.parts!.momentum,null);
  const tooLong=[coarse[0],row(49,[25000,1300,250,125])];assert.equal(calculateHeat(report(tooLong),tooLong).score,null);
  const short=[row(0,[0,0,0,0]),row(.5,[1000,50,10,5])];assert.equal(calculateHeat(report(short),short).state,'reference');
});
