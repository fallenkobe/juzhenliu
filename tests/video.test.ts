import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

process.env.MATRIX_DATA_DIR = resolve('.data','video-test-'+randomUUID());
process.env.DATABASE_URL = '';
process.env.MATRIX_OWNER_PASSWORD = 'video-tests-owner-password-32-characters';
process.env.TIKHUB_API_KEY = 'test-key-never-real';
process.env.MATRIX_VIDEO_DAILY_LIMIT = '100';
process.env.NODE_ENV = 'test';
delete process.env.MATRIX_PUBLIC_ORIGIN;
const {db} = await import('../packages/db/index');
const auth = await import('../packages/domain/douyin-auth');
const {parseVideoId} = await import('../packages/video/input');
const provider = await import('../packages/providers/tikhub');
const service = await import('../packages/video/service');
const {handleVideoRequest,requestOrigin} = await import('../packages/video/http');
const id = '7000000000000000001';
let owner: string;
const totals = (videoId=id) => ({item_id:videoId,exist:true,watch_cnt:'100000000000000001',stats:{like_cnt:'10',comment_cnt:null,share_cnt:'-2',favorite_cnt:'0'},item:{id:videoId,title:'合成测试视频',create_time:'1704067200',duration:12.5}});
const history = () => ({base_resp:{status_code:0},date_values:{vv_list:[{visit_date:20240101,value:'12'},{visit_date:20240102,value:'0'},{visit_date:20240103,value:'8'}],like_cnt_list:[{visit_date:20240101,value:'-2'},{visit_date:20240103,value:'3'}]}});
const response = (data:unknown) => new Response(JSON.stringify({code:200,data}),{headers:{'Content-Type':'application/json'}});
const transport: typeof fetch = async (url,init) => {
  const u = new URL(String(url));
  assert.equal(u.origin,'https://api.tikhub.io'); assert.equal(init?.redirect,'error'); assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer test-key-never-real');
  return u.pathname.endsWith('get_item_play_count') ? response(totals(u.searchParams.get('item_id')!)) : response(history());
};
before(async()=>{await db.migrate();owner=await auth.loginOwner(process.env.MATRIX_OWNER_PASSWORD);});
after(async()=>{await db.close();});

test('video IDs stay exact strings and only known full URLs are accepted without fetching URLs',()=>{
  for(const value of [id,`https://www.douyin.com/video/${id}`,`https://www.douyin.com/user/self?modal_id=${id}`,`https://www.iesdouyin.com/share/video/${id}/`]) assert.equal(parseVideoId(value),id);
  for(const value of [Number(id),'https://douyin.com.evil.test/video/'+id,'http://127.0.0.1/video/'+id,'https://user:pass@douyin.com/video/'+id,'https://www.douyin.com:8443/video/'+id,'https://v.douyin.com/abc/','x'.repeat(3000)]) assert.throws(()=>parseVideoId(value));
});
test('parsers preserve zero, missing, negative and large counts with fixed identity',()=>{
  const t = provider.parseTotals(totals(),id); assert.equal(t.plays,'100000000000000001'); assert.equal(t.comments,null); assert.equal(t.shares,'-2'); assert.equal(t.collects,'0');
  assert.equal(provider.count(9007199254740992),null); assert.equal(provider.count('not available'),null);
  assert.throws(()=>provider.parseTotals(totals('7000000000000000002'),id),/身份不匹配/);
  const h = provider.parseHistory(history()); assert.equal(h.rows.length,3); assert.equal(h.start,'2024-01-01'); assert.equal(h.end,'2024-01-03'); assert.equal(h.plays,'20'); assert.equal(h.rows[1].likes,null); assert.equal(h.rows[0].likes,'-2');
});
test('missing days and malformed counters never become complete interval totals',()=>{
  const data = history();data.date_values.vv_list.splice(1,1);
  const h = provider.parseHistory(data);assert.equal(h.continuous,false);assert.equal(h.plays,null);
  const invalid = history(); invalid.date_values.vv_list[1].value='unknown';assert.equal(provider.parseHistory(invalid).plays,null);
  const dup = history(); dup.date_values.vv_list.push(dup.date_values.vv_list[0]);assert.throws(()=>provider.parseHistory(dup),/重复日期/);
  const bad = history();bad.date_values.vv_list[0].visit_date=20240231;assert.throws(()=>provider.parseHistory(bad),/无效/);
});
test('provider drops raw upstream secrets and preserves partial success',async()=>{
  const partial = await provider.fetchVideo(id,'test-key-never-real',async url=>String(url).includes('get_item_play_count')?new Response('test-key-never-real secret cache url',{status:403}):response(history()));
  assert.equal(partial.totals.data,null);assert.ok(partial.history.data);assert.ok(!JSON.stringify(partial).includes('test-key'));
  const denied = await provider.fetchVideo(id,'test-key-never-real',async()=>new Response('upstream-secret',{status:502}));
  assert.equal(denied.totals.data,null);assert.equal(denied.history.data,null);assert.ok(!JSON.stringify(denied).includes('upstream-secret'));
});
test('unauthorized queries cannot reach the provider, cache, recent list or CSV',async()=>{
  let called=0;const noCall:typeof fetch=async()=>{called++;throw new Error();};
  await assert.rejects(()=>service.queryVideo('demo-session',id,false,noCall),/会话已到期/);
  await assert.rejects(()=>service.getVideo(undefined,id),/请先登录/);assert.equal(called,0);
  for(const action of [['recent'],['reports',id],['export',id]]){const res=await handleVideoRequest(new Request('http://localhost/api/videos/'+action.join('/')),action);assert.equal(res.status,401);assert.equal(res.headers.get('Cache-Control'),'private, no-store');}
});
test('cache and CSV reads do not call provider; partial fields stay blank in export',async()=>{
  let calls=0;const fetcher:typeof fetch=async(...args)=>{calls++;return transport(...args);};
  const first=await service.queryVideo(owner,id,false,fetcher);assert.equal(first.cached,false);assert.equal(calls,2);
  const cached=await service.queryVideo(owner,id,true,fetcher);assert.equal(cached.cached,true);assert.equal(calls,2);
  assert.equal((await service.listVideos(owner))[0].videoId,id);const saved=await service.getVideo(owner,id);
  assert.equal(saved.totals.data?.plays,'100000000000000001');assert.ok(service.historyCsv(saved).includes('2024-01-02,0,,,,,'));
  assert.equal((await service.dailyUsed()),1);
});
test('persisted lease prevents concurrent double billing',async()=>{
  const next='7000000000000000002';let calls=0;let release!:()=>void;let started!:()=>void;
  const gate=new Promise<void>(r=>release=r),begun=new Promise<void>(r=>started=r);
  const held:typeof fetch=async(...args)=>{calls++;started();await gate;return transport(...args);};
  const first=service.queryVideo(owner,next,false,held);await begun;
  await assert.rejects(()=>service.queryVideo(owner,next,false,held),/正在查询/);assert.equal(calls,2);
  release();await first;assert.equal((await service.dailyUsed()),2);
});
test('daily quota is atomic and cached reports remain available after reaching it',async()=>{
  process.env.MATRIX_VIDEO_DAILY_LIMIT='2';let calls=0;
  await assert.rejects(()=>service.queryVideo(owner,'7000000000000000003',false,async()=>{calls++;return response(history());}),/额度已用完/);
  assert.equal(calls,0);assert.equal((await service.queryVideo(owner,id,false,transport)).cached,true);
  assert.equal((await service.getVideo(owner,id)).videoId,id);process.env.MATRIX_VIDEO_DAILY_LIMIT='100';
});
test('partial results save honestly; total failures preserve old data and release leases',async()=>{
  const other='7000000000000000004';const partial:typeof fetch=async url=>String(url).includes('get_item_play_count')?response(totals(other)):new Response('bad',{status:500});
  const result=await service.queryVideo(owner,other,false,partial);assert.ok(result.report.totals.data);assert.equal(result.report.history.data,null);assert.ok(result.report.history.error);
  await db.query('UPDATE video_reports SET fetched_at=$1 WHERE video_id=$2',['2000-01-01T00:00:00Z',other]);
  await assert.rejects(()=>service.queryVideo(owner,other,true,async()=>new Response('bad',{status:500})),/无法完成查询/);
  assert.ok((await service.getVideo(owner,other)).totals.data);assert.equal((await db.query('SELECT * FROM video_query_leases')).length,0);
});
test('query validation, body bounds, CSRF and secure production cookies fail closed',async()=>{
  const req=(body:string,origin='http://localhost:3000')=>new Request('http://localhost:3000/api/videos/session',{method:'POST',headers:{host:'localhost:3000',origin,'x-matrix-request':'video-analytics-v1','Content-Type':'application/json'},body});
  assert.throws(()=>requestOrigin(req('{}','https://evil.example')),/来源验证失败/);
  assert.equal((await handleVideoRequest(req('x'.repeat(5000)),['session'])).status,413);
  assert.equal((await handleVideoRequest(req('{'),['session'])).status,400);
  assert.equal((await handleVideoRequest(req('{}'),['query'])).status,401);
  const old=process.env.NODE_ENV;process.env.NODE_ENV='production';
  try {
    assert.equal((await handleVideoRequest(req('{}'),['session'])).status,503);
    process.env.MATRIX_PUBLIC_ORIGIN='https://matrix.example';
    const login=await handleVideoRequest(req(JSON.stringify({password:process.env.MATRIX_OWNER_PASSWORD}),'https://matrix.example'),['session']);
    assert.equal(login.status,200);assert.match(login.headers.get('Set-Cookie')!,/HttpOnly; SameSite=Lax; Max-Age=43200; Secure/);
  } finally {process.env.NODE_ENV=old;delete process.env.MATRIX_PUBLIC_ORIGIN;}
});
test('password rotation revokes saved-report access',async()=>{
  process.env.MATRIX_OWNER_PASSWORD='rotated-video-owner-password-32-characters';
  await assert.rejects(()=>service.getVideo(owner,id),/会话已到期/);
});
