import { db } from '../../packages/db/index';
import { ensureReady, now } from '../../packages/db/seed';
import { audit } from '../../packages/domain/service';
import { demoProvider } from '../../packages/providers/demo';
import type { Account, PublishJob, PromotionOrder } from '../../packages/domain/types';

export async function tick(workerId = 'alpha-worker', minimumAge = 900) {
  await ensureReady();
  await db.query('INSERT INTO worker_heartbeat VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at',[workerId,now()]);
  const stale = new Date(Date.now()-60000).toISOString();
  await db.query("UPDATE publish_jobs SET state='UNKNOWN',error=$1,updated_at=$2 WHERE state='SUBMITTING' AND updated_at<$3",['提交进程中断，等待核验原结果',now(),stale]);
  await db.query("UPDATE promotion_orders SET create_state='UNKNOWN',payment_state='UNKNOWN',delivery_state='UNKNOWN',updated_at=$1 WHERE create_state='SUBMITTING' AND updated_at<$2",[now(),stale]);
  const jobs=await db.query<PublishJob>("SELECT * FROM publish_jobs WHERE state IN ('QUEUED','ACCEPTED') ORDER BY created_at LIMIT 100");
  for(const candidate of jobs){
    if(Date.now()-Date.parse(candidate.updated_at)<minimumAge)continue;
    const claimed=await db.transaction(candidate.workspace_id,async tx=>{
      const [job]=await tx.query<PublishJob>('SELECT * FROM publish_jobs WHERE workspace_id=$1 AND id=$2',[candidate.workspace_id,candidate.id]);
      if(job.state==='ACCEPTED'){
        const stamp=now();
        await tx.query('INSERT INTO works VALUES($1,$2,$3,$4,$5,$6,$7,0,0,0,$8) ON CONFLICT DO NOTHING',['work_'+job.id,job.workspace_id,job.account_id,job.asset_id,job.title,'public','demo_work_'+job.id,stamp]);
        await tx.query("UPDATE publish_jobs SET state='SUCCEEDED',updated_at=$1 WHERE workspace_id=$2 AND id=$3",[stamp,job.workspace_id,job.id]);
        await tx.query('UPDATE accounts SET posts=posts+1 WHERE workspace_id=$1 AND id=$2',[job.workspace_id,job.account_id]);
        await audit(tx,job.workspace_id,'演示发布完成',job.title+' · 已模拟核验发表结果');return null;
      }
      if(job.state!=='QUEUED')return null;
      const [account]=await tx.query<Account>('SELECT * FROM accounts WHERE workspace_id=$1 AND id=$2',[job.workspace_id,job.account_id]);
      if(!account||account.status!=='active'||account.auth_epoch!==job.auth_epoch){await tx.query("UPDATE publish_jobs SET state='BLOCKED',error=$1,updated_at=$2 WHERE workspace_id=$3 AND id=$4",['账号授权已失效或发生变化',now(),job.workspace_id,job.id]);return null;}
      await tx.query("UPDATE publish_jobs SET state='SUBMITTING',attempts=attempts+1,updated_at=$1 WHERE workspace_id=$2 AND id=$3",[now(),job.workspace_id,job.id]);return job;
    });
    if(!claimed)continue;
    const result=await demoProvider.publish(claimed.id,claimed.scenario);
    await db.transaction(claimed.workspace_id,async tx=>{await tx.query("UPDATE publish_jobs SET state=$1,external_id=$2,error=$3,updated_at=$4 WHERE workspace_id=$5 AND id=$6 AND state='SUBMITTING'",[result.state,result.externalId,result.error,now(),claimed.workspace_id,claimed.id]);});
  }
  const orders=await db.query<PromotionOrder>("SELECT * FROM promotion_orders WHERE delivery_state IN ('QUEUED','WAITING_PAYMENT','AUDITING','DELIVERING','STOP_REQUESTED') ORDER BY created_at LIMIT 100");
  for(const candidate of orders){
    if(Date.now()-Date.parse(candidate.updated_at)<minimumAge)continue;
    const claimed=await db.transaction(candidate.workspace_id,async tx=>{
      const [o]=await tx.query<PromotionOrder>('SELECT * FROM promotion_orders WHERE workspace_id=$1 AND id=$2',[candidate.workspace_id,candidate.id]);
      if(o.actual_cents!==null)return null;
      if(o.delivery_state==='STOP_REQUESTED'){
        const actual=o.create_state==='QUEUED'?0:Math.round(o.budget_cents*.24);
        await tx.query("UPDATE promotion_orders SET delivery_state='STOPPED',actual_cents=$1,updated_at=$2 WHERE workspace_id=$3 AND id=$4",[actual,now(),o.workspace_id,o.id]);
        await audit(tx,o.workspace_id,'演示投流已停止',`演示最终消耗 ¥${(actual/100).toFixed(2)}，未使用部分已释放`);return null;
      }
      if(o.delivery_state==='WAITING_PAYMENT'){await tx.query("UPDATE promotion_orders SET payment_state='SIMULATED_PAID',delivery_state='AUDITING',updated_at=$1 WHERE workspace_id=$2 AND id=$3",[now(),o.workspace_id,o.id]);return null;}
      if(o.delivery_state==='AUDITING'){await tx.query("UPDATE promotion_orders SET delivery_state='DELIVERING',updated_at=$1 WHERE workspace_id=$2 AND id=$3",[now(),o.workspace_id,o.id]);return null;}
      if(o.delivery_state==='DELIVERING'){
        if(Date.now()-Date.parse(o.updated_at)>10000||minimumAge===0){await tx.query("UPDATE promotion_orders SET delivery_state='ENDED',actual_cents=$1,updated_at=$2 WHERE workspace_id=$3 AND id=$4",[Math.round(o.budget_cents*.62),now(),o.workspace_id,o.id]);await audit(tx,o.workspace_id,'演示投流已结束','模拟结算完成，不代表真实流量或真实花费');}return null;
      }
      if(o.delivery_state!=='QUEUED'||o.create_state!=='QUEUED')return null;
      const [a]=await tx.query<Account>('SELECT * FROM accounts WHERE workspace_id=$1 AND id=$2',[o.workspace_id,o.account_id]);
      if(!a||a.status!=='active'||a.auth_epoch!==o.auth_epoch){await tx.query("UPDATE promotion_orders SET create_state='BLOCKED',delivery_state='BLOCKED',actual_cents=0,updated_at=$1 WHERE workspace_id=$2 AND id=$3",[now(),o.workspace_id,o.id]);return null;}
      await tx.query("UPDATE promotion_orders SET create_state='SUBMITTING',delivery_state='SUBMITTING',updated_at=$1 WHERE workspace_id=$2 AND id=$3",[now(),o.workspace_id,o.id]);return o;
    });
    if(!claimed)continue;
    const result=await demoProvider.promote(claimed.id,claimed.scenario);
    await db.transaction(claimed.workspace_id,async tx=>{
      if(result.scenario==='unknown')await tx.query("UPDATE promotion_orders SET create_state='UNKNOWN',payment_state='UNKNOWN',delivery_state='UNKNOWN',updated_at=$1 WHERE workspace_id=$2 AND id=$3 AND create_state='SUBMITTING'",[now(),claimed.workspace_id,claimed.id]);
      else if(result.scenario==='rejected')await tx.query("UPDATE promotion_orders SET create_state='REJECTED',delivery_state='REJECTED',actual_cents=0,external_id=$1,updated_at=$2 WHERE workspace_id=$3 AND id=$4 AND create_state='SUBMITTING'",[result.externalId,now(),claimed.workspace_id,claimed.id]);
      else await tx.query("UPDATE promotion_orders SET create_state='CREATED',delivery_state=CASE WHEN delivery_state='STOP_REQUESTED' THEN 'STOP_REQUESTED' ELSE 'WAITING_PAYMENT' END,external_id=$1,updated_at=$2 WHERE workspace_id=$3 AND id=$4 AND create_state='SUBMITTING'",[result.externalId,now(),claimed.workspace_id,claimed.id]);
    });
  }
}
