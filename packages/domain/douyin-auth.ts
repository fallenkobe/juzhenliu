import { createHash, randomBytes, randomUUID, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { db } from '../db/index';
import { AppError } from './types';
import { authorizeUrl, exchangeCode, getProfile, type Transport } from '../providers/douyin';

const stamp=()=>new Date().toISOString();
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
const expiry=(seconds:number)=>new Date(Date.now()+seconds*1000).toISOString();
export const OWNER_COOKIE='matrix_douyin_owner';
interface ConnectedAccount { id:string; nickname:string; avatar:string; scope:string; expires_at:string; connected_at:string }
const CALLBACK='/api/douyin/callback';
function config(){
  const clientKey=(process.env.DOUYIN_CLIENT_KEY||'').trim(),clientSecret=(process.env.DOUYIN_CLIENT_SECRET||'').trim(),redirectUri=(process.env.DOUYIN_REDIRECT_URI||'').trim();
  const ownerPassword=process.env.MATRIX_OWNER_PASSWORD||'',encryptionKey=process.env.DOUYIN_TOKEN_KEY||'';
  let callbackValid=false;
  try{const u=new URL(redirectUri);callbackValid=u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname===CALLBACK&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname);}catch{}
  const checks=[{name:'MATRIX_OWNER_PASSWORD',ok:ownerPassword.length>=24,hint:'至少 24 位的工作空间管理密码'},{name:'DOUYIN_CLIENT_KEY',ok:!!clientKey,hint:'具备 user_info 权限的应用 Client Key'},{name:'DOUYIN_CLIENT_SECRET',ok:!!clientSecret,hint:'应用 Client Secret，仅在服务器保存'},{name:'DOUYIN_REDIRECT_URI',ok:callbackValid,hint:'已登记的 HTTPS 回调地址，路径为 '+CALLBACK},{name:'DOUYIN_TOKEN_KEY',ok:/^[a-f0-9]{64}$/i.test(encryptionKey),hint:'32 字节随机密钥的 64 位十六进制文本'}];
  return {clientKey,clientSecret,redirectUri,ownerPassword,encryptionKey,checks};
}
export function connectionStatus(){const c=config();return{ready:c.checks.every(x=>x.ok),ownerConfigured:c.checks[0].ok,checks:c.checks,scope:'user_info',version:'0.11',authorizationOrigin:c.checks[3].ok?new URL(c.redirectUri).origin:null};}
function requireConfig(){const c=config();if(!c.checks.every(x=>x.ok))throw new AppError(503,'真实抖音登录尚未配置完整，请查看接入检查清单','OAUTH_NOT_CONFIGURED');return c;}
function ownerEpoch(){const c=config();if(c.ownerPassword.length<24)throw new AppError(503,'请先在服务器配置 MATRIX_OWNER_PASSWORD（至少 24 位）','OWNER_NOT_CONFIGURED');return hash(c.ownerPassword);}
export async function loginOwner(password:unknown){
  const epoch=ownerEpoch();
  const bucket=String(Math.floor(Date.now()/900000));
  await db.query('DELETE FROM douyin_login_limits WHERE bucket<>$1',[bucket]);
  const [limit]=await db.query('INSERT INTO douyin_login_limits VALUES($1,1) ON CONFLICT(bucket) DO UPDATE SET attempts=douyin_login_limits.attempts+1 RETURNING attempts',[bucket]);
  if(Number(limit.attempts)>10)throw new AppError(429,'登录尝试过多，请 15 分钟后重试','RATE_LIMITED');
  if(typeof password!=='string'||password.length>1024||!timingSafeEqual(Buffer.from(hash(password)),Buffer.from(epoch)))throw new AppError(401,'管理密码不正确','OWNER_INVALID');
  await db.query('DELETE FROM douyin_owner_sessions WHERE expires_at<=$1 OR owner_epoch<>$2',[stamp(),epoch]);
  const token=secret();await db.query('INSERT INTO douyin_owner_sessions VALUES($1,$2,$3)',[hash(token),epoch,expiry(43200)]);return token;
}
export async function requireOwner(token:string|undefined){
  const epoch=ownerEpoch();if(!token||token.length>256)throw new AppError(401,'请先登录真实账号工作空间','OWNER_REQUIRED');
  const [session]=await db.query('SELECT token_hash FROM douyin_owner_sessions WHERE token_hash=$1 AND owner_epoch=$2 AND expires_at>$3',[hash(token),epoch,stamp()]);
  if(!session)throw new AppError(401,'管理会话已到期，请重新登录','OWNER_REQUIRED');return session.token_hash as string;
}
export async function logoutOwner(token:string){await db.query('DELETE FROM douyin_owner_sessions WHERE token_hash=$1',[hash(token)]);}
export async function startAuthorization(token:string){
  const sessionHash=await requireOwner(token),c=requireConfig(),state=secret();
  await db.query('DELETE FROM douyin_oauth_attempts WHERE expires_at<=$1',[stamp()]);
  await db.query('INSERT INTO douyin_oauth_attempts VALUES($1,$2,$3,$4,$5)',[hash(state),sessionHash,c.clientKey,c.redirectUri,expiry(600)]);
  return {url:authorizeUrl(c.clientKey,c.redirectUri,state)};
}
function encrypt(value:string,aad:string,key:string){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);cipher.setAAD(Buffer.from(aad));
  const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');
}
// For future authorized API calls. Credentials are never part of account-list responses.
export function decryptTokens(value:string,aad:string){
  const c=requireConfig(),[version,iv,tag,payload]=value.split('.');if(version!=='v1')throw new Error('Unsupported credential format');
  const decipher=createDecipheriv('aes-256-gcm',Buffer.from(c.encryptionKey,'hex'),Buffer.from(iv,'base64url'));decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(Buffer.from(tag,'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload,'base64url')),decipher.final()]).toString('utf8'));
}
export async function finishAuthorization(token:string|undefined,state:string|null,code:string|null,denied:boolean,transport?:Transport){
  const sessionHash=await requireOwner(token),c=requireConfig();
  if(!state||!/^[A-Za-z0-9_-]{43}$/.test(state))throw new AppError(400,'授权状态无效，请重新扫码','OAUTH_STATE');
  // Atomic consume before any provider request; failed codes are never retried automatically.
  const [attempt]=await db.query('DELETE FROM douyin_oauth_attempts WHERE state_hash=$1 AND session_hash=$2 AND expires_at>$3 AND client_key=$4 AND redirect_uri=$5 RETURNING state_hash',[hash(state),sessionHash,stamp(),c.clientKey,c.redirectUri]);
  if(!attempt)throw new AppError(400,'授权已过期或已使用，请重新扫码','OAUTH_STATE');
  if(denied)throw new AppError(400,'你已取消本次抖音授权','OAUTH_DENIED');
  if(!code||code.length>4096)throw new AppError(400,'未收到有效授权码，请重新扫码','OAUTH_CODE');
  const tokens=await exchangeCode(c.clientKey,c.clientSecret,code,transport),profile=await getProfile(tokens,transport);
  // If the owner logged out while provider calls were in progress, do not persist a binding.
  await requireOwner(token);
  const id=randomUUID(),at=stamp(),ciphertext=encrypt(JSON.stringify(tokens),c.clientKey+':'+tokens.open_id,c.encryptionKey);
  await db.query(`INSERT INTO douyin_connections VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT(client_key,open_id) DO UPDATE SET nickname=excluded.nickname,avatar=excluded.avatar,scope=excluded.scope,token_ciphertext=excluded.token_ciphertext,expires_at=excluded.expires_at,refresh_expires_at=excluded.refresh_expires_at,connected_at=excluded.connected_at`,[id,c.clientKey,tokens.open_id,profile.nickname,profile.avatar,tokens.scope,ciphertext,expiry(tokens.expires_in),expiry(tokens.refresh_expires_in),at]);
  return {ok:true};
}
export async function listConnections(token:string){
  await requireOwner(token);
  const accounts=await db.query<ConnectedAccount>('SELECT id,nickname,avatar,scope,expires_at,connected_at FROM douyin_connections WHERE client_key=$1 ORDER BY connected_at DESC',[config().clientKey]);
  return accounts.map(a=>({...a,status:a.expires_at>stamp()?'authorized':'expired'}));
}
export async function removeConnection(token:string,id:string){
  await requireOwner(token);
  const deleted=await db.query('DELETE FROM douyin_connections WHERE id=$1 AND client_key=$2 RETURNING id',[id,config().clientKey]);
  if(!deleted.length)throw new AppError(404,'账号不存在','NOT_FOUND');return{ok:true};
}
