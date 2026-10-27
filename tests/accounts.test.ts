import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

Object.assign(process.env,{MATRIX_DATA_DIR:resolve('.data','accounts-test-'+randomUUID()),DATABASE_URL:'',MATRIX_OWNER_PASSWORD:'accounts-test-owner-password-32-characters',TIKHUB_API_KEY:'account-fixture-key',MATRIX_VIDEO_DAILY_LIMIT:'100',NODE_ENV:'test'});
delete process.env.MATRIX_PUBLIC_ORIGIN;
const {db}=await import('../packages/db/index');
const auth=await import('../packages/domain/douyin-auth');
const provider=await import('../packages/accounts/provider');
const service=await import('../packages/accounts/service');
const {dailyUsed}=await import('../packages/video/service');
const {handleVideoRequest}=await import('../packages/video/http');
const uid='7000000000000000001',sec='MS4wLjABAAAAaccounts_fixture_00000001';
const response=(data:unknown)=>new Response(JSON.stringify({code:200,data}),{headers:{'Content-Type':'application/json'}});
const profile=(id='12345678901',userId=uid)=>({status_code:0,user:{uid:userId,sec_uid:sec,unique_id:id,nickname:'合成账号',signature:'合成签名',avatar_thumb:{url_list:['javascript:alert(1)']},follower_count:'100000000000000001',following_count:0,aweme_count:null,total_favorited:-3,favoriting_count:5}});
function transport(id='12345678901',userId=uid):typeof fetch {
  return async (input,init)=>{
    const url=new URL(String(input));assert.equal(url.origin,'https://api.tikhub.io');assert.equal(init?.redirect,'error');assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer account-fixture-key');
    if(url.pathname.endsWith('fetch_user_profile_by_short_id')){assert.equal(url.searchParams.get('short_id'),id);assert.equal(url.searchParams.has('uid'),false);return response({status_code:0,data:{user:{id_str:userId,sec_uid:sec}}});}
    if(url.pathname.endsWith('handler_user_profile_v2')){assert.equal(url.searchParams.get('unique_id'),id);return response({status_code:0,user_info:{unique_id:id,sec_uid:sec}});}
    assert.equal(url.pathname,'/api/v1/douyin/app/v3/handler_user_profile');assert.equal(url.searchParams.get('sec_user_id'),sec);return response(profile(id,userId));
  };
}
let owner:string;
before(async()=>{await db.migrate();owner=await auth.loginOwner(process.env.MATRIX_OWNER_PASSWORD);});
after(async()=>{await db.close();});

test('account inputs reject URLs, whitespace, scripts and numeric JSON identifiers',()=>{
  assert.equal(provider.parseDouyinId(' 12345678901 '),'12345678901');assert.equal(provider.parseDouyinId('test_account'),'test_account');
  for(const input of [12345678901,'https://evil.test','张三','a b','x'.repeat(41),null])assert.throws(()=>provider.parseDouyinId(input));
});
test('numeric account resolution uses only Short ID before profile; exact identity and nullable counters are preserved',async()=>{
  const calls:string[]=[];const fetcher:typeof fetch=async(...args)=>{calls.push(String(args[0]));return transport()(...args);};
  const p=await provider.fetchAccount('12345678901','account-fixture-key',fetcher);
  assert.equal(calls.length,2);assert.ok(calls[0].endsWith('?short_id=12345678901'));assert.equal(p.uid,uid);assert.equal(p.followers,'100000000000000001');assert.equal(p.following,'0');assert.equal(p.posts,null);assert.equal(p.likes,'-3');assert.equal(p.avatarUrl,null);
});
test('letter IDs use unique_id; numeric failures get one alternative without guessing UID',async()=>{
  const alpha=await provider.fetchAccount('synthetic_account','account-fixture-key',transport('synthetic_account'));assert.equal(alpha.douyinId,'synthetic_account');
  const calls:string[]=[];const fallback:typeof fetch=async(...args)=>{calls.push(String(args[0]));if(String(args[0]).includes('fetch_user_profile_by_short_id'))return response({status_code:20001,data:{prompts:'not found'}});return transport()(...args);};
  await provider.fetchAccount('12345678901','account-fixture-key',fallback);assert.equal(calls.length,3);assert.ok(calls[1].includes('handler_user_profile_v2?unique_id='));
});
test('wrong account identities and underlying errors cannot become valid account profiles',async()=>{
  assert.throws(()=>provider.parseAccountProfile(profile('different'),'12345678901',sec,uid),/不一致/);
  assert.throws(()=>provider.parseAccountProfile(profile(),'12345678901',sec,'9999999999999999'),/不一致/);
  assert.throws(()=>provider.parseAccountProfile({status_code:20001},'12345678901',sec),/没有取得/);
  let calls=0;await assert.rejects(()=>provider.fetchAccount('12345678901','account-fixture-key',async()=>{calls++;return new Response('private-upstream',{status:403});}),/鉴权失败/);assert.equal(calls,1);
});
test('owner access is enforced before account queries and all account HTTP routes',async()=>{
  let calls=0;await assert.rejects(()=>service.lookupAccount('demo','12345678901',async()=>{calls++;throw new Error();}),/会话已到期/);assert.equal(calls,0);
  for(const action of [['accounts'],['accounts','lookup']]){const r=await handleVideoRequest(new Request('http://localhost/api/videos/'+action.join('/')),action);assert.equal(r.status,401);}
});
test('lookup previews are cached, session-bound and server-owned; saving does not call TikHub',async()=>{
  let calls=0;const fetcher:typeof fetch=async(...args)=>{calls++;return transport()(...args);};
  const first=await service.lookupAccount(owner,'12345678901',fetcher);assert.equal(first.cached,false);assert.equal((await service.listManagedAccounts(owner)).length,0);
  const again=await service.lookupAccount(owner,'12345678901',fetcher);assert.equal(again.lookupId,first.lookupId);assert.equal(again.cached,true);assert.equal(calls,2);assert.equal(await dailyUsed(),1);
  const second=await auth.loginOwner(process.env.MATRIX_OWNER_PASSWORD);await assert.rejects(()=>service.addManagedAccount(second,first.lookupId),/不属于当前会话/);
  const request=new Request('http://localhost/api/videos/accounts',{method:'POST',headers:{host:'localhost',origin:'http://localhost','x-matrix-request':'video-analytics-v1','content-type':'application/json'},body:JSON.stringify({lookupId:first.lookupId,profile:{uid:'forged',nickname:'forged',followers:'999'}})});
  const saved=await handleVideoRequest(request,['accounts'],owner);assert.equal(saved.status,200);
  const account=(await saved.json()).account;assert.equal(account.uid,uid);assert.equal(account.nickname,'合成账号');assert.equal(calls,2);assert.equal((await service.listManagedAccounts(owner)).length,1);
  await assert.rejects(()=>service.addManagedAccount(owner,first.lookupId),/已保存/);
  await assert.rejects(()=>service.lookupAccount(owner,'12345678901',fetcher),/已有记录/);assert.equal(calls,2);
});
test('UID uniqueness prevents duplicated accounts even across changed public IDs',async()=>{
  const preview=await service.lookupAccount(owner,'updated_account',transport('updated_account'));
  await assert.rejects(()=>service.addManagedAccount(owner,preview.lookupId),/已经添加/);assert.equal((await service.listManagedAccounts(owner)).length,1);
});
test('parallel lookups reserve budget once; daily quota blocks provider calls',async()=>{
  let ready!:()=>void,release!:()=>void;const start=new Promise<void>(r=>ready=r),gate=new Promise<void>(r=>release=r);let calls=0;
  const held:typeof fetch=async(...args)=>{calls++;ready();await gate;return transport('22345678901','7000000000000000002')(...args);};
  const pending=service.lookupAccount(owner,'22345678901',held);await start;
  await assert.rejects(()=>service.lookupAccount(owner,'22345678901',held),/正在查询/);release();await pending;assert.equal(calls,2);
  const used=await dailyUsed();process.env.MATRIX_VIDEO_DAILY_LIMIT=String(used);
  await assert.rejects(()=>service.lookupAccount(owner,'32345678901',async()=>{calls++;throw new Error();}),/额度已用完/);assert.equal(calls,2);
  process.env.MATRIX_VIDEO_DAILY_LIMIT='100';
});
test('expired previews and logged-out sessions cannot save accounts; removal changes local records only',async()=>{
  const preview=await service.lookupAccount(owner,'42345678901',transport('42345678901','7000000000000000004'));
  await db.query('UPDATE account_lookups SET expires_at=$1 WHERE lookup_id=$2',['2000-01-01T00:00:00Z',preview.lookupId]);await assert.rejects(()=>service.addManagedAccount(owner,preview.lookupId),/已过期/);
  await service.removeManagedAccount(owner,uid);assert.equal((await service.listManagedAccounts(owner)).length,0);
  await auth.logoutOwner(owner);await assert.rejects(()=>service.listManagedAccounts(owner),/会话已到期/);
});
