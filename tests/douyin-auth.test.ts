import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const directory=path.resolve('.data','test-oauth-'+randomUUID());mkdirSync(directory,{recursive:true});
Object.assign(process.env,{MATRIX_DATA_DIR:directory,DATABASE_URL:'',MATRIX_OWNER_PASSWORD:randomBytes(32).toString('base64url'),DOUYIN_CLIENT_KEY:'test-app',DOUYIN_CLIENT_SECRET:'test-secret',DOUYIN_REDIRECT_URI:'https://matrix.example/api/douyin/callback',DOUYIN_TOKEN_KEY:randomBytes(32).toString('hex')});
const {db}=await import('../packages/db/index');
const auth=await import('../packages/domain/douyin-auth');
const provider=await import('../packages/providers/douyin');
const tokens={access_token:'sensitive-access',refresh_token:'sensitive-refresh',open_id:'official-open-id',scope:'user_info',expires_in:3600,refresh_expires_in:7200,error_code:0};
const profile={open_id:tokens.open_id,nickname:'官方授权测试用户',avatar:'https://example.com/avatar.jpg',error_code:'0'};
const response=(data:unknown)=>new Response(JSON.stringify({data,err_no:0}),{headers:{'Content-Type':'application/json'}});
let owner:string;
let calls:{url:string;init:RequestInit}[]=[];
const transport:typeof fetch=async(input,init)=>{calls.push({url:String(input),init:init!});return response(String(input).includes('/access_token/')?tokens:profile);};
const newState=async(token=owner)=>new URL((await auth.startAuthorization(token)).url).searchParams.get('state')!;
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
before(async()=>{await db.migrate();owner=await auth.loginOwner(process.env.MATRIX_OWNER_PASSWORD);});
after(async()=>{await db.close();if(path.dirname(directory)===path.resolve('.data')&&path.basename(directory).startsWith('test-oauth-'))rmSync(directory,{recursive:true,force:true});});

test('OAuth migration upgrades idempotently and keeps original schema',async()=>{
  await db.migrate();const versions=await db.query('SELECT version FROM schema_migrations');assert.deepEqual(versions.map(v=>v.version).sort(),['001_alpha','002_douyin_oauth','003_video_analytics','004_managed_accounts','005_account_works','006_video_query_snapshots','007_publishing','008_publishing_login']);
  await db.query('SELECT id FROM accounts LIMIT 1');
});
test('configuration blocks incomplete keys, unsafe callbacks and weak owner passwords',()=>{
  const saved=process.env.DOUYIN_REDIRECT_URI;
  for(const uri of ['http://matrix.example/api/douyin/callback','https://localhost/api/douyin/callback','https://matrix.example/api/douyin/callback?x=1','https://matrix.example/wrong']){process.env.DOUYIN_REDIRECT_URI=uri;assert.equal(auth.connectionStatus().ready,false);}
  process.env.DOUYIN_REDIRECT_URI=saved;
  const key=process.env.DOUYIN_TOKEN_KEY;process.env.DOUYIN_TOKEN_KEY='abc';assert.equal(auth.connectionStatus().ready,false);process.env.DOUYIN_TOKEN_KEY=key;
  assert.equal(auth.connectionStatus().ready,true);assert.ok(!JSON.stringify(auth.connectionStatus()).includes(process.env.DOUYIN_CLIENT_SECRET!));
});
test('demo and random tokens cannot access real accounts',async()=>{
  await assert.rejects(()=>auth.listConnections('demo-session'),/会话已到期/);await assert.rejects(()=>auth.startAuthorization('random-token'),/会话已到期/);
});
test('authorization URL requests only user_info and state contains no secrets',async()=>{
  const u=new URL((await auth.startAuthorization(owner)).url);assert.equal(u.origin,'https://open.douyin.com');assert.equal(u.searchParams.get('scope'),'user_info');assert.equal(u.searchParams.get('response_type'),'code');assert.equal(u.searchParams.get('state')?.length,43);assert.ok(!u.toString().includes('test-secret'));
});
test('callback consumes state once, exchanges code, validates profile, encrypts tokens, and redacts account API',async()=>{
  calls=[];const state=await newState();await auth.finishAuthorization(owner,state,'one-use-code',false,transport);
  assert.equal(calls.length,2);assert.equal(calls[0].url,'https://open.douyin.com/oauth/access_token/');assert.equal(calls[0].init.headers&& (calls[0].init.headers as Record<string,string>)['Content-Type'],'application/x-www-form-urlencoded');
  assert.equal(new URLSearchParams(String(calls[0].init.body)).get('grant_type'),'authorization_code');assert.equal(JSON.parse(String(calls[1].init.body)).open_id,tokens.open_id);
  const [stored]=await db.query('SELECT * FROM douyin_connections');assert.ok(!stored.token_ciphertext.includes(tokens.access_token));assert.equal(auth.decryptTokens(stored.token_ciphertext,'test-app:'+tokens.open_id).access_token,tokens.access_token);
  const accounts=await auth.listConnections(owner);assert.equal(accounts[0].nickname,profile.nickname);assert.equal(accounts[0].status,'authorized');assert.ok(!JSON.stringify(accounts).includes('sensitive'));assert.equal('open_id' in accounts[0],false);
  await assert.rejects(()=>auth.finishAuthorization(owner,state,'one-use-code',false,transport),/已过期或已使用/);assert.equal(calls.length,2);
});
test('reauthorizing the same official identity updates one binding',async()=>{
  const first=(await auth.listConnections(owner))[0];await auth.finishAuthorization(owner,await newState(),'new-code',false,transport);
  const list=await auth.listConnections(owner);assert.equal(list.length,1);assert.equal(list[0].id,first.id);
});
test('state is tied to its owner session; forged and expired state never call provider',async()=>{
  const second=await auth.loginOwner(process.env.MATRIX_OWNER_PASSWORD),state=await newState();calls=[];
  await assert.rejects(()=>auth.finishAuthorization(second,state,'code',false,transport),/已过期或已使用/);
  await assert.rejects(()=>auth.finishAuthorization(owner,'forged','code',false,transport),/授权状态无效/);
  await db.query('UPDATE douyin_oauth_attempts SET expires_at=$1 WHERE state_hash=$2',['2000-01-01T00:00:00.000Z',hash(state)]);
  await assert.rejects(()=>auth.finishAuthorization(owner,state,'code',false,transport),/已过期或已使用/);assert.equal(calls.length,0);
});
test('concurrent callbacks submit a code to the provider at most once',async()=>{
  const state=await newState();calls=[];const results=await Promise.allSettled([auth.finishAuthorization(owner,state,'concurrent',false,transport),auth.finishAuthorization(owner,state,'concurrent',false,transport)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(calls.filter(c=>c.url.includes('/access_token/')).length,1);
});
test('denial consumes state and does not touch saved accounts',async()=>{
  const state=await newState();calls=[];await assert.rejects(()=>auth.finishAuthorization(owner,state,null,true,transport),/取消/);await assert.rejects(()=>auth.finishAuthorization(owner,state,'code',false,transport),/已过期或已使用/);assert.equal(calls.length,0);assert.equal((await auth.listConnections(owner)).length,1);
});
test('provider errors and mismatched identity do not overwrite saved credentials or expose provider text',async()=>{
  const [before]=await db.query('SELECT token_ciphertext FROM douyin_connections');
  const bad:typeof fetch=async()=>response({error_code:10013,description:'leaked-secret'});
  await assert.rejects(async()=>auth.finishAuthorization(owner,await newState(),'bad-code',false,bad),(e:Error)=>!e.message.includes('leaked-secret')&&e.message.includes('授权未成功'));
  const mismatch:typeof fetch=async(input)=>response(String(input).includes('/access_token/')?tokens:{...profile,open_id:'someone-else'});
  await assert.rejects(async()=>auth.finishAuthorization(owner,await newState(),'mismatch',false,mismatch),/资料校验失败/);
  const [saved]=await db.query('SELECT token_ciphertext FROM douyin_connections');assert.equal(saved.token_ciphertext,before.token_ciphertext);
});
test('malformed responses, missing scope, and network failures are safe errors',async()=>{
  await assert.rejects(()=>provider.exchangeCode('a','b','c',async()=>response({error_code:0})),/响应不完整/);
  await assert.rejects(()=>provider.exchangeCode('a','b','c',async()=>response({...tokens,scope:'other'})),/未授予/);
  await assert.rejects(()=>provider.exchangeCode('a','b','c',async()=>{throw new Error('secret-url');}),/连接失败/);
});
test('expired credentials display expired; local removal deletes ciphertext',async()=>{
  const [a]=await auth.listConnections(owner);await db.query('UPDATE douyin_connections SET expires_at=$1 WHERE id=$2',['2000-01-01T00:00:00.000Z',a.id]);assert.equal((await auth.listConnections(owner))[0].status,'expired');
  await auth.removeConnection(owner,a.id);assert.equal((await auth.listConnections(owner)).length,0);await assert.rejects(()=>auth.removeConnection(owner,a.id),/不存在/);
});
test('logout invalidates outstanding state and owner password rotation revokes sessions',async()=>{
  const state=await newState();await auth.logoutOwner(owner);await assert.rejects(()=>auth.finishAuthorization(owner,state,'code',false,transport),/会话已到期/);
  const rows=await db.query('SELECT state_hash FROM douyin_oauth_attempts WHERE state_hash=$1',[hash(state)]);assert.equal(rows.length,0);
  const token=await auth.loginOwner(process.env.MATRIX_OWNER_PASSWORD);process.env.MATRIX_OWNER_PASSWORD=randomBytes(32).toString('base64url');await assert.rejects(()=>auth.listConnections(token),/会话已到期/);
});
test('short owner password works only in local development, with sessions still revocable',async()=>{
  const saved={NODE_ENV:process.env.NODE_ENV,MATRIX_PUBLIC_ORIGIN:process.env.MATRIX_PUBLIC_ORIGIN,MATRIX_OWNER_PASSWORD:process.env.MATRIX_OWNER_PASSWORD};
  try{
    Object.assign(process.env,{NODE_ENV:'development',MATRIX_PUBLIC_ORIGIN:'',MATRIX_OWNER_PASSWORD:'dev'});
    await db.query('DELETE FROM douyin_login_limits');
    assert.equal(auth.connectionStatus().ownerConfigured,true);
    const token=await auth.loginOwner('dev');await auth.requireOwner(token);
    await assert.rejects(()=>auth.loginOwner('wrong'),/不正确/);
    process.env.MATRIX_OWNER_PASSWORD='new';await assert.rejects(()=>auth.requireOwner(token),/会话已到期/);
    process.env.MATRIX_OWNER_PASSWORD='dev';process.env.MATRIX_PUBLIC_ORIGIN='https://matrix.example';
    assert.equal(auth.ownerPasswordConfigured(),false);await assert.rejects(()=>auth.loginOwner('dev'),/至少 24 位/);
    Object.assign(process.env,{NODE_ENV:'production',MATRIX_PUBLIC_ORIGIN:''});
    assert.equal(auth.ownerPasswordConfigured(),false);await assert.rejects(()=>auth.loginOwner('dev'),/至少 24 位/);
    Object.assign(process.env,{NODE_ENV:'development',MATRIX_OWNER_PASSWORD:''});assert.equal(auth.ownerPasswordConfigured(),false);
  }finally{
    for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    await db.query('DELETE FROM douyin_login_limits');
  }
});

test('owner login rate limit is persisted and rejects repeated guesses',async()=>{
  await db.query('DELETE FROM douyin_login_limits');for(let i=0;i<10;i++)await assert.rejects(()=>auth.loginOwner('wrong'),/不正确/);await assert.rejects(()=>auth.loginOwner('wrong'),/尝试过多/);
});
