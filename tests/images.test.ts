import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import type {AccountProfile} from '../packages/accounts/types';

Object.assign(process.env,{MATRIX_DATA_DIR:resolve('.data','images-test-'+randomUUID()),DATABASE_URL:'',MATRIX_OWNER_PASSWORD:'images-test-owner-password-32-characters',TIKHUB_API_KEY:'images-fixture-key',MATRIX_VIDEO_DAILY_LIMIT:'100',NODE_ENV:'test'});
delete process.env.MATRIX_PUBLIC_ORIGIN;
const {db}=await import('../packages/db/index');
const auth=await import('../packages/domain/douyin-auth');
const {accountImage}=await import('../packages/accounts/image-service');
const {imageCandidates,safeImageUrl}=await import('../packages/accounts/image-urls');
const {parseAccountProfile}=await import('../packages/accounts/provider');
const {parseAccountWorks}=await import('../packages/accounts/works-provider');
const {refreshManagedAccount}=await import('../packages/accounts/service');
const {dailyUsed}=await import('../packages/video/service');
const {handleVideoRequest}=await import('../packages/video/http');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1kAAAAASUVORK5CYII=','base64');
const cdn=(path:string)=>'https://p3.douyinpic.com/'+path;
const image=()=>new Response(png,{headers:{'Content-Type':'image/png','Set-Cookie':'upstream=must-not-leak'}});
const vid='7000000000000000001';
let owner:string,seq=0;
before(async()=>{await db.migrate();owner=await auth.loginOwner(process.env.MATRIX_OWNER_PASSWORD);});
after(async()=>{await db.close();});
async function saved(name:string,urls:string[]=[cdn(name+'.png')]):Promise<AccountProfile>{
  const profile:AccountProfile={uid:String(7100000000000000000n+BigInt(++seq)),secUid:'MS4wLjABAAAAimages_fixture_00000001',douyinId:'fixture_'+seq,nickname:'合成图片账号',avatarUrl:urls[0]??null,avatarUrls:urls,signature:'',followers:'1',following:'0',posts:'1',likes:'2',favorites:null,fetchedAt:'2000-01-01T00:00:00Z'};
  await db.query('INSERT INTO managed_douyin_accounts VALUES($1,$2,$3,$4)',[profile.uid,profile.douyinId,JSON.stringify(profile),profile.fetchedAt]);return profile;
}
function profileResponse(p:AccountProfile,avatar=cdn('fresh.png')){
  return {status_code:0,user:{uid:p.uid,sec_uid:p.secUid,unique_id:p.douyinId,nickname:p.nickname,avatar_larger:{url_list:[avatar]},follower_count:5}};
}

test('image candidates retain original signatures, prefer larger avatars, and reject untrusted URLs',()=>{
  for(const url of ['http://p3.douyinpic.com/a','https://localhost/a','https://127.0.0.1/a','https://p3.douyinpic.com.evil.test/a','https://user:pass@p3.douyinpic.com/a','https://p3.douyinpic.com:8080/a','data:image/png;base64,x'])assert.equal(safeImageUrl(url),null);
  const url=cdn('a.png?expires=123&signature=synthetic');assert.equal(safeImageUrl(url),url);
  assert.deepEqual(imageCandidates({url_list:[url,url,'https://evil.test/a']},cdn('backup.png')),[url,cdn('backup.png')]);
  const p={uid:'1',secUid:'MS4wLjABAAAAimages_fixture_00000001',douyinId:'fixture',nickname:'合成账号'} as AccountProfile;
  const raw=profileResponse(p);Object.assign(raw.user,{avatar_thumb:{url_list:[cdn('thumb.png')]},avatar_medium:{url_list:[cdn('medium.png')]}});
  const parsed=parseAccountProfile(raw,p.douyinId,p.secUid,p.uid);assert.equal(parsed.avatarUrl,cdn('fresh.png'));assert.deepEqual(parsed.avatarUrls,[cdn('fresh.png'),cdn('medium.png'),cdn('thumb.png')]);
  const page=parseAccountWorks({status_code:0,has_more:0,aweme_list:[{aweme_id:vid,author:{uid:p.uid},aweme_type:0,video:{cover:{url_list:[cdn('cover.png')]},origin_cover:{url_list:[cdn('origin.png')]}}}]},p,'0');
  assert.deepEqual(page.items[0].coverUrls,[cdn('cover.png'),cdn('origin.png')]);
});

test('avatar proxy tries saved backups, caches bytes and never forwards secrets or consumes query quota',async()=>{
  const p=await saved('backups',[cdn('expired.png'),cdn('working.png')]);let calls=0;const used=await dailyUsed();
  const fetcher:typeof fetch=async(url,init)=>{calls++;assert.equal(init?.redirect,'manual');const headers=new Headers(init?.headers);assert.equal(headers.get('authorization'),null);assert.equal(headers.get('cookie'),null);assert.equal(headers.get('referer'),'https://www.douyin.com/');return String(url).includes('expired')?new Response('',{status:403}):image();};
  const response=await accountImage(owner,['avatar',p.uid],fetcher);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.equal(response.headers.get('set-cookie'),null);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);assert.equal(calls,2);
  await accountImage(owner,['avatar',p.uid],fetcher);assert.equal(calls,2);assert.equal(await dailyUsed(),used);
  const http=await handleVideoRequest(new Request('http://localhost/api/videos/images/avatar/'+p.uid+'?url=https://evil.test'),['images','avatar',p.uid],owner);assert.equal(http.status,200);assert.deepEqual(Buffer.from(await http.arrayBuffer()),png);assert.equal(calls,2);
  await db.query('DELETE FROM managed_douyin_accounts WHERE uid=$1',[p.uid]);await assert.rejects(()=>accountImage(owner,['avatar',p.uid],fetcher),/不存在/);assert.equal(calls,2);
});

test('image reads require auth and previews belong to their session and expire',async()=>{
  const p=await saved('preview'),lookup=randomUUID(),session=await auth.requireOwner(owner);let calls=0;
  const fetcher:typeof fetch=async()=>{calls++;return image();};
  await assert.rejects(()=>accountImage(undefined,['avatar',p.uid],fetcher),{status:401});
  assert.equal((await handleVideoRequest(new Request('http://localhost/api/videos/images/avatar/'+p.uid),['images','avatar',p.uid])).status,401);
  await db.query('INSERT INTO account_lookups VALUES($1,$2,$3,$4,$5)',[lookup,session,p.douyinId,JSON.stringify(p),'2099-01-01T00:00:00Z']);
  const other=await auth.loginOwner(process.env.MATRIX_OWNER_PASSWORD);
  await assert.rejects(()=>accountImage(other,['preview',lookup],fetcher),/已过期/);assert.equal(calls,0);
  await accountImage(owner,['preview',lookup],fetcher);assert.equal(calls,1);
  await db.query('UPDATE account_lookups SET expires_at=$1 WHERE lookup_id=$2',['2000-01-01T00:00:00Z',lookup]);
  await assert.rejects(()=>accountImage(owner,['preview',lookup],fetcher),/已过期/);assert.equal(calls,1);
});

test('cover lookup is scoped to saved account/work pairs and supports legacy single URLs',async()=>{
  const p=await saved('cover'),other=await saved('other');let calls=0;
  const page={accountUid:p.uid,cursor:'0',hasMore:false,nextCursor:null,fetchedAt:p.fetchedAt,items:[{id:vid,title:'旧记录',kind:'video',url:'https://www.douyin.com/video/'+vid,coverUrl:cdn('legacy-cover.png'),publishedAt:null}]};
  await db.query('INSERT INTO account_work_pages VALUES($1,$2,$3,$4)',[p.uid,'0',JSON.stringify(page),p.fetchedAt]);
  const fetcher:typeof fetch=async(url)=>{calls++;assert.equal(String(url),cdn('legacy-cover.png'));return image();};
  await accountImage(owner,['cover',p.uid,vid],fetcher);assert.equal(calls,1);
  await assert.rejects(()=>accountImage(owner,['cover',other.uid,vid],fetcher),/尚未保存/);
  await assert.rejects(()=>accountImage(owner,['avatar','https://evil.test'],fetcher),/标识无效/);assert.equal(calls,1);
});

test('redirects cannot escape the image CDN allowlist and invalid content/oversized bodies are rejected',async()=>{
  for(const target of ['http://127.0.0.1/a','https://evil.test/a','https://p3.douyinpic.com.evil.test/a']){
    const p=await saved('redirect-'+seq);let calls=0;
    await assert.rejects(()=>accountImage(owner,['avatar',p.uid],async()=>{calls++;return new Response(null,{status:302,headers:{Location:target}});}),/图片暂不可用/);assert.equal(calls,1);
  }
  const responses=[()=>new Response('<html>denied</html>',{headers:{'Content-Type':'text/html'}}),()=>new Response('<script>bad</script>',{headers:{'Content-Type':'image/png'}}),()=>new Response('<svg/>',{headers:{'Content-Type':'image/svg+xml'}}),()=>new Response(png,{headers:{'Content-Type':'image/png','Content-Length':String(6*1024*1024)}}),()=>new Response(new Uint8Array(5*1024*1024+1),{headers:{'Content-Type':'image/png'}})];
  for(const response of responses){const p=await saved('invalid-'+seq);await assert.rejects(()=>accountImage(owner,['avatar',p.uid],async()=>response()),/图片暂不可用/);}
});

test('same-image concurrent loads share a single bounded download',async()=>{
  const p=await saved('concurrent');let release!:()=>void,started!:()=>void,calls=0;
  const gate=new Promise<void>(r=>release=r),start=new Promise<void>(r=>started=r);
  const fetcher:typeof fetch=async()=>{calls++;started();await gate;return image();};
  const one=accountImage(owner,['avatar',p.uid],fetcher);await start;const two=accountImage(owner,['avatar',p.uid],fetcher);release();await Promise.all([one,two]);assert.equal(calls,1);
});

test('explicit profile refresh renews image sources using stored identity, shares quota and has a cooldown',async()=>{
  const p=await saved('refresh'),used=await dailyUsed();let calls=0;
  const fetcher:typeof fetch=async(url)=>{calls++;const u=new URL(String(url));assert.equal(u.pathname,'/api/v1/douyin/app/v3/handler_user_profile');assert.equal(u.searchParams.get('sec_user_id'),p.secUid);return Response.json({code:200,data:profileResponse(p)});};
  const result=await refreshManagedAccount(owner,p.uid,fetcher);assert.equal(result.cached,false);assert.equal(result.account.avatarUrl,cdn('fresh.png'));assert.equal(result.account.addedAt,p.fetchedAt);assert.equal(await dailyUsed(),used+1);assert.equal(calls,1);
  assert.equal((await refreshManagedAccount(owner,p.uid,fetcher)).cached,true);assert.equal(calls,1);assert.equal(await dailyUsed(),used+1);
});

test('failed or conflicting profile refresh preserves saved data and blocks concurrent billing',async()=>{
  const p=await saved('refresh-failed'),used=await dailyUsed();let release!:()=>void,started!:()=>void,calls=0;
  const gate=new Promise<void>(r=>release=r),start=new Promise<void>(r=>started=r);
  const fetcher:typeof fetch=async()=>{calls++;started();await gate;return Response.json({code:200,data:profileResponse({...p,uid:'999'})});};
  const pending=refreshManagedAccount(owner,p.uid,fetcher);await start;await assert.rejects(()=>refreshManagedAccount(owner,p.uid,fetcher),/正在更新/);release();await assert.rejects(()=>pending,/不一致/);
  assert.equal(calls,1);assert.equal(await dailyUsed(),used+1);const [row]=await db.query('SELECT profile_json FROM managed_douyin_accounts WHERE uid=$1',[p.uid]);assert.deepEqual(JSON.parse(row.profile_json),p);assert.equal((await db.query('SELECT * FROM account_lookup_leases')).length,0);
});
