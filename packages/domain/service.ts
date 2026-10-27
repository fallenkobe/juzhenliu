import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, storageMode, type Client, type Row } from '../db/index';
import { DEMO_WORKSPACE, dayInZone, ensureReady, now } from '../db/seed';
import { AppError, type Context, type Workspace, type Account, type Bootstrap, type PublishJob, type PromotionOrder, type Asset } from './types';

const ids = z.array(z.string().min(1).max(100)).min(1).max(10).refine(a => new Set(a).size === a.length, '不能重复选择');
const scenario = z.enum(['success', 'rejected', 'unknown']).default('success');
export const accountInput = z.object({ nickname: z.string().trim().min(1).max(24), handle: z.string().trim().regex(/^[a-zA-Z0-9_]{3,32}$/, '账号标识需为 3–32 位字母、数字或下划线'), group: z.string().trim().min(1).max(20).default('未分组') }).strict();
export const publishInput = z.object({ assetId: z.string(), accountIds: ids, title: z.string().trim().min(1).max(1000), scenario }).strict();
export const promotionInput = z.object({ workIds: ids, budgetCents: z.number().int().min(10000).max(50000), goal: z.enum(['plays','followers','engagement']), hours: z.union([z.literal(6),z.literal(12),z.literal(24)]), scenario }).strict();
export const confirmInput = z.object({ previewId: z.string().uuid(), requestKey: z.string().min(8).max(100) }).strict();
export const budgetInput = z.object({ dailyCents: z.number().int().min(10000).max(10000000), outstandingCents: z.number().int().min(10000).max(20000000), version: z.number().int().positive() }).strict();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const assertWrite = (ctx: Context) => { if (ctx.role === 'viewer') throw new AppError(403, '只读成员不能执行此操作', 'FORBIDDEN'); };
export async function audit(tx: Client, workspace: string, action: string, detail: string) { await tx.query('INSERT INTO audit_events VALUES($1,$2,$3,$4,$5)', [randomUUID(),workspace,action,detail,now()]); }
export async function workspace(tx: Client, ctx: Context) {
  const [row] = await tx.query<Workspace>('SELECT * FROM workspaces WHERE id=$1', [ctx.workspaceId]);
  if (!row) throw new AppError(404, '工作空间不存在');
  return row;
}
async function getAccount(tx: Client, ctx: Context, id: string) {
  const [account] = await tx.query<Account>('SELECT * FROM accounts WHERE workspace_id=$1 AND id=$2', [ctx.workspaceId,id]);
  if (!account) throw new AppError(404, '账号不存在或无访问权限');
  return account;
}
function active(account: Account, epoch?: number) {
  if (account.status !== 'active' || (epoch !== undefined && epoch !== account.auth_epoch)) throw new AppError(409, '账号授权已变化，请重新检查并确认', 'AUTH_CHANGED');
  if (account.provider !== 'demo') throw new AppError(409, '当前版本只支持演示适配器', 'UNSUPPORTED_PROVIDER');
}
export async function createSession() {
  await ensureReady();
  const token = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO sessions VALUES($1,$2,$3,$4)', [hash(token), DEMO_WORKSPACE,'owner', new Date(Date.now()+43200000).toISOString()]);
  return token;
}
export async function sessionContext(token?: string): Promise<Context> {
  await ensureReady();
  if (!token) throw new AppError(401, '请先进入演示工作台', 'UNAUTHENTICATED');
  const [session] = await db.query('SELECT * FROM sessions WHERE token_hash=$1 AND expires_at>$2', [hash(token),now()]);
  if (!session) throw new AppError(401, '会话已到期，请重新进入', 'UNAUTHENTICATED');
  return { workspaceId: session.workspace_id, role: session.role, userName: 'Alpha 体验者' };
}
export async function deleteSession(token: string) { await db.query('DELETE FROM sessions WHERE token_hash=$1',[hash(token)]); }
export async function budgetUsage(tx: Client, ctx: Context, day: string) {
  const [daily] = await tx.query('SELECT COALESCE(SUM(COALESCE(actual_cents,budget_cents)),0) AS used FROM promotion_orders WHERE workspace_id=$1 AND confirmation_day=$2',[ctx.workspaceId,day]);
  const [risk] = await tx.query('SELECT COALESCE(SUM(budget_cents),0) AS used FROM promotion_orders WHERE workspace_id=$1 AND actual_cents IS NULL',[ctx.workspaceId]);
  return { day, dailyUsed: Number(daily.used), outstanding: Number(risk.used) };
}
export async function bootstrap(ctx: Context): Promise<Bootstrap> {
  const ws = await workspace(db,ctx);
  const [accounts,assets,works,batches,jobs,orders,metrics,events,heartbeat,budget] = await Promise.all([
    db.query('SELECT * FROM accounts WHERE workspace_id=$1 ORDER BY synced_at DESC',[ctx.workspaceId]),
    db.query('SELECT * FROM assets WHERE workspace_id=$1 ORDER BY created_at DESC',[ctx.workspaceId]),
    db.query('SELECT w.*,a.nickname,s.theme FROM works w JOIN accounts a ON a.id=w.account_id AND a.workspace_id=w.workspace_id JOIN assets s ON s.id=w.asset_id AND s.workspace_id=w.workspace_id WHERE w.workspace_id=$1 ORDER BY w.created_at DESC LIMIT 200',[ctx.workspaceId]),
    db.query('SELECT * FROM publish_batches WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100',[ctx.workspaceId]),
    db.query('SELECT j.*,a.nickname FROM publish_jobs j JOIN accounts a ON a.id=j.account_id AND a.workspace_id=j.workspace_id WHERE j.workspace_id=$1 ORDER BY j.created_at DESC LIMIT 1000',[ctx.workspaceId]),
    db.query('SELECT o.*,w.title,a.nickname,s.theme FROM promotion_orders o JOIN works w ON w.id=o.work_id AND w.workspace_id=o.workspace_id JOIN accounts a ON a.id=o.account_id AND a.workspace_id=o.workspace_id JOIN assets s ON s.id=w.asset_id AND s.workspace_id=w.workspace_id WHERE o.workspace_id=$1 ORDER BY o.created_at DESC LIMIT 200',[ctx.workspaceId]),
    db.query('SELECT account_id,day,plays,followers,likes FROM metric_points WHERE workspace_id=$1 ORDER BY day',[ctx.workspaceId]),
    db.query('SELECT id,action,detail,created_at FROM audit_events WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 30',[ctx.workspaceId]),
    db.query('SELECT * FROM worker_heartbeat ORDER BY updated_at DESC LIMIT 1'),
    budgetUsage(db,ctx,dayInZone(new Date(),ws.timezone))
  ]);
  return { version:'Alpha 0.11', mode:'demo', user:{name:ctx.userName,role:ctx.role},workspace:ws,
    accounts,assets,works,batches:batches.map(b=>({...b,jobs:jobs.filter(j=>j.batch_id===b.id)})), orders,metrics,audit:events,budget,
    worker:{online:!!heartbeat[0] && Date.now()-Date.parse(heartbeat[0].updated_at)<15000,updatedAt:heartbeat[0]?.updated_at??null}, storage:storageMode } as Bootstrap;
}
export async function addAccount(ctx: Context, value: unknown) {
  assertWrite(ctx); const input=accountInput.parse(value);
  return db.transaction(ctx.workspaceId,async tx=>{
    const ws=await workspace(tx,ctx);
    const [count]=await tx.query('SELECT COUNT(*) AS count FROM accounts WHERE workspace_id=$1',[ctx.workspaceId]);
    if(Number(count.count)>=ws.account_limit)throw new AppError(409,'演示账号额度已用完','QUOTA_EXCEEDED');
    const old=await tx.query('SELECT id FROM accounts WHERE workspace_id=$1 AND handle=$2',[ctx.workspaceId,input.handle]);
    if(old.length)throw new AppError(409,'这个账号标识已存在');
    const id=randomUUID();
    await tx.query('INSERT INTO accounts VALUES($1,$2,$3,$4,$5,$6,$7,1,0,0,0,$8,$9)',[id,ctx.workspaceId,input.nickname,input.handle,input.group,['rose','violet','teal','amber'][Number(count.count)%4],'active',now(),'demo']);
    await audit(tx,ctx.workspaceId,'添加演示账号',input.nickname+' · 未连接真实抖音账号');return{id};
  });
}
export async function updateAccount(ctx:Context,id:string,value:unknown){
  assertWrite(ctx);const input=z.object({action:z.enum(['reauthorize','expire','sync']),group:z.string().max(20).optional()}).strict().parse(value);
  return db.transaction(ctx.workspaceId,async tx=>{
    const a=await getAccount(tx,ctx,id);
    if(input.action==='sync'){active(a);await tx.query('UPDATE accounts SET synced_at=$1 WHERE workspace_id=$2 AND id=$3',[now(),ctx.workspaceId,id]);}
    else await tx.query('UPDATE accounts SET status=$1,auth_epoch=auth_epoch+1,synced_at=$2 WHERE workspace_id=$3 AND id=$4',[input.action==='expire'?'expired':'active',now(),ctx.workspaceId,id]);
    await audit(tx,ctx.workspaceId,input.action==='sync'?'同步演示账号':input.action==='expire'?'模拟授权失效':'模拟重新授权',a.nickname);return{ok:true};
  });
}
export async function saveAsset(ctx:Context,asset:Omit<Asset,'workspace_id'|'created_at'>){
  assertWrite(ctx);
  await db.transaction(ctx.workspaceId,async tx=>{
    await workspace(tx,ctx);
    const [usage]=await tx.query('SELECT COALESCE(SUM(bytes),0) AS bytes FROM assets WHERE workspace_id=$1',[ctx.workspaceId]);
    if(Number(usage.bytes)+asset.bytes>500*1024*1024)throw new AppError(409,'Alpha 素材存储上限为 500 MB');
    await tx.query('INSERT INTO assets VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[asset.id,ctx.workspaceId,asset.title,asset.theme,asset.filename,asset.mime,asset.bytes,asset.storage_key,asset.content_hash,now()]);
    await audit(tx,ctx.workspaceId,'上传原创素材',asset.title);
  });return{id:asset.id};
}
async function preview(tx:Client,ctx:Context,kind:string,payload:Row){
  const id=randomUUID(),serialized=JSON.stringify(payload),fingerprint=hash(serialized);
  await tx.query('INSERT INTO previews VALUES($1,$2,$3,$4,$5,$6)',[id,ctx.workspaceId,kind,serialized,fingerprint,new Date(Date.now()+300000).toISOString()]);
  return{previewId:id,fingerprint,...payload};
}
export async function previewPublish(ctx:Context,value:unknown){
  assertWrite(ctx);const input=publishInput.parse(value);
  return db.transaction(ctx.workspaceId,async tx=>{
    await workspace(tx,ctx);
    const [asset]=await tx.query('SELECT * FROM assets WHERE workspace_id=$1 AND id=$2',[ctx.workspaceId,input.assetId]);
    if(!asset)throw new AppError(404,'素材不存在');
    const targets=[];
    for(const id of [...input.accountIds].sort()){
      const a=await getAccount(tx,ctx,id);active(a);
      const pending=await tx.query('SELECT id FROM publish_jobs WHERE workspace_id=$1 AND account_id=$2 AND asset_id=$3',[ctx.workspaceId,id,asset.id]);
      if(pending.length)throw new AppError(409,`${a.nickname} 已有该素材的发布记录，请查看原任务`,'DUPLICATE_INTENT');
      targets.push({id:a.id,nickname:a.nickname,epoch:a.auth_epoch});
    }
    return preview(tx,ctx,'publish',{assetId:asset.id,assetHash:asset.content_hash,title:input.title,scenario:input.scenario,targets,mode:'demo'});
  });
}
async function getPreview(tx:Client,ctx:Context,id:string,kind:string){
  const [p]=await tx.query('SELECT * FROM previews WHERE workspace_id=$1 AND id=$2 AND kind=$3',[ctx.workspaceId,id,kind]);
  if(!p)throw new AppError(404,'确认单不存在');return{fingerprint:String(p.fingerprint),expires_at:String(p.expires_at),data:JSON.parse(p.payload)};
}
function fresh(p:Row){if(Date.parse(p.expires_at)<Date.now())throw new AppError(409,'确认单已过期，请重新预检','PREVIEW_EXPIRED');}
export async function confirmPublish(ctx:Context,value:unknown){
  assertWrite(ctx);const input=confirmInput.parse(value);
  return db.transaction(ctx.workspaceId,async tx=>{
    const p=await getPreview(tx,ctx,input.previewId,'publish');
    const [old]=await tx.query('SELECT * FROM publish_batches WHERE workspace_id=$1 AND request_key=$2',[ctx.workspaceId,input.requestKey]);
    if(old){if(old.fingerprint!==p.fingerprint)throw new AppError(409,'请求键已用于其他参数','IDEMPOTENCY_CONFLICT');return{id:old.id,reused:true};}
    fresh(p);const ws=await workspace(tx,ctx);
    const [asset]=await tx.query('SELECT * FROM assets WHERE workspace_id=$1 AND id=$2',[ctx.workspaceId,p.data.assetId]);
    if(!asset||asset.content_hash!==p.data.assetHash)throw new AppError(409,'素材已变化');
    for(const target of p.data.targets){active(await getAccount(tx,ctx,target.id),target.epoch);const exists=await tx.query('SELECT id FROM publish_jobs WHERE workspace_id=$1 AND account_id=$2 AND asset_id=$3',[ctx.workspaceId,target.id,asset.id]);if(exists.length)throw new AppError(409,'该账号与素材已有发布任务','DUPLICATE_INTENT');}
    const [count]=await tx.query('SELECT COUNT(*) AS n FROM accounts WHERE workspace_id=$1',[ctx.workspaceId]);if(Number(count.n)>ws.account_limit)throw new AppError(409,'工作空间账号数超过套餐额度');
    const id=randomUUID(),stamp=now();
    await tx.query('INSERT INTO publish_batches VALUES($1,$2,$3,$4,$5,$6)',[id,ctx.workspaceId,input.requestKey,p.fingerprint,p.data.title,stamp]);
    for(const t of p.data.targets)await tx.query('INSERT INTO publish_jobs VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,NULL,0,$10,$11)',[randomUUID(),ctx.workspaceId,id,t.id,asset.id,p.data.title,t.epoch,'QUEUED',p.data.scenario,stamp,stamp]);
    await audit(tx,ctx.workspaceId,'提交演示发布',`${p.data.targets.length} 个账号 · ${p.data.title}`);return{id,reused:false};
  });
}
async function promotionTarget(tx:Client,ctx:Context,id:string,epoch?:number){
  const [w]=await tx.query('SELECT * FROM works WHERE workspace_id=$1 AND id=$2',[ctx.workspaceId,id]);
  if(!w)throw new AppError(404,'作品不存在或无访问权限');
  if(w.visibility!=='public'||!w.external_id.startsWith('demo_'))throw new AppError(409,'作品暂不符合演示投流条件');
  const a=await getAccount(tx,ctx,w.account_id);active(a,epoch);return{work:w,account:a};
}
function checkBudget(ws:Workspace,usage:{dailyUsed:number;outstanding:number},amount:number,count:number){
  if(amount>ws.per_order_cents||amount*count>ws.per_batch_cents||usage.dailyUsed+amount*count>ws.daily_budget_cents||usage.outstanding+amount*count>ws.outstanding_budget_cents)throw new AppError(409,'超过单单、单批、每日确认或在途预算上限','BUDGET_EXCEEDED');
}
export async function previewPromotion(ctx:Context,value:unknown){
  assertWrite(ctx);const input=promotionInput.parse(value);
  return db.transaction(ctx.workspaceId,async tx=>{
    const ws=await workspace(tx,ctx),targets=[];
    for(const id of [...input.workIds].sort()){const {work,account}=await promotionTarget(tx,ctx,id);targets.push({id,title:work.title,accountId:account.id,nickname:account.nickname,epoch:account.auth_epoch});}
    const day=dayInZone(new Date(),ws.timezone),usage=await budgetUsage(tx,ctx,day);checkBudget(ws,usage,input.budgetCents,targets.length);
    return preview(tx,ctx,'promotion',{targets,budgetCents:input.budgetCents,totalCents:input.budgetCents*targets.length,goal:input.goal,hours:input.hours,scenario:input.scenario,budgetVersion:ws.budget_version,day,mode:'demo',funding:'演示资金账户 · 不会扣款'});
  });
}
export async function confirmPromotion(ctx:Context,value:unknown){
  assertWrite(ctx);const input=confirmInput.parse(value);
  return db.transaction(ctx.workspaceId,async tx=>{
    const p=await getPreview(tx,ctx,input.previewId,'promotion');
    const [old]=await tx.query('SELECT * FROM promotion_batches WHERE workspace_id=$1 AND request_key=$2',[ctx.workspaceId,input.requestKey]);
    if(old){if(old.fingerprint!==p.fingerprint)throw new AppError(409,'请求键参数冲突','IDEMPOTENCY_CONFLICT');return{id:old.id,reused:true};}
    fresh(p);const ws=await workspace(tx,ctx),day=dayInZone(new Date(),ws.timezone);
    if(ws.budget_version!==p.data.budgetVersion||day!==p.data.day)throw new AppError(409,'预算策略或日期已变化，请重新确认');
    for(const t of p.data.targets)await promotionTarget(tx,ctx,t.id,t.epoch);
    const usage=await budgetUsage(tx,ctx,day);checkBudget(ws,usage,p.data.budgetCents,p.data.targets.length);
    const id=randomUUID(),stamp=now();
    await tx.query('INSERT INTO promotion_batches VALUES($1,$2,$3,$4,$5)',[id,ctx.workspaceId,input.requestKey,p.fingerprint,stamp]);
    for(const t of p.data.targets)await tx.query('INSERT INTO promotion_orders VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NULL,NULL,$14,$15,$16)',[randomUUID(),ctx.workspaceId,id,t.id,t.accountId,t.epoch,p.data.budgetCents,day,p.data.goal,p.data.hours,'QUEUED','UNPAID','QUEUED',p.data.scenario,stamp,stamp]);
    await audit(tx,ctx.workspaceId,'确认演示投流',`${p.data.targets.length} 个作品 · 演示预算 ¥${(p.data.totalCents/100).toFixed(2)} · 不会扣费`);return{id,reused:false};
  });
}
export async function updatePolicy(ctx:Context,value:unknown){
  if(ctx.role!=='owner')throw new AppError(403,'仅工作空间所有者可修改预算');const input=budgetInput.parse(value);
  return db.transaction(ctx.workspaceId,async tx=>{
    const ws=await workspace(tx,ctx);if(ws.budget_version!==input.version)throw new AppError(409,'策略已由其他操作更新，请刷新');
    await tx.query('UPDATE workspaces SET daily_budget_cents=$1,outstanding_budget_cents=$2,budget_version=budget_version+1 WHERE id=$3',[input.dailyCents,input.outstandingCents,ctx.workspaceId]);
    await audit(tx,ctx.workspaceId,'更新预算策略','不影响已确认订单；只约束新演示投放');return{ok:true};
  });
}
export async function stopOrder(ctx:Context,id:string){
  assertWrite(ctx);return db.transaction(ctx.workspaceId,async tx=>{
    const [o]=await tx.query<PromotionOrder>('SELECT * FROM promotion_orders WHERE workspace_id=$1 AND id=$2',[ctx.workspaceId,id]);if(!o)throw new AppError(404,'订单不存在');
    if(o.actual_cents!==null)return{ok:true};
    if(o.delivery_state==='UNKNOWN')throw new AppError(409,'订单结果未知，请先核验，预算将继续保留');
    await tx.query("UPDATE promotion_orders SET delivery_state='STOP_REQUESTED',updated_at=$1 WHERE workspace_id=$2 AND id=$3",[now(),ctx.workspaceId,id]);
    await audit(tx,ctx.workspaceId,'申请停止演示投放','等待任务引擎确认后结算，不立即释放预算');return{ok:true};
  });
}
export async function reconcile(ctx:Context,id:string,kind:string){
  assertWrite(ctx);return db.transaction(ctx.workspaceId,async tx=>{
    if(kind==='publish'){
      const [job]=await tx.query<PublishJob>('SELECT * FROM publish_jobs WHERE workspace_id=$1 AND id=$2',[ctx.workspaceId,id]);if(!job)throw new AppError(404,'任务不存在');if(job.state!=='UNKNOWN')throw new AppError(409,'仅可核验未知结果的任务');
      await tx.query("UPDATE publish_jobs SET state='ACCEPTED',external_id=$1,error=NULL,updated_at=$2 WHERE workspace_id=$3 AND id=$4",['demo_reconciled_'+id,now(),ctx.workspaceId,id]);
    }else{
      const [o]=await tx.query<PromotionOrder>('SELECT * FROM promotion_orders WHERE workspace_id=$1 AND id=$2',[ctx.workspaceId,id]);if(!o)throw new AppError(404,'订单不存在');if(o.delivery_state!=='UNKNOWN')throw new AppError(409,'该订单不需要未知结果核验');
      await tx.query("UPDATE promotion_orders SET create_state='CREATED',payment_state='SIMULATED_PAID',delivery_state='AUDITING',external_id=$1,updated_at=$2 WHERE workspace_id=$3 AND id=$4",['demo_reconciled_'+id,now(),ctx.workspaceId,id]);
    }
    await audit(tx,ctx.workspaceId,'核验演示结果','模拟查询找回原结果，未再次提交发布或下单');return{ok:true};
  });
}
