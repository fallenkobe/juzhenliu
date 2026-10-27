import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import type {AccountProfile} from '../packages/accounts/types';

Object.assign(process.env,{MATRIX_DATA_DIR:resolve('.data','works-test-'+randomUUID()),DATABASE_URL:'',MATRIX_OWNER_PASSWORD:'works-test-owner-password-32-characters',TIKHUB_API_KEY:'works-fixture-key',MATRIX_VIDEO_DAILY_LIMIT:'100',NODE_ENV:'test'});
delete process.env.MATRIX_PUBLIC_ORIGIN;
const {db}=await import('../packages/db/index');
const auth=await import('../packages/domain/douyin-auth');
const {parseAccountWorks,parseWorkCursor}=await import('../packages/accounts/works-provider');
const {queryAccountWorks,savedAccountWorks}=await import('../packages/accounts/works-service');
const {workspaceReturnPath}=await import('../packages/domain/workspace-path');
const {dailyUsed}=await import('../packages/video/service');
const {handleVideoRequest}=await import('../packages/video/http');
const account:AccountProfile={uid:'7000000000000000001',secUid:'MS4wLjABAAAAworks_fixture_00000001',douyinId:'12345678901',nickname:'合成作品账号',avatarUrl:null,signature:'',followers:null,following:'0',posts:'3',likes:null,favorites:null,fetchedAt:new Date().toISOString()};
const id='7000000000000000001';
let owner:string;
const item=(videoId=id,type=0)=>({aweme_id:videoId,desc:'合成作品',aweme_type:type,author:{uid:account.uid,sec_uid:account.secUid},create_time:1704067200,share_url:`https://www.iesdouyin.com/share/${type===68?'note':'video'}/${videoId}/?tracking=removed`,video:{cover:{url_list:['https://evil.test/track.png','https://p3.douyinpic.com/synthetic.jpg']}}});
const page=(cursor='0')=>({status_code:0,uid:account.uid,sec_uid:account.secUid,has_more:cursor==='0'?1:0,max_cursor:100,aweme_list:[item()]});
const response=(data:unknown)=>new Response(JSON.stringify({code:200,data}),{headers:{'Content-Type':'application/json'}});
const transport:typeof fetch=async(input,init)=>{const u=new URL(String(input));assert.equal(u.origin,'https://api.tikhub.io');assert.equal(u.pathname,'/api/v1/douyin/app/v3/fetch_user_post_videos');assert.equal(u.searchParams.get('sec_user_id'),account.secUid);assert.equal(u.searchParams.get('count'),'20');assert.equal(u.searchParams.get('channel'),'normal');assert.equal(init?.redirect,'error');return response(page(u.searchParams.get('max_cursor')!));};
before(async()=>{await db.migrate();owner=await auth.loginOwner(process.env.MATRIX_OWNER_PASSWORD);await db.query('INSERT INTO managed_douyin_accounts VALUES($1,$2,$3,$4)',[account.uid,account.douyinId,JSON.stringify(account),account.fetchedAt]);});
after(async()=>{await db.close();});

test('work cursors are bounded canonical strings, not arbitrary URL or numeric JSON',()=>{
  assert.equal(parseWorkCursor(undefined),'0');assert.equal(parseWorkCursor('000100'),'100');
  for(const v of [100,'-1','https://evil.test','1.5','x'.repeat(30)])assert.throws(()=>parseWorkCursor(v));
});
test('work parsing preserves IDs, removes tracking URLs and distinguishes video/image/unknown',()=>{
  const data=page();data.has_more=0;data.aweme_list=[item(),item('7000000000000000002',68),item('7000000000000000002',68)];
  const result=parseAccountWorks(data,account,'0');assert.equal(result.items.length,2);assert.equal(result.items[0].kind,'video');assert.equal(result.items[1].kind,'image');assert.equal(result.items[1].url,'https://www.douyin.com/note/7000000000000000002');assert.ok(!JSON.stringify(result).includes('tracking='));assert.equal(result.items[0].coverUrl,'https://p3.douyinpic.com/synthetic.jpg');
  const odd={...item(),aweme_type:999,share_url:'https://evil.test/video/'+id,create_time:0};
  const unknown=parseAccountWorks({...data,aweme_list:[odd]},account,'0').items[0];assert.equal(unknown.kind,'other');assert.equal(unknown.publishedAt,null);
});
test('foreign authors, foreign account envelopes and malformed IDs reject the entire page',()=>{
  assert.throws(()=>parseAccountWorks({...page(),uid:'another-account'},account,'0'),/身份不匹配/);
  assert.throws(()=>parseAccountWorks({...page(),aweme_list:[{...item(),author:{uid:'someone-else'}}]},account,'0'),/作者/);
  assert.throws(()=>parseAccountWorks({...page(),aweme_list:[{...item(),aweme_id:12345}]},account,'0'),/作品ID/);
});
test('pagination failures are not mistaken for completion; genuinely empty pages are allowed',()=>{
  assert.throws(()=>parseAccountWorks({...page(),max_cursor:0},account,'0'),/游标/);
  assert.throws(()=>parseAccountWorks({...page(),max_cursor:9007199254740992},account,'0'),/游标/);
  assert.throws(()=>parseAccountWorks({...page(),has_more:undefined},account,'0'),/不完整/);
  assert.throws(()=>parseAccountWorks({...page(),status_code:20001},account,'0'),/不可用/);
  const empty=parseAccountWorks({...page(),aweme_list:null,has_more:0},account,'0');assert.equal(empty.items.length,0);assert.equal(empty.hasMore,false);assert.equal(empty.nextCursor,null);
});
test('auth and saved-account existence are checked before any provider call',async()=>{
  let calls=0;const denied:typeof fetch=async()=>{calls++;throw new Error();};
  await assert.rejects(()=>queryAccountWorks('demo',account.uid,'0',false,denied),/会话已到期/);
  await assert.rejects(()=>queryAccountWorks(owner,'7000000000000000999','0',false,denied),/先添加/);assert.equal(calls,0);
});
test('page queries use the stored account identity, cache each cursor and share daily quota',async()=>{
  let calls=0;const counted:typeof fetch=async(...args)=>{calls++;return transport(...args);};
  const first=await queryAccountWorks(owner,account.uid,'0',false,counted);assert.equal(first.cached,false);assert.equal(first.page.nextCursor,'100');
  assert.equal((await queryAccountWorks(owner,account.uid,'000',true,counted)).cached,true);assert.equal(calls,1);
  const next=await queryAccountWorks(owner,account.uid,first.page.nextCursor,false,counted);assert.equal(next.page.hasMore,false);assert.equal(calls,2);assert.equal(await dailyUsed(),2);
});
test('saved-page navigation reads stale complete cursor chains without provider config or quota',async()=>{
  const used=await dailyUsed();const key=process.env.TIKHUB_API_KEY;process.env.TIKHUB_API_KEY='';
  try{
    await db.query('UPDATE account_work_pages SET fetched_at=$1 WHERE uid=$2',['2000-01-01T00:00:00Z',account.uid]);
    await assert.rejects(()=>savedAccountWorks('demo',account.uid),/会话已到期/);
    await assert.rejects(()=>savedAccountWorks(owner,'invalid'),/标识无效/);
    await assert.rejects(()=>savedAccountWorks(owner,'7000000000000000999'),/先添加/);
    const pages=await savedAccountWorks(owner,account.uid);assert.deepEqual(pages.map(p=>p.cursor),['0','100']);assert.equal(await dailyUsed(),used);
    const response=await handleVideoRequest(new Request('http://localhost/api/videos/accounts/'+account.uid+'/works'),['accounts',account.uid,'works'],owner);
    assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.deepEqual((await response.json()).pages.map((p:{cursor:string})=>p.cursor),['0','100']);assert.equal(await dailyUsed(),used);
    await db.query('INSERT INTO account_work_pages VALUES($1,$2,$3,$4)',[account.uid,'999',JSON.stringify({...pages[0],cursor:'999'}),account.fetchedAt]);
    assert.equal((await savedAccountWorks(owner,account.uid)).length,2);
    await db.query('DELETE FROM account_work_pages WHERE uid=$1 AND cursor=$2',[account.uid,'999']);
  }finally{process.env.TIKHUB_API_KEY=key;}
});

test('workspace return paths preserve account context while rejecting external and malformed destinations',()=>{
  for(const path of ['/accounts?accountUid='+account.uid,'/videos?videoId='+id+'&accountUid='+account.uid])assert.equal(workspaceReturnPath(path),path);
  for(const path of ['//evil.example','/accounts?accountUid=evil','/videos?videoId='+id+'&accountUid='+account.uid+'&next=https://evil.example','/accounts?accountUid='+account.uid+'#bad'])assert.equal(workspaceReturnPath(path),'/accounts');
});

test('failed refresh retains the previous page and releases leases',async()=>{
  await db.query('UPDATE account_work_pages SET fetched_at=$1 WHERE uid=$2',['2000-01-01T00:00:00Z',account.uid]);
  await assert.rejects(()=>queryAccountWorks(owner,account.uid,'0',true,async()=>new Response('upstream-private',{status:500})),/无法完成/);
  assert.equal((await db.query('SELECT * FROM account_work_pages WHERE uid=$1',[account.uid])).length,2);assert.equal((await db.query('SELECT * FROM account_work_leases')).length,0);
});
test('successful first-page refresh invalidates old following-page cache',async()=>{
  await queryAccountWorks(owner,account.uid,'0',true,transport);
  assert.equal((await db.query('SELECT cursor FROM account_work_pages WHERE uid=$1',[account.uid])).length,1);
});
test('concurrent loads bill once; exhausted quota and missing key still allow cache reads',async()=>{
  let started!:()=>void,release!:()=>void;const start=new Promise<void>(r=>started=r),gate=new Promise<void>(r=>release=r);let calls=0;
  const held:typeof fetch=async(...args)=>{calls++;started();await gate;return transport(...args);};
  const pending=queryAccountWorks(owner,account.uid,'200',false,held);await start;await assert.rejects(()=>queryAccountWorks(owner,account.uid,'200',false,held),/正在加载/);release();await pending;assert.equal(calls,1);
  process.env.MATRIX_VIDEO_DAILY_LIMIT=String(await dailyUsed());await assert.rejects(()=>queryAccountWorks(owner,account.uid,'201',false,held),/额度已用完/);assert.equal(calls,1);
  process.env.TIKHUB_API_KEY='';assert.equal((await queryAccountWorks(owner,account.uid,'0')).cached,true);process.env.TIKHUB_API_KEY='works-fixture-key';process.env.MATRIX_VIDEO_DAILY_LIMIT='100';
});
test('removing the account cascades its work caches and denies subsequent reads',async()=>{
  await db.query('DELETE FROM managed_douyin_accounts WHERE uid=$1',[account.uid]);assert.equal((await db.query('SELECT * FROM account_work_pages')).length,0);
  await assert.rejects(()=>queryAccountWorks(owner,account.uid,'0',false,transport),/先添加/);await assert.rejects(()=>savedAccountWorks(owner,account.uid),/先添加/);
});
