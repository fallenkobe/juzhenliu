import { z } from 'zod';
import { AppError } from '../domain/types';

const tokenSchema=z.object({access_token:z.string().min(1),refresh_token:z.string().min(1),open_id:z.string().min(1).max(512),scope:z.string(),expires_in:z.number().int().positive().max(31536000),refresh_expires_in:z.number().int().positive().max(31536000)});
const profileSchema=z.object({open_id:z.string().min(1).max(512),nickname:z.string().min(1).max(200),avatar:z.string().max(2048).optional().default('')});
export type DouyinTokens=z.infer<typeof tokenSchema>;
export type DouyinProfile=z.infer<typeof profileSchema>;
export type Transport=typeof fetch;

async function request(endpoint:string,headers:Record<string,string>,body:string,transport:Transport){
  let response:Response;
  try{response=await transport('https://open.douyin.com'+endpoint,{method:'POST',headers,body,signal:AbortSignal.timeout(15000),redirect:'error',cache:'no-store'});}
  catch{throw new AppError(502,'抖音服务连接失败，请重新发起授权','PROVIDER_UNAVAILABLE');}
  if(!response.ok)throw new AppError(502,'抖音服务暂时不可用，请重新发起授权','PROVIDER_UNAVAILABLE');
  let value:any;
  try{value=await response.json();}catch{throw new AppError(502,'抖音返回了无效响应','PROVIDER_RESPONSE');}
  // Do not propagate provider descriptions: they can contain credentials or personal data.
  const codes=[value?.err_no,value?.error_code,value?.data?.error_code].filter(v=>v!==undefined);
  if(codes.some(code=>String(code)!=='0'))throw new AppError(502,'抖音授权未成功，请检查应用权限或重新扫码','PROVIDER_REJECTED');
  return value?.data;
}
export function authorizeUrl(clientKey:string,redirectUri:string,state:string){
  const url=new URL('https://open.douyin.com/platform/oauth/connect/');
  url.search=new URLSearchParams({client_key:clientKey,response_type:'code',scope:'user_info',redirect_uri:redirectUri,state}).toString();
  return url.toString();
}
export async function exchangeCode(clientKey:string,secret:string,code:string,transport:Transport=fetch):Promise<DouyinTokens>{
  const data=await request('/oauth/access_token/',{'Content-Type':'application/x-www-form-urlencoded'},new URLSearchParams({client_key:clientKey,client_secret:secret,code,grant_type:'authorization_code'}).toString(),transport);
  const result=tokenSchema.safeParse(data);
  if(!result.success)throw new AppError(502,'抖音令牌响应不完整，请重新授权','PROVIDER_RESPONSE');
  if(!result.data.scope.split(',').map(s=>s.trim()).includes('user_info'))throw new AppError(403,'未授予用户基本资料权限，请重新授权','MISSING_SCOPE');
  return result.data;
}
export async function getProfile(token:DouyinTokens,transport:Transport=fetch):Promise<DouyinProfile>{
  const data=await request('/oauth/userinfo/',{'Content-Type':'application/json'},JSON.stringify({access_token:token.access_token,open_id:token.open_id}),transport);
  const result=profileSchema.safeParse(data);
  if(!result.success||result.data.open_id!==token.open_id)throw new AppError(502,'抖音用户资料校验失败','PROFILE_MISMATCH');
  const profile=result.data;
  try{const url=new URL(profile.avatar);if(url.protocol!=='https:'||url.username||url.password)profile.avatar='';}catch{profile.avatar='';}
  return profile;
}
