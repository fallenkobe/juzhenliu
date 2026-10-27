import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../../../../packages/db/index';
import * as auth from '../../../../../../packages/domain/douyin-auth';
import { AppError } from '../../../../../../packages/domain/types';

export const runtime='nodejs';
export const dynamic='force-dynamic';
// Independent auth migration readiness; do not reuse the demo seed readiness promise.
const globalAuth=globalThis as typeof globalThis & {matrixOAuthReady?:Promise<void>};
function json(value:unknown,status=200){return NextResponse.json(value,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}
function mutationOrigin(req:NextRequest){
  const origin=req.headers.get('origin');let valid=false;
  try{const u=new URL(origin||'');valid=u.host===req.headers.get('host')&&['http:','https:'].includes(u.protocol);}catch{}
  if(!valid||req.headers.get('x-matrix-request')!=='douyin-0.11'||req.headers.get('sec-fetch-site')==='cross-site')throw new AppError(403,'请求来源验证失败','ORIGIN_REJECTED');
}
async function smallJson(req:NextRequest){
  if(!req.headers.get('content-type')?.includes('application/json'))throw new AppError(415,'需要 JSON 请求');
  const reader=req.body?.getReader();if(!reader)throw new AppError(400,'请求内容为空');
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();throw new AppError(413,'请求内容过大');}chunks.push(value);}}finally{reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AppError(400,'JSON 格式不正确');}
}
async function handler(req:NextRequest,{params}:{params:Promise<{action:string[]}>}){
  const {action}=await params,resource=action.join('/'),token=req.cookies.get(auth.OWNER_COOKIE)?.value;
  try{
    await (globalAuth.matrixOAuthReady??=db.migrate());
    if(req.method!=='GET')mutationOrigin(req);
    if(resource==='status'&&req.method==='GET'){
      const status=auth.connectionStatus();let signedIn=false;
      if(status.ownerConfigured&&token)try{await auth.requireOwner(token);signedIn=true;}catch(e){if(!(e instanceof AppError)||e.status!==401)throw e;}
      return json({...status,signedIn,accounts:signedIn?await auth.listConnections(token!):[]});
    }
    if(resource==='owner'&&req.method==='POST'){
      const body=await smallJson(req),value=await auth.loginOwner(body?.password),res=json({ok:true});
      res.cookies.set(auth.OWNER_COOKIE,value,{httpOnly:true,sameSite:'lax',secure:new URL(req.headers.get('origin')!).protocol==='https:',path:'/',maxAge:43200});return res;
    }
    if(resource==='owner'&&req.method==='DELETE'){
      if(token)await auth.logoutOwner(token);const res=json({ok:true});res.cookies.delete(auth.OWNER_COOKIE);return res;
    }
    if(resource==='authorize'&&req.method==='POST'){
      await auth.requireOwner(token);const status=auth.connectionStatus();
      if(!status.ready)throw new AppError(503,'请先完成真实抖音登录配置','OAUTH_NOT_CONFIGURED');
      // OAuth must start and finish on the same site so the owner cookie can bind state.
      if(req.headers.get('origin')!==status.authorizationOrigin)throw new AppError(409,'请从已配置的 HTTPS 回调域名打开本工作台后再扫码','CALLBACK_ORIGIN');
      return json(await auth.startAuthorization(token!));
    }
    if(resource==='callback'&&req.method==='GET'){
      const p=req.nextUrl.searchParams;
      await auth.finishAuthorization(token,p.get('state'),p.get('code'),p.has('error')||(p.has('error_code')&&p.get('error_code')!=='0'));
      return redirect('connected');
    }
    if(action.length===2&&action[0]==='accounts'&&req.method==='DELETE')return json(await auth.removeConnection(token||'',action[1]));
    return json({error:'接口不存在'},404);
  }catch(error){
    if(resource==='callback'&&req.method==='GET')return redirect(error instanceof AppError?error.code:'INTERNAL_ERROR');
    if(error instanceof AppError)return json({error:error.message,code:error.code},error.status);
    // Never log authorization URLs, codes, tokens, or upstream response bodies.
    console.error('[douyin-auth] Internal error');return json({error:'登录服务暂时不可用，请稍后重试',code:'INTERNAL_ERROR'},500);
  }
}
function redirect(result:string){return new NextResponse(null,{status:303,headers:{Location:'/douyin?result='+encodeURIComponent(result),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}
export {handler as GET,handler as POST,handler as DELETE};
