import {after, before, test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import type {VideoReport} from '../packages/video/types';

process.env.MATRIX_DATA_DIR=resolve('.data','snapshot-test-'+randomUUID());
process.env.DATABASE_URL='';
process.env.MATRIX_OWNER_PASSWORD='snapshot-owner-password-32-characters';
process.env.TIKHUB_API_KEY='snapshot-test-key';
process.env.NODE_ENV='test';
delete process.env.MATRIX_PUBLIC_ORIGIN;
const {db}=await import('../packages/db/index');
const {loginOwner}=await import('../packages/domain/douyin-auth');
const {getVideo,queryVideo,dailyUsed}=await import('../packages/video/service');
const {snapshotFromReport,compareSnapshots}=await import('../packages/video/snapshots');
let owner:string;
const legacy:VideoReport={videoId:'7000000000000000020',fetchedAt:'2026-01-01T01:02:03.000Z',
  totals:{data:{title:'旧报告',publishedAt:null,durationSeconds:null,plays:'100000000000000001',likes:'4',comments:null,shares:'-2',collects:'0'},error:null},
  history:{data:null,error:'暂无历史'}};
before(async()=>{await db.migrate();owner=await loginOwner(process.env.MATRIX_OWNER_PASSWORD);});
after(async()=>{await db.close();});
const response=(data:unknown)=>new Response(JSON.stringify({code:200,data}));
const transport=(id:string,plays='150',failTotals=false):typeof fetch=>async url=>String(url).includes('get_item_play_count')
  ? failTotals ? new Response('',{status:500}) : response({item_id:id,exist:true,watch_cnt:plays,stats:{like_cnt:'10',comment_cnt:null,share_cnt:'-1',favorite_cnt:'0'},item:{id,title:'快照测试',create_time:'1704067200',duration:12}})
  : response({base_resp:{status_code:0},date_values:{vv_list:[{visit_date:20240101,value:'1'}]}});

test('migration preserves only existing cumulative reports at original timestamps and is idempotent',async()=>{
  await db.query('DROP TABLE video_query_snapshots');
  await db.query("DELETE FROM schema_migrations WHERE version='006_video_query_snapshots'");
  const image={...legacy,videoId:'7000000000000000021',kind:'image' as const,source:'douyin-app-v3' as const,totals:{data:{...legacy.totals.data!,plays:null},error:null}};
  const empty={...legacy,videoId:'7000000000000000022',totals:{data:null,error:'失败'}};
  for(const report of [legacy,image,empty]) await db.query('INSERT INTO video_reports VALUES($1,$2,$3)',[report.videoId,JSON.stringify(report),report.fetchedAt]);
  await db.migrate();await db.migrate();
  const report=await getVideo(owner,legacy.videoId);
  assert.equal(report.snapshotCount,1);assert.equal(report.snapshots![0].fetchedAt,legacy.fetchedAt);
  assert.equal(report.snapshots![0].origin,'saved-report');assert.equal(report.snapshots![0].totals.plays,'100000000000000001');
  assert.equal(report.snapshots![0].totals.comments,null);assert.equal(report.snapshots![0].totals.shares,'-2');
  assert.equal((await getVideo(owner,image.videoId)).snapshots![0].source,'douyin-app-v3');
  assert.equal((await getVideo(owner,empty.videoId)).snapshotCount,0);
});

test('new query appends atomically; cache and saved reads never append or bill again',async()=>{
  let calls=0;const fetcher:typeof fetch=async(...args)=>{calls++;return transport(legacy.videoId)(...args);};
  const beforeUsage=await dailyUsed();
  const result=await queryVideo(owner,legacy.videoId,true,fetcher);
  assert.equal(result.cached,false);assert.equal(result.report.snapshotCount,2);assert.equal(calls,2);
  assert.equal(result.report.snapshots![1].totals.plays,'150');
  assert.equal(result.report.snapshots![0].totals.plays,'100000000000000001');
  const cached=await queryVideo(owner,legacy.videoId,true,fetcher);
  assert.equal(cached.cached,true);assert.equal(cached.report.snapshotCount,2);assert.equal(calls,2);
  delete process.env.TIKHUB_API_KEY;
  assert.equal((await getVideo(owner,legacy.videoId)).snapshotCount,2);
  process.env.TIKHUB_API_KEY='snapshot-test-key';
  assert.equal(await dailyUsed(),beforeUsage+1);
  const [stored]=await db.query('SELECT report_json FROM video_reports WHERE video_id=$1',[legacy.videoId]);
  assert.equal(JSON.parse(stored.report_json).snapshots,undefined);
  await assert.rejects(()=>getVideo(undefined,legacy.videoId),/请先登录/);
});

test('history-only and failed queries do not create snapshots; partial totals do',async()=>{
  const id='7000000000000000023';
  const result=await queryVideo(owner,id,false,transport(id,'150',true));
  assert.equal(result.report.snapshotCount,0);
  await db.query('UPDATE video_reports SET fetched_at=$1 WHERE video_id=$2',['2000-01-01T00:00:00Z',id]);
  await assert.rejects(()=>queryVideo(owner,id,true,async()=>new Response('',{status:500})));
  assert.equal((await getVideo(owner,id)).snapshotCount,0);
  const partial:typeof fetch=async(...args)=>String(args[0]).includes('get_item_play_count')?transport(id)(...args):new Response('',{status:500});
  const next=await queryVideo(owner,id,true,partial);
  assert.equal(next.report.snapshotCount,1);assert.equal(next.report.history.data,null);
  const noValues={...legacy,totals:{data:{...legacy.totals.data!,plays:null,likes:null,comments:null,shares:null,collects:null},error:null}};
  assert.equal(snapshotFromReport(noValues,'query'),null);
});

test('snapshot insertion failure rolls back report replacement and releases lease',async()=>{
  const before=await getVideo(owner,legacy.videoId);
  await db.query('UPDATE video_reports SET fetched_at=$1 WHERE video_id=$2',['2000-01-01T00:00:00Z',legacy.videoId]);
  await db.query("CREATE TRIGGER reject_snapshot BEFORE INSERT ON video_query_snapshots BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
  try {await assert.rejects(()=>queryVideo(owner,legacy.videoId,true,transport(legacy.videoId,'999')));}
  finally {await db.query('DROP TRIGGER reject_snapshot');}
  const after=await getVideo(owner,legacy.videoId);
  assert.equal(after.totals.data?.plays,before.totals.data?.plays);assert.equal(after.snapshotCount,before.snapshotCount);
  assert.equal((await db.query('SELECT * FROM video_query_leases')).length,0);
});

test('recent 100 observations are chronological while older observations remain stored',async()=>{
  const id='7000000000000000024';
  await db.query('INSERT INTO video_reports VALUES($1,$2,$3)',[id,JSON.stringify({...legacy,videoId:id}),legacy.fetchedAt]);
  for(let i=0;i<102;i++){
    const snap=snapshotFromReport({...legacy,fetchedAt:new Date(Date.UTC(2026,0,1,0,i)).toISOString()},'query')!;
    await db.query('INSERT INTO video_query_snapshots VALUES($1,$2,$3)',[id,snap.fetchedAt,JSON.stringify(snap)]);
  }
  const result=await getVideo(owner,id);
  assert.equal(result.snapshotCount,102);assert.equal(result.snapshots!.length,100);
  assert.equal(result.snapshots![0].fetchedAt,'2026-01-01T00:02:00.000Z');
  assert.equal(result.snapshots![0].change?.previousAt,'2026-01-01T00:01:00.000Z');
  assert.equal(result.snapshots![0].change?.values.plays,'0');
  assert.equal(result.snapshots!.at(-1)!.fetchedAt,'2026-01-01T01:41:00.000Z');
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM video_query_snapshots WHERE video_id=$1',[id]))[0].n,102);
});

test('increments use exact BigInt subtraction, retain negative/zero, and show elapsed interval',()=>{
  const first=snapshotFromReport(legacy,'query')!;
  const next={...first,fetchedAt:'2026-01-02T02:32:03.000Z',totals:{...first.totals,plays:'100000000000000011',likes:'1',shares:'-2',comments:'10'}};
  const change=compareSnapshots(next,first);
  assert.deepEqual(change.values,{plays:'10',likes:'-3',comments:null,shares:'0',collects:'0'});
  assert.equal(change.previousAt,first.fetchedAt);assert.equal(change.elapsedMs,91800000);assert.equal(change.reason,null);
  assert.deepEqual(compareSnapshots(first).values,{plays:null,likes:null,comments:null,shares:null,collects:null});
  assert.equal(compareSnapshots(first).reason,'first');
});

test('saved report heat reads more than chart limit without provider calls or new snapshots',async()=>{
  const id='7000000000000000025',start=Date.parse('2026-01-01T00:00:00Z');
  const report={...legacy,videoId:id,fetchedAt:new Date(start+3600000).toISOString(),totals:{data:{...legacy.totals.data!,publishedAt:new Date(start).toISOString(),plays:'2400',likes:'120',comments:'0',shares:'0'},error:null}};
  await db.query('INSERT INTO video_reports VALUES($1,$2,$3)',[id,JSON.stringify(report),report.fetchedAt]);
  for(let i=0;i<=120;i++){
    const snapshot=snapshotFromReport({...report,fetchedAt:new Date(start+i*30000).toISOString(),totals:{data:{...report.totals.data,plays:String(i*20),likes:String(i)},error:null}},'query')!;
    await db.query('INSERT INTO video_query_snapshots VALUES($1,$2,$3)',[id,snapshot.fetchedAt,JSON.stringify(snapshot)]);
  }
  const usage=await dailyUsed();delete process.env.TIKHUB_API_KEY;
  try {
    const result=await getVideo(owner,id);
    assert.equal(result.snapshots!.length,100);assert.equal(result.snapshotCount,121);
    assert.equal(result.heat?.state,'ready');assert.equal(result.heat?.hours,1);assert.ok(result.heat?.score!==null);
    assert.equal((await getVideo(owner,id)).snapshotCount,121);assert.equal(await dailyUsed(),usage);
  } finally {process.env.TIKHUB_API_KEY='snapshot-test-key';}
});

test('increments reject source/time mismatches and never bridge an intervening missing value',()=>{
  const first=snapshotFromReport(legacy,'query')!;
  const missing={...first,fetchedAt:'2026-01-02T00:00:00.000Z',totals:{...first.totals,likes:null}};
  const third={...first,fetchedAt:'2026-01-03T00:00:00.000Z',totals:{...first.totals,likes:'12'}};
  assert.equal(compareSnapshots(missing,first).values.likes,null);
  assert.equal(compareSnapshots(third,missing).values.likes,null);
  const changed=compareSnapshots({...third,source:'douyin-app-v3'},missing);
  assert.equal(changed.reason,'source-changed');assert.ok(Object.values(changed.values).every(v=>v===null));
  for(const time of [first.fetchedAt,'2000-01-01T00:00:00Z','invalid']){
    const invalid=compareSnapshots({...third,fetchedAt:time},first);
    assert.equal(invalid.reason,'invalid-time');assert.equal(invalid.elapsedMs,null);
  }
});
