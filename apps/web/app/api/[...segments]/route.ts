import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { db, dataDir } from '../../../../../packages/db/index';
import { ensureReady } from '../../../../../packages/db/seed';
import * as service from '../../../../../packages/domain/service';
import { AppError, type Asset } from '../../../../../packages/domain/types';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const COOKIE='matrix_alpha_session';
function json(value:unknown,status=200){return NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});}
async function readLimited(req:NextRequest,limit:number){
  if(Number(req.headers.get('content-length')||0)>limit)throw new AppError(413,'请求内容过大');
  const reader=req.body?.getReader();if(!reader)return new Uint8Array();const chunks:Uint8Array[]=[];let bytes=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>limit){await reader.cancel();throw new AppError(413,'请求内容过大');}chunks.push(value);}}finally{reader.releaseLock();}
  const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}return buffer;
}
async function body(req:NextRequest){if(!req.headers.get('content-type')?.includes('application/json'))throw new AppError(415,'需要 JSON 请求');try{return JSON.parse(new TextDecoder().decode(await readLimited(req,65536)));}catch(e){if(e instanceof AppError)throw e;throw new AppError(400,'JSON 格式不正确');}}
function protectMutation(req:NextRequest){
  const origin=req.headers.get('origin');
  const publicHost=req.headers.get('host')||new URL(req.url).host;
  let matchesOrigin=true;
  try{matchesOrigin=!origin||new URL(origin).host===publicHost;}catch{matchesOrigin=false;}
  if(req.headers.get('x-matrix-request')!=='alpha-0.01'||req.headers.get('sec-fetch-site')==='cross-site'||!matchesOrigin)throw new AppError(403,'请求来源验证失败');
}
async function handler(req:NextRequest,options:{params:Promise<{segments:string[]}>}){
  try{
    const {segments}=await options.params;const resource=segments.join('/'),method=req.method;
    await ensureReady();
    if(method!=='GET')protectMutation(req);
    if(resource==='health'&&method==='GET')return json({ok:true,version:'Alpha 0.01',mode:'demo'});
    if(resource==='session'&&method==='POST'){
      const token=await service.createSession();const res=json({ok:true});res.cookies.set(COOKIE,token,{httpOnly:true,sameSite:'strict',secure:req.nextUrl.protocol==='https:',path:'/',maxAge:43200});return res;
    }
    const token=req.cookies.get(COOKIE)?.value;const ctx=await service.sessionContext(token);
    if(resource==='session'&&method==='GET')return json(ctx);
    if(resource==='session'&&method==='DELETE'){await service.deleteSession(token!);const res=json({ok:true});res.cookies.delete(COOKIE);return res;}
    if(resource==='bootstrap'&&method==='GET')return json(await service.bootstrap(ctx));
    if(resource==='accounts'&&method==='POST')return json(await service.addAccount(ctx,await body(req)),201);
    if(segments[0]==='accounts'&&segments.length===2&&method==='PATCH')return json(await service.updateAccount(ctx,segments[1],await body(req)));
    if(resource==='publish/previews'&&method==='POST')return json(await service.previewPublish(ctx,await body(req)));
    if(resource==='publish/batches'&&method==='POST')return json(await service.confirmPublish(ctx,await body(req)),202);
    if(resource==='promotion/previews'&&method==='POST')return json(await service.previewPromotion(ctx,await body(req)));
    if(resource==='promotion/batches'&&method==='POST')return json(await service.confirmPromotion(ctx,await body(req)),202);
    if(resource==='settings/budget'&&method==='PATCH')return json(await service.updatePolicy(ctx,await body(req)));
    if(segments.length===4&&segments[0]==='promotion'&&segments[1]==='orders'&&segments[3]==='stop'&&method==='POST')return json(await service.stopOrder(ctx,segments[2]));
    if(segments[0]==='tasks'&&segments.length===4&&segments[3]==='reconcile'&&method==='POST'){
      if(!['publish','promotion'].includes(segments[1]))throw new AppError(404,'任务类型不存在');return json(await service.reconcile(ctx,segments[2],segments[1]));
    }
    if(resource==='assets'&&method==='POST'){
      service.assertWrite(ctx);const raw=await readLimited(req,51*1024*1024);
      const form=await new Response(raw,{headers:{'content-type':req.headers.get('content-type')||''}}).formData();const file=form.get('file');
      if(!(file instanceof File)||file.size<12||file.size>50*1024*1024)throw new AppError(400,'请选择不超过 50 MB 的 MP4 或 WebM 视频');
      const buffer=Buffer.from(await file.arrayBuffer()),mp4=buffer.toString('ascii',4,8)==='ftyp',webm=buffer.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
      if(!mp4&&!webm)throw new AppError(400,'文件头不符合 MP4 / WebM 格式');
      const id=randomUUID(),storageKey=id+(mp4?'.mp4':'.webm'),title=String(form.get('title')||file.name.replace(/\.[^.]+$/,'')).trim().slice(0,80)||'未命名素材';
      const directory=path.join(dataDir,'uploads',ctx.workspaceId);await mkdir(directory,{recursive:true});const destination=path.join(directory,storageKey);
      await writeFile(destination,buffer,{flag:'wx'});
      try{return json(await service.saveAsset(ctx,{id,title,theme:'uploaded',filename:file.name.slice(0,200),mime:mp4?'video/mp4':'video/webm',bytes:file.size,storage_key:storageKey,content_hash:createHash('sha256').update(buffer).digest('hex')}),201);}catch(e){await unlink(destination).catch(()=>{});throw e;}
    }
    if(segments.length===3&&segments[0]==='assets'&&segments[2]==='content'&&method==='GET'){
      const [asset]=await db.query<Asset>('SELECT * FROM assets WHERE workspace_id=$1 AND id=$2',[ctx.workspaceId,segments[1]]);
      if(!asset?.storage_key||!/^[0-9a-f-]+\.(mp4|webm)$/.test(asset.storage_key))throw new AppError(404,'该演示素材没有视频文件');
      const buffer=await readFile(/* turbopackIgnore: true */ path.join(dataDir,'uploads',ctx.workspaceId,asset.storage_key));
      return new NextResponse(buffer,{headers:{'Content-Type':asset.mime!,'Content-Length':String(buffer.length),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
    }
    if(resource==='analytics/export'&&method==='GET'){
      const data=await service.bootstrap(ctx);const safe=(v:unknown)=>'"'+String(v).replace(/^[=+\-@]/,"'$&").replaceAll('"','""')+'"';
      const rows=[['数据来源','演示数据，不代表真实抖音指标'],['账号','日期','播放量','新增粉丝','点赞量'],...data.metrics.map(m=>[data.accounts.find(a=>a.id===m.account_id)?.nickname??m.account_id,m.day,m.plays,m.followers,m.likes])];
      return new NextResponse('\ufeff'+rows.map(r=>r.map(safe).join(',')).join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="matrix-alpha-demo.csv"','Cache-Control':'no-store'}});
    }
    throw new AppError(404,'接口不存在');
  }catch(error){
    if(error instanceof AppError)return json({error:error.message,code:error.code},error.status);
    if(error instanceof ZodError)return json({error:error.issues[0]?.message||'参数不正确',code:'VALIDATION_ERROR'},400);
    console.error('[api]',error instanceof Error?error.message:'Unexpected error');return json({error:'服务暂时不可用，请稍后重试',code:'INTERNAL_ERROR'},500);
  }
}
export { handler as GET,handler as POST,handler as PATCH,handler as DELETE };
