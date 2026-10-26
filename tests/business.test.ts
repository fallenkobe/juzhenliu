import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Context } from '../packages/domain/types';

const directory=path.resolve('.data','test-'+randomUUID());
mkdirSync(directory,{recursive:true});
process.env.MATRIX_DATA_DIR=directory;process.env.DATABASE_URL='';process.env.ALPHA_MODE='demo';
const {db}=await import('../packages/db/index');
const {ensureReady,now}=await import('../packages/db/seed');
const s=await import('../packages/domain/service');
const {tick}=await import('../apps/worker/engine');
const ctx:Context={workspaceId:'test-workspace',role:'owner',userName:'Test'};
let accountId:string,assetId:string,workId:string;
before(async()=>{
  await ensureReady();
  await db.query("INSERT INTO workspaces VALUES($1,'Tests',100,100000,200000,50000,100000,1,'Asia/Hong_Kong')",[ctx.workspaceId]);
  accountId=(await s.addAccount(ctx,{nickname:'测试账号',handle:'test_account',group:'测试'})).id;
  assetId=randomUUID();await s.saveAsset(ctx,{id:assetId,title:'测试原创素材',theme:'olive',filename:null,mime:null,bytes:0,storage_key:null,content_hash:'test-content'});
  workId=randomUUID();await db.query('INSERT INTO works VALUES($1,$2,$3,$4,$5,$6,$7,0,0,0,$8)',[workId,ctx.workspaceId,accountId,assetId,'测试演示作品','public','demo_test_work',now()]);
});
after(async()=>{await db.close();if(path.dirname(directory)===path.resolve('.data')&&path.basename(directory).startsWith('test-'))rmSync(directory,{recursive:true,force:true});});
const publication=(a=accountId,asset=assetId,scenario='success')=>({assetId:asset,accountIds:[a],title:'原创内容测试',scenario});
const promotion=(amount=10000,scenario='success')=>({workIds:[workId],budgetCents:amount,goal:'plays',hours:6,scenario});

test('session token creates a server-side scoped session',async()=>{
  const token=await s.createSession();assert.ok(token.length>30);const context=await s.sessionContext(token);assert.equal(context.workspaceId,'workspace-alpha');await s.deleteSession(token);await assert.rejects(()=>s.sessionContext(token),/会话已到期/);
});
test('viewer cannot create accounts or publish',async()=>{
  const viewer={...ctx,role:'viewer' as const};await assert.rejects(()=>s.addAccount(viewer,{nickname:'x',handle:'viewer_test'}),/只读/);await assert.rejects(()=>s.previewPublish(viewer,publication()),/只读/);
});
test('cross-workspace assets and accounts are not accessible',async()=>{
  await assert.rejects(()=>s.previewPublish(ctx,publication('account-1')),/账号不存在/);
  await assert.rejects(()=>s.previewPublish(ctx,publication(accountId,'asset-1')),/素材不存在/);
});
test('SQLite concurrent account admissions enforce the quota atomically',async()=>{
  const quotaCtx={...ctx,workspaceId:'quota-test'};await db.query("INSERT INTO workspaces VALUES($1,'Quota',2,100000,200000,50000,100000,1,'Asia/Hong_Kong')",[quotaCtx.workspaceId]);
  const results=await Promise.allSettled(Array.from({length:12},(_,i)=>s.addAccount(quotaCtx,{nickname:'Q'+i,handle:'quota_'+i})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,2);
});
test('publishing is idempotent and writes one batch and one durable job',async()=>{
  const p=await s.previewPublish(ctx,publication());const key=randomUUID();
  const [a,b]=await Promise.all([s.confirmPublish(ctx,{previewId:p.previewId,requestKey:key}),s.confirmPublish(ctx,{previewId:p.previewId,requestKey:key})]);
  assert.equal(a.id,b.id);const jobs=await db.query('SELECT * FROM publish_jobs WHERE batch_id=$1',[a.id]);assert.equal(jobs.length,1);
  const data=await s.bootstrap(ctx);assert.ok(data.batches.some(batch=>batch.id===a.id));
});
test('unknown publish results never automatically resubmit; reconciliation preserves attempts',async()=>{
  const a=(await s.addAccount(ctx,{nickname:'超时测试',handle:'timeout_publish'})).id;
  const p=await s.previewPublish(ctx,publication(a,assetId,'unknown'));const b=await s.confirmPublish(ctx,{previewId:p.previewId,requestKey:randomUUID()});
  await tick('test-worker',0);let [job]=await db.query('SELECT * FROM publish_jobs WHERE batch_id=$1',[b.id]);assert.equal(job.state,'UNKNOWN');assert.equal(job.attempts,1);
  await tick('test-worker',0);[job]=await db.query('SELECT * FROM publish_jobs WHERE batch_id=$1',[b.id]);assert.equal(job.attempts,1);
  await s.reconcile(ctx,job.id,'publish');await tick('test-worker',0);[job]=await db.query('SELECT * FROM publish_jobs WHERE batch_id=$1',[b.id]);assert.equal(job.state,'SUCCEEDED');assert.equal(job.attempts,1);
});
test('new request keys cannot bypass the same account and asset intent',async()=>{
  await assert.rejects(()=>s.previewPublish(ctx,publication()),/已有该素材/);
});
test('authorization changes after preview invalidate publication confirmation',async()=>{
  const a=(await s.addAccount(ctx,{nickname:'授权变更测试',handle:'auth_change'})).id;const p=await s.previewPublish(ctx,publication(a));
  await s.updateAccount(ctx,a,{action:'expire'});await assert.rejects(()=>s.confirmPublish(ctx,{previewId:p.previewId,requestKey:randomUUID()}),/授权已变化/);
  const [count]=await db.query('SELECT COUNT(*) AS n FROM publish_jobs WHERE account_id=$1',[a]);assert.equal(Number(count.n),0);
});
test('queued jobs are blocked if authorization is revoked before dispatch',async()=>{
  const a=(await s.addAccount(ctx,{nickname:'排队撤销测试',handle:'queued_revoke'})).id;const p=await s.previewPublish(ctx,publication(a));const b=await s.confirmPublish(ctx,{previewId:p.previewId,requestKey:randomUUID()});
  await s.updateAccount(ctx,a,{action:'expire'});await tick('test-worker',0);const [job]=await db.query('SELECT * FROM publish_jobs WHERE batch_id=$1',[b.id]);assert.equal(job.state,'BLOCKED');assert.equal(job.attempts,0);
});
test('same publish request key cannot change confirmation parameters',async()=>{
  const a=(await s.addAccount(ctx,{nickname:'请求冲突测试',handle:'request_conflict'})).id;const p=await s.previewPublish(ctx,publication(a));const key=randomUUID();await s.confirmPublish(ctx,{previewId:p.previewId,requestKey:key});
  const other=await s.previewPublish(ctx,{...publication((await s.addAccount(ctx,{nickname:'第二账号',handle:'second_conflict'})).id),title:'其他内容'});await assert.rejects(()=>s.confirmPublish(ctx,{previewId:other.previewId,requestKey:key}),/请求键/);
});
test('concurrent promotion confirmation cannot exceed daily budget',async()=>{
  const previews=await Promise.all(Array.from({length:12},()=>s.previewPromotion(ctx,promotion())));
  const results=await Promise.allSettled(previews.map(p=>s.confirmPromotion(ctx,{previewId:p.previewId,requestKey:randomUUID()})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,10);
  const data=await s.bootstrap(ctx);assert.equal(data.budget.dailyUsed,100000);assert.equal(data.budget.outstanding,100000);
});
test('duplicate promotion confirmation returns original order without double reservation',async()=>{
  // Use an already-confirmed preview, even after the budget is full.
  const [batch]=await db.query('SELECT * FROM promotion_batches WHERE workspace_id=$1 LIMIT 1',[ctx.workspaceId]);const [preview]=await db.query("SELECT * FROM previews WHERE workspace_id=$1 AND kind='promotion' AND fingerprint=$2 LIMIT 1",[ctx.workspaceId,batch.fingerprint]);
  const result=await s.confirmPromotion(ctx,{previewId:preview.id,requestKey:batch.request_key});assert.equal(result.id,batch.id);
  assert.equal((await s.bootstrap(ctx)).budget.outstanding,100000);
});
test('stop request retains budget until the independent worker confirms settlement',async()=>{
  const [order]=await db.query('SELECT * FROM promotion_orders WHERE workspace_id=$1 LIMIT 1',[ctx.workspaceId]);await s.stopOrder(ctx,order.id);
  assert.equal((await s.bootstrap(ctx)).budget.outstanding,100000);
  await tick('test-worker',0);const [after]=await db.query('SELECT * FROM promotion_orders WHERE id=$1',[order.id]);assert.equal(after.delivery_state,'STOPPED');assert.equal(after.actual_cents,0);
  assert.equal((await s.bootstrap(ctx)).budget.outstanding,90000);
});
test('unknown promotion retains full reservation and explicit reconciliation does not duplicate order',async()=>{
  const p=await s.previewPromotion(ctx,promotion(10000,'unknown'));const batch=await s.confirmPromotion(ctx,{previewId:p.previewId,requestKey:randomUUID()});await tick('test-worker',0);
  const [order]=await db.query('SELECT * FROM promotion_orders WHERE batch_id=$1',[batch.id]);assert.equal(order.delivery_state,'UNKNOWN');assert.equal(order.actual_cents,null);
  await assert.rejects(()=>s.stopOrder(ctx,order.id),/结果未知/);await s.reconcile(ctx,order.id,'promotion');await tick('test-worker',0);
  const rows=await db.query('SELECT * FROM promotion_orders WHERE batch_id=$1',[batch.id]);assert.equal(rows.length,1);assert.notEqual(rows[0].delivery_state,'UNKNOWN');
});
test('budget strategy version invalidates an old confirmation and supports optimistic locking',async()=>{
  await tick('test-worker',0);await tick('test-worker',0);await tick('test-worker',0);
  const p=await s.previewPromotion(ctx,promotion());const data=await s.bootstrap(ctx);await s.updatePolicy(ctx,{dailyCents:100000,outstandingCents:200000,version:data.workspace.budget_version});
  await assert.rejects(()=>s.confirmPromotion(ctx,{previewId:p.previewId,requestKey:randomUUID()}),/预算策略/);
  await assert.rejects(()=>s.updatePolicy(ctx,{dailyCents:100000,outstandingCents:200000,version:data.workspace.budget_version}),/策略已/);
});
test('malformed monetary values are rejected before any order is created',async()=>{
  const [before]=await db.query('SELECT COUNT(*) AS n FROM promotion_orders');
  for(const value of [true,10000.5,-1,0,'10000'])await assert.rejects(()=>s.previewPromotion(ctx,{...promotion(),budgetCents:value}));
  const [after]=await db.query('SELECT COUNT(*) AS n FROM promotion_orders');assert.equal(before.n,after.n);
});
test('foreign workspace references are rejected by composite database foreign keys',async()=>{
  await assert.rejects(()=>db.query('INSERT INTO works VALUES($1,$2,$3,$4,$5,$6,$7,0,0,0,$8)',[randomUUID(),ctx.workspaceId,'account-1',assetId,'forbidden','public','demo_forbidden',now()]));
});
test('real-provider IDs cannot be used for the demo promotion path',async()=>{
  const id=randomUUID();await db.query('INSERT INTO works VALUES($1,$2,$3,$4,$5,$6,$7,0,0,0,$8)',[id,ctx.workspaceId,accountId,assetId,'unknown-provider','public','real_unverified_id',now()]);
  await assert.rejects(()=>s.previewPromotion(ctx,{...promotion(),workIds:[id]}),/不符合演示投流/);
});
