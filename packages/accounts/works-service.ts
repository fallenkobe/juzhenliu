import {randomUUID} from 'node:crypto';
import {db} from '../db/index';
import {requireOwner} from '../domain/douyin-auth';
import {AppError} from '../domain/types';
import {reserveDailyQuery,CACHE_MINUTES} from '../video/service';
import type {TikHubTransport} from '../providers/tikhub';
import type {AccountProfile} from './types';
import type {AccountWorkPage} from './works-types';
import {fetchAccountWorks,parseWorkCursor} from './works-provider';

const now=()=>new Date().toISOString();
export async function queryAccountWorks(token:string|undefined,uid:string,inputCursor:unknown,refresh=false,transport?:TikHubTransport) {
  await requireOwner(token);
  if(!/^\d{1,25}$/.test(uid))throw new AppError(400,'账号标识无效');
  const cursor=parseWorkCursor(inputCursor),lease=randomUUID();
  const result=await db.transaction(null,async tx=>{
    const [row]=await tx.query('SELECT profile_json FROM managed_douyin_accounts WHERE uid=$1',[uid]);
    if(!row)throw new AppError(404,'请先添加这个账号，再查看作品','NOT_FOUND');
    const account=JSON.parse(row.profile_json) as AccountProfile;
    const [cached]=await tx.query('SELECT page_json,fetched_at FROM account_work_pages WHERE uid=$1 AND cursor=$2',[uid,cursor]);
    if(cached){const age=Date.now()-new Date(cached.fetched_at).getTime();if(age<60000||(!refresh&&age<CACHE_MINUTES*60000))return {account,page:JSON.parse(cached.page_json) as AccountWorkPage};}
    if(!process.env.TIKHUB_API_KEY?.trim())throw new AppError(503,'请管理员在服务端配置 TIKHUB_API_KEY','PROVIDER_NOT_CONFIGURED');
    const got=await tx.query(`INSERT INTO account_work_leases VALUES($1,$2,$3,$4)
      ON CONFLICT(uid,cursor) DO UPDATE SET lease_token=excluded.lease_token,expires_at=excluded.expires_at
      WHERE account_work_leases.expires_at<=$5 RETURNING uid`,[uid,cursor,lease,new Date(Date.now()+60000).toISOString(),now()]);
    if(!got.length)throw new AppError(409,'这页作品正在加载中，请稍后重试','QUERY_RUNNING');
    await reserveDailyQuery(tx);
    return {account,page:null};
  });
  if(result.page)return {page:result.page,cached:true};
  try{
    const page=await fetchAccountWorks(result.account,cursor,process.env.TIKHUB_API_KEY!.trim(),transport);
    await requireOwner(token);
    await db.transaction(null,async tx=>{
      const valid=await tx.query('SELECT uid FROM account_work_leases WHERE uid=$1 AND cursor=$2 AND lease_token=$3 AND expires_at>$4',[uid,cursor,lease,now()]);
      if(!valid.length)throw new AppError(409,'账号已移除或作品查询已超时','QUERY_EXPIRED');
      // A refreshed first page starts a new pagination view, so discard old following-page caches.
      if(refresh&&cursor==='0')await tx.query('DELETE FROM account_work_pages WHERE uid=$1',[uid]);
      await tx.query('INSERT INTO account_work_pages VALUES($1,$2,$3,$4) ON CONFLICT(uid,cursor) DO UPDATE SET page_json=excluded.page_json,fetched_at=excluded.fetched_at',[uid,cursor,JSON.stringify(page),page.fetchedAt]);
    });
    return {page,cached:false};
  }finally{await db.query('DELETE FROM account_work_leases WHERE uid=$1 AND cursor=$2 AND lease_token=$3',[uid,cursor,lease]);}
}
