import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
Object.assign(process.env,{MATRIX_DATA_DIR:resolve('.data','image-analysis-'+randomUUID()),DATABASE_URL:'',MATRIX_OWNER_PASSWORD:'image-analysis-test-password-32-chars',TIKHUB_API_KEY:'synthetic-image-key',NODE_ENV:'test'});
delete process.env.MATRIX_PUBLIC_ORIGIN;
const {db}=await import('../packages/db/index');
const {loginOwner}=await import('../packages/domain/douyin-auth');
const {parseImageTotals}=await import('../packages/providers/tikhub');
const {parseVideoId}=await import('../packages/video/input');
const service=await import('../packages/video/service');
const id='7000000000000000011';let owner:string,calls=0;
const detail=(value=id)=>({aweme_detail:{aweme_id:value,aweme_type:68,desc:'合成图文',images:[{},{},{},{},{}],video:{duration:10000},create_time:1704067200,statistics:{aweme_id:value,digg_count:'100000000000000001',comment_count:5,share_count:-2,collect_count:0,play_count:0}}});
const transport:typeof fetch=async url=>{calls++;const u=new URL(String(url));assert.equal(u.origin,'https://api.tikhub.io');assert.equal(u.pathname,'/api/v1/douyin/app/v3/fetch_one_video');return new Response(JSON.stringify({code:200,data:detail(u.searchParams.get('aweme_id')!)}));};
before(async()=>{await db.migrate();owner=await loginOwner(process.env.MATRIX_OWNER_PASSWORD);});
after(async()=>{await db.close();});
test('image detail validates identity and type, preserves counts, omits pseudo play count and music duration',()=>{
  const parsed=parseImageTotals(detail(),id);assert.equal(parsed.imageCount,5);assert.equal(parsed.totals.plays,null);assert.equal(parsed.totals.durationSeconds,null);assert.equal(parsed.totals.likes,'100000000000000001');assert.equal(parsed.totals.shares,'-2');assert.equal(parsed.totals.collects,'0');
  assert.throws(()=>parseImageTotals(detail('7000000000000000012'),id),/身份/);
  assert.throws(()=>parseImageTotals({aweme_detail:{...detail().aweme_detail,statistics:{aweme_id:'wrong'}}},id),/身份/);
  assert.throws(()=>parseImageTotals({aweme_detail:{...detail().aweme_detail,aweme_type:0,images:[]}},id),/图文/);
  assert.throws(()=>parseImageTotals({filter_list:[{reason:5}]},id),/不可用/);
  assert.equal(parseImageTotals({aweme_detail:{...detail().aweme_detail,statistics:{}}},id).totals.comments,null);
});
test('note links and saved image IDs use one detail call, retain 30 minute cache, never call trend or export fabricated history',async()=>{
  const note='https://www.douyin.com/note/'+id;assert.equal(parseVideoId('https://www.iesdouyin.com/share/note/'+id),id);
  await assert.rejects(()=>service.queryVideo(undefined,note,false,transport),/登录/);assert.equal(calls,0);
  const result=await service.queryVideo(owner,note,false,transport);assert.equal(result.report.kind,'image');assert.equal(result.report.historySupported,false);assert.equal(result.report.history.data,null);assert.equal(calls,1);assert.equal(await service.dailyUsed(),1);
  await db.query('UPDATE video_reports SET fetched_at=$1 WHERE video_id=$2',[new Date(Date.now()-120000).toISOString(),id]);
  const cached=await service.queryVideo(owner,id,false,transport);assert.equal(cached.cached,true);assert.equal(calls,1);assert.equal((await service.listVideos(owner))[0].partial,false);
  assert.throws(()=>service.historyCsv(result.report),/暂无/);
  await service.queryVideo(owner,id,true,transport);assert.equal(calls,2);
});
test('known saved image work resolves from numeric ID and replaces incompatible legacy report',async()=>{
  const other='7000000000000000012',uid='7000000000000000013',now=new Date().toISOString();
  await db.query('INSERT INTO managed_douyin_accounts VALUES($1,$2,$3,$4)',[uid,'fixture','{}',now]);
  await db.query('INSERT INTO account_work_pages VALUES($1,$2,$3,$4)',[uid,'0',JSON.stringify({items:[{id:other,kind:'image'}]}),now]);
  await db.query('INSERT INTO video_reports VALUES($1,$2,$3)',[other,JSON.stringify({videoId:other,fetchedAt:now,totals:{data:{title:'旧报告'},error:null},history:{data:null,error:'无历史'}}),now]);
  const result=await service.queryVideo(owner,other,false,transport);assert.equal(result.cached,false);assert.equal(result.report.kind,'image');assert.equal(calls,3);
});
test('failed image refresh preserves saved results and releases lease; quota blocks network',async()=>{
  await db.query('UPDATE video_reports SET fetched_at=$1 WHERE video_id=$2',['2000-01-01T00:00:00Z',id]);
  await assert.rejects(()=>service.queryVideo(owner,id,true,async()=>new Response('secret-body',{status:500})),/无法完成查询/);
  assert.equal((await service.getVideo(owner,id)).kind,'image');assert.equal((await db.query('SELECT * FROM video_query_leases')).length,0);
  process.env.MATRIX_VIDEO_DAILY_LIMIT=String(await service.dailyUsed());
  await assert.rejects(()=>service.queryVideo(owner,id,true,transport),/额度已用完/);assert.equal(calls,3);
});
