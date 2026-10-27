import { randomUUID } from 'node:crypto';
import { db } from '../db/index';
import { requireOwner } from '../domain/douyin-auth';
import { AppError } from '../domain/types';
import { reserveDailyQuery } from '../video/service';
import type { TikHubTransport } from '../providers/tikhub';
import { fetchAccount, parseDouyinId } from './provider';
import type { AccountPreview, AccountProfile, ManagedAccount } from './types';

const now = () => new Date().toISOString();
export async function listManagedAccounts(token: string | undefined): Promise<ManagedAccount[]> {
  await requireOwner(token);
  return (await db.query('SELECT profile_json,added_at FROM managed_douyin_accounts ORDER BY added_at DESC')).map(r=>({...JSON.parse(r.profile_json) as AccountProfile,addedAt:r.added_at}));
}
export async function lookupAccount(token: string | undefined, input: unknown, transport?: TikHubTransport): Promise<AccountPreview> {
  const session = await requireOwner(token), id = parseDouyinId(input), key = process.env.TIKHUB_API_KEY?.trim();
  if (!key) throw new AppError(503,'请管理员在服务端配置 TIKHUB_API_KEY','PROVIDER_NOT_CONFIGURED');
  const lease = randomUUID();
  const cached = await db.transaction(null, async tx => {
    const at = now();
    await tx.query('DELETE FROM account_lookups WHERE expires_at<=$1',[at]);
    const existing = await tx.query('SELECT uid FROM managed_douyin_accounts WHERE douyin_id=$1',[id]);
    if (existing.length) throw new AppError(409,'这个抖音号已有记录，请在账号列表中查看','ACCOUNT_EXISTS');
    const [preview] = await tx.query('SELECT lookup_id,profile_json,expires_at FROM account_lookups WHERE session_hash=$1 AND douyin_id=$2 AND expires_at>$3 ORDER BY expires_at DESC LIMIT 1',[session,id,at]);
    if (preview) return {lookupId:preview.lookup_id,expiresAt:preview.expires_at,profile:JSON.parse(preview.profile_json) as AccountProfile,cached:true};
    const got = await tx.query(`INSERT INTO account_lookup_leases VALUES($1,$2,$3)
      ON CONFLICT(douyin_id) DO UPDATE SET lease_token=excluded.lease_token,expires_at=excluded.expires_at
      WHERE account_lookup_leases.expires_at<=$4 RETURNING douyin_id`,[id,lease,new Date(Date.now()+90000).toISOString(),at]);
    if (!got.length) throw new AppError(409,'这个账号正在查询中，请稍后重试','QUERY_RUNNING');
    await reserveDailyQuery(tx);
    return null;
  });
  if (cached) return cached;
  try {
    const profile = await fetchAccount(id,key,transport);
    await requireOwner(token);
    const lookupId = randomUUID(), expiresAt = new Date(Date.now()+600000).toISOString();
    await db.transaction(null, async tx => {
      const owned = await tx.query('SELECT douyin_id FROM account_lookup_leases WHERE douyin_id=$1 AND lease_token=$2 AND expires_at>$3',[id,lease,now()]);
      if (!owned.length) throw new AppError(409,'账号查询已超时，请重新获取信息','QUERY_EXPIRED');
      await tx.query('INSERT INTO account_lookups VALUES($1,$2,$3,$4,$5)',[lookupId,session,id,JSON.stringify(profile),expiresAt]);
    });
    return {lookupId,expiresAt,profile,cached:false};
  } finally {await db.query('DELETE FROM account_lookup_leases WHERE douyin_id=$1 AND lease_token=$2',[id,lease]);}
}
export async function addManagedAccount(token: string | undefined, lookupId: unknown): Promise<ManagedAccount> {
  const session = await requireOwner(token);
  if (typeof lookupId !== 'string' || !/^[a-f0-9-]{36}$/.test(lookupId)) throw new AppError(400,'请先获取账号信息','LOOKUP_REQUIRED');
  return db.transaction(null, async tx => {
    const [preview] = await tx.query('DELETE FROM account_lookups WHERE lookup_id=$1 AND session_hash=$2 AND expires_at>$3 RETURNING profile_json',[lookupId,session,now()]);
    if (!preview) throw new AppError(409,'账号信息已过期、已保存或不属于当前会话，请重新获取','LOOKUP_EXPIRED');
    const profile = JSON.parse(preview.profile_json) as AccountProfile, addedAt = now();
    const rows = await tx.query('INSERT INTO managed_douyin_accounts VALUES($1,$2,$3,$4) ON CONFLICT(uid) DO NOTHING RETURNING uid',[profile.uid,profile.douyinId,JSON.stringify(profile),addedAt]);
    if (!rows.length) throw new AppError(409,'该账号已经添加，不会重复保存','ACCOUNT_EXISTS');
    return {...profile,addedAt};
  });
}
export async function removeManagedAccount(token: string | undefined, uid: string) {
  await requireOwner(token);
  if (!/^\d{1,25}$/.test(uid)) throw new AppError(400,'账号标识无效');
  const removed = await db.query('DELETE FROM managed_douyin_accounts WHERE uid=$1 RETURNING uid',[uid]);
  if (!removed.length) throw new AppError(404,'账号记录不存在','NOT_FOUND');
  return {ok:true};
}
